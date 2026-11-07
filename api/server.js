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
const { spawn, execFileSync } = require('child_process');

// Banyak server IPTV memakai sertifikat SSL self-signed / rantai tidak lengkap
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let movieProvider = null;
try {
  movieProvider = require('./zan-movie-provider');
} catch (e) {
  console.warn('[ZanTV] Movie provider module load warning:', e.message);
}

/* ---------------- Global VOD & Movie Cache ---------------- */
const vodCache = global.__vodCache || (global.__vodCache = new Map());
function getVodCache(key) {
  const item = vodCache.get(key);
  if (item && item.exp > Date.now()) return item.data;
  vodCache.delete(key);
  return null;
}
function setVodCache(key, data, ttlMs) {
  if (vodCache.size > 500) vodCache.clear();
  vodCache.set(key, { data, exp: Date.now() + (ttlMs || 900000) });
}

let HAS_FFMPEG = false;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 3000 });
  HAS_FFMPEG = true;
} catch (e) {}
let activeFfmpegCount = 0;
const MAX_FFMPEG = 3;

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
let db = { users: {}, sessions: {}, playlists: [], blocked: {}, epg: null, movieProviders: {}, appConfig: {} };
let dbMtime = 0;
function getAppConfig() {
  const cfg = (db && db.appConfig && typeof db.appConfig === 'object') ? db.appConfig : {};
  return {
    movieEnabled: cfg.movieEnabled !== false,
    movieEngine: cfg.movieEngine === 'klikxxi' ? 'klikxxi' : 'moviebox',
    movieMirror: db.movieMirror || 'https://klikxxi.shop',
    watermarkLogo: typeof cfg.watermarkLogo === 'string' ? cfg.watermarkLogo : '',
    watermarkText: typeof cfg.watermarkText === 'string' && cfg.watermarkText.trim() ? cfg.watermarkText.trim().slice(0, 28) : 'ZanTV'
  };
}
function syncMovieProviderConfig() {
  if (!movieProvider) return;
  const cfg = getAppConfig();
  if (typeof movieProvider.setActiveEngine === 'function') {
    movieProvider.setActiveEngine(cfg.movieEngine);
  }
  if (typeof movieProvider.setActiveMirror === 'function') {
    movieProvider.setActiveMirror(cfg.movieMirror);
  }
}
function load() {
  try {
    const st = fs.statSync(DB_FILE);
    if (st.mtimeMs === dbMtime) return;
    db = Object.assign({ users: {}, sessions: {}, playlists: [], blocked: {}, epg: null, movieProviders: {}, appConfig: {} }, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    dbMtime = st.mtimeMs;
    syncMovieProviderConfig();
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
  dbMtime = fs.statSync(DB_FILE).mtimeMs;
}
load();
if (db.movieMirror && (db.movieMirror.includes('ngefilm') || db.movieMirror.includes('idmxl'))) {
  db.movieMirror = 'https://klikxxi.shop';
  save();
}
syncMovieProviderConfig();

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

function gpsDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ensureUserGps(u) {
  if (!u) return;
  if (!Array.isArray(u.gpsList)) u.gpsList = [];
  if (u.gps && typeof u.gps.lat === 'number' && typeof u.gps.lng === 'number') {
    u.gpsList.push({
      id: crypto.randomBytes(6).toString('hex'),
      label: u.gps.label || 'User #1',
      lat: u.gps.lat,
      lng: u.gps.lng,
      radius: u.gps.radius || u.gpsRadius || 2000,
      updatedAt: u.gps.updatedAt || Date.now(),
      by: u.gps.by || 'admin'
    });
    delete u.gps;
  }
  if (!Array.isArray(u.pendingGpsList)) u.pendingGpsList = [];
  if (u.pendingGps && typeof u.pendingGps.lat === 'number' && typeof u.pendingGps.lng === 'number') {
    u.pendingGpsList.push(Object.assign({ id: crypto.randomBytes(6).toString('hex') }, u.pendingGps));
    delete u.pendingGps;
  }
}

function findMatchingGps(u, lat, lng) {
  ensureUserGps(u);
  let bestItem = null, bestDist = Infinity;
  let nearestItem = null, nearestDist = Infinity;
  for (const item of u.gpsList) {
    if (!item || typeof item.lat !== 'number' || typeof item.lng !== 'number') continue;
    const d = Math.round(gpsDistanceMeters(item.lat, item.lng, lat, lng));
    const maxR = Math.max(100, +(item.radius || u.gpsRadius || 2000));
    if (d < nearestDist) { nearestDist = d; nearestItem = item; }
    if (d <= maxR && d < bestDist) { bestDist = d; bestItem = item; }
  }
  return {
    item: bestItem,
    dist: bestItem ? bestDist : null,
    nearestItem,
    nearestDist: nearestItem ? nearestDist : null
  };
}

function recordPendingGps(u, lat, lng, acc, req, nearestDist) {
  ensureUserGps(u);
  const ip = clientIp(req);
  const device = parseUA(req.headers['user-agent']);
  const existingIdx = u.pendingGpsList.findIndex(
    (p) => p && typeof p.lat === 'number' && gpsDistanceMeters(p.lat, p.lng, lat, lng) <= 150
  );
  const entry = {
    id: existingIdx >= 0 ? u.pendingGpsList[existingIdx].id : crypto.randomBytes(6).toString('hex'),
    lat,
    lng,
    accuracy: acc,
    at: Date.now(),
    ip,
    device,
    dist: nearestDist != null ? nearestDist : undefined
  };
  if (existingIdx >= 0) u.pendingGpsList.splice(existingIdx, 1);
  u.pendingGpsList.unshift(entry);
  if (u.pendingGpsList.length > 30) u.pendingGpsList.length = 30;
  return entry;
}

function createSession(name, gpsOk, gpsId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions[sha(token)] = { user: name, exp: Date.now() + SESSION_MS, gpsOk: !!gpsOk, gpsId: gpsId || null };
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < Date.now()) delete db.sessions[k];
  save();
  return token;
}
function dropSessionsOf(name) {
  for (const [k, s] of Object.entries(db.sessions)) {
    if (s.user === name) {
      delete db.sessions[k];
      presence.delete(k);
    }
  }
  presence.delete(name);
}
function dropSessionsByGpsId(name, gpsId) {
  for (const [k, s] of Object.entries(db.sessions)) {
    if (s.user === name && s.gpsId === gpsId) {
      delete db.sessions[k];
      presence.delete(k);
    }
  }
}
function sessionUser(req) {
  const m = /(?:^|;\s*)zantv_sid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const key = sha(m[1]);
  const s = db.sessions[key];
  const u = s && db.users[s.user];
  if (!s || s.exp < Date.now() || !u) return null;
  let gpsItem = null;
  if (u.role !== 'admin') {
    ensureUserGps(u);
    if (!s.gpsOk || !u.gpsList.length) return null;
    if (s.gpsId) {
      gpsItem = u.gpsList.find((g) => g.id === s.gpsId) || null;
      if (!gpsItem) return null;
    } else {
      gpsItem = u.gpsList[0];
    }
  }
  return { name: s.user, role: u.role, key, gpsId: s.gpsId || null, gpsItem };
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
  if (net.isIP(host)) {
    if (privateIp(host)) throw new Error('Alamat menuju jaringan internal tidak diizinkan');
    return url;
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (addrs && addrs.length && addrs.some((a) => privateIp(a.address))) {
      throw new Error('Alamat menuju jaringan internal tidak diizinkan');
    }
  } catch (err) {
    if (err.message && err.message.includes('jaringan internal')) throw err;
    // Jika DNS lokal gagal/timeout, biarkan fetch upstream mencoba resolusi langsung
  }
  return url;
}
function isDirectStreamUrl(u) {
  const s = String(u || '').toLowerCase();
  const pathPart = s.split(/[?#]/)[0];
  if (/\.(ts|mp4|mkv|flv|mpd|webm|aac|mp3)$/.test(pathPart)) return true;
  if (/[?&](extension|output|format)=(ts|mpegts|flv|mp4)\b/.test(s)) return true;
  if (/\/play\/live\.php\b/.test(s) || /\/live\/play\//.test(s)) return true;
  // Xtream Codes extensionless live stream: /<user>/<pass>/<stream_id> atau /live/<user>/<pass>/<stream_id>
  if (/^https?:\/\/[^/]+\/(?:live\/)?[^/?#]+\/[^/?#]+\/\d+$/.test(pathPart)) return true;
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
  const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = (req.socket && req.socket.remoteAddress) || '';
  const local = /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(raw);
  return (local && forwarded) ? forwarded : (forwarded || raw).replace(/^::ffff:/, '');
}

/* ---------------- Benteng Pertahanan Anti-Fake GPS (Anti-Spoofing Shield) ---------------- */
const ipGeoCache = new Map();
function isPrivateIp(ip) {
  if (!ip) return true;
  return /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|fc00:|fe80:|::1|localhost)/i.test(ip);
}

async function lookupIpGeo(ip) {
  if (!ip || isPrivateIp(ip)) return null;
  const cached = ipGeoCache.get(ip);
  if (cached && cached.exp > Date.now()) return cached.data;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2200);
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,lat,lon,proxy,hosting`, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.status === 'success') {
      if (ipGeoCache.size > 500) ipGeoCache.clear();
      ipGeoCache.set(ip, { data, exp: Date.now() + 6 * 3600 * 1000 });
      return data;
    }
  } catch (e) {}
  return null;
}

function verifyGpsHeuristics(b) {
  if (b.isMock) {
    return { ok: false, code: 'mock_flagged', msg: 'Akses ditolak: Terdeteksi sinyal Fake GPS / Mock Location pada perangkat.' };
  }
  const acc = Math.round(+b.accuracy || 0);
  if (acc <= 1) {
    return { ok: false, code: 'fake_gps_zero_accuracy', msg: 'Akses ditolak: Parameter akurasi GPS tidak wajar (0–1 meter). Matikan aplikasi Fake GPS.' };
  }
  if (acc > 15000) {
    return { ok: false, code: 'gps_unreliable', msg: 'Akses ditolak: Sinyal GPS terlalu lemah/tidak akurat (> 15 km). Pastikan GPS HP aktif.' };
  }
  if (b.gpsTs && b.clientTs) {
    const drift = Math.abs(+b.clientTs - +b.gpsTs);
    if (drift > 180000) {
      return { ok: false, code: 'gps_timestamp_manipulation', msg: 'Akses ditolak: Sinyal waktu GPS tidak sinkron dengan jam sistem perangkat.' };
    }
  }
  return { ok: true };
}

function checkTeleportation(lastLat, lastLng, lastAt, newLat, newLng) {
  if (!lastLat || !lastLng || !lastAt) return { ok: true };
  const timeSec = (Date.now() - lastAt) / 1000;
  // Periksa pergerakan jika dalam kurun waktu 1 detik s/d 2 jam (7200s)
  if (timeSec >= 1 && timeSec <= 7200) {
    const distM = gpsDistanceMeters(lastLat, lastLng, newLat, newLng);
    const speedKmH = (distM / timeSec) * 3.6;
    // Lompatan jarak > 1.5 km dengan kecepatan instan > 400 km/jam
    if (distM > 1500 && speedKmH > 400) {
      return {
        ok: false,
        code: 'teleportation',
        speed: Math.round(speedKmH),
        dist: Math.round(distM),
        msg: `Akses ditolak: Terdeteksi lompatan lokasi instan / teleportasi (${Math.round(speedKmH)} km/jam, jarak ${Math.round(distM / 1000)} km). Matikan Fake GPS!`
      };
    }
  }
  return { ok: true };
}

async function verifyIpVsGps(req, gpsLat, gpsLng) {
  const ip = clientIp(req);
  if (!ip || isPrivateIp(ip)) return { ok: true };
  const geo = await lookupIpGeo(ip);
  if (!geo) return { ok: true };

  // 1. Deteksi Datacenter VPN luar negeri
  if (geo.hosting && geo.countryCode !== 'ID') {
    return {
      ok: false,
      code: 'vpn_hosting_detected',
      msg: `Akses ditolak: Terdeteksi koneksi VPN/Proxy server luar (${geo.city || geo.country}). Matikan VPN untuk menggunakan ZanTV.`
    };
  }

  // 2. Deteksi anomali jarak IP vs GPS (misal: GPS spoofed ke Jakarta, tapi IP koneksi dari luar negeri > 1.500 km)
  if (geo.lat && geo.lon) {
    const distM = gpsDistanceMeters(geo.lat, geo.lon, gpsLat, gpsLng);
    if (distM > 1500000 && geo.countryCode !== 'ID') {
      return {
        ok: false,
        code: 'ip_gps_discrepancy',
        msg: `Akses ditolak: Lokasi GPS (${gpsLat}, ${gpsLng}) bertolak belakang dengan jaringan internet Anda (${geo.city}, ${geo.country}). Matikan Fake GPS/VPN.`
      };
    }
  }

  return { ok: true, geo };
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
const translateCache = new Map();
async function translateText(text, targetLang, sourceLang) {
  const clean = String(text || '').trim().slice(0, 600);
  if (!clean) return { text: '', detected: '' };
  const tl = /^[a-z-]{2,8}$/i.test(targetLang || '') ? targetLang.toLowerCase() : 'id';
  const sl = /^[a-z-]{2,8}$/i.test(sourceLang || '') ? sourceLang.toLowerCase() : 'auto';
  const key = `${sl}:${tl}:${clean}`;
  if (translateCache.has(key)) return translateCache.get(key);
  const gUrl =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' +
    encodeURIComponent(sl) +
    '&tl=' +
    encodeURIComponent(tl) +
    '&dt=t&q=' +
    encodeURIComponent(clean);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(gUrl, {
      signal: ac.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!r.ok) return { text: clean, detected: sl };
    const data = await r.json();
    const out = Array.isArray(data && data[0])
      ? data[0].map((seg) => (seg && seg[0]) || '').join('').trim()
      : clean;
    const resObj = { text: out || clean, detected: (data && data[2]) || sl };
    if (translateCache.size > 1200) {
      const firstKey = translateCache.keys().next().value;
      translateCache.delete(firstKey);
    }
    translateCache.set(key, resObj);
    return resObj;
  } catch (e) {
    return { text: clean, detected: sl };
  } finally {
    clearTimeout(timer);
  }
}

const publicUser = (name, myGps) => {
  const u = db.users[name];
  ensureUserGps(u);
  return {
    name,
    role: u.role,
    created: u.created,
    gpsList: u.gpsList,
    pendingGpsList: u.pendingGpsList,
    myGps: myGps || null,
    gpsAutoBind: !!u.gpsAutoBind,
    gpsRadius: u.gpsRadius || 2000,
    hasFfmpeg: HAS_FFMPEG,
    appConfig: getAppConfig()
  };
};

function parseSrtTimeSec(str) {
  const m = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(String(str || '').trim());
  if (!m) return 0;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+(m[4].padEnd(3, '0'))) / 1000;
}

function parseSrtToCues(srtText) {
  const blocks = String(srtText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\s*\n/);
  const cues = [];
  for (const blk of blocks) {
    const lines = blk.trim().split('\n');
    if (lines.length < 2) continue;
    let timeIdx = 0;
    if (!lines[0].includes('-->') && lines[1] && lines[1].includes('-->')) timeIdx = 1;
    const tLine = lines[timeIdx];
    if (!tLine || !tLine.includes('-->')) continue;
    const parts = tLine.split('-->');
    const start = parseSrtTimeSec(parts[0]);
    const end = parseSrtTimeSec(parts[1]);
    const text = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
    if (text && end > start) {
      cues.push({ start: +start.toFixed(2), end: +end.toFixed(2), text });
    }
  }
  return cues;
}

const fail = (status, message) => Object.assign(new Error(message), { status });
const activeStreamLocks = new Map();
const activeMovieExtractions = new Map();

async function handle(req, res) {
  load(); // ikut membaca perubahan dari perintah CLI tanpa restart
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '');
  const method = req.method;
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization, X-ZanTV, User-Agent, Referer, Accept',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  if (!p.startsWith('/api/')) throw fail(404, 'Tidak ditemukan');
  // perlindungan CSRF: permintaan yang mengubah data wajib membawa header khusus
  if (method !== 'GET' && req.headers['x-zantv'] !== '1' && p !== '/api/activity') throw fail(403, 'Permintaan ditolak');

  if (p === '/api/config' && method === 'GET') {
    return send(res, 200, { ok: true, config: getAppConfig() });
  }

  if (p === '/api/login' && method === 'POST') {
    if (loginBlocked(ip)) throw fail(429, 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.');
    const b = await readBody(req, 4096);
    const name = String(b.username || '').trim().toLowerCase();
    const user = db.users[name];
    const ok = user ? checkPassword(user, String(b.password || '')) : (checkPassword(DUMMY, 'x'), false);
    if (!ok) { loginFailed(ip); logEvent(req, null, 'login_failed', { tried: clip(name, 40) }); throw fail(401, 'Nama pengguna atau kata sandi salah'); }
    attempts.delete(ip);

    const rawLat = b.lat, rawLng = b.lng, acc = Math.round(+b.accuracy || 0);
    const hasCoords =
      rawLat !== null && rawLat !== undefined && rawLat !== '' &&
      rawLng !== null && rawLng !== undefined && rawLng !== '' &&
      Number.isFinite(+rawLat) && Number.isFinite(+rawLng) &&
      Math.abs(+rawLat) <= 90 && Math.abs(+rawLng) <= 180;

    let matchedGps = null;
    if (user.role !== 'admin') {
      ensureUserGps(user);
      if (!hasCoords) {
        logEvent(req, name, 'login_gps_missing', { reason: clip(b.gpsError || 'no_gps', 60) });
        throw fail(403, 'Akses ditolak: Wajib mengaktifkan & mengizinkan lokasi GPS pada browser/perangkat untuk masuk.');
      }

      // Anti-Fake GPS Layer 1: Sinyal & Heuristik Akurasi
      const heur = verifyGpsHeuristics(b);
      if (!heur.ok) {
        logEvent(req, name, 'login_fake_gps_heuristic', { code: heur.code, accuracy: acc, isMock: !!b.isMock });
        throw fail(403, heur.msg);
      }

      // Anti-Fake GPS Layer 2: IP vs Geolocation Cross-Check
      const ipGps = await verifyIpVsGps(req, +rawLat, +rawLng);
      if (!ipGps.ok) {
        logEvent(req, name, 'login_fake_gps_ip', { code: ipGps.code, lat: +rawLat, lng: +rawLng });
        throw fail(403, ipGps.msg);
      }

      const lat = +(+rawLat).toFixed(5), lng = +(+rawLng).toFixed(5);
      const match = findMatchingGps(user, lat, lng);
      if (match.item) {
        // Anti-Fake GPS Layer 3: Anti-Teleportasi (Lompatan instan antar titik)
        const prevLat = (user.lastGpsPing && user.lastGpsPing.lat) || match.item.lastLat;
        const prevLng = (user.lastGpsPing && user.lastGpsPing.lng) || match.item.lastLng;
        const prevAt = (user.lastGpsPing && user.lastGpsPing.at) || match.item.lastAt;
        const tele = checkTeleportation(prevLat, prevLng, prevAt, lat, lng);
        if (!tele.ok) {
          logEvent(req, name, 'login_fake_gps_teleport', { speed: tele.speed, dist: tele.dist, prevLat, prevLng, lat, lng });
          throw fail(403, tele.msg);
        }

        matchedGps = match.item;
        matchedGps.lastLat = lat;
        matchedGps.lastLng = lng;
        matchedGps.lastAcc = acc;
        matchedGps.lastAt = Date.now();
        matchedGps.lastIp = clientIp(req);
        matchedGps.lastDevice = parseUA(req.headers['user-agent']);
        user.lastGpsPing = { lat, lng, at: Date.now() };
        // Hapus dari pending jika sebelumnya ada di sekitar titik ini
        user.pendingGpsList = user.pendingGpsList.filter(
          (pItem) => !pItem || gpsDistanceMeters(pItem.lat, pItem.lng, lat, lng) > 250
        );
        save();
        logEvent(req, name, 'location', { lat, lng, accuracy: acc, gpsLabel: matchedGps.label });
      } else if (user.gpsAutoBind) {
        const radius = Math.max(100, +(user.gpsRadius || 2000));
        const newItem = {
          id: crypto.randomBytes(6).toString('hex'),
          label: 'User #' + (user.gpsList.length + 1) + ' (Auto)',
          lat,
          lng,
          radius,
          updatedAt: Date.now(),
          by: 'auto-bind',
          lastLat: lat,
          lastLng: lng,
          lastAcc: acc,
          lastAt: Date.now(),
          lastIp: clientIp(req),
          lastDevice: parseUA(req.headers['user-agent'])
        };
        user.gpsList.push(newItem);
        user.gpsAutoBind = false;
        user.lastGpsPing = { lat, lng, at: Date.now() };
        matchedGps = newItem;
        save();
        logEvent(req, name, 'location', { lat, lng, accuracy: acc, gpsLabel: newItem.label });
      } else {
        recordPendingGps(user, lat, lng, acc, req, match.nearestDist);
        save();
        if (!user.gpsList.length) {
          logEvent(req, name, 'login_gps_unregistered', { lat, lng, accuracy: acc });
          throw fail(403, `Akses ditolak: Lokasi GPS kamu (${lat}, ${lng}) belum terdaftar di database GPS. Koordinatmu sudah dikirim ke Admin untuk disetujui.`);
        } else {
          const maxRadius = match.nearestItem ? (match.nearestItem.radius || 2000) : (user.gpsRadius || 2000);
          logEvent(req, name, 'login_gps_mismatch', { lat, lng, accuracy: acc, dist: match.nearestDist, maxRadius });
          throw fail(403, `Akses ditolak: Lokasi GPS kamu (${lat}, ${lng}) belum terdaftar di database GPS (jarak terdekat ${match.nearestDist} m). Koordinatmu sudah dikirim ke Admin untuk disetujui.`);
        }
      }
    } else if (hasCoords) {
      logEvent(req, name, 'location', { lat: +(+rawLat).toFixed(5), lng: +(+rawLng).toFixed(5), accuracy: acc });
    }

    logEvent(req, name, 'login', matchedGps ? { gpsLabel: matchedGps.label } : undefined);
    const token = createSession(name, true, matchedGps ? matchedGps.id : null);
    return send(res, 200, publicUser(name, matchedGps), { 'Set-Cookie': cookie(token, SESSION_MS / 1000) });
  }

  /* ==========================================================================
     ZanTV Bioskop / Movie VOD Endpoints (Dual-Engine: MovieBox BFF + CloudX)
     ========================================================================== */
  if (p === '/api/movie/categories' && method === 'GET') {
    if (!movieProvider) return send(res, 503, { error: 'Movie provider not available' });
    const cfg = getAppConfig();
    return send(res, 200, { categories: movieProvider.CATEGORIES, movieEnabled: cfg.movieEnabled, engine: cfg.movieEngine });
  }

  if (p === '/api/movie/subtitle' && method === 'GET') {
    const subUrl = (url.searchParams.get('u') || url.searchParams.get('url') || '').trim();
    const fmt = (url.searchParams.get('format') || 'vtt').toLowerCase();
    if (!subUrl || !/^https?:\/\//i.test(subUrl)) return send(res, 400, { error: 'URL subtitle tidak valid' });
    const cacheKey = `mov:sub:${fmt}:${subUrl}`;
    const cached = getVodCache(cacheKey);
    if (cached) {
      if (fmt === 'json') return send(res, 200, cached);
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=7200' });
      return res.end(cached);
    }
    try {
      const targetSub = await assertPublicUrl(subUrl);
      const sRes = await fetch(targetSub.toString(), {
        headers: { 'User-Agent': CHROME_UA, 'Referer': 'https://123movienow.cc/' },
        signal: AbortSignal.timeout(7000)
      });
      if (!sRes.ok) throw new Error('HTTP ' + sRes.status);
      const srtText = await sRes.text();
      if (fmt === 'json') {
        const cues = parseSrtToCues(srtText);
        const payload = { ok: true, count: cues.length, cues };
        setVodCache(cacheKey, payload, 2 * 3600 * 1000);
        return send(res, 200, payload);
      }
      const vttBody = 'WEBVTT\n\n' + srtText
        .replace(/\r\n/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      setVodCache(cacheKey, vttBody, 2 * 3600 * 1000);
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=7200' });
      return res.end(vttBody);
    } catch (err) {
      return send(res, 502, { error: 'Gagal memuat subtitle: ' + err.message });
    }
  }

  if (p === '/api/movie/list' && method === 'GET') {
    if (!movieProvider) return send(res, 503, { error: 'Movie provider not available' });
    const cfg = getAppConfig();
    const cat = (url.searchParams.get('category') || 'terbaru').toLowerCase();
    const page = Math.max(1, +(url.searchParams.get('page') || 1));
    const cacheKey = `mov:cat:${cfg.movieEngine}:${cat}:${page}`;
    const cached = getVodCache(cacheKey);
    if (cached) return send(res, 200, cached);

    try {
      const data = await movieProvider.getCatalog(cat, page);
      setVodCache(cacheKey, data, 10 * 60 * 1000);
      return send(res, 200, data);
    } catch (err) {
      return send(res, 502, { error: err.message || 'Gagal mengambil katalog film' });
    }
  }

  if (p === '/api/movie/search' && method === 'GET') {
    if (!movieProvider) return send(res, 503, { error: 'Movie provider not available' });
    const cfg = getAppConfig();
    const q = (url.searchParams.get('q') || '').trim();
    const page = Math.max(1, +(url.searchParams.get('page') || 1));
    if (!q) return send(res, 200, { query: '', page: 1, items: [] });
    const cacheKey = `mov:search:${cfg.movieEngine}:${q}:${page}`;
    const cached = getVodCache(cacheKey);
    if (cached) return send(res, 200, cached);

    try {
      const data = await movieProvider.search(q, page);
      setVodCache(cacheKey, data, 15 * 60 * 1000);
      return send(res, 200, data);
    } catch (err) {
      return send(res, 502, { error: err.message || 'Pencarian film gagal' });
    }
  }

  if (p === '/api/movie/detail' && method === 'GET') {
    if (!movieProvider) return send(res, 503, { error: 'Movie provider not available' });
    const itemUrl = (url.searchParams.get('url') || url.searchParams.get('id') || '').trim();
    if (!itemUrl) return send(res, 400, { error: 'Parameter url atau id diperlukan' });
    const cacheKey = `mov:det:${itemUrl}`;
    const cached = getVodCache(cacheKey);
    if (cached) return send(res, 200, cached);

    try {
      const data = await movieProvider.getDetail(itemUrl);
      setVodCache(cacheKey, data, 30 * 60 * 1000);
      return send(res, 200, data);
    } catch (err) {
      return send(res, 502, { error: err.message || 'Gagal mengambil detail film' });
    }
  }

  if (p === '/api/movie/stream' && method === 'GET') {
    if (!movieProvider) return send(res, 503, { error: 'Movie provider not available' });
    const itemUrl = (url.searchParams.get('url') || url.searchParams.get('id') || '').trim();
    const tab = (url.searchParams.get('tab') || '1080').trim();
    if (!itemUrl) return send(res, 400, { error: 'Parameter url diperlukan' });
    const cacheKey = `mov:stream:${itemUrl}:${tab}`;
    const cached = getVodCache(cacheKey);
    if (cached) {
      console.log('[Movie API] CACHE HIT: tab=' + tab + ' url=' + clip(itemUrl, 70));
      return send(res, 200, cached);
    }

    try {
      console.log('[Movie API] Extracting: tab=' + tab + ' url=' + clip(itemUrl, 70));
      const data = await movieProvider.extractStream(itemUrl, tab);
      if (data && data.streamUrl) {
        console.log('[Movie API] Extracted SUCCESS: kind=' + data.kind + ' url=' + clip(data.streamUrl, 80));
        setVodCache(cacheKey, data, 2 * 3600 * 1000);
      }
      return send(res, 200, data);
    } catch (err) {
      console.error('[Movie API] Extract error: ' + err.message);
      return send(res, 502, { error: err.message || 'Gagal mengekstrak link stream film' });
    }
  }

  const me = sessionUser(req);
  if (!me && p !== '/api/stream') throw fail(401, 'Silakan masuk dulu');
  const admin = me && me.role === 'admin';
  const needAdmin = () => { if (!admin) throw fail(403, 'Hanya admin yang boleh melakukan ini'); };

  /* Status & kelola provider Bioskop 21 + Custom Watermark Logo (Admin Only) */
  if (p === '/api/movie/admin/mirror' && method === 'GET') {
    needAdmin();
    if (!movieProvider) return send(res, 503, { error: 'Movie provider not available' });
    const info = movieProvider.getMirrors ? movieProvider.getMirrors() : { active: 'https://klikxxi.shop', engine: 'moviebox', mirrors: ['https://klikxxi.shop'] };
    const cfg = getAppConfig();
    return send(res, 200, {
      ok: true,
      active: info.active,
      engine: cfg.movieEngine,
      mirrors: info.mirrors,
      movieEnabled: cfg.movieEnabled,
      watermarkLogo: cfg.watermarkLogo,
      watermarkText: cfg.watermarkText
    });
  }

  if ((p === '/api/movie/admin/mirror' || p === '/api/admin/config') && method === 'POST') {
    needAdmin();
    const b = await readBody(req, 1024 * 1024); // support base64 logo upload up to 1MB
    if (!db.appConfig || typeof db.appConfig !== 'object') db.appConfig = {};

    if (typeof b.movieEnabled === 'boolean') {
      db.appConfig.movieEnabled = b.movieEnabled;
    }
    if (b.engine === 'moviebox' || b.engine === 'klikxxi') {
      db.appConfig.movieEngine = b.engine;
      if (movieProvider && typeof movieProvider.setActiveEngine === 'function') {
        movieProvider.setActiveEngine(b.engine);
      }
    }
    if (typeof b.url === 'string' && b.url.trim()) {
      const newUrl = b.url.trim();
      if (newUrl === 'moviebox' || newUrl === 'klikxxi') {
        db.appConfig.movieEngine = newUrl;
        if (movieProvider && typeof movieProvider.setActiveEngine === 'function') {
          movieProvider.setActiveEngine(newUrl);
        }
      } else if (/^https?:\/\//i.test(newUrl)) {
        const updated = movieProvider ? movieProvider.setActiveMirror(newUrl) : newUrl;
        db.movieMirror = updated;
      }
    }
    if (typeof b.watermarkLogo === 'string') {
      const logoVal = b.watermarkLogo.trim();
      if (!logoVal || /^https?:\/\//i.test(logoVal) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(logoVal) || logoVal.startsWith('icons/')) {
        db.appConfig.watermarkLogo = logoVal;
      } else {
        throw fail(400, 'Format logo harus berupa URL gambar (https://...) atau unggahan gambar');
      }
    }
    if (typeof b.watermarkText === 'string') {
      db.appConfig.watermarkText = b.watermarkText.trim().slice(0, 28) || 'ZanTV';
    }

    save();
    syncMovieProviderConfig();
    vodCache.clear();
    const cfg = getAppConfig();
    console.log('[ZanTV] App/Movie config updated by admin:', { engine: cfg.movieEngine, movieEnabled: cfg.movieEnabled, mirror: cfg.movieMirror, hasCustomLogo: !!cfg.watermarkLogo });
    return send(res, 200, {
      ok: true,
      active: cfg.movieMirror,
      engine: cfg.movieEngine,
      movieEnabled: cfg.movieEnabled,
      watermarkLogo: cfg.watermarkLogo,
      watermarkText: cfg.watermarkText,
      config: cfg
    });
  }

  if (p === '/api/logout' && method === 'POST') {
    logEvent(req, me.name, 'logout', me.gpsItem ? { gpsLabel: me.gpsItem.label } : undefined);
    presence.delete(me.key);
    presence.delete(me.name);
    delete db.sessions[me.key]; save();
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (p === '/api/me' && method === 'GET') return send(res, 200, publicUser(me.name, me.gpsItem));
  if (p === '/api/me/gps' && method === 'POST') {
    const b = await readBody(req, 4096);
    const rawLat = b.lat, rawLng = b.lng, acc = Math.round(+b.accuracy || 0);
    const hasCoords =
      rawLat !== null && rawLat !== undefined && rawLat !== '' &&
      rawLng !== null && rawLng !== undefined && rawLng !== '' &&
      Number.isFinite(+rawLat) && Number.isFinite(+rawLng) &&
      Math.abs(+rawLat) <= 90 && Math.abs(+rawLng) <= 180;
    const u = db.users[me.name];
    if (!admin) {
      ensureUserGps(u);
      if (!u || !u.gpsList.length) {
        delete db.sessions[me.key]; presence.delete(me.key); save();
        throw fail(401, 'Akses lokasi GPS akun ini telah dicabut oleh Admin.');
      }
      if (!hasCoords) {
        logEvent(req, me.name, 'login_gps_missing', { reason: clip(b.gpsError || 'periodic_no_gps', 60) });
        delete db.sessions[me.key]; presence.delete(me.key); save();
        throw fail(401, 'Sesi dihentikan karena izin GPS dimatikan pada perangkat/browser.');
      }

      // Anti-Fake GPS Layer 1: Sinyal & Heuristik Akurasi
      const heur = verifyGpsHeuristics(b);
      if (!heur.ok) {
        logEvent(req, me.name, 'login_fake_gps_heuristic', { code: heur.code, accuracy: acc, isMock: !!b.isMock });
        delete db.sessions[me.key]; presence.delete(me.key); save();
        throw fail(401, heur.msg);
      }

      // Anti-Fake GPS Layer 2: IP vs Geolocation Cross-Check
      const ipGps = await verifyIpVsGps(req, +rawLat, +rawLng);
      if (!ipGps.ok) {
        logEvent(req, me.name, 'login_fake_gps_ip', { code: ipGps.code, lat: +rawLat, lng: +rawLng });
        delete db.sessions[me.key]; presence.delete(me.key); save();
        throw fail(401, ipGps.msg);
      }

      const lat = +(+rawLat).toFixed(5), lng = +(+rawLng).toFixed(5);
      const match = findMatchingGps(u, lat, lng);
      if (!match.item) {
        const maxRadius = match.nearestItem ? (match.nearestItem.radius || 2000) : (u.gpsRadius || 2000);
        recordPendingGps(u, lat, lng, acc, req, match.nearestDist);
        delete db.sessions[me.key]; presence.delete(me.key); save();
        logEvent(req, me.name, 'login_gps_mismatch', { lat, lng, accuracy: acc, dist: match.nearestDist, maxRadius });
        throw fail(401, `Sesi dihentikan: Lokasi GPS berada di luar area terdaftar (${match.nearestDist || 0} m > ${maxRadius} m).`);
      }

      // Anti-Fake GPS Layer 3: Anti-Teleportasi
      const prevLat = (u.lastGpsPing && u.lastGpsPing.lat) || match.item.lastLat;
      const prevLng = (u.lastGpsPing && u.lastGpsPing.lng) || match.item.lastLng;
      const prevAt = (u.lastGpsPing && u.lastGpsPing.at) || match.item.lastAt;
      const tele = checkTeleportation(prevLat, prevLng, prevAt, lat, lng);
      if (!tele.ok) {
        logEvent(req, me.name, 'login_fake_gps_teleport', { speed: tele.speed, dist: tele.dist, prevLat, prevLng, lat, lng });
        delete db.sessions[me.key]; presence.delete(me.key); save();
        throw fail(401, tele.msg);
      }

      match.item.lastLat = lat;
      match.item.lastLng = lng;
      match.item.lastAcc = acc;
      match.item.lastAt = Date.now();
      match.item.lastIp = clientIp(req);
      match.item.lastDevice = parseUA(req.headers['user-agent']);
      u.lastGpsPing = { lat, lng, at: Date.now() };
      if (db.sessions[me.key]) db.sessions[me.key].gpsId = match.item.id;
      save();
      return send(res, 200, { ok: true, dist: match.dist, maxRadius: match.item.radius || 2000, label: match.item.label });
    }
    if (hasCoords) {
      logEvent(req, me.name, 'location', { lat: +(+rawLat).toFixed(5), lng: +(+rawLng).toFixed(5), accuracy: acc });
    }
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me/password' && method === 'POST') {
    const b = await readBody(req, 4096);
    if (!checkPassword(db.users[me.name], String(b.current || ''))) throw fail(400, 'Kata sandi lama salah');
    if (!validPass(b.password)) throw fail(400, 'Kata sandi baru minimal 8 karakter');
    Object.assign(db.users[me.name], hashPassword(b.password));
    dropSessionsOf(me.name);
    const token = createSession(me.name, true, me.gpsId);
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

  /* Terjemahan otomatis subtitle (Auto CC) */
  if (p === '/api/translate' && method === 'POST') {
    const b = await readBody(req, 4096);
    const out = await translateText(b.text, b.target || 'id', b.source || 'auto');
    return send(res, 200, out);
  }


  async function fetchVodJson(upstreamUrl) {
    const r = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (!r.ok) throw new Error('Upstream VOD returned ' + r.status);
    return await r.json();
  }

  if (p === '/api/vod/list' && method === 'GET') {
    const prov = (url.searchParams.get('provider') || 'shortmax').toLowerCase();
    const lang = (url.searchParams.get('lang') || 'id').toLowerCase();
    const type = (url.searchParams.get('type') || 'popular').toLowerCase();
    const page = Math.max(1, +(url.searchParams.get('page') || 1));
    const cacheKey = `list:${prov}:${lang}:${type}:${page}`;
    const cached = getVodCache(cacheKey);
    if (cached) return send(res, 200, cached);

    let upUrl = '';
    if (prov === 'shortmax') {
      const epType = (type === 'new' || type === 'latest') ? 'new' : (type === 'hot' ? 'hot' : 'popular');
      upUrl = `https://apishort.com/v1/shortmax/api/v1/${epType}?lang=${lang}&page=${page}`;
    } else if (prov === 'goodshort') {
      const epType = type === 'feed' ? 'feed' : 'browse';
      upUrl = epType === 'feed'
        ? `https://apishort.com/v1/goodshort/v1/feed?lang=${lang}&page=${page}`
        : `https://apishort.com/v1/goodshort/v1/browse?lang=${lang}&page=${page}&limit=24`;
    } else if (prov === 'joyreels') {
      upUrl = `https://apishort.com/v1/joyreels/dramas/browse?lang=${lang}&page=${page}&per_page=20`;
    } else if (prov === 'raptdrama') {
      upUrl = `https://apishort.com/v1/raptdrama/api/public/browse?page=${page}&limit=20`;
    } else {
      upUrl = `https://apishort.com/v1/shortmax/api/v1/popular?lang=${lang}&page=${page}`;
    }

    const raw = await fetchVodJson(upUrl).catch(() => ({}));
    let items = [];
    if (prov === 'shortmax') {
      const list = raw.data || [];
      items = list.map(d => ({
        id: String(d.id || d.code),
        title: d.name || '',
        cover: d.cover || '',
        episodes: d.episodes || 0,
        summary: d.summary || '',
        provider: 'shortmax',
        lang,
        views: d.views || 0
      }));
    } else if (prov === 'goodshort') {
      const list = (raw.data && (raw.data.books || raw.data.list)) || [];
      items = list.map(d => ({
        id: String(d.id),
        title: d.title || '',
        cover: d.cover || '',
        episodes: d.total_chapters || 0,
        summary: d.desc || d.title || '',
        provider: 'goodshort',
        lang: d.lang || lang
      }));
    } else if (prov === 'joyreels') {
      const list = raw.items || [];
      items = list.map(d => ({
        id: String(d.id),
        title: d.title || '',
        cover: d.poster || '',
        episodes: d.episode_count || 0,
        summary: d.category || '',
        category: d.category || '',
        provider: 'joyreels',
        lang: raw.language || lang
      }));
    } else if (prov === 'raptdrama') {
      const list = raw.data || [];
      items = list.map(d => ({
        id: String(d.id),
        title: d.title || '',
        cover: d.cover || d.poster_original || '',
        episodes: d.total_episodes || 0,
        summary: d.desc || '',
        provider: 'raptdrama',
        lang: 'zh'
      }));
    }

    const payload = { provider: prov, lang, type, page, items };
    setVodCache(cacheKey, payload, 15 * 60 * 1000);
    return send(res, 200, payload);
  }

  if (p === '/api/vod/search' && method === 'GET') {
    const prov = (url.searchParams.get('provider') || 'shortmax').toLowerCase();
    const lang = (url.searchParams.get('lang') || 'id').toLowerCase();
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return send(res, 200, { provider: prov, lang, q, items: [] });
    const cacheKey = `search:${prov}:${lang}:${q}`;
    const cached = getVodCache(cacheKey);
    if (cached) return send(res, 200, cached);

    let upUrl = '';
    if (prov === 'shortmax') {
      upUrl = `https://apishort.com/v1/shortmax/api/v1/search?lang=${lang}&q=${encodeURIComponent(q)}`;
    } else if (prov === 'goodshort') {
      upUrl = `https://apishort.com/v1/goodshort/v1/books/search?lang=${lang}&q=${encodeURIComponent(q)}`;
    } else if (prov === 'joyreels') {
      upUrl = `https://apishort.com/v1/joyreels/search?lang=${lang}&q=${encodeURIComponent(q)}&page=1`;
    } else if (prov === 'raptdrama') {
      upUrl = `https://apishort.com/v1/raptdrama/api/public/search?page=1&q=${encodeURIComponent(q)}`;
    } else {
      upUrl = `https://apishort.com/v1/shortmax/api/v1/search?lang=${lang}&q=${encodeURIComponent(q)}`;
    }

    const raw = await fetchVodJson(upUrl).catch(() => ({}));
    let items = [];
    if (prov === 'shortmax') {
      const list = raw.data || [];
      items = list.map(d => ({
        id: String(d.id || d.code),
        title: d.name || '',
        cover: d.cover || '',
        episodes: d.episodes || 0,
        summary: d.summary || '',
        provider: 'shortmax',
        lang
      }));
    } else if (prov === 'goodshort') {
      const list = (raw.data && (raw.data.books || raw.data.list)) || [];
      items = list.map(d => ({
        id: String(d.id),
        title: d.title || '',
        cover: d.cover || '',
        episodes: d.total_chapters || 0,
        summary: d.desc || d.title || '',
        provider: 'goodshort',
        lang
      }));
    } else if (prov === 'joyreels') {
      const list = raw.items || [];
      items = list.map(d => ({
        id: String(d.id),
        title: d.title || '',
        cover: d.poster || '',
        episodes: d.episode_count || 0,
        summary: d.category || '',
        provider: 'joyreels',
        lang
      }));
    } else if (prov === 'raptdrama') {
      const list = raw.data || [];
      items = list.map(d => ({
        id: String(d.id),
        title: d.title || '',
        cover: d.cover || d.poster_original || '',
        episodes: d.total_episodes || 0,
        summary: d.desc || '',
        provider: 'raptdrama',
        lang: 'zh'
      }));
    }

    const payload = { provider: prov, lang, q, items };
    setVodCache(cacheKey, payload, 5 * 60 * 1000);
    return send(res, 200, payload);
  }

  if (p === '/api/vod/drama' && method === 'GET') {
    const prov = (url.searchParams.get('provider') || 'shortmax').toLowerCase();
    const id = (url.searchParams.get('id') || '').trim();
    const lang = (url.searchParams.get('lang') || 'id').toLowerCase();
    if (!id) throw fail(400, 'Parameter id diperlukan');
    const cacheKey = `drama:${prov}:${lang}:${id}`;
    const cached = getVodCache(cacheKey);
    if (cached) return send(res, 200, cached);

    let upUrl = '';
    if (prov === 'shortmax') {
      upUrl = `https://apishort.com/v1/shortmax/api/v1/alleps/${id}?lang=${lang}`;
    } else if (prov === 'goodshort') {
      upUrl = `https://apishort.com/v1/goodshort/v1/book/${id}`;
    } else if (prov === 'joyreels') {
      upUrl = `https://apishort.com/v1/joyreels/drama/${id}/episodes?lang=${lang}`;
    } else if (prov === 'raptdrama') {
      upUrl = `https://apishort.com/v1/raptdrama/api/public/episodes/${id}`;
    }

    const raw = await fetchVodJson(upUrl).catch(() => ({}));
    let payload = { provider: prov, id, lang, title: '', cover: '', summary: '', totalEpisodes: 0, episodes: [] };

    if (prov === 'shortmax') {
      const d = raw.data || {};
      payload.title = d.name || '';
      payload.summary = d.summary || '';
      payload.totalEpisodes = d.totalEpisodes || (d.episodes || []).length;
      payload.episodes = (d.episodes || []).map(ep => ({
        episode: ep.episode,
        title: 'Ep ' + ep.episode,
        stream: (ep.video && (ep.video.video_1080 || ep.video.video_720 || ep.video.video_480)) || '',
        cover: ep.cover || '',
        duration: ep.duration || 0
      }));
    } else if (prov === 'goodshort') {
      const d = raw.data || {};
      payload.title = d.title || '';
      payload.cover = d.cover || '';
      payload.summary = d.desc || d.title || '';
      payload.totalEpisodes = d.total_chapters || (d.chapters || []).length;
      payload.episodes = (d.chapters || []).map(ch => ({
        episode: ch.chapter,
        title: 'Ep ' + ch.chapter,
        stream: ch.stream,
        quality: ch.quality || '1080p'
      }));
    } else if (prov === 'joyreels') {
      payload.totalEpisodes = raw.total_episodes || (raw.episodes || []).length;
      payload.episodes = (raw.episodes || []).map(ep => ({
        episode: ep.idx,
        episodeId: ep.episode_id,
        title: 'Ep ' + ep.idx,
        cover: ep.poster || '',
        needsResolve: true
      }));
    } else if (prov === 'raptdrama') {
      const list = raw.data || [];
      payload.totalEpisodes = list.length;
      payload.episodes = list.map(ep => ({
        episode: ep.idx,
        title: ep.title || ('Ep ' + ep.idx),
        stream: ep.url,
        segments: ep.segments
      }));
    }

    setVodCache(cacheKey, payload, 30 * 60 * 1000);
    return send(res, 200, payload);
  }

  if (p === '/api/vod/stream' && method === 'GET') {
    const prov = (url.searchParams.get('provider') || 'joyreels').toLowerCase();
    const id = (url.searchParams.get('id') || '').trim();
    const ep = +(url.searchParams.get('ep') || 1);
    const lang = (url.searchParams.get('lang') || 'id').toLowerCase();
    const cacheKey = `stream:${prov}:${lang}:${id}:${ep}`;
    const cached = getVodCache(cacheKey);
    if (cached) return send(res, 200, cached);

    let upUrl = '';
    if (prov === 'joyreels') {
      upUrl = `https://apishort.com/v1/joyreels/drama/${id}/episode/${ep}?lang=${lang}`;
    } else if (prov === 'goodshort') {
      upUrl = `https://apishort.com/v1/goodshort/v1/book/${id}/chapter/${ep}`;
    }

    const raw = await fetchVodJson(upUrl).catch(() => ({}));
    let streamUrl = '';
    if (prov === 'joyreels') {
      streamUrl = raw.content_resource_url || '';
    } else if (prov === 'goodshort') {
      streamUrl = (raw.data && raw.data.stream) || '';
    }

    const payload = { provider: prov, id, ep, stream: streamUrl, raw };
    if (streamUrl) setVodCache(cacheKey, payload, 30 * 60 * 1000);
    return send(res, 200, payload);
  }



  /* Relay stream HLS/TS dengan injeksi header HTTP standar M3U, anti multi-connect MAC, penyambung TS otomatis, & kompresi resolusi FFmpeg */
  if (p === '/api/stream' && (method === 'GET' || method === 'HEAD')) {
    const rawU = url.searchParams.get('u') || '';
    const ua = (url.searchParams.get('ua') || '').slice(0, 300);
    const ref = (url.searchParams.get('ref') || '').slice(0, 300);
    const org = (url.searchParams.get('org') || '').slice(0, 300);
    console.log('[Stream Relay] INCOMING:', method, 'seg=' + (url.searchParams.get('seg') || '0'), 'target:', clip(rawU, 90));

    const clientOrigin = req.headers.origin;
    const streamCors = {
      'Access-Control-Allow-Origin': clientOrigin || '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
      ...(clientOrigin ? { 'Access-Control-Allow-Credentials': 'true' } : {})
    };
    const reqQ = +(url.searchParams.get('q') || 0);
    const q = (reqQ === 360 || reqQ === 480 || reqQ === 720) ? reqQ : 0;
    const forceTranscode = url.searchParams.get('transcode') === '1';

    let initialTarget;
    try {
      initialTarget = await assertPublicUrl(rawU);
    } catch (e) {
      console.error('[Stream Relay] assertPublicUrl REJECTED:', e.message, 'rawU:', clip(rawU, 90));
      throw fail(400, e.message);
    }
    const isSegReq = url.searchParams.get('seg') === '1';
    const isTsLike = !isSegReq && isDirectStreamUrl(rawU);
    const isStalker = /\/play\/live\.php\b/i.test(rawU);
    const cleanRawPath = rawU.split(/[?#]/)[0];

    // Cegah multi-connect pada server Stalker/MAC & Xtream Codes (max_connections: 1):
    // Putus koneksi lama pada MAC / akun Xtream yang sama sebelum buka yang baru (JANGAN terapkan pada segmen HLS seg=1!)
    const macMatch = /[?&]mac=([0-9a-fA-F:%]+)/.exec(rawU);
    const xtreamMatch = /\/(?:live|movie|series)\/([^/?#]+)\/([^/?#]+)\/(\d+)/i.exec(cleanRawPath) ||
                        /^https?:\/\/[^/]+\/([^/?#]+)\/([^/?#]+)\/(\d+)$/i.exec(cleanRawPath);
    const lockKey = (!isSegReq && (isTsLike || (q && forceTranscode) || xtreamMatch))
      ? (macMatch
          ? 'mac:' + decodeURIComponent(macMatch[1]).toLowerCase()
          : (xtreamMatch
              ? 'xtream:' + initialTarget.hostname.toLowerCase() + ':' + xtreamMatch[1].toLowerCase()
              : 'ts:' + (me ? me.key : ip)))
      : '';
    if (lockKey && activeStreamLocks.has(lockKey)) {
      try { activeStreamLocks.get(lockKey).kill(); } catch (e) {}
      activeStreamLocks.delete(lockKey);
      // Panel Xtream-Masters butuh ~650ms untuk mendeteksi socket TCP lama putus & menurunkan active_cons menjadi 0
      await new Promise((r) => setTimeout(r, xtreamMatch ? 650 : 300));
    }

    const VLC_UA = 'VLC/3.0.20 LibVLC/3.0.20';
    const LAVF_UA = 'Lavf/60.16.100';
    const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const primaryUa = ua || (isTsLike ? VLC_UA : CHROME_UA);
    const fallbackUa = ua ? '' : (isTsLike ? LAVF_UA : VLC_UA);

    let clientClosed = false;
    let currentAc = new AbortController();
    let pipeStream = null;
    let ffProc = null;
    let ffCounted = false;
    const killFfmpeg = () => {
      if (ffCounted) {
        ffCounted = false;
        activeFfmpegCount = Math.max(0, activeFfmpegCount - 1);
      }
      if (ffProc) {
        try { if (ffProc.stdin) ffProc.stdin.destroy(); } catch (e) {}
        try { ffProc.kill('SIGKILL'); } catch (e) {}
        ffProc = null;
      }
    };
    const killUpstream = () => {
      clientClosed = true;
      try { currentAc.abort(); } catch (e) {}
      if (pipeStream) { try { pipeStream.destroy(); } catch (e) {} }
      killFfmpeg();
    };
    const lockObj = { kill: killUpstream };
    if (lockKey) activeStreamLocks.set(lockKey, lockObj);
    req.on('close', () => {
      killUpstream();
      if (lockKey && activeStreamLocks.get(lockKey) === lockObj) activeStreamLocks.delete(lockKey);
    });

    const Q_PROFILES = {
      360: { h: 360, vb: '480k', max: '600k', buf: '1000k', ab: '64k' },
      480: { h: 480, vb: '850k', max: '1050k', buf: '1800k', ab: '96k' },
      720: { h: 720, vb: '1600k', max: '2000k', buf: '3200k', ab: '128k' }
    };

    const startFfmpegPipe = (height, directUrl, customUa) => {
      const prof = Q_PROFILES[height];
      if (!prof || !HAS_FFMPEG || activeFfmpegCount >= MAX_FFMPEG) return null;
      const args = ['-loglevel', 'error', '-fflags', '+genpts+igndts+discardcorrupt+nobuffer'];
      if (directUrl) {
        if (customUa) args.push('-user_agent', customUa);
        const hdrLines = [];
        if (ref) {
          hdrLines.push('Referer: ' + ref);
          try { hdrLines.push('Origin: ' + (org || new URL(ref).origin)); } catch (e) {}
        } else if (org) {
          hdrLines.push('Origin: ' + org);
        }
        if (hdrLines.length) args.push('-headers', hdrLines.join('\r\n') + '\r\n');
        args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '3', '-i', directUrl);
      } else {
        args.push('-f', 'mpegts', '-i', 'pipe:0');
      }
      args.push(
        '-vf', `scale=-2:${prof.h}`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-b:v', prof.vb,
        '-maxrate', prof.max,
        '-bufsize', prof.buf,
        '-g', '50',
        '-c:a', 'aac',
        '-b:a', prof.ab,
        '-ac', '2',
        '-f', 'mpegts',
        'pipe:1'
      );
      try {
        const proc = spawn('ffmpeg', args, { stdio: [directUrl ? 'ignore' : 'pipe', 'pipe', 'ignore'] });
        activeFfmpegCount++;
        ffCounted = true;
        ffProc = proc;
        proc.on('error', () => { killFfmpeg(); try { res.end(); } catch (e) {} });
        proc.on('close', () => { killFfmpeg(); if (directUrl) { try { res.end(); } catch (e) {} } });
        if (proc.stdin) proc.stdin.on('error', () => {});
        proc.stdout.on('error', () => {});
        proc.stdout.pipe(res);
        return proc;
      } catch (e) {
        return null;
      }
    };

    const uIp = clientIp(req);
    async function connectUpstream(useUa, sendClientIp, startUrl) {
      let curTarget = startUrl || initialTarget;
      const stepAc = new AbortController();
      currentAc = stepAc;
      const connTimer = setTimeout(() => stepAc.abort(), 20000);
      const reqHeaders = {
        'User-Agent': useUa,
        'Accept': '*/*',
        'Accept-Encoding': 'identity'
      };
      if (!isTsLike) reqHeaders['Icy-MetaData'] = '1';
      if (sendClientIp && uIp && !privateIp(uIp)) {
        reqHeaders['X-Forwarded-For'] = uIp;
        reqHeaders['X-Real-IP'] = uIp;
      }
      if (ref) {
        reqHeaders['Referer'] = ref;
        try { reqHeaders['Origin'] = org || new URL(ref).origin; } catch (e) {}
      } else if (org) {
        reqHeaders['Origin'] = org;
      }
      if (req.headers['range'] && !isTsLike && !q) reqHeaders['Range'] = req.headers['range'];

      const cookies = [];
      try {
        for (let hop = 0; hop < 8; hop++) {
          if (clientClosed) { clearTimeout(connTimer); return { res: null, target: curTarget, ac: stepAc }; }
          if (cookies.length) reqHeaders['Cookie'] = cookies.join('; ');
          const r = await fetch(curTarget, { redirect: 'manual', signal: stepAc.signal, headers: reqHeaders });
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
          clearTimeout(connTimer);
          return { res: r, target: curTarget, ac: stepAc };
        }
        clearTimeout(connTimer);
        return { res: null, target: curTarget, ac: stepAc };
      } catch (e) {
        clearTimeout(connTimer);
        throw e;
      }
    }

    const isRejectedTs = (r) => {
      if (!r) return false;
      if (r.status === 401 || r.status === 403 || r.status === 511 || r.status === 429 || r.status === 458) return true;
      const c = (r.headers.get('content-type') || '').toLowerCase();
      return isTsLike && c.includes('text/html');
    };

    const cachedDirect = activeStreamLocks.get('direct:' + rawU);
    let upRes, target = initialTarget, chosenUa = primaryUa, chosenSendIp = false;
    let preloadedXtreamM3u8 = null;
    try {
      // Untuk URL Xtream Live (.ts atau tanpa ekstensi), coba jalur .m3u8 (/hlsr/) lebih dulu agar tidak memicu active_cons ganda
      if (xtreamMatch && !isSegReq && !/\.m3u8($|\?)/i.test(cleanRawPath)) {
        try {
          const xM3u8Url = await assertPublicUrl(`${initialTarget.protocol}//${initialTarget.host}/live/${xtreamMatch[1]}/${xtreamMatch[2]}/${xtreamMatch[3]}.m3u8`);
          const mAtt = await connectUpstream(primaryUa, false, xM3u8Url);
          if (mAtt.res && mAtt.res.ok) {
            const mTxt = await mAtt.res.text();
            if (mTxt.trimStart().startsWith('#EXTM3U')) {
              preloadedXtreamM3u8 = { text: mTxt, target: mAtt.target || xM3u8Url, base: xM3u8Url };
              upRes = mAtt.res;
              target = mAtt.target || xM3u8Url;
            }
          } else if (mAtt.res && mAtt.res.body) {
            try { mAtt.res.body.cancel(); } catch (e) {}
          }
        } catch (e) {}
      }

      if (!preloadedXtreamM3u8) {
        let attempt = await connectUpstream(primaryUa, false);
        upRes = attempt.res;
        target = attempt.target;
        // Jika kena 429 Connection limit reached (panel Xtream masih melepas sesi channel sebelumnya), tunggu 1.1 detik lalu coba lagi
        if (upRes && (upRes.status === 429 || upRes.status === 458) && !clientClosed) {
          try { if (upRes.body) upRes.body.cancel(); } catch (e) {}
          await new Promise((r) => setTimeout(r, 1100));
          if (!clientClosed) {
            attempt = await connectUpstream(primaryUa, false);
            upRes = attempt.res;
            target = attempt.target;
          }
        }
        // Jika server Stalker menolak play_token karena sudah pernah ditukar (kode 511/403), coba URL media langsung yang sudah di-cache
        if (isRejectedTs(upRes) && upRes.status !== 429 && cachedDirect && cachedDirect.url && (Date.now() - cachedDirect.ts < 3 * 3600 * 1000)) {
          try { if (upRes.body) upRes.body.cancel(); } catch (e) {}
          chosenUa = cachedDirect.ua || primaryUa;
          chosenSendIp = !!cachedDirect.sendIp;
          attempt = await connectUpstream(chosenUa, chosenSendIp, cachedDirect.url);
          upRes = attempt.res;
          target = attempt.target;
        }
        if (isRejectedTs(upRes) && upRes.status !== 429 && uIp && !privateIp(uIp)) {
          try { if (upRes.body) upRes.body.cancel(); } catch (e) {}
          chosenSendIp = true;
          attempt = await connectUpstream(primaryUa, true);
          upRes = attempt.res;
          target = attempt.target;
        }
        if (isRejectedTs(upRes) && upRes.status !== 429 && fallbackUa) {
          try { if (upRes.body) upRes.body.cancel(); } catch (e) {}
          chosenUa = fallbackUa;
          chosenSendIp = true;
          attempt = await connectUpstream(fallbackUa, true);
          upRes = attempt.res;
          target = attempt.target;
        }
        if (isRejectedTs(upRes) && upRes.status !== 429 && isTsLike && chosenUa !== CHROME_UA) {
          try { if (upRes.body) upRes.body.cancel(); } catch (e) {}
          chosenUa = CHROME_UA;
          chosenSendIp = true;
          attempt = await connectUpstream(CHROME_UA, true);
          upRes = attempt.res;
          target = attempt.target;
        }
      }
    } catch (e) {
      if (clientClosed) return res.end();
      console.error('[Stream Relay] Connect error:', e.message, 'target:', clip(rawU, 80));
      throw fail(502, 'Gagal menghubungi server stream: ' + e.message);
    }
    if (clientClosed) return res.end();
    if (!upRes) throw fail(502, 'Terlalu banyak pengalihan stream');
    console.log(`[Stream Relay] Upstream status: ${upRes.status} (${upRes.headers.get('content-type') || 'unknown'}) for ${target.hostname}`);
    if (!upRes.ok && upRes.status !== 206) {
      console.warn(`[Stream Relay] Upstream rejected HTTP ${upRes.status} for ${clip(rawU, 90)}`);
      res.writeHead(upRes.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...streamCors });
      return res.end(JSON.stringify({ error: 'Stream menjawab kode ' + upRes.status }));
    }

    if (isStalker && target && target !== initialTarget) {
      activeStreamLocks.set('direct:' + rawU, { url: target, ua: chosenUa, sendIp: chosenSendIp, ts: Date.now() });
    }

    const ct = (upRes.headers.get('content-type') || '').toLowerCase();
    if (isTsLike && ct.includes('text/html')) {
      try { if (upRes.body) upRes.body.cancel(); } catch (e) {}
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'Token stream dikunci ke IP perangkat asal atau VLC masih terbuka' }));
    }
    const isM3u8 = !preloadedXtreamM3u8 && (ct.includes('mpegurl') || /\.m3u8($|\?)/i.test(target.pathname));
    const suffix = (ua ? '&ua=' + encodeURIComponent(ua) : '') +
      (ref ? '&ref=' + encodeURIComponent(ref) : '') +
      (org ? '&org=' + encodeURIComponent(org) : '') +
      '&seg=1';
    const wrapUrl = (rel) => {
      try {
        const absUrl = new URL(rel, target);
        // Jika target memiliki query params dan rel tidak punya, wariskan query params target
        if (target.search && !absUrl.search) {
          absUrl.search = target.search;
        }
        return '/api/stream?u=' + encodeURIComponent(absUrl.toString()) + suffix;
      } catch (e) { return rel; }
    };

    if (isM3u8) {
      if (q && forceTranscode && HAS_FFMPEG && activeFfmpegCount < MAX_FFMPEG) {
        try { if (upRes.body) upRes.body.cancel(); } catch (e) {}
        res.writeHead(200, {
          'Content-Type': 'video/mp2t',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
          ...streamCors
        });
        const ff = startFfmpegPipe(q, target.toString(), chosenUa);
        if (ff) return;
      }
      const buf = Buffer.from(await upRes.arrayBuffer());
      const bodyText = buf.toString('utf8');
      if (bodyText.trimStart().startsWith('#EXTM3U')) {
        const rewritten = bodyText.split(/\r?\n/).map((line) => {
          const t = line.trim();
          if (!t) return line;
          if (t.startsWith('#')) {
            return line.replace(/URI=["']([^"']+)["']/gi, (_, u1) => 'URI="' + wrapUrl(u1) + '"');
          }
          return wrapUrl(t);
        }).join('\n');
        const outBuf = Buffer.from(rewritten, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Content-Length': outBuf.length,
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
          ...streamCors
        });
        return res.end(outBuf);
      }
      res.writeHead(upRes.status, {
        'Content-Type': ct || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        ...streamCors
      });
      return res.end(buf);
    }

    const isSeg = isSegReq;
    const isLiveTs = Boolean(preloadedXtreamM3u8) || (!isSeg && !upRes.headers.get('content-length') && !req.headers['range'] && (isTsLike || ct.includes('mp2t')));
    if (isLiveTs) {
      res.writeHead(200, {
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...streamCors
      });
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      // Fungsi remux ringan (-c:v copy -c:a aac) khusus untuk stream DVB/Satelit (seperti BRI 1 / sansatplus)
      // yang memakai audio MP2 (MPEG-1 Layer 2) atau AC3 yang ditolak MSE browser Chrome/Safari
      const startAudioRemuxPipe = () => {
        if (!HAS_FFMPEG || activeFfmpegCount >= MAX_FFMPEG) return null;
        const args = [
          '-loglevel', 'error',
          '-analyzeduration', '500000',
          '-probesize', '500000',
          '-fflags', '+genpts+igndts+discardcorrupt+nobuffer',
          '-f', 'mpegts',
          '-i', 'pipe:0',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '48000',
          '-ac', '2',
          '-flush_packets', '1',
          '-f', 'mpegts',
          'pipe:1'
        ];
        try {
          const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'ignore'] });
          activeFfmpegCount++;
          ffCounted = true;
          ffProc = proc;
          proc.on('error', () => { killFfmpeg(); });
          proc.on('close', () => { killFfmpeg(); });
          if (proc.stdin) proc.stdin.on('error', () => {});
          proc.stdout.on('error', () => {});
          proc.stdout.pipe(res);
          return proc;
        } catch (e) {
          return null;
        }
      };

      // Deteksi apakah PMT MPEG-TS memiliki audio non-AAC (0x03/0x04 MP2, 0x06/0x81 AC3) atau MPEG Audio Layer 2
      const needsAudioRemux = (chunk) => {
        for (let p = 0; p + 188 <= chunk.length; p += 188) {
          if (chunk[p] !== 0x47) continue;
          const payloadStart = (chunk[p + 1] & 0x40) !== 0;
          if (!payloadStart) continue;
          const pid = ((chunk[p + 1] & 0x1F) << 8) | chunk[p + 2];
          const af = (chunk[p + 3] >> 4) & 0x3;
          let off = 4 + ((af === 2 || af === 3) ? 1 + chunk[p + 4] : 0);
          if (off + 16 >= 188) continue;

          // 1. Cek PES audio stream_id 0xC0..0xDF untuk header MPEG Audio Layer 2 ((b[1] & 0x06) === 0x04)
          if (chunk[p + off] === 0x00 && chunk[p + off + 1] === 0x00 && chunk[p + off + 2] === 0x01) {
            const sid = chunk[p + off + 3];
            if (sid >= 0xC0 && sid <= 0xDF) {
              const pesHdrLen = chunk[p + off + 8];
              const esOff = p + off + 9 + pesHdrLen;
              if (esOff + 2 < p + 188 && chunk[esOff] === 0xFF && (chunk[esOff + 1] & 0xE0) === 0xE0) {
                const layerBits = (chunk[esOff + 1] >> 1) & 0x03;
                if (layerBits === 2 || layerBits === 3) return true; // Layer II (MP2) atau Layer I (MP1)
              }
            } else if (sid === 0xBD) {
              return true; // Private Stream 1 (AC3 / EAC3 di DVB TS)
            }
          }

          // 2. Cek tabel PMT (Program Map Table, table_id === 0x02) untuk stream_type 0x03/0x04 (MP1/MP2) atau 0x81/0x87 (AC3/EAC3)
          if (pid !== 0 && pid !== 17) {
            const ptr = chunk[p + off];
            const tblOff = p + off + 1 + ptr;
            if (tblOff + 12 < p + 188 && chunk[tblOff] === 0x02) {
              const secLen = ((chunk[tblOff + 1] & 0x0F) << 8) | chunk[tblOff + 2];
              const progInfoLen = ((chunk[tblOff + 10] & 0x0F) << 8) | chunk[tblOff + 11];
              let pos = tblOff + 12 + progInfoLen;
              const endPos = Math.min(p + 188, tblOff + 3 + secLen - 4);
              while (pos + 5 <= endPos) {
                const st = chunk[pos];
                const esInfoLen = ((chunk[pos + 3] & 0x0F) << 8) | chunk[pos + 4];
                if (st === 0x03 || st === 0x04 || st === 0x81 || st === 0x87) return true;
                pos += 5 + esInfoLen;
              }
            }
          }
        }
        return false;
      };

      let ff = q ? startFfmpegPipe(q, null, chosenUa) : null;
      let outStream = (ff && ff.stdin) ? ff.stdin : res;
      let audioChecked = !!ff || !HAS_FFMPEG;

      let lastVideoPts = null;
      let lastTailSig = null;

      // Parser PTS akurat dari paket TS 188-byte untuk sambungan mulus (seamless splice) tanpa lompatan waktu
      const parsePts = (pkt) => {
        if (pkt.length < 188 || pkt[0] !== 0x47) return null;
        const payloadStart = (pkt[1] & 0x40) !== 0;
        if (!payloadStart) return null;
        const pid = ((pkt[1] & 0x1F) << 8) | pkt[2];
        const af = (pkt[3] >> 4) & 0x3;
        let offset = 4;
        if (af === 2 || af === 3) offset += 1 + pkt[4];
        if (offset + 14 <= 188) {
          if (pkt[offset] === 0x00 && pkt[offset + 1] === 0x00 && pkt[offset + 2] === 0x01) {
            const streamId = pkt[offset + 3];
            const ptsFlags = (pkt[offset + 7] >> 6) & 0x3;
            if (ptsFlags === 2 || ptsFlags === 3) {
              const b = pkt.subarray(offset + 9, offset + 14);
              const pts = (((b[0] & 0x0E) * 2 ** 29) + ((b[1] & 0xFF) << 22) + ((b[2] & 0xFE) << 14) + ((b[3] & 0xFF) << 7) + ((b[4] & 0xFE) >> 1)) / 90000;
              return { pid, streamId, pts, isVideo: (streamId & 0xF0) === 0xE0 };
            }
          }
        }
        return null;
      };

      // Pompa paket MPEG-TS: kirim instan paket awal untuk startup kilat, lalu batch kelipatan 188 byte
      // Dilengkapi Seamless PTS Splice agar reconnect tidak mengirim duplikat video lama yang membuat player tersendat per 5 detik
      const pumpTsAligned = async (body, stepAc, isReconnect) => {
        if (!body) return 0;
        const reader = body.getReader();
        let rem = Buffer.alloc(0);
        let synced = false;
        let bytesSent = 0;
        let idleTimer = null;
        let skipping = !!(isReconnect && (lastVideoPts !== null || lastTailSig));
        let skippedBytes = 0;
        const resetIdle = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => { try { stepAc.abort(); } catch (e) {} }, 12000);
        };
        try {
          resetIdle();
          while (!clientClosed) {
            const { value, done } = await reader.read();
            if (done || clientClosed) break;
            resetIdle();
            if (!value || !value.byteLength) continue;
            rem = rem.length ? Buffer.concat([rem, Buffer.from(value)]) : Buffer.from(value);
            if (!synced) {
              if (rem.length < 376) continue;
              let syncPos = -1;
              for (let i = 0; i + 188 < rem.length; i++) {
                if (rem[i] === 0x47 && rem[i + 188] === 0x47) { syncPos = i; break; }
              }
              if (syncPos < 0) {
                if (rem.length > 4096) rem = rem.subarray(rem.length - 188);
                continue;
              }
              if (syncPos > 0) rem = rem.subarray(syncPos);
              synced = true;
            }

            // Pada awal stream (~3.7KB pertama), periksa apakah tabel PMT / audio menggunakan MP2/AC3 yang butuh remux instan ke AAC
            if (!audioChecked) {
              if (rem.length < 188 * 20) continue;
              audioChecked = true;
              if (needsAudioRemux(rem)) {
                console.log('[Stream Relay] Detected MP2/AC3 audio in Live TS -> activating zero-CPU video-copy + AAC audio remux for:', clip(rawU, 70));
                ff = startAudioRemuxPipe();
                if (ff && ff.stdin) outStream = ff.stdin;
              }
            }

            // Jika ini reconnect, lewati duplikasi paket lama (overlap) yang dikirim ulang server IPTV
            if (skipping) {
              // Jalur 1: Tail signature matching (jika ada)
              if (lastTailSig && rem.length >= lastTailSig.length) {
                const tailIdx = rem.indexOf(lastTailSig);
                if (tailIdx >= 0) {
                  const cut = tailIdx + lastTailSig.length;
                  skippedBytes += cut;
                  rem = rem.subarray(cut);
                  skipping = false;
                }
              }
              // Jalur 2: PTS matching frame-by-frame
              if (skipping && lastVideoPts !== null) {
                let foundContinuationAt = -1;
                for (let p = 0; p + 188 <= rem.length; p += 188) {
                  const pkt = rem.subarray(p, p + 188);
                  const info = parsePts(pkt);
                  if (info && info.isVideo) {
                    const isContinuation = (info.pts > lastVideoPts && info.pts - lastVideoPts < 120) || (lastVideoPts - info.pts > 85000);
                    if (isContinuation) {
                      foundContinuationAt = p;
                      break;
                    }
                  }
                }
                if (foundContinuationAt >= 0) {
                  skippedBytes += foundContinuationAt;
                  rem = rem.subarray(foundContinuationAt);
                  skipping = false;
                } else if (rem.length > 188 * 50) {
                  const discard = rem.length - (188 * 20);
                  skippedBytes += discard;
                  rem = rem.subarray(discard);
                }
              }
              // Safety valve: jika sudah buang > 384KB (~0.8 detik) tapi belum ketemu, lepaskan skip agar stream tidak beku
              if (skipping && skippedBytes > 384 * 1024) {
                skipping = false;
              }
              if (skipping) continue;
            }

            // Kirim paket langsung kelipatan 188 byte tanpa ditunda-tunda
            const maxAligned = Math.floor(rem.length / 188) * 188;
            if (maxAligned > 0) {
              const outChunk = rem.subarray(0, maxAligned);
              rem = rem.subarray(maxAligned);
              bytesSent += outChunk.length;

              // Catat PTS video & tail paket terakhir untuk referensi reconnect berikutnya
              for (let p = 0; p < outChunk.length; p += 188) {
                const pkt = outChunk.subarray(p, p + 188);
                const info = parsePts(pkt);
                if (info && info.isVideo) {
                  lastVideoPts = info.pts;
                }
              }
              if (outChunk.length >= 188 * 8) {
                lastTailSig = outChunk.subarray(outChunk.length - 188 * 8);
              }

              if (!outStream.destroyed && !outStream.write(outChunk)) {
                await new Promise((r) => outStream.once('drain', r));
              }
            }
          }
        } catch (e) {
          // upstream terputus atau idle timeout -> disambung oleh loop di bawah
        } finally {
          clearTimeout(idleTimer);
          try { reader.cancel(); } catch (e) {}
        }
        return bytesSent;
      };

      // Mode Xtream HLS-to-TS Stitcher:
      // Banyak panel Xtream (seperti sansatplus.net:88 / BRI 1) memutus koneksi raw .ts setiap 2-3 detik (262KB) jika max_connections:1,
      // tetapi menyediakan playlist HLS /live/<user>/<pass>/<id>.m3u8 berisi segmen /hlsr/ 10 detik yang stabil & bebas putus!
      const tryXtreamHlsStitcher = async () => {
        if (!preloadedXtreamM3u8) return false;
        const m3u8Base = preloadedXtreamM3u8.base;
        let activeM3u8Target = preloadedXtreamM3u8.target;
        const seenSegs = new Set();
        let emptyPolls = 0;
        let stitchedAny = false;

        try {
          console.log('[Stream Relay] Activated Xtream HLS-to-TS Stitcher for:', m3u8Base.toString());

          const parseSegLines = (txt) => txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
          const segKey = (rel) => rel.split('/').pop().split('?')[0];

          let curLines = parseSegLines(preloadedXtreamM3u8.text);
          // Ambil 4 segmen terakhir (~40 detik buffer) agar langsung jalan mulus tanpa sering polling .m3u8
          if (curLines.length > 4) {
            curLines.slice(0, -4).forEach((l) => seenSegs.add(segKey(l)));
          }

          while (!clientClosed && emptyPolls < 10) {
            const todo = curLines.filter((l) => !seenSegs.has(segKey(l)));
            if (todo.length === 0) {
              emptyPolls++;
            } else {
              emptyPolls = 0;
              for (const rel of todo) {
                if (clientClosed) break;
                const k = segKey(rel);
                seenSegs.add(k);
                if (seenSegs.size > 60) {
                  const firstKey = seenSegs.values().next().value;
                  seenSegs.delete(firstKey);
                }
                try {
                  const segTarget = await assertPublicUrl(new URL(rel, activeM3u8Target).toString());
                  const segAtt = await connectUpstream(chosenUa, chosenSendIp, segTarget);
                  if (segAtt.res && segAtt.res.ok && segAtt.res.body) {
                    const bSent = await pumpTsAligned(segAtt.res.body, segAtt.ac, false);
                    if (bSent > 0) stitchedAny = true;
                  } else if (segAtt.res && segAtt.res.body) {
                    try { segAtt.res.body.cancel(); } catch (e) {}
                  }
                } catch (e) {}
              }
            }
            if (clientClosed) break;
            await new Promise((r) => setTimeout(r, todo.length ? 300 : 2500));
            if (clientClosed) break;

            // Poll .m3u8 berikutnya (selalu satu koneksi tunggal setelah segmen selesai)
            let nextLines = null;
            for (const pollTarget of (activeM3u8Target !== m3u8Base ? [activeM3u8Target, m3u8Base] : [m3u8Base])) {
              if (clientClosed) break;
              try {
                const pAtt = await connectUpstream(chosenUa, chosenSendIp, pollTarget);
                if (pAtt.res && pAtt.res.ok) {
                  const pTxt = await pAtt.res.text();
                  if (pTxt.trimStart().startsWith('#EXTM3U')) {
                    if (pAtt.target) activeM3u8Target = pAtt.target;
                    nextLines = parseSegLines(pTxt);
                    break;
                  }
                } else if (pAtt.res && pAtt.res.body) {
                  try { pAtt.res.body.cancel(); } catch (e) {}
                }
              } catch (e) {}
              await new Promise((r) => setTimeout(r, 300));
            }
            curLines = nextLines || [];
          }
          return stitchedAny;
        } catch (e) {
          return stitchedAny;
        }
      };

      if (preloadedXtreamM3u8) {
        await tryXtreamHlsStitcher();
        killFfmpeg();
        return res.end();
      }

      let curBody = upRes.body;
      let curAc = currentAc;
      let lastDirectTarget = isStalker ? (target !== initialTarget ? target : (cachedDirect && cachedDirect.url ? cachedDirect.url : null)) : null;
      let consecutiveDrops = 0;
      let sessionIndex = 0;

      while (!clientClosed && consecutiveDrops < 8) {
        const sent = await pumpTsAligned(curBody, curAc, sessionIndex > 0);
        if (clientClosed) break;
        sessionIndex++;
        if (sent >= 188 * 20) {
          consecutiveDrops = 0;
        } else {
          consecutiveDrops++;
          lastDirectTarget = null;
        }

        await new Promise((r) => setTimeout(r, 60));
        if (clientClosed) break;

        let reconnected = null;
        // Hanya gunakan lastDirectTarget pada portal Stalker (di mana play_token bersifat sekali pakai)
        const targetsToTry = (isStalker && lastDirectTarget) ? [lastDirectTarget, initialTarget] : [initialTarget];
        for (const tUrl of targetsToTry) {
          if (clientClosed) break;
          try {
            const att = await connectUpstream(chosenUa, chosenSendIp, tUrl);
            if (att.res && att.res.ok && !isRejectedTs(att.res)) {
              reconnected = att;
              if (isStalker && att.target && att.target !== initialTarget) {
                lastDirectTarget = att.target;
                activeStreamLocks.set('direct:' + rawU, { url: att.target, ua: chosenUa, sendIp: chosenSendIp, ts: Date.now() });
              }
              break;
            }
            if (tUrl === lastDirectTarget) {
              lastDirectTarget = null;
            }
            if (att.res && att.res.body) { try { att.res.body.cancel(); } catch (e) {} }
          } catch (e) {
            if (tUrl === lastDirectTarget) lastDirectTarget = null;
          }
        }
        if (!reconnected || !reconnected.res || !reconnected.res.body) {
          consecutiveDrops++;
          curBody = null;
          continue;
        }
        curBody = reconnected.res.body;
        curAc = reconnected.ac;
      }
      killFfmpeg();
      return res.end();
    }

    const outHeaders = {
      'Content-Type': upRes.headers.get('content-type') || 'video/mp2t',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      ...streamCors
    };
    const cl = upRes.headers.get('content-length');
    if (cl) outHeaders['Content-Length'] = cl;
    const cr = upRes.headers.get('content-range');
    if (cr) outHeaders['Content-Range'] = cr;
    const ar = upRes.headers.get('accept-ranges');
    if (ar) outHeaders['Accept-Ranges'] = ar;
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
    const gpsLabel = me.gpsItem ? me.gpsItem.label : undefined;
    if (t === 'watch') {
      const seconds = Math.max(0, Math.min(86400, Math.round(+b.seconds || 0)));
      logEvent(req, me.name, 'watch', { channel: clip(b.channel, 120), group: clip(b.group, 60), playlist: clip(b.playlist, 80), seconds, gpsLabel });
    } else if (t === 'play_error') {
      logEvent(req, me.name, 'play_error', { channel: clip(b.channel, 120), reason: clip(b.reason, 120), gpsLabel });
    } else if (t === 'location') {
      const lat = +b.lat, lng = +b.lng, acc = Math.round(+b.accuracy || 0);
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw fail(400, 'Lokasi tidak valid');
      logEvent(req, me.name, 'location', { lat: +lat.toFixed(5), lng: +lng.toFixed(5), accuracy: acc, gpsLabel });
    } else if (t === 'location_declined') {
      logEvent(req, me.name, 'location_declined', { gpsLabel });
    } else throw fail(400, 'Jenis aktivitas tidak dikenal');
    return send(res, 204);
  }
  if (p === '/api/presence' && method === 'POST') {
    const b = await readBody(req, 2048);
    presence.set(me.key, {
      user: me.name,
      gpsLabel: me.gpsItem ? me.gpsItem.label : '',
      ts: Date.now(),
      channel: clip(b.channel, 120),
      ip: clientIp(req),
      device: parseUA(req.headers['user-agent'])
    });
    return send(res, 204);
  }
  if (p === '/api/presence' && method === 'GET') {
    needAdmin();
    const now = Date.now(), out = [];
    for (const [key, v] of presence) {
      if (now - v.ts < 3 * 60 * 1000) out.push(Object.assign({ user: v.user || key }, v));
      else presence.delete(key);
    }
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
  if (p === '/api/users' && method === 'GET') { needAdmin(); return send(res, 200, Object.keys(db.users).sort().map((n) => publicUser(n))); }
  if (p === '/api/users' && method === 'POST') {
    needAdmin();
    const b = await readBody(req, 4096);
    const name = String(b.username || '').trim().toLowerCase();
    if (!validName(name)) throw fail(400, 'Nama pengguna 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip');
    if (db.users[name]) throw fail(409, 'Nama pengguna sudah dipakai');
    if (!validPass(b.password)) throw fail(400, 'Kata sandi minimal 8 karakter');
    const role = b.role === 'admin' ? 'admin' : 'user';
    const radius = Math.max(100, Math.min(500000, Math.round(+b.radius || 2000)));
    const gpsMode = String(b.gpsMode || 'strict');
    const gpsList = [];
    let gpsAutoBind = false;
    if (role !== 'admin') {
      if (gpsMode === 'manual') {
        const lat = +b.lat, lng = +b.lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          throw fail(400, 'Koordinat GPS manual tidak valid (contoh: -6.20000, 106.81666)');
        }
        gpsList.push({
          id: crypto.randomBytes(6).toString('hex'),
          label: clip(b.label, 60) || 'User #1',
          lat: +lat.toFixed(5),
          lng: +lng.toFixed(5),
          radius,
          updatedAt: Date.now(),
          by: me.name
        });
      } else if (gpsMode === 'autobind') {
        gpsAutoBind = true;
      }
    }
    db.users[name] = Object.assign({ role, created: Date.now(), gpsList, pendingGpsList: [], gpsAutoBind, gpsRadius: radius }, hashPassword(b.password)); save();
    return send(res, 201, publicUser(name));
  }
  m = /^\/api\/users\/([a-z0-9._-]+)(\/password|\/gps)?$/.exec(p);
  if (m) {
    needAdmin();
    const name = m[1];
    if (!db.users[name]) throw fail(404, 'Pengguna tidak ditemukan');
    if (m[2] === '/password' && method === 'POST') {
      const b = await readBody(req, 4096);
      if (!validPass(b.password)) throw fail(400, 'Kata sandi minimal 8 karakter');
      Object.assign(db.users[name], hashPassword(b.password));
      dropSessionsOf(name); save();
      return send(res, 200, { ok: true });
    }
    if (m[2] === '/gps' && method === 'POST') {
      const b = await readBody(req, 4096);
      const u = db.users[name];
      ensureUserGps(u);
      const action = String(b.action || '');
      const radius = Math.max(100, Math.min(500000, Math.round(+b.radius || u.gpsRadius || 2000)));
      if (action === 'approve') {
        const pId = String(b.pendingId || '');
        const pIdx = pId ? u.pendingGpsList.findIndex((x) => x && x.id === pId) : (u.pendingGpsList.length ? 0 : -1);
        if (pIdx < 0) throw fail(400, 'Permintaan lokasi GPS tidak ditemukan atau sudah diproses');
        const pend = u.pendingGpsList[pIdx];
        const label = clip(b.label, 60).trim() || ('User #' + (u.gpsList.length + 1));
        u.gpsList.push({
          id: crypto.randomBytes(6).toString('hex'),
          label,
          lat: pend.lat,
          lng: pend.lng,
          radius,
          updatedAt: Date.now(),
          by: me.name,
          lastLat: pend.lat,
          lastLng: pend.lng,
          lastAcc: pend.accuracy || 0,
          lastAt: pend.at || Date.now(),
          lastIp: pend.ip || '',
          lastDevice: pend.device || null
        });
        u.pendingGpsList.splice(pIdx, 1);
        u.gpsRadius = radius;
        save();
        return send(res, 200, publicUser(name));
      }
      if (action === 'reject_pending') {
        const pId = String(b.pendingId || '');
        if (pId === 'all') u.pendingGpsList = [];
        else u.pendingGpsList = u.pendingGpsList.filter((x) => x && x.id !== pId);
        save();
        return send(res, 200, publicUser(name));
      }
      if (action === 'add' || action === 'set') {
        const lat = +b.lat, lng = +b.lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          throw fail(400, 'Koordinat latitude/longitude tidak valid');
        }
        const cleanLat = +lat.toFixed(5), cleanLng = +lng.toFixed(5);
        const gpsId = String(b.gpsId || '');
        const existing = gpsId ? u.gpsList.find((g) => g.id === gpsId) : null;
        if (existing) {
          existing.label = clip(b.label, 60).trim() || existing.label || 'Lokasi';
          existing.lat = cleanLat;
          existing.lng = cleanLng;
          existing.radius = radius;
          existing.updatedAt = Date.now();
          existing.by = me.name;
          dropSessionsByGpsId(name, existing.id);
        } else {
          const label = clip(b.label, 60).trim() || ('User #' + (u.gpsList.length + 1));
          u.gpsList.push({
            id: crypto.randomBytes(6).toString('hex'),
            label,
            lat: cleanLat,
            lng: cleanLng,
            radius,
            updatedAt: Date.now(),
            by: me.name
          });
        }
        u.gpsRadius = radius;
        save();
        return send(res, 200, publicUser(name));
      }
      if (action === 'delete_item') {
        const gpsId = String(b.gpsId || '');
        const beforeLen = u.gpsList.length;
        u.gpsList = u.gpsList.filter((g) => g && g.id !== gpsId);
        if (u.gpsList.length === beforeLen) throw fail(404, 'Titik GPS tidak ditemukan');
        dropSessionsByGpsId(name, gpsId);
        save();
        return send(res, 200, publicUser(name));
      }
      if (action === 'autobind') {
        u.gpsAutoBind = b.enable !== undefined ? !!b.enable : !u.gpsAutoBind;
        u.gpsRadius = radius;
        save();
        return send(res, 200, publicUser(name));
      }
      if (action === 'clear') {
        u.gpsList = [];
        u.pendingGpsList = [];
        u.gpsAutoBind = false;
        dropSessionsOf(name);
        save();
        return send(res, 200, publicUser(name));
      }
      throw fail(400, 'Aksi GPS tidak dikenal');
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
