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
const zlib = require('zlib');
const { Readable } = require('stream');

const PORT = +(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.ZANTV_DATA || '/var/lib/zantv';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== '0';
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PL_DIR = path.join(DATA_DIR, 'playlists');
const EPG_FILE = path.join(DATA_DIR, 'epg.json');
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_M3U = 15 * 1024 * 1024;
const MAX_EPG = 60 * 1024 * 1024;
const COOKIE = 'zantv_sid';

/* ---------------- penyimpanan ---------------- */
fs.mkdirSync(PL_DIR, { recursive: true, mode: 0o700 });
let db = { users: {}, sessions: {}, playlists: [], blocked: {}, epg: null };
let dbMtime = 0;
function load() {
  try {
    const st = fs.statSync(DB_FILE);
    if (st.mtimeMs === dbMtime) return;
    db = Object.assign({ users: {}, sessions: {}, playlists: [], blocked: {}, epg: null }, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
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
function isDirectStreamUrl(u) {
  const s = String(u || '').toLowerCase();
  const pathPart = s.split(/[?#]/)[0];
  if (/\.(ts|mp4|mkv|flv|mpd|webm|aac|mp3)$/.test(pathPart)) return true;
  if (/[?&](extension|output|format)=(ts|mpegts|flv|mp4)\b/.test(s)) return true;
  if (/\/play\/live\.php\b/.test(s) || /\/live\/play\//.test(s)) return true;
  return false;
}
function wrapSingleStreamM3U(u, name) {
  const chName = String(name || 'Direct Stream').replace(/[\r\n,]+/g, ' ').trim() || 'Direct Stream';
  return `#EXTM3U\n#EXTINF:-1 group-title="Direct Stream",${chName}\n${String(u).trim()}\n`;
}
async function fetchM3U(u, fallbackName) {
  let url = await assertPublicUrl(u);
  if (isDirectStreamUrl(u)) return wrapSingleStreamM3U(u, fallbackName);
  for (let hop = 0; hop < 6; hop++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25000);
    let r;
    try {
      r = await fetch(url, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' } });
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      clearTimeout(timer);
      url = await assertPublicUrl(new URL(r.headers.get('location'), url).toString());
      if (isDirectStreamUrl(url.toString())) return wrapSingleStreamM3U(u, fallbackName);
      continue;
    }
    if (!r.ok) {
      clearTimeout(timer);
      throw new Error('Server playlist menjawab kode ' + r.status);
    }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (/^(video|audio)\/|application\/octet-stream/.test(ct)) {
      clearTimeout(timer);
      ac.abort();
      return wrapSingleStreamM3U(u, fallbackName);
    }
    const len = +(r.headers.get('content-length') || 0);
    if (len > MAX_M3U) {
      clearTimeout(timer);
      ac.abort();
      throw new Error('Playlist terlalu besar');
    }
    try {
      const reader = r.body ? r.body.getReader() : null;
      if (!reader) {
        clearTimeout(timer);
        return wrapSingleStreamM3U(u, fallbackName);
      }
      const chunks = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        total += chunk.length;
        if (total >= 376 && chunks[0][0] === 0x47) {
          const firstBuf = Buffer.concat(chunks, total);
          if (firstBuf[0] === 0x47 && firstBuf[188] === 0x47) {
            clearTimeout(timer);
            ac.abort();
            return wrapSingleStreamM3U(u, fallbackName);
          }
        }
        if (total > MAX_M3U) {
          clearTimeout(timer);
          ac.abort();
          throw new Error('Playlist terlalu besar');
        }
      }
      clearTimeout(timer);
      const text = Buffer.concat(chunks, total).toString('utf8');
      if (!countChannels(text) && /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(text)) {
        return wrapSingleStreamM3U(u, fallbackName);
      }
      return text;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
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
    if (l && l[0] !== '#' && /^http:\/\//i.test(l)) {
      const base = l.split('|')[0];
      if (!isDirectStreamUrl(base)) out.push(base);
    }
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

/* ---------------- EPG (XMLTV .xml / .xml.gz) ---------------- */
function decodeXml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function normEpgKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.(id|co\.id|tv|com)$/i, '')
    .replace(/\b(hd|fhd|uhd|4k|sd|indo|indonesia|tv|channel|ch)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseXmltvTime(str) {
  if (!str) return 0;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(str).trim());
  if (!m) return 0;
  const y = +m[1], mo = +m[2] - 1, d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] || 0);
  let utcMs = Date.UTC(y, mo, d, h, mi, s);
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    const offH = +m[7].slice(1, 3);
    const offM = +m[7].slice(3, 5);
    utcMs -= sign * (offH * 3600 + offM * 60) * 1000;
  }
  return utcMs;
}

function unpackBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    const out = zlib.gunzipSync(buf, { maxOutputLength: MAX_EPG });
    return out.toString('utf8');
  }
  return buf.toString('utf8');
}

async function fetchEPGUrl(u) {
  let url = await assertPublicUrl(u);
  for (let hop = 0; hop < 4; hop++) {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'ZanTV/1.6' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = await assertPublicUrl(new URL(r.headers.get('location'), url).toString());
      continue;
    }
    if (!r.ok) throw new Error('Server EPG menjawab kode ' + r.status);
    const len = +(r.headers.get('content-length') || 0);
    if (len > MAX_EPG) throw new Error('File EPG terlalu besar');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_EPG) throw new Error('File EPG terlalu besar');
    return unpackBuffer(buf);
  }
  throw new Error('Terlalu banyak pengalihan alamat EPG');
}

function parseXMLTV(xml) {
  const aliases = {};
  const chNames = {};
  const chRe = /<channel\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/channel>/gi;
  let cm;
  while ((cm = chRe.exec(xml))) {
    const id = decodeXml(cm[1]);
    const body = cm[2];
    const idLow = id.toLowerCase();
    aliases[idLow] = id;
    const nk = normEpgKey(id);
    if (nk && !aliases[nk]) aliases[nk] = id;
    const dnRe = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/gi;
    let dm;
    while ((dm = dnRe.exec(body))) {
      const dn = decodeXml(dm[1]);
      if (!dn) continue;
      if (!chNames[id]) chNames[id] = dn;
      aliases[dn.toLowerCase()] = id;
      const dnk = normEpgKey(dn);
      if (dnk && !aliases[dnk]) aliases[dnk] = id;
    }
  }

  const allProgs = {};
  const now = Date.now();
  const minTime = now - 6 * 3600 * 1000;
  const maxTime = now + 36 * 3600 * 1000;
  const prRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let pm, totalParsed = 0, windowProgs = {};

  while ((pm = prRe.exec(xml))) {
    const attrs = pm[1], body = pm[2];
    const chM = /\bchannel=["']([^"']+)["']/i.exec(attrs);
    const stM = /\bstart=["']([^"']+)["']/i.exec(attrs);
    const spM = /\bstop=["']([^"']+)["']/i.exec(attrs);
    if (!chM || !stM) continue;
    const chId = decodeXml(chM[1]);
    const start = parseXmltvTime(stM[1]);
    if (!start) continue;
    let stop = spM ? parseXmltvTime(spM[1]) : 0;
    if (!stop || stop <= start) stop = start + 3600 * 1000;

    const tM = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    const title = tM ? decodeXml(tM[1]).slice(0, 140) : '';
    if (!title) continue;
    const dM = /<desc\b[^>]*>([\s\S]*?)<\/desc>/i.exec(body);
    const desc = dM ? decodeXml(dM[1]).slice(0, 280) : '';
    const cM = /<category\b[^>]*>([\s\S]*?)<\/category>/i.exec(body);
    const cat = cM ? decodeXml(cM[1]).slice(0, 60) : '';

    if (!aliases[chId.toLowerCase()]) {
      aliases[chId.toLowerCase()] = chId;
      const nk = normEpgKey(chId);
      if (nk && !aliases[nk]) aliases[nk] = chId;
    }

    const item = { start, stop, title };
    if (desc) item.desc = desc;
    if (cat) item.cat = cat;

    totalParsed++;
    if (stop >= minTime && start <= maxTime) {
      (windowProgs[chId] = windowProgs[chId] || []).push(item);
    }
    if (!allProgs[chId] || allProgs[chId].length < 25) {
      (allProgs[chId] = allProgs[chId] || []).push(item);
    }
  }

  const chosen = Object.keys(windowProgs).length ? windowProgs : allProgs;
  let programmeCount = 0;
  for (const k of Object.keys(chosen)) {
    chosen[k].sort((a, b) => a.start - b.start);
    if (chosen[k].length > 48) chosen[k] = chosen[k].slice(0, 48);
    programmeCount += chosen[k].length;
  }

  const channelCount = Object.keys(chosen).length || Object.keys(chNames).length;
  return { channels: chosen, chNames, aliases, channelCount, programmeCount, totalParsed };
}

function saveEPG(xml, kind, source) {
  const parsed = parseXMLTV(xml);
  if (!parsed.channelCount && !parsed.totalParsed) {
    throw new Error('File bukan format XMLTV EPG atau tidak berisi jadwal acara');
  }
  const meta = {
    kind,
    source,
    updatedAt: Date.now(),
    channelCount: parsed.channelCount,
    programmeCount: parsed.programmeCount
  };
  const payload = { meta, channels: parsed.channels, chNames: parsed.chNames, aliases: parsed.aliases };
  fs.writeFileSync(EPG_FILE + '.tmp', JSON.stringify(payload), { mode: 0o600 });
  fs.renameSync(EPG_FILE + '.tmp', EPG_FILE);
  db.epg = meta;
  save();
  return meta;
}

function detectM3UEpgUrl(text) {
  const firstLines = String(text || '').slice(0, 2048);
  const m = /\b(?:url-tvg|x-tvg-url)=["']([^"']+)["']/i.exec(firstLines);
  if (!m) return '';
  const first = m[1].split(',')[0].trim();
  return /^https?:\/\//i.test(first) ? first : '';
}

let epgRefreshing = false;
async function autoLoadEpgUrl(u) {
  if (!u || epgRefreshing) return;
  epgRefreshing = true;
  try {
    const xml = await fetchEPGUrl(u);
    saveEPG(xml, 'url', u);
    console.log('EPG diperbarui otomatis dari', u);
  } catch (e) {
    console.error('Gagal muat EPG otomatis:', e.message);
  } finally {
    epgRefreshing = false;
  }
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
      const text = await fetchM3U(pl.source, pl.name).catch((e) => { throw fail(502, e.message); });
      const count = countChannels(text);
      if (!count) throw fail(422, 'Isinya bukan playlist M3U atau tidak berisi channel');
      fs.writeFileSync(file, text);
      Object.assign(pl, { count, updatedAt: Date.now(), httpsChecked: 0 }); save();
      upgradePlaylist(pl.id);
      if (!db.epg) { const eu = detectM3UEpgUrl(text); if (eu) autoLoadEpgUrl(eu); }
      return send(res, 200, pl);
    }
    if (!m[2] && method === 'PATCH') {
      needAdmin();
      const b = await readBody(req, 8192);
      const name = b.name != null ? String(b.name).trim().slice(0, 80) : pl.name;
      if (!name) throw fail(400, 'Nama playlist tidak boleh kosong');
      const newUrl = b.url != null ? String(b.url).trim() : '';
      if (b.referer !== undefined) pl.referer = String(b.referer || '').trim().slice(0, 300);
      if (b.userAgent !== undefined) pl.userAgent = String(b.userAgent || '').trim().slice(0, 300);
      if (newUrl && newUrl !== pl.source) {
        const text = await fetchM3U(newUrl, name).catch((e) => { throw fail(502, e.message); });
        const count = countChannels(text);
        if (!count) throw fail(422, 'Isinya bukan playlist M3U atau tidak berisi channel');
        fs.writeFileSync(file, text);
        Object.assign(pl, { kind: 'url', source: newUrl, count, updatedAt: Date.now(), httpsChecked: 0, httpUpgraded: 0, httpLeft: 0 });
        pl.name = name; save();
        upgradePlaylist(pl.id);
        if (!db.epg) { const eu = detectM3UEpgUrl(text); if (eu) autoLoadEpgUrl(eu); }
      } else {
        pl.name = name; pl.updatedAt = Date.now(); save();
      }
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
    const referer = String(b.referer || '').trim().slice(0, 300);
    const userAgent = String(b.userAgent || '').trim().slice(0, 300);
    let text, kind, source;
    if (b.url) {
      kind = 'url'; source = String(b.url).trim();
      text = await fetchM3U(source, name).catch((e) => { throw fail(502, e.message); });
    } else if (typeof b.text === 'string') {
      kind = 'file'; source = String(b.filename || 'upload.m3u').slice(0, 120); text = b.text;
    } else throw fail(400, 'Isi alamat playlist atau unggah file');
    const count = countChannels(text);
    if (!count) throw fail(422, 'Isinya bukan playlist M3U atau tidak berisi channel');
    const pl = { id: crypto.randomBytes(6).toString('hex'), name, kind, source, count, referer, userAgent, updatedAt: Date.now() };
    fs.writeFileSync(path.join(PL_DIR, pl.id + '.m3u'), text);
    db.playlists.push(pl); save();
    upgradePlaylist(pl.id);
    if (!db.epg) { const eu = detectM3UEpgUrl(text); if (eu) autoLoadEpgUrl(eu); }
    return send(res, 201, pl);
  }

  /* Relay stream HLS/TS dengan injeksi header HTTP standar M3U (Referer, Origin, User-Agent) */
  if (p === '/api/stream' && method === 'GET') {
    const rawU = url.searchParams.get('u') || '';
    const ua = (url.searchParams.get('ua') || '').slice(0, 300);
    const ref = (url.searchParams.get('ref') || '').slice(0, 300);
    const org = (url.searchParams.get('org') || '').slice(0, 300);
    const initialTarget = await assertPublicUrl(rawU).catch((e) => { throw fail(400, e.message); });
    const isTsLike = isDirectStreamUrl(rawU);

    const VLC_UA = 'VLC/3.0.20 LibVLC/3.0.20';
    const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const primaryUa = ua || (isTsLike ? VLC_UA : CHROME_UA);
    const fallbackUa = ua ? '' : (isTsLike ? CHROME_UA : VLC_UA);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25000);
    let pipeStream = null;
    req.on('close', () => {
      ac.abort();
      if (pipeStream) { try { pipeStream.destroy(); } catch (e) {} }
    });

    async function connectUpstream(useUa) {
      let curTarget = initialTarget;
      const reqHeaders = {
        'User-Agent': useUa,
        'Accept': '*/*',
        'Connection': 'keep-alive'
      };
      if (ref) {
        reqHeaders['Referer'] = ref;
        try { reqHeaders['Origin'] = org || new URL(ref).origin; } catch (e) {}
      } else if (org) {
        reqHeaders['Origin'] = org;
      }
      if (req.headers['range'] && !isTsLike) reqHeaders['Range'] = req.headers['range'];

      const cookies = [];
      for (let hop = 0; hop < 8; hop++) {
        if (cookies.length) reqHeaders['Cookie'] = cookies.join('; ');
        const r = await fetch(curTarget, { redirect: 'manual', signal: ac.signal, headers: reqHeaders });
        const setCookie = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
        for (const sc of setCookie) {
          const pair = String(sc).split(';')[0].trim();
          if (pair && !cookies.includes(pair)) cookies.push(pair);
        }
        if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
          try { if (r.body) r.body.cancel(); } catch (e) {}
          curTarget = await assertPublicUrl(new URL(r.headers.get('location'), curTarget).toString());
          continue;
        }
        return { res: r, target: curTarget };
      }
      return { res: null, target: curTarget };
    }

    let upRes, target = initialTarget;
    try {
      let attempt = await connectUpstream(primaryUa);
      upRes = attempt.res;
      target = attempt.target;
      if (upRes && (upRes.status === 401 || upRes.status === 403) && fallbackUa) {
        try { if (upRes.body) upRes.body.cancel(); } catch (e) {}
        attempt = await connectUpstream(fallbackUa);
        upRes = attempt.res;
        target = attempt.target;
      }
    } catch (e) {
      clearTimeout(timer);
      throw fail(502, 'Gagal menghubungi server stream');
    }
    clearTimeout(timer);
    if (!upRes) throw fail(502, 'Terlalu banyak pengalihan stream');
    if (!upRes.ok && upRes.status !== 206) {
      res.writeHead(upRes.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'Stream menjawab kode ' + upRes.status }));
    }

    const ct = (upRes.headers.get('content-type') || '').toLowerCase();
    const isM3u8 = ct.includes('mpegurl') || /\.m3u8($|\?)/i.test(target.pathname);
    const suffix = (ua ? '&ua=' + encodeURIComponent(ua) : '') +
      (ref ? '&ref=' + encodeURIComponent(ref) : '') +
      (org ? '&org=' + encodeURIComponent(org) : '');
    const wrapUrl = (rel) => {
      try {
        const abs = new URL(rel, target).toString();
        return '/api/stream?u=' + encodeURIComponent(abs) + suffix;
      } catch (e) { return rel; }
    };

    if (isM3u8) {
      const buf = Buffer.from(await upRes.arrayBuffer());
      const bodyText = buf.toString('utf8');
      if (bodyText.trimStart().startsWith('#EXTM3U')) {
        const rewritten = bodyText.split(/\r?\n/).map((line) => {
          const t = line.trim();
          if (!t) return line;
          if (t.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/gi, (_, u1) => 'URI="' + wrapUrl(u1) + '"');
          }
          return wrapUrl(t);
        }).join('\n');
        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no'
        });
        return res.end(rewritten);
      }
      res.writeHead(upRes.status, {
        'Content-Type': ct || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no'
      });
      return res.end(buf);
    }

    const outHeaders = {
      'Content-Type': upRes.headers.get('content-type') || 'video/mp2t',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no'
    };
    const cl = upRes.headers.get('content-length');
    if (cl) outHeaders['Content-Length'] = cl;
    const cr = upRes.headers.get('content-range');
    if (cr) outHeaders['Content-Range'] = cr;
    res.writeHead(upRes.status, outHeaders);
    if (!upRes.body) return res.end();
    pipeStream = Readable.fromWeb(upRes.body);
    pipeStream.on('error', () => res.end());
    return pipeStream.pipe(res);
  }

  /* EPG (Jadwal Acara TV XMLTV) */
  if (p === '/api/epg' && method === 'GET') {
    if (db.epg && fs.existsSync(EPG_FILE)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return fs.createReadStream(EPG_FILE).on('error', () => res.end()).pipe(res);
    }
    return send(res, 200, { meta: null, channels: {}, chNames: {}, aliases: {} });
  }
  if (p === '/api/epg' && method === 'POST') {
    needAdmin();
    const b = await readBody(req, MAX_EPG);
    let xml, kind, source;
    if (b.url) {
      kind = 'url';
      source = String(b.url).trim();
      xml = await fetchEPGUrl(source).catch((e) => { throw fail(502, e.message); });
    } else if (typeof b.base64 === 'string') {
      kind = 'file';
      source = String(b.filename || 'epg.xml').slice(0, 120);
      try { xml = unpackBuffer(Buffer.from(b.base64, 'base64')); } catch (e) { throw fail(400, 'File EPG gagal dibaca: ' + e.message); }
    } else if (typeof b.text === 'string') {
      kind = 'file';
      source = String(b.filename || 'epg.xml').slice(0, 120);
      xml = b.text;
    } else {
      throw fail(400, 'Isi alamat EPG (.xml / .xml.gz) atau unggah file');
    }
    let meta;
    try { meta = saveEPG(xml, kind, source); } catch (e) { throw fail(422, e.message); }
    return send(res, 200, meta);
  }
  if (p === '/api/epg/refresh' && method === 'POST') {
    needAdmin();
    if (!db.epg || db.epg.kind !== 'url') throw fail(400, 'EPG dari file tidak bisa diperbarui otomatis. Unggah ulang file-nya.');
    const xml = await fetchEPGUrl(db.epg.source).catch((e) => { throw fail(502, e.message); });
    let meta;
    try { meta = saveEPG(xml, 'url', db.epg.source); } catch (e) { throw fail(422, e.message); }
    return send(res, 200, meta);
  }
  if (p === '/api/epg' && method === 'DELETE') {
    needAdmin();
    db.epg = null; save();
    fs.rm(EPG_FILE, () => {});
    return send(res, 200, { ok: true });
  }

  /* channel terkunci (DRM / dibatasi wilayah): disembunyikan untuk semua pengguna */
  if (p === '/api/blocked' && method === 'GET') {
    return send(res, 200, Object.keys(db.blocked || {}).map((u) => Object.assign({ url: u }, db.blocked[u])));
  }
  if (p === '/api/blocked' && method === 'POST') {
    const b = await readBody(req, 8192);
    const u = String(b.url || '').trim();
    const reason = b.reason === 'drm' ? 'drm' : b.reason === 'geo' ? 'geo' : '';
    if (!u || u.length > 2048 || !/^(https?|rtmp|rtsp|udp):/i.test(u)) throw fail(400, 'Alamat channel tidak valid');
    if (!reason) throw fail(400, 'Alasan tidak dikenal');
    db.blocked = db.blocked || {};
    if (!db.blocked[u]) {
      const keys = Object.keys(db.blocked);
      if (keys.length >= 5000) delete db.blocked[keys.sort((a, c) => db.blocked[a].at - db.blocked[c].at)[0]];
      db.blocked[u] = { reason, name: clip(b.name, 120), at: Date.now(), by: me.name };
      save();
    }
    return send(res, 204);
  }
  if (p === '/api/blocked' && method === 'DELETE') {
    needAdmin();
    const n = Object.keys(db.blocked || {}).length;
    db.blocked = {}; save();
    return send(res, 200, { ok: true, restored: n });
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
  setInterval(() => {
    if (db.epg && db.epg.kind === 'url') autoLoadEpgUrl(db.epg.source);
  }, 6 * 3600 * 1000).unref();
  if (db.epg && db.epg.kind === 'url' && (!fs.existsSync(EPG_FILE) || Date.now() - (db.epg.updatedAt || 0) > 6 * 3600 * 1000)) {
    autoLoadEpgUrl(db.epg.source);
  } else if (!db.epg) {
    for (const pl of db.playlists) {
      try {
        const eu = detectM3UEpgUrl(fs.readFileSync(path.join(PL_DIR, pl.id + '.m3u'), 'utf8'));
        if (eu) { autoLoadEpgUrl(eu); break; }
      } catch (e) {}
    }
  }
  db.playlists.filter((pl) => !pl.httpsChecked).forEach((pl) => upgradePlaylist(pl.id));
}
