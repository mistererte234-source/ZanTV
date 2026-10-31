#!/usr/bin/env node
/* ZanTV API: login, peran (admin/user), dan penyimpanan playlist.
 * Hanya memakai modul bawaan Node.js (tanpa npm install). Butuh Node 18+.
 *
 * Jalankan server:       node server.js
 * Buat/ubah akun:        node server.js add-user <nama> <admin|user>
 * Ganti kata sandi:      node server.js passwd <nama>
 * Daftar akun:           node server.js list-users
 * Hapus akun:            node server.js del-user <nama>
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const readline = require('readline');

const PORT = +(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.ZANTV_DATA || '/var/lib/zantv';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== '0';
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PL_DIR = path.join(DATA_DIR, 'playlists');
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_M3U = 15 * 1024 * 1024;
const COOKIE = 'zantv_sid';

/* ---------------- penyimpanan ---------------- */
fs.mkdirSync(PL_DIR, { recursive: true, mode: 0o700 });
let db = { users: {}, sessions: {}, playlists: [] };
let dbMtime = 0;
function load() {
  try {
    const st = fs.statSync(DB_FILE);
    if (st.mtimeMs === dbMtime) return;
    db = Object.assign({ users: {}, sessions: {}, playlists: [] }, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    dbMtime = st.mtimeMs;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
  dbMtime = fs.statSync(DB_FILE).mtimeMs;
}
load();

/* ---------------- kata sandi & sesi ---------------- */
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function checkPassword(user, pw) {
  const h = hashPassword(pw, user.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(user.hash, 'hex'));
}
const DUMMY = hashPassword('dummy-password');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const validName = (n) => typeof n === 'string' && /^[a-z0-9._-]{3,32}$/.test(n);
const validPass = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

function createSession(name) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions[sha(token)] = { user: name, exp: Date.now() + SESSION_MS };
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < Date.now()) delete db.sessions[k];
  save();
  return token;
}
function dropSessionsOf(name) {
  for (const [k, s] of Object.entries(db.sessions)) if (s.user === name) delete db.sessions[k];
}
function sessionUser(req) {
  const m = /(?:^|;\s*)zantv_sid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = db.sessions[sha(m[1])];
  if (!s || s.exp < Date.now() || !db.users[s.user]) return null;
  return { name: s.user, role: db.users[s.user].role, key: sha(m[1]) };
}
function cookie(token, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${COOKIE_SECURE ? '; Secure' : ''}`;
}

/* batas percobaan login: 5 gagal per IP → kunci 10 menit */
const attempts = new Map();
function loginBlocked(ip) {
  const a = attempts.get(ip);
  return a && a.until > Date.now();
}
function loginFailed(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  a.n++;
  if (a.n >= 5) { a.until = Date.now() + 10 * 60 * 1000; a.n = 0; }
  attempts.set(ip, a);
}

/* ---------------- ambil playlist dari internet (khusus admin) ---------------- */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
async function assertPublicUrl(u) {
  let url;
  try { url = new URL(u); } catch (e) { throw new Error('Alamat tidak valid'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Alamat harus diawali http:// atau https://');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('Alamat menuju jaringan internal tidak diizinkan');
  return url;
}
async function fetchM3U(u) {
  let url = await assertPublicUrl(u);
  for (let hop = 0; hop < 4; hop++) {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'ZanTV/1.2' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = await assertPublicUrl(new URL(r.headers.get('location'), url).toString());
      continue;
    }
    if (!r.ok) throw new Error('Server playlist menjawab kode ' + r.status);
    const len = +(r.headers.get('content-length') || 0);
    if (len > MAX_M3U) throw new Error('Playlist terlalu besar');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_M3U) throw new Error('Playlist terlalu besar');
    return buf.toString('utf8');
  }
  throw new Error('Terlalu banyak pengalihan alamat');
}
/* ---------------- ubah http → https otomatis ----------------
 * Untuk setiap alamat stream http di playlist, server mencoba versi https-nya.
 * Yang berhasil dijawab server tujuan (dengan sertifikat sah) diganti di playlist.
 */
const hostOk = new Map(); // host → { ok, ts } supaya DNS tidak dicek berulang
async function publicHost(url) {
  const h = url.hostname;
  const c = hostOk.get(h);
  if (c && Date.now() - c.ts < 10 * 60 * 1000) return c.ok;
  let ok = false;
  try { await assertPublicUrl(url.toString()); ok = true; } catch (e) {}
  hostOk.set(h, { ok, ts: Date.now() });
  return ok;
}
async function httpsWorks(httpUrl) {
  let u;
  try { u = new URL(httpUrl); } catch (e) { return false; }
  if (u.protocol !== 'http:') return false;
  u.protocol = 'https:';
  if (!(await publicHost(u))) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(u, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'ZanTV/1.4' } });
    ctrl.abort(); // cukup lihat jawabannya, tidak perlu mengunduh isi stream
    return r.status >= 200 && r.status < 400;
  } catch (e) {
    return false;
  } finally { clearTimeout(timer); }
}
function streamUrls(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim();
    if (l && l[0] !== '#' && /^http:\/\//i.test(l)) out.push(l.split('|')[0]);
  }
  return out;
}
const upgrading = new Set();
async function upgradePlaylist(id) {
  if (upgrading.has(id)) return;
  upgrading.add(id);
  try {
    let pl = db.playlists.find((x) => x.id === id);
    if (!pl) return;
    const file = path.join(PL_DIR, id + '.m3u');
    const text = fs.readFileSync(file, 'utf8');
    const urls = Array.from(new Set(streamUrls(text)));
    const good = new Set();
    let i = 0;
    async function worker() {
      while (i < urls.length) {
        const u = urls[i++];
        if (await httpsWorks(u)) good.add(u);
      }
    }
    await Promise.all(Array.from({ length: Math.min(10, urls.length) }, worker));
    // tulis ulang hanya baris alamat stream yang terbukti bisa https
    const lines = text.split(/(\r?\n)/);
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k].trim();
      if (!l || l[0] === '#') continue;
      const base = l.split('|')[0];
      if (good.has(base)) lines[k] = lines[k].replace(/http:\/\//i, 'https://');
    }
    load();
    pl = db.playlists.find((x) => x.id === id);
    if (!pl) return; // dihapus selama pengecekan
    if (good.size) fs.writeFileSync(file, lines.join(''));
    Object.assign(pl, { httpsChecked: Date.now(), httpUpgraded: good.size, httpLeft: urls.length - good.size });
    if (good.size) pl.updatedAt = Date.now();
    save();
    console.log(`Playlist ${pl.name}: ${good.size} alamat diganti ke https, ${urls.length - good.size} tetap http`);
  } catch (e) {
    console.error('Cek https gagal:', e.message);
  } finally { upgrading.delete(id); }
}

function countChannels(text) {
  let n = 0;
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim();
    if (l && l[0] !== '#' && /^(https?|rtmp|rtsp|udp):|^\/\//i.test(l)) n++;
  }
  return n;
}

/* ---------------- log aktivitas ---------------- */
const LOG_FILE = path.join(DATA_DIR, 'activity.jsonl');
const LOG_DAYS = +(process.env.ZANTV_LOG_DAYS || 90);
const presence = new Map(); // nama → { ts, channel, ip, device } (hanya di memori)

function parseUA(ua) {
  ua = String(ua || '');
  let os = 'Tidak diketahui', browser = 'Tidak diketahui', type = 'Komputer';
  let m;
  if (/Android TV|AFT[A-Z]|BRAVIA|SMART-TV|SmartTV|Tizen|Web0S|webOS|GoogleTV|HbbTV/i.test(ua)) type = 'TV';
  if ((m = /Android ([\d.]+)/.exec(ua))) { os = 'Android ' + m[1]; if (type !== 'TV') type = /Mobile/.test(ua) ? 'HP' : 'Tablet'; }
  else if ((m = /(iPhone|iPad|iPod).*?OS ([\d_]+)/.exec(ua))) { os = (m[1] === 'iPad' ? 'iPadOS ' : 'iOS ') + m[2].replace(/_/g, '.'); type = m[1] === 'iPad' ? 'Tablet' : 'HP'; }
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Tizen/.test(ua)) os = 'Tizen';
  else if (/Web0S|webOS/i.test(ua)) os = 'webOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  if ((m = /Edg(?:A|iOS)?\/(\d+)/.exec(ua))) browser = 'Edge ' + m[1];
  else if ((m = /SamsungBrowser\/(\d+)/.exec(ua))) browser = 'Samsung Internet ' + m[1];
  else if ((m = /OPR\/(\d+)/.exec(ua))) browser = 'Opera ' + m[1];
  else if ((m = /Firefox\/(\d+)/.exec(ua))) browser = 'Firefox ' + m[1];
  else if ((m = /(?:Chrome|CriOS)\/(\d+)/.exec(ua))) browser = 'Chrome ' + m[1];
  else if ((m = /Version\/(\d+).*Safari/.exec(ua))) browser = 'Safari ' + m[1];
  // model perangkat hanya ada kalau browser masih menyertakannya (banyak browser modern menyembunyikannya)
  let model = '';
  if ((m = /Android [\d.]+; ([^;)]+?)(?: Build|\))/.exec(ua)) && !/^(K|wv)$/.test(m[1].trim())) model = m[1].trim();
  return { type, os, browser, model };
}
function clientIp(req) {
  const local = /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
  return (local && req.headers['x-real-ip']) || req.socket.remoteAddress || '';
}
function logEvent(req, user, type, data) {
  const ua = req.headers['user-agent'] || '';
  const entry = Object.assign({ ts: Date.now(), user: user || null, type, ip: clientIp(req), ua: ua.slice(0, 300), device: parseUA(ua) }, data || {});
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', { mode: 0o600 }); } catch (e) { console.error('log gagal:', e.message); }
}
function readLog() {
  try {
    return fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
function pruneLog() {
  const cutoff = Date.now() - LOG_DAYS * 24 * 3600 * 1000;
  const all = readLog();
  const keep = all.filter((e) => e.ts >= cutoff).slice(-100000);
  if (keep.length !== all.length) {
    fs.writeFileSync(LOG_FILE + '.tmp', keep.map((e) => JSON.stringify(e)).join('\n') + (keep.length ? '\n' : ''), { mode: 0o600 });
    fs.renameSync(LOG_FILE + '.tmp', LOG_FILE);
  }
}
const clip = (v, n) => (v == null ? '' : String(v).slice(0, n));

/* ---------------- HTTP ---------------- */
function send(res, status, data, headers) {
  const body = data === undefined || status === 204 ? '' : JSON.stringify(data);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Data terlalu besar'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(Object.assign(new Error('Format data salah'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const publicUser = (name) => ({ name, role: db.users[name].role, created: db.users[name].created });
const fail = (status, message) => Object.assign(new Error(message), { status });

async function handle(req, res) {
  load(); // ikut membaca perubahan dari perintah CLI tanpa restart
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '');
  const method = req.method;
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;

  if (!p.startsWith('/api/')) throw fail(404, 'Tidak ditemukan');
  // perlindungan CSRF: permintaan yang mengubah data wajib membawa header khusus
  if (method !== 'GET' && req.headers['x-zantv'] !== '1' && p !== '/api/activity') throw fail(403, 'Permintaan ditolak');

  if (p === '/api/login' && method === 'POST') {
    if (loginBlocked(ip)) throw fail(429, 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.');
    const b = await readBody(req, 4096);
    const name = String(b.username || '').trim().toLowerCase();
    const user = db.users[name];
    const ok = user ? checkPassword(user, String(b.password || '')) : (checkPassword(DUMMY, 'x'), false);
    if (!ok) { loginFailed(ip); logEvent(req, null, 'login_failed', { tried: clip(name, 40) }); throw fail(401, 'Nama pengguna atau kata sandi salah'); }
    attempts.delete(ip);
    logEvent(req, name, 'login');
    const token = createSession(name);
    return send(res, 200, publicUser(name), { 'Set-Cookie': cookie(token, SESSION_MS / 1000) });
  }

  const me = sessionUser(req);
  if (!me) throw fail(401, 'Silakan masuk dulu');
  const admin = me.role === 'admin';
  const needAdmin = () => { if (!admin) throw fail(403, 'Hanya admin yang boleh melakukan ini'); };

  if (p === '/api/logout' && method === 'POST') {
    logEvent(req, me.name, 'logout');
    presence.delete(me.name);
    delete db.sessions[me.key]; save();
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (p === '/api/me' && method === 'GET') return send(res, 200, publicUser(me.name));
  if (p === '/api/me/password' && method === 'POST') {
    const b = await readBody(req, 4096);
    if (!checkPassword(db.users[me.name], String(b.current || ''))) throw fail(400, 'Kata sandi lama salah');
    if (!validPass(b.password)) throw fail(400, 'Kata sandi baru minimal 8 karakter');
    Object.assign(db.users[me.name], hashPassword(b.password));
    dropSessionsOf(me.name);
    const token = createSession(me.name);
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(token, SESSION_MS / 1000) });
  }

  /* playlist */
  if (p === '/api/playlists' && method === 'GET') return send(res, 200, db.playlists);
  let m = /^\/api\/playlists\/([a-z0-9]+)(\/m3u|\/refresh)?$/.exec(p);
  if (m) {
    const pl = db.playlists.find((x) => x.id === m[1]);
    if (!pl) throw fail(404, 'Playlist tidak ditemukan');
    const file = path.join(PL_DIR, pl.id + '.m3u');
    if (m[2] === '/m3u' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl; charset=utf-8', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).on('error', () => res.end()).pipe(res);
    }
    if (m[2] === '/refresh' && method === 'POST') {
      needAdmin();
      if (pl.kind !== 'url') throw fail(400, 'Playlist dari file tidak bisa diperbarui otomatis. Unggah ulang file-nya.');
      const text = await fetchM3U(pl.source).catch((e) => { throw fail(502, e.message); });
      const count = countChannels(text);
      if (!count) throw fail(422, 'Isinya bukan playlist M3U atau tidak berisi channel');
      fs.writeFileSync(file, text);
      Object.assign(pl, { count, updatedAt: Date.now(), httpsChecked: 0 }); save();
      upgradePlaylist(pl.id);
      return send(res, 200, pl);
    }
    if (!m[2] && method === 'DELETE') {
      needAdmin();
      db.playlists = db.playlists.filter((x) => x.id !== pl.id); save();
      fs.rm(file, () => {});
      return send(res, 200, { ok: true });
    }
  }
  if (p === '/api/playlists' && method === 'POST') {
    needAdmin();
    const b = await readBody(req, MAX_M3U * 2);
    const name = String(b.name || '').trim().slice(0, 80) || 'Playlist ' + (db.playlists.length + 1);
    let text, kind, source;
    if (b.url) {
      kind = 'url'; source = String(b.url).trim();
      text = await fetchM3U(source).catch((e) => { throw fail(502, e.message); });
    } else if (typeof b.text === 'string') {
      kind = 'file'; source = String(b.filename || 'upload.m3u').slice(0, 120); text = b.text;
    } else throw fail(400, 'Isi alamat playlist atau unggah file');
    const count = countChannels(text);
    if (!count) throw fail(422, 'Isinya bukan playlist M3U atau tidak berisi channel');
    const pl = { id: crypto.randomBytes(6).toString('hex'), name, kind, source, count, updatedAt: Date.now() };
    fs.writeFileSync(path.join(PL_DIR, pl.id + '.m3u'), text);
    db.playlists.push(pl); save();
    upgradePlaylist(pl.id);
    return send(res, 201, pl);
  }

  /* aktivitas: dikirim aplikasi (tontonan, error, lokasi yang disetujui pengguna) */
  if (p === '/api/activity' && method === 'POST') {
    const b = await readBody(req, 4096);
    const t = String(b.type || '');
    if (t === 'watch') {
      const seconds = Math.max(0, Math.min(86400, Math.round(+b.seconds || 0)));
      logEvent(req, me.name, 'watch', { channel: clip(b.channel, 120), group: clip(b.group, 60), playlist: clip(b.playlist, 80), seconds });
    } else if (t === 'play_error') {
      logEvent(req, me.name, 'play_error', { channel: clip(b.channel, 120), reason: clip(b.reason, 120) });
    } else if (t === 'location') {
      const lat = +b.lat, lng = +b.lng, acc = Math.round(+b.accuracy || 0);
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw fail(400, 'Lokasi tidak valid');
      logEvent(req, me.name, 'location', { lat: +lat.toFixed(5), lng: +lng.toFixed(5), accuracy: acc });
    } else if (t === 'location_declined') {
      logEvent(req, me.name, 'location_declined');
    } else throw fail(400, 'Jenis aktivitas tidak dikenal');
    return send(res, 204);
  }
  if (p === '/api/presence' && method === 'POST') {
    const b = await readBody(req, 2048);
    presence.set(me.name, { ts: Date.now(), channel: clip(b.channel, 120), ip: clientIp(req), device: parseUA(req.headers['user-agent']) });
    return send(res, 204);
  }
  if (p === '/api/presence' && method === 'GET') {
    needAdmin();
    const now = Date.now(), out = [];
    for (const [name, v] of presence) { if (now - v.ts < 3 * 60 * 1000) out.push(Object.assign({ user: name }, v)); else presence.delete(name); }
    return send(res, 200, out.sort((a, b) => b.ts - a.ts));
  }
  if (p === '/api/activity' && method === 'GET') {
    needAdmin();
    const user = url.searchParams.get('user') || '';
    const type = url.searchParams.get('type') || '';
    const before = +url.searchParams.get('before') || Infinity;
    const limit = Math.min(500, +url.searchParams.get('limit') || 200);
    const rows = readLog().filter((e) => e.ts < before && (!user || e.user === user || e.tried === user) && (!type || e.type === type));
    return send(res, 200, { days: LOG_DAYS, items: rows.slice(-limit).reverse(), more: rows.length > limit });
  }

  /* pengguna (khusus admin) */
  if (p === '/api/users' && method === 'GET') { needAdmin(); return send(res, 200, Object.keys(db.users).sort().map(publicUser)); }
  if (p === '/api/users' && method === 'POST') {
    needAdmin();
    const b = await readBody(req, 4096);
    const name = String(b.username || '').trim().toLowerCase();
    if (!validName(name)) throw fail(400, 'Nama pengguna 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip');
    if (db.users[name]) throw fail(409, 'Nama pengguna sudah dipakai');
    if (!validPass(b.password)) throw fail(400, 'Kata sandi minimal 8 karakter');
    const role = b.role === 'admin' ? 'admin' : 'user';
    db.users[name] = Object.assign({ role, created: Date.now() }, hashPassword(b.password)); save();
    return send(res, 201, publicUser(name));
  }
  m = /^\/api\/users\/([a-z0-9._-]+)(\/password)?$/.exec(p);
  if (m) {
    needAdmin();
    const name = m[1];
    if (!db.users[name]) throw fail(404, 'Pengguna tidak ditemukan');
    if (m[2] && method === 'POST') {
      const b = await readBody(req, 4096);
      if (!validPass(b.password)) throw fail(400, 'Kata sandi minimal 8 karakter');
      Object.assign(db.users[name], hashPassword(b.password));
      dropSessionsOf(name); save();
      return send(res, 200, { ok: true });
    }
    if (!m[2] && method === 'DELETE') {
      if (name === me.name) throw fail(400, 'Kamu tidak bisa menghapus akunmu sendiri');
      const admins = Object.values(db.users).filter((u) => u.role === 'admin').length;
      if (db.users[name].role === 'admin' && admins <= 1) throw fail(400, 'Harus ada minimal satu admin');
      delete db.users[name]; dropSessionsOf(name); save();
      return send(res, 200, { ok: true });
    }
  }
  throw fail(404, 'Tidak ditemukan');
}

/* ---------------- perintah baris (CLI) ---------------- */
let pipedLines = null;
function askHidden(q) {
  if (!process.stdin.isTTY) {
    // masukan dari pipe (untuk skrip): baca baris berikutnya
    if (!pipedLines) {
      pipedLines = fs.readFileSync(0, 'utf8').split(/\r?\n/);
    }
    return Promise.resolve(pipedLines.shift() || '');
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
    muted = true;
  });
}
async function cli(args) {
  const [cmd, name, role] = args;
  if (cmd === 'upgrade-https') {
    for (const pl of db.playlists) { console.log('Mengecek ' + pl.name + ' …'); await upgradePlaylist(pl.id); }
    return;
  }
  if (cmd === 'list-users') {
    const names = Object.keys(db.users).sort();
    if (!names.length) console.log('(belum ada akun)');
    names.forEach((n) => console.log(n.padEnd(24), db.users[n].role));
    return;
  }
  if (!validName(name)) { console.error('Nama tidak valid. Pakai 3–32 karakter: huruf kecil, angka, titik, _ atau -'); process.exit(1); }
  if (cmd === 'add-user') {
    if (role !== 'admin' && role !== 'user') { console.error('Peran harus admin atau user'); process.exit(1); }
    if (db.users[name]) { console.error('Akun sudah ada. Pakai: passwd ' + name); process.exit(1); }
    const pw = await askHidden('Kata sandi untuk ' + name + ' (min 8 karakter): ');
    const pw2 = await askHidden('Ulangi kata sandi: ');
    if (pw !== pw2) { console.error('Kata sandi tidak sama'); process.exit(1); }
    if (!validPass(pw)) { console.error('Kata sandi minimal 8 karakter'); process.exit(1); }
    db.users[name] = Object.assign({ role, created: Date.now() }, hashPassword(pw)); save();
    console.log('Akun ' + name + ' (' + role + ') dibuat.');
  } else if (cmd === 'passwd') {
    if (!db.users[name]) { console.error('Akun tidak ditemukan'); process.exit(1); }
    const pw = await askHidden('Kata sandi baru untuk ' + name + ': ');
    if (!validPass(pw)) { console.error('Kata sandi minimal 8 karakter'); process.exit(1); }
    Object.assign(db.users[name], hashPassword(pw)); dropSessionsOf(name); save();
    console.log('Kata sandi ' + name + ' diganti. Sesi lamanya dikeluarkan.');
  } else if (cmd === 'del-user') {
    if (!db.users[name]) { console.error('Akun tidak ditemukan'); process.exit(1); }
    delete db.users[name]; dropSessionsOf(name); save();
    console.log('Akun ' + name + ' dihapus.');
  } else {
    console.error('Perintah tidak dikenal'); process.exit(1);
  }
}

if (process.argv[2]) {
  cli(process.argv.slice(2));
} else {
  http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Terjadi kesalahan di server' : e.message });
      else res.end();
    });
  }).listen(PORT, HOST, () => console.log(`ZanTV API jalan di http://${HOST}:${PORT} (data: ${DATA_DIR})`));
  pruneLog();
  setInterval(pruneLog, 6 * 3600 * 1000).unref();
  db.playlists.filter((pl) => !pl.httpsChecked).forEach((pl) => upgradePlaylist(pl.id));
}
