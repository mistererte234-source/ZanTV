/* ZanTV web player
 * Memutar playlist M3U yang sah: HLS (.m3u8), DASH tanpa DRM (.mpd),
 * MPEG-TS (.ts), FLV, dan file video biasa.
 * Stream ber-DRM sengaja tidak didukung.
 */
'use strict';

/* ------------------------------------------------------------------ */
/* Util                                                                */
/* ------------------------------------------------------------------ */
function $(s) { return document.querySelector(s); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function initials(name) {
  var w = String(name).replace(/[()\[\]{}\-_.:|/\\+&,]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return (w.slice(0, 2).map(function (x) { return x[0]; }).join('') || 'TV').toUpperCase();
}
function debounce(fn, ms) {
  var t;
  return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
}

var LS = {
  get: function (k, d) {
    try { var v = localStorage.getItem('zantv:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set: function (k, v) { try { localStorage.setItem('zantv:' + k, JSON.stringify(v)); } catch (e) {} }
};

/* IndexedDB kecil untuk menyimpan isi playlist (bisa beberapa MB) */
var IDB = (function () {
  var dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise(function (res, rej) {
        var r = indexedDB.open('zantv', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    return dbp;
  }
  function op(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction('kv', mode);
        var req = fn(tx.objectStore('kv'));
        tx.oncomplete = function () { res(req ? req.result : undefined); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  return {
    get: function (k) { return op('readonly', function (s) { return s.get(k); }).catch(function () { return undefined; }); },
    set: function (k, v) { return op('readwrite', function (s) { return s.put(v, k); }).catch(function () {}); },
    del: function (k) { return op('readwrite', function (s) { return s.delete(k); }).catch(function () {}); }
  };
})();

/* ------------------------------------------------------------------ */
/* Parser M3U                                                          */
/* ------------------------------------------------------------------ */
function parseHeaderPairs(str, cb) {
  String(str || '').split('&').forEach(function (kv) {
    var e = kv.indexOf('=');
    if (e <= 0) return;
    var key = kv.slice(0, e).trim().toLowerCase(), val = kv.slice(e + 1).trim();
    try { val = decodeURIComponent(val); } catch (x) {}
    val = val.replace(/^["']|["']$/g, '');
    cb(key, val);
  });
}

function parseClearKeys(str) {
  if (!str) return null;
  str = String(str).trim();
  var out = {};
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      var obj = JSON.parse(str);
      if (obj.keys && Array.isArray(obj.keys)) {
        obj.keys.forEach(function (k) { if (k.kid && k.k) out[k.kid] = k.k; });
      } else {
        Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
      }
      if (Object.keys(out).length) return out;
    } catch (e) {}
  }
  var pairs = str.split(/[,;\s]+/);
  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i].trim();
    if (!p) continue;
    var colon = p.indexOf(':');
    if (colon > 0 && colon < p.length - 1) {
      var kid = p.slice(0, colon).trim().replace(/-/g, '').toLowerCase();
      var key = p.slice(colon + 1).trim().replace(/-/g, '').toLowerCase();
      if (/^[0-9a-f]{16,64}$/.test(kid) && /^[0-9a-f]{16,64}$/.test(key)) {
        out[kid] = key;
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

function hexToBase64Url(hex) {
  try {
    var clean = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
    if (!clean || clean.length % 2 !== 0) return '';
    var bytes = [];
    for (var i = 0; i < clean.length; i += 2) {
      bytes.push(String.fromCharCode(parseInt(clean.slice(i, i + 2), 16)));
    }
    return btoa(bytes.join('')).replace(/=/g, '').replace(/\//g, '_').replace(/\+/g, '-');
  } catch (e) {
    return '';
  }
}

function buildDashClearKeys(clearKeys) {
  if (!clearKeys) return null;
  var out = {};
  Object.keys(clearKeys).forEach(function (rawKid) {
    var rawKey = clearKeys[rawKid];
    var kidClean = String(rawKid).replace(/[^0-9a-fA-F]/g, '');
    var keyClean = String(rawKey).replace(/[^0-9a-fA-F]/g, '');

    var kidB64 = '';
    var keyB64 = '';

    if (kidClean.length === 32) {
      kidB64 = hexToBase64Url(kidClean);
    } else if (/^[A-Za-z0-9_-]{22}$/.test(String(rawKid).trim())) {
      kidB64 = String(rawKid).trim();
    }

    if (keyClean.length === 32) {
      keyB64 = hexToBase64Url(keyClean);
    } else if (/^[A-Za-z0-9_-]{22}$/.test(String(rawKey).trim())) {
      keyB64 = String(rawKey).trim();
    }

    if (kidB64 && keyB64) {
      out[kidB64] = keyB64;
    }
    if (kidClean && keyB64) {
      out[kidClean.toLowerCase()] = keyB64;
      out[kidClean.toUpperCase()] = keyB64;
    }
  });
  return Object.keys(out).length ? out : null;
}


function parseM3U(text, pl) {
  var lines = String(text).replace(/\r/g, '').split('\n');
  var out = [];
  var defUa = (pl && pl.userAgent) || '';
  var defRef = (pl && pl.referer) || '';
  var attrs = {}, name = null, ua = null, ref = null, org = null, drm = false, clearKeys = null;
  var attrRe = /([\w-]+)="([^"]*)"/g;
  var lastChannel = null;

  function reset() {
    attrs = {}; name = null; ua = null; ref = null; org = null; drm = false; clearKeys = null;
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    if (line.indexOf('#EXTINF') === 0) {
      reset();
      lastChannel = null;
      var m;
      attrRe.lastIndex = 0;
      while ((m = attrRe.exec(line))) attrs[m[1].toLowerCase()] = m[2];
      if (attrs['http-user-agent'] || attrs['user-agent']) ua = attrs['http-user-agent'] || attrs['user-agent'];
      if (attrs['http-referrer'] || attrs['http-referer'] || attrs['referer']) ref = attrs['http-referrer'] || attrs['http-referer'] || attrs['referer'];
      if (attrs['http-origin'] || attrs['origin']) org = attrs['http-origin'] || attrs['origin'];
      var lastQuote = line.lastIndexOf('"');
      var comma = line.indexOf(',', lastQuote < 0 ? 0 : lastQuote);
      name = comma >= 0 ? line.slice(comma + 1).trim() : null;
    } else if (line.indexOf('#EXTVLCOPT:') === 0) {
      var opt = line.slice(11), eq = opt.indexOf('=');
      if (eq > 0) {
        var k = opt.slice(0, eq).trim().toLowerCase(), v = opt.slice(eq + 1).trim();
        if (k === 'http-user-agent') ua = v;
        else if (k === 'http-referrer' || k === 'http-referer') ref = v;
        else if (k === 'http-origin') org = v;
      }
    } else if (line.indexOf('#EXTGRP:') === 0) {
      if (!attrs['group-title']) attrs['group-title'] = line.slice(8).trim();
    } else if (line.charAt(0) === '#') {
      if (/^#KODIPROP:.*inputstream\.adaptive\.stream_headers=/i.test(line)) {
        var sh = line.slice(line.indexOf('=') + 1);
        parseHeaderPairs(sh, function (key, val) {
          if (key === 'user-agent') ua = val;
          else if (key === 'referer' || key === 'referrer') ref = val;
          else if (key === 'origin') org = val;
        });
      } else if (/^#KODIPROP:.*inputstream\.adaptive\.license_key=/i.test(line)) {
        var lk = line.slice(line.indexOf('=') + 1).trim();
        var parsedCk = parseClearKeys(lk);
        if (parsedCk) {
          clearKeys = Object.assign(clearKeys || {}, parsedCk);
          drm = false;
        } else {
          drm = true;
        }
      } else if (/^#KODIPROP:.*inputstream\.adaptive\.license_type=(org\.w3\.clearkey|clearkey)/i.test(line)) {
        drm = false;
      } else if (/^#KODIPROP:.*(license_type|license_key|drm)/i.test(line)) {
        drm = true;
      }
      continue;
    } else {
      var url = line, pipe = url.indexOf('|');
      var lineUa = ua, lineRef = ref, lineOrg = org, lineClearKeys = clearKeys;
      if (pipe > 0) {
        var extra = url.slice(pipe + 1);
        url = url.slice(0, pipe);
        parseHeaderPairs(extra, function (key, val) {
          if (key === 'user-agent') lineUa = val;
          else if (key === 'referer' || key === 'referrer') lineRef = val;
          else if (key === 'origin') lineOrg = val;
          else if (key === 'license_key' || key.endsWith('license_key')) {
            var parsedCk = parseClearKeys(val);
            if (parsedCk) {
              lineClearKeys = Object.assign(lineClearKeys || {}, parsedCk);
              drm = false;
            }
          }
        });
      }
      if (!/^(https?|rtmp|rtsp|udp|file):|^\/\//i.test(url)) { continue; }
      // Filter link expired / billing loop IPTV Rusia (otttv.pw) agar tidak mencemari daftar stream
      if (/otttv\.pw\/iptv\/HEGN4VXXQQSYCA/i.test(url)) { continue; }
      var finalUa = lineUa || defUa || '';
      var finalRef = lineRef || defRef || '';
      var finalOrg = lineOrg || '';
      var srcObj = {
        url: url,
        ua: finalUa,
        ref: finalRef,
        origin: finalOrg,
        clearKeys: lineClearKeys ? Object.assign({}, lineClearKeys) : null
      };

      if (lastChannel) {
        lastChannel.sources.push(srcObj);
        if (!lastChannel.clearKeys && lineClearKeys) {
          lastChannel.clearKeys = Object.assign({}, lineClearKeys);
          lastChannel.drm = false;
        }
      } else {
        var group = String(attrs['group-title'] || '').split(';')[0].trim() || 'Lainnya';
        var ch = {
          no: out.length + 1,
          name: name || attrs['tvg-name'] || url,
          url: url,
          logo: attrs['tvg-logo'] || '',
          group: group,
          tvgId: attrs['tvg-id'] || '',
          ua: finalUa,
          ref: finalRef,
          origin: finalOrg,
          needsHeaders: !!(finalUa || finalRef || finalOrg),
          drm: drm,
          clearKeys: lineClearKeys ? Object.assign({}, lineClearKeys) : null,
          sources: [srcObj]
        };
        out.push(ch);
        lastChannel = ch;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
var S = {
  playlists: [],
  activeId: LS.get('active', null),
  channels: [],
  view: [],
  favs: new Set(LS.get('favs', [])),
  recent: LS.get('recent', []),
  group: 'all',
  query: '',
  playing: null,
  cued: null,
  loading: false,
  listError: ''
};

var el = {
  video: $('#video'), stage: $('#stage'), idle: $('#idle'), idleText: $('#idleText'),
  spinner: $('#spinner'), osd: $('#osd'), osdNo: $('#osdNo'), osdName: $('#osdName'),
  msg: $('#msg'), msgTitle: $('#msgTitle'), msgBody: $('#msgBody'),
  groups: $('#groups'), list: $('#list'), listCount: $('#listCount'),
  search: $('#search'), nowNo: $('#nowNo'), nowName: $('#nowName'), nowMeta: $('#nowMeta'),
  liveTag: $('#liveTag'), favBtn: $('#favBtn'), muteIcon: $('#muteIcon'), playIcon: $('#playIcon'),
  playlistName: $('#playlistName'), dialog: $('#plDialog'), plList: $('#plList'), toast: $('#toast')
};

var EXAMPLE_URL = 'https://iptv-org.github.io/iptv/countries/id.m3u';

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */
var toastTimer;
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 3200);
}

window.zanToast = toast;

/* ------------------------------------------------------------------ */
/* Catatan aktivitas (diberitahukan ke pengguna di layar login)         */
/* ------------------------------------------------------------------ */
var W = { ch: null, secs: 0, last: 0 };
function track(type, data) {
  if (!ME) return;
  var body = JSON.stringify(Object.assign({ type: type }, data || {}));
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/activity', new Blob([body], { type: 'application/json' }))) return;
  } catch (e) {}
  fetch('/api/activity', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-ZanTV': '1' }, body: body }).catch(function () {});
}
function flushWatch(keepChannel) {
  if (W.ch && W.secs >= 5) {
    var pl = activePlaylist();
    track('watch', { channel: W.ch.name, group: W.ch.group, playlist: pl ? pl.name : '', seconds: Math.round(W.secs) });
  }
  W.secs = 0; W.last = 0;
  if (!keepChannel) W.ch = null;
}
function sendPresence() {
  if (!ME || document.visibilityState !== 'visible') return;
  var watching = S.playing && !el.video.paused ? S.playing.name : '';
  fetch('/api/presence', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-ZanTV': '1' }, body: JSON.stringify({ channel: watching }) }).catch(function () {});
}
setInterval(sendPresence, 60000);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') flushWatch(true); else sendPresence();
});
window.addEventListener('pagehide', function () { flushWatch(true); });

/* keamanan lokasi GPS: wajib aktif & terdaftar di database untuk akun selain admin */
function getGpsPosition(timeoutMs) {
  return new Promise(function (resolve) {
    if (!navigator.geolocation) {
      resolve({ lat: null, lng: null, accuracy: 0, error: 'unsupported' });
      return;
    }
    var done = false;
    function finish(res) {
      if (done) return;
      done = true;
      resolve(res);
    }
    function parsePos(pos) {
      var c = (pos && pos.coords) || {};
      var acc = Math.round(c.accuracy || 0);
      var isMock = false;
      // Heuristik Mock Location: akurasi 0-1m adalah artifak mock GPS
      if (acc <= 1) isMock = true;
      // Waktu GPS timestamp drift ekstrem dari jam lokal (> 2 menit)
      if (pos && pos.timestamp && Math.abs(Date.now() - pos.timestamp) > 120000) isMock = true;
      return {
        lat: c.latitude,
        lng: c.longitude,
        accuracy: acc,
        altitude: c.altitude != null ? Math.round(c.altitude) : null,
        altitudeAccuracy: c.altitudeAccuracy != null ? Math.round(c.altitudeAccuracy) : null,
        heading: c.heading != null && !isNaN(c.heading) ? Math.round(c.heading) : null,
        speed: c.speed != null && !isNaN(c.speed) ? +(c.speed).toFixed(2) : null,
        gpsTs: (pos && pos.timestamp) || Date.now(),
        clientTs: Date.now(),
        isMock: isMock,
        error: null
      };
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        finish(parsePos(pos));
      },
      function (err) {
        if (err && err.code === 1) {
          finish({ lat: null, lng: null, accuracy: 0, error: 'permission_denied' });
          return;
        }
        // Fallback ke jaringan/Wi-Fi jika penguncian satelit presisi tinggi timeout di dalam ruangan
        navigator.geolocation.getCurrentPosition(
          function (pos2) {
            finish(parsePos(pos2));
          },
          function (err2) {
            var codeMap = { 1: 'permission_denied', 2: 'position_unavailable', 3: 'timeout' };
            finish({
              lat: null,
              lng: null,
              accuracy: 0,
              error: codeMap[err2 && err2.code] || 'gps_error'
            });
          },
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 }
        );
      },
      { enableHighAccuracy: true, timeout: timeoutMs || 7000, maximumAge: 0 }
    );
  });
}

function verifyActiveGps(manual) {
  if (!ME) return;
  if (manual) toast('Memverifikasi titik GPS…');
  getGpsPosition(8000).then(function (gps) {
    if (!ME) return;
    return api('POST', '/api/me/gps', {
      lat: gps.lat,
      lng: gps.lng,
      accuracy: gps.accuracy,
      altitude: gps.altitude,
      altitudeAccuracy: gps.altitudeAccuracy,
      heading: gps.heading,
      speed: gps.speed,
      gpsTs: gps.gpsTs,
      clientTs: gps.clientTs || Date.now(),
      isMock: gps.isMock,
      gpsError: gps.error
    }).then(function (res) {
      if (manual) {
        if (isAdmin()) toast(gps.lat != null ? 'Lokasi GPS Admin tercatat (' + gps.lat.toFixed(5) + ', ' + gps.lng.toFixed(5) + ')' : 'Akun Admin bebas batas lokasi GPS');
        else toast('GPS terverifikasi: ' + ((res && res.label) ? res.label + ' ' : '') + '(jarak ' + (res && res.dist != null ? res.dist : 0) + ' m)');
      }
      return api('GET', '/api/me').then(function (u) { ME = u; syncLocToggle(); }).catch(function () {});
    });
  }).catch(function (err) {
    if (manual && err && err.message) toast(err.message);
  });
}
setInterval(function () {
  if (ME && !isAdmin() && document.visibilityState === 'visible') verifyActiveGps(false);
}, 5 * 60 * 1000);

function askLocation() {
  $('#locBanner').hidden = true;
}
function syncLocToggle() {
  var st = $('#locState'), btn = $('#locToggle');
  if (!st || !btn || !ME) return;
  if (isAdmin()) {
    st.textContent = 'Admin: Bebas akses dari lokasi mana pun tanpa blokir GPS.';
    btn.textContent = 'Catat GPS';
  } else if (ME.myGps && typeof ME.myGps.lat === 'number') {
    st.textContent = 'Terdaftar (' + (ME.myGps.label || 'User') + '): ' + ME.myGps.lat + ', ' + ME.myGps.lng + ' · radius ' + (ME.myGps.radius || 2000) + ' m.';
    btn.textContent = 'Verifikasi GPS';
  } else {
    st.textContent = 'Belum ada titik GPS terdaftar untuk perangkat ini.';
    btn.textContent = 'Verifikasi GPS';
  }
}
$('#locToggle').addEventListener('click', function () {
  verifyActiveGps(true);
});

/* ------------------------------------------------------------------ */
/* Akun & API server                                                   */
/* ------------------------------------------------------------------ */
var ME = null; // { name, role }
function isAdmin() { return !!ME && ME.role === 'admin'; }

function api(method, url, body) {
  var opt = { method: method, credentials: 'same-origin', headers: { 'X-ZanTV': '1' } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  return fetch(url, opt).then(function (r) {
    var ct = r.headers.get('content-type') || '';
    var parse = ct.indexOf('json') >= 0 ? r.json() : r.text();
    return parse.catch(function () { return null; }).then(function (data) {
      if (r.ok) return data;
      var msg = (data && data.error) || ('Server menjawab kode ' + r.status);
      if (r.status === 401 && url !== '/api/login') onLoggedOut(url !== '/api/me' ? msg : '');
      var err = new Error(msg);
      err.status = r.status;
      throw err;
    });
  }, function () {
    var e = new Error('Server ZanTV tidak bisa dihubungi. Periksa koneksi internet.');
    e.status = 0;
    throw e;
  });
}

/* ------------------------------------------------------------------ */
/* Playlist                                                            */
/* ------------------------------------------------------------------ */
function activePlaylist() {
  for (var i = 0; i < S.playlists.length; i++) if (S.playlists[i].id === S.activeId) return S.playlists[i];
  return null;
}

/* ---------- channel terkunci (DRM / geo-lock): sekali ditandai langsung hilang dari daftar ---------- */
var BLOCKED = LS.get('blocked', {}); // { url: 'drm' | 'geo' }
S.raw = [];
S.hidden = 0;

function isBlocked(c) {
  if (c.clearKeys && Object.keys(c.clearKeys).length) return false;
  return !!c.drm || !!BLOCKED[c.url];
}

function filterBlocked(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) if (!isBlocked(list[i])) out.push(list[i]);
  for (var j = 0; j < out.length; j++) out[j].no = j + 1; // nomor channel tetap urut tanpa bolong
  S.hidden = list.length - out.length;
  return out;
}

var PENDING = {}; // laporan yang belum dikonfirmasi server

function syncBlocked() {
  return api('GET', '/api/blocked').then(function (rows) {
    var next = {};
    (rows || []).forEach(function (r) { if (r && r.url) next[r.url] = r.reason || 'geo'; });
    Object.keys(PENDING).forEach(function (u) { next[u] = PENDING[u]; });
    var changed = JSON.stringify(next) !== JSON.stringify(BLOCKED);
    BLOCKED = next; LS.set('blocked', BLOCKED);
    if (changed && S.raw.length) applyChannels(S.raw);
  }).catch(function () {});
}
setInterval(function () { if (ME) syncBlocked(); }, 5 * 60 * 1000);

function blockChannel(ch, reason) {
  if (!ch || BLOCKED[ch.url]) return;
  BLOCKED[ch.url] = reason; LS.set('blocked', BLOCKED);
  PENDING[ch.url] = reason;
  api('POST', '/api/blocked', { url: ch.url, reason: reason, name: ch.name })
    .then(function () { delete PENDING[ch.url]; }).catch(function () {});
  // ingat posisinya supaya tombol "channel berikutnya" lanjut ke tetangganya, bukan balik ke awal
  var pool = S.view.length ? S.view : S.channels;
  S.gap = { url: ch.url, idx: pool.indexOf(ch) };
  S.channels = filterBlocked(S.raw);
  refreshView();
  toast(ch.name + ' disembunyikan (' + (reason === 'drm' ? 'terkunci DRM' : 'dibatasi wilayah') + ')');
}

function restoreBlocked() {
  return api('DELETE', '/api/blocked').then(function (r) {
    BLOCKED = {}; LS.set('blocked', BLOCKED);
    if (S.raw.length) applyChannels(S.raw);
    renderPlaylistDialog();
    toast((r && r.restored ? r.restored : 'Semua') + ' channel ditampilkan lagi');
  }).catch(function (e) { toast(e.message); });
}

function applyChannels(list) {
  S.raw = list;
  list = filterBlocked(list);
  S.channels = list;
  if (S.playing) {
    var same = list.filter(function (c) { return c.url === S.playing.url; })[0];
    if (same) S.playing = same;
  }
  var valid = S.group === 'all' || S.group === 'fav' || S.group === 'recent' ||
    list.some(function (c) { return 'g:' + c.group === S.group; });
  if (!valid) S.group = 'all';
  S.listError = '';
  refreshView();
  updateNow();
  var last = LS.get('last', null);
  if (!S.playing && list.length === 1) {
    play(list[0]);
  } else if (!S.playing && last) {
    var ch = list.filter(function (c) { return c.url === last; })[0];
    if (ch) cue(ch);
  }
}

function loadPlaylist(pl) {
  S.loading = true; S.listError = '';
  if (!S.channels.length) renderList();
  var key = 'pl:' + pl.id + ':' + pl.updatedAt;
  return IDB.get(key).then(function (cached) {
    if (cached) return cached;
    return api('GET', '/api/playlists/' + pl.id + '/m3u').then(function (text) {
      IDB.set(key, text);
      return text;
    });
  }).then(function (text) {
    S.loading = false;
    applyChannels(parseM3U(text, pl));
  }).catch(function (err) {
    S.loading = false;
    if (err.status === 401) return;
    S.listError = 'Playlist tidak bisa dimuat. ' + err.message;
    renderList();
  });
}

function setPlaylistLabel() {
  var pl = activePlaylist();
  el.playlistName.textContent = pl ? pl.name : 'Playlist';
}

function activate(id) {
  S.activeId = id;
  LS.set('active', id);
  S.channels = []; S.raw = []; S.hidden = 0; S.view = []; S.group = 'all';
  setPlaylistLabel();
  renderGroups(); renderList(); updateNow();
  var pl = activePlaylist();
  if (pl) loadPlaylist(pl);
}

/* ambil daftar playlist dari server */
function fetchPlaylists(quiet) {
  return api('GET', '/api/playlists').then(function (list) {
    var prev = activePlaylist();
    S.playlists = list || [];
    var still = S.playlists.filter(function (p) { return p.id === S.activeId; })[0];
    if (!still) { activate(S.playlists.length ? S.playlists[0].id : null); return; }
    setPlaylistLabel();
    if (!prev || prev.updatedAt !== still.updatedAt || !S.channels.length) loadPlaylist(still);
    else if (!quiet) toast('Playlist sudah yang terbaru');
    renderPlaylistDialog();
  }).catch(function (err) {
    if (err.status === 401) return;
    S.listError = err.message;
    renderList();
  });
}

/* aksi admin */
function adminAdd(body) {
  toast(body.url ? 'Mengambil playlist dari server…' : 'Mengunggah playlist…');
  return api('POST', '/api/playlists', body).then(function (pl) {
    S.playlists.push(pl);
    renderPlaylistDialog();
    toast(pl.count + ' channel ditambahkan ke "' + pl.name + '"');
    activate(pl.id);
  }).catch(function (e) { toast(e.message); });
}
function adminRefresh(id) {
  toast('Memperbarui playlist…');
  return api('POST', '/api/playlists/' + id + '/refresh').then(function (pl) {
    S.playlists = S.playlists.map(function (p) { return p.id === pl.id ? pl : p; });
    renderPlaylistDialog();
    toast('Diperbarui: ' + pl.count + ' channel');
    if (pl.id === S.activeId) loadPlaylist(pl);
  }).catch(function (e) { toast(e.message); });
}
function adminDelete(id) {
  return api('DELETE', '/api/playlists/' + id).then(function () {
    S.playlists = S.playlists.filter(function (p) { return p.id !== id; });
    if (S.activeId === id) activate(S.playlists.length ? S.playlists[0].id : null);
    renderPlaylistDialog();
    toast('Playlist dihapus');
  }).catch(function (e) { toast(e.message); });
}

/* ------------------------------------------------------------------ */
/* Tampilan daftar                                                     */
/* ------------------------------------------------------------------ */
function computeView() {
  var list;
  if (S.group === 'fav') {
    list = S.channels.filter(function (c) { return S.favs.has(c.url); });
  } else if (S.group === 'recent') {
    var map = new Map(S.channels.map(function (c) { return [c.url, c]; }));
    list = S.recent.map(function (u) { return map.get(u); }).filter(Boolean);
  } else if (S.group.indexOf('g:') === 0) {
    var g = S.group.slice(2);
    list = S.channels.filter(function (c) { return c.group === g; });
  } else {
    list = S.channels;
  }
  var q = S.query.trim().toLowerCase();
  if (q) {
    list = list.filter(function (c) { return c.name.toLowerCase().indexOf(q) >= 0 || String(c.no) === q; });
  }
  S.view = list;
}

function refreshView() { computeView(); renderGroups(); renderList(); }

function renderGroups() {
  if (!S.channels.length) { el.groups.innerHTML = ''; return; }
  var counts = new Map();
  S.channels.forEach(function (c) { counts.set(c.group, (counts.get(c.group) || 0) + 1); });
  var favCount = S.channels.filter(function (c) { return S.favs.has(c.url); }).length;
  var urls = new Set(S.channels.map(function (c) { return c.url; }));
  var recentCount = S.recent.filter(function (u) { return urls.has(u); }).length;
  var items = [
    { id: 'all', label: 'Semua channel', n: S.channels.length },
    { id: 'fav', label: 'Favorit', n: favCount },
    { id: 'recent', label: 'Baru ditonton', n: recentCount }
  ];
  Array.from(counts.keys()).sort(function (a, b) { return a.localeCompare(b, 'id'); }).forEach(function (g) {
    items.push({ id: 'g:' + g, label: g, n: counts.get(g) });
  });
  el.groups.innerHTML = items.map(function (it) {
    return '<button class="grp" data-g="' + esc(it.id) + '" aria-pressed="' + (it.id === S.group) + '"><span>' +
      esc(it.label) + '</span><small>' + it.n + '</small></button>';
  }).join('');
}

/* ------------------------------------------------------------------ */
/* EPG (Jadwal Acara TV XMLTV)                                         */
/* ------------------------------------------------------------------ */
var EPG = { meta: null, channels: {}, chNames: {}, aliases: {} };

function normEpgKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.(id|co\.id|tv|com)$/i, '')
    .replace(/\b(hd|fhd|uhd|4k|sd|indo|indonesia|tv|channel|ch)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function fmtClockWib(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).replace('.', ':');
  } catch (e) {
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
}

function epgIdForChannel(c) {
  if (!c || !EPG.channels) return '';
  var al = EPG.aliases || {};
  var tries = [];
  if (c.tvgId) {
    tries.push(c.tvgId, c.tvgId.toLowerCase(), normEpgKey(c.tvgId));
  }
  if (c.name) {
    tries.push(c.name, c.name.toLowerCase(), normEpgKey(c.name));
  }
  for (var i = 0; i < tries.length; i++) {
    var k = tries[i];
    if (!k) continue;
    if (EPG.channels[k] && EPG.channels[k].length) return k;
    var mapped = al[k];
    if (mapped && EPG.channels[mapped] && EPG.channels[mapped].length) return mapped;
  }
  return '';
}

function epgForChannel(c) {
  var id = epgIdForChannel(c);
  return id ? EPG.channels[id] : null;
}

function epgNowNext(c) {
  var progs = epgForChannel(c);
  if (!progs || !progs.length) return null;
  var now = Date.now();
  var curIdx = -1;
  for (var i = 0; i < progs.length; i++) {
    if (progs[i].start <= now && progs[i].stop > now) { curIdx = i; break; }
  }
  if (curIdx < 0) {
    for (var j = 0; j < progs.length; j++) {
      if (progs[j].start > now) { curIdx = j > 0 ? j - 1 : 0; break; }
    }
    if (curIdx < 0) curIdx = progs.length - 1;
  }
  var cur = progs[curIdx];
  var next = progs[curIdx + 1] || null;
  var isLive = cur && cur.start <= now && cur.stop > now;
  var pct = isLive ? Math.max(3, Math.min(100, Math.round((now - cur.start) / Math.max(1, cur.stop - cur.start) * 100))) : 0;
  return { cur: cur, next: next, isLive: isLive, pct: pct, list: progs };
}

function fetchEPG() {
  if (!ME) return Promise.resolve();
  return api('GET', '/api/epg').then(function (data) {
    EPG = data && data.channels ? data : { meta: null, channels: {}, chNames: {}, aliases: {} };
    renderList();
    updateNow();
    renderEpgStatus();
  }).catch(function () {});
}
setInterval(function () { if (ME) fetchEPG(); }, 15 * 60 * 1000);
setInterval(function () {
  if (ME && EPG.meta) { updateNow(); }
}, 30000);

var BAD_LOGO_DOMAINS = new Set([
  'picon.tivi-ott.net',
  'picon.tivi-ott.net:25461',
  'tivi-ott.net'
]);

function sanitizeLogoUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  var u = raw.trim();
  if (!/^https?:\/\//i.test(u)) return '';
  try {
    var parsed = new URL(u);
    var host = parsed.hostname.toLowerCase();
    var hostWithPort = parsed.host.toLowerCase();
    if (BAD_LOGO_DOMAINS.has(host) || BAD_LOGO_DOMAINS.has(hostWithPort)) return '';
    // Server IPTV seringkali pasang port non-standar (misal :25461) tanpa sertifikat SSL yang valid -> langsung cegah agar tidak membebani browser
    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') return '';
  } catch (e) {
    return '';
  }
  return u;
}

function renderList() {
  var pl = activePlaylist();
  if (!ME) { el.listCount.textContent = ''; el.list.innerHTML = ''; return; }
  if (S.listError) {
    el.listCount.textContent = '';
    el.list.innerHTML = '<div class="empty"><h2>Playlist gagal dimuat</h2><p>' + esc(S.listError) +
      '</p><div class="row-actions"><button class="btn" data-act="reload">Coba lagi</button>' +
      (isAdmin() ? '<button class="btn ghost" data-act="open-dialog">Kelola playlist</button>' : '') + '</div></div>';
    return;
  }
  if (!S.playlists.length || !pl) {
    el.listCount.textContent = '';
    el.list.innerHTML = isAdmin()
      ? '<div class="empty"><h2>Belum ada playlist</h2>' +
        '<p>Tambahkan playlist M3U yang sah: milikmu sendiri, dari penyedia IPTV resmi yang kamu langgani, atau daftar siaran gratis. Semua pengguna akan melihat playlist yang kamu tambahkan.</p>' +
        '<div class="row-actions"><button class="btn primary" data-act="open-dialog">Tambah playlist</button>' +
        '<button class="btn ghost" data-act="example">Pakai daftar TV Indonesia (iptv-org)</button></div>' +
        '<p class="note">iptv-org adalah kumpulan alamat siaran yang tersedia publik. Banyak channel bisa mati atau dibatasi wilayah, jadi tidak semua akan jalan.</p></div>'
      : '<div class="empty"><h2>Belum ada playlist</h2><p>Admin belum menambahkan playlist. Coba lagi nanti.</p>' +
        '<div class="row-actions"><button class="btn" data-act="reload">Periksa lagi</button></div></div>';
    return;
  }
  if (S.loading && !S.channels.length) {
    el.listCount.textContent = 'Memuat playlist…';
    el.list.innerHTML = '';
    return;
  }
  el.listCount.textContent = S.view.length + ' channel' + (S.query ? ' cocok dengan "' + S.query + '"' : '') +
    (S.hidden && !S.query ? ' · ' + S.hidden + ' terkunci disembunyikan' : '');
  if (!S.view.length) {
    var t = S.group === 'fav' ? 'Belum ada favorit. Tekan bintang saat menonton untuk menyimpan channel di sini.'
      : S.group === 'recent' ? 'Channel yang kamu tonton akan muncul di sini.'
      : 'Tidak ada channel yang cocok. Coba kata lain atau pilih "Semua channel".';
    el.list.innerHTML = '<div class="empty"><p>' + esc(t) + '</p></div>';
    return;
  }
  var active = S.playing || S.cued;
  var html = new Array(S.view.length);
  for (var i = 0; i < S.view.length; i++) {
    var c = S.view[i];
    var safeLogo = sanitizeLogoUrl(c.logo);
    var logo = safeLogo
      ? '<img src="' + esc(safeLogo) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="40" height="40">'
      : '<b>' + esc(initials(c.name)) + '</b>';
    var en = epgNowNext(c);
    var subHtml = en && en.cur
      ? '<span class="row-epg"><i class="row-epg-dot"></i>' + esc(fmtClockWib(en.cur.start) + ' · ' + en.cur.title) + '</span>'
      : '<span>' + esc(c.group) + '</span>';
    html[i] = '<button class="row' + (c === active ? ' is-playing' : '') + '" role="option" data-i="' + i + '">' +
      '<span class="no">' + c.no + '</span><span class="logo">' + logo + '</span>' +
      '<span class="t"><strong>' + esc(c.name) + '</strong>' + subHtml + '</span>' +
      (S.favs.has(c.url) ? '<svg class="fav" viewBox="0 0 24 24" aria-label="favorit"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>' : '<span></span>') +
      '</button>';
  }
  el.list.innerHTML = html.join('');
}

function markPlaying() {
  var active = S.playing || S.cued;
  var rows = el.list.querySelectorAll('.row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.toggle('is-playing', !!active && S.view[+rows[i].dataset.i] === active);
  }
}

/* logo gagal dimuat → inisial & blacklist domain mati */
el.list.addEventListener('error', function (e) {
  var img = e.target;
  if (img.tagName !== 'IMG') return;
  try {
    var badHost = new URL(img.src).hostname.toLowerCase();
    if (badHost) BAD_LOGO_DOMAINS.add(badHost);
  } catch (err) {}
  var row = img.closest('.row');
  var c = row ? S.view[+row.dataset.i] : null;
  var b = document.createElement('b');
  b.textContent = c ? initials(c.name) : 'TV';
  img.replaceWith(b);
}, true);

/* ------------------------------------------------------------------ */
/* Mesin pemutar                                                       */
/* ------------------------------------------------------------------ */
var LIBS = {
  hls: 'vendor/hls-1.7.3.min.js',
  dash: 'vendor/dash-5.2.1.all.min.js',
  shaka: 'vendor/shaka-player.compiled.js',
  mpegts: 'vendor/mpegts-1.8.2.js'
};
var libPromises = {};
function loadLib(name) {
  if (!libPromises[name]) {
    libPromises[name] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = LIBS[name];
      s.onload = res;
      s.onerror = function () { libPromises[name] = null; rej({ kind: 'lib' }); };
      document.head.appendChild(s);
    });
  }
  return libPromises[name];
}

var E = { token: 0, retries: 0, hasPlayed: false, mode: null, hls: null, dash: null, shaka: null, ts: null, stall: null, tsFallback: false, nativeFallback: false, serverTranscode: false, probeAc: null };
var savedQualMode = LS.get('qual-mode', 'auto');
if (savedQualMode === 'server') savedQualMode = 'target';
var QUAL = {
  mode: savedQualMode,
  level: -1,
  targetH: +LS.get('qual-target-h', +LS.get('qual-server-q', 0) || 0) || 0,
  serverQ: 0,
  levels: [],
  activeHeight: 0,
  clientScaledH: 0
};
var CC = { mode: LS.get('cc-mode', 'off'), srcLang: LS.get('cc-src', 'en-US'), hasTrack: false, sr: null, srRunning: false, hideTimer: null, lastRaw: '', reqSeq: 0, cache: {} };

function destroyEngine() {
  clearTimeout(E.stall);
  if (E.probeAc) { try { E.probeAc.abort(); } catch (e) {} E.probeAc = null; }
  stopSpeechCc();
  clearCcDisplay();
  CC.hasTrack = false;
  QUAL.levels = [];
  QUAL.activeHeight = 0;
  QUAL.clientScaledH = 0;
  if (E.hls) { try { E.hls.destroy(); } catch (e) {} E.hls = null; }
  if (E.shaka) { try { E.shaka.destroy(); } catch (e) {} E.shaka = null; }
  if (E.dash) { try { E.dash.reset(); } catch (e) {} E.dash = null; }
  if (E.ts) { try { E.ts.pause(); E.ts.unload(); E.ts.detachMediaElement(); E.ts.destroy(); } catch (e) {} E.ts = null; }
  E.mode = null;
  E.serverTranscode = false;
  QUAL.serverQ = 0;
  el.video.removeAttribute('src');
  try { el.video.load(); } catch (e) {}
  updateQualBadge();
}

function kindOf(url) {
  var full = String(url || '').toLowerCase();
  var u = full.split(/[?#]/)[0];
  if (/\.m3u8$/.test(u) || full.indexOf('.m3u8') >= 0 || /[?&](extension|output|type|format)=(m3u8|hls)\b/.test(full)) return 'hls';
  if (/\.mpd$/.test(u) || /[?&](extension|output|format)=mpd\b/.test(full)) return 'dash';
  if (/\.flv$/.test(u) || /[?&](extension|output|format)=flv\b/.test(full)) return 'flv';
  if (/\.ts$/.test(u) || /[?&](extension|output|type|format)=(ts|mpegts)\b/.test(full) || /\/play\/live\.php\b/.test(full) || /\/live\/play\//.test(full)) return 'mpegts';
  if (/\.(mp4|m4v|webm|ogv|mov|mp3|aac|m4a|ogg|opus)$/.test(u)) return 'native';
  if (/^(rtmp|rtsp|udp):/i.test(url)) return 'unsupported';
  return 'hls'; // kebanyakan stream IPTV tanpa ekstensi adalah HLS
}

function upgradeUrl(url) {
  if (location.protocol === 'https:' && /^http:\/\//i.test(url)) return url.replace(/^http:/i, 'https:');
  return url;
}

function startNative(url) {
  E.mode = 'native';
  el.video.src = url;
}

function healBufferGap() {
  try {
    var b = el.video.buffered;
    if (!b || !b.length) return false;
    var cur = el.video.currentTime;

    // Sambung celah buffer (buffer gap) jika playhead macet tepat di lubang kosong antar segmen
    if (b.length > 1) {
      var lastStart = b.start(b.length - 1);
      var lastEnd = b.end(b.length - 1);
      if (lastEnd - lastStart > 0.2 && cur < lastStart - 0.05) {
        el.video.currentTime = lastStart + 0.1;
        el.video.play().catch(function () {});
        return true;
      }
    }
    for (var i = 0; i < b.length; i++) {
      if (b.start(i) > cur + 0.15 && b.end(i) - b.start(i) > 0.2) {
        el.video.currentTime = b.start(i) + 0.08;
        el.video.play().catch(function () {});
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function startHls(url, token) {
  var nativeHls = el.video.canPlayType('application/vnd.apple.mpegurl');
  if (nativeHls && !window.MediaSource && !window.ManagedMediaSource) { startNative(url); return Promise.resolve(); }
  return loadLib('hls').then(function () {
    if (token !== E.token) return;
    if (!window.Hls || !Hls.isSupported()) { startNative(url); return; }
    var isEco = QUAL.mode === 'saver' || (QUAL.mode === 'target' && QUAL.targetH > 0 && QUAL.targetH <= 480);
    var hls = new Hls({
      enableWorker: true,
      enableWebVTT: true,
      enableIMSC1: true,
      enableCEA708Captions: true,
      capLevelToPlayerSize: isEco,
      // Turbo Buffer & Zero-Lag Live Sync Engine (OTT Navigator Enhanced)
      lowLatencyMode: true,
      backBufferLength: isEco ? 15 : 30,
      maxBufferLength: isEco ? 20 : 35,
      maxMaxBufferLength: isEco ? 35 : 70,
      maxBufferSize: 60 * 1024 * 1024,
      maxBufferHole: 0.8,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 5,
      maxStarvationDelay: 2.5,
      liveSyncDurationCount: 4,
      liveMaxLatencyDurationCount: 8,
      liveDurationInfinity: true,
      manifestLoadingMaxRetry: 6,
      manifestLoadingRetryDelay: 500,
      levelLoadingMaxRetry: 6,
      levelLoadingRetryDelay: 500,
      fragLoadingMaxRetry: 8,
      fragLoadingRetryDelay: 500
    });
    E.hls = hls; E.mode = 'hls';
    hls.on(Hls.Events.MANIFEST_PARSED, function (_, data) {
      if (token !== E.token) return;
      var lvls = (hls.levels || []).map(function (lv, idx) {
        return { index: idx, height: lv.height || 0, width: lv.width || 0, bitrate: lv.bitrate || 0 };
      });
      QUAL.levels = lvls;
      applyHlsQuality(hls);
      if (data && data.subtitleTracks && data.subtitleTracks.length > 0) {
        CC.hasTrack = true;
        if (CC.mode !== 'off') {
          hls.subtitleDisplay = false;
          hls.subtitleTrack = 0;
        }
      }
      bindVideoTextTracks();
      syncCcEngine();
      updateQualBadge();
      renderQualMenu();
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, function (_, data) {
      if (token !== E.token) return;
      var lv = hls.levels && hls.levels[data.level];
      if (lv && lv.height) QUAL.activeHeight = lv.height;
      updateQualBadge();
      renderQualMenu();
    });
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, function (_, data) {
      if (token !== E.token) return;
      if (data && data.subtitleTracks && data.subtitleTracks.length > 0) {
        CC.hasTrack = true;
        if (CC.mode !== 'off') {
          hls.subtitleDisplay = false;
          if (hls.subtitleTrack < 0) hls.subtitleTrack = 0;
        }
        bindVideoTextTracks();
        syncCcEngine();
      }
    });
    hls.on(Hls.Events.CUES_PARSED, function (_, data) {
      if (token !== E.token || CC.mode === 'off') return;
      CC.hasTrack = true;
      stopSpeechCc();
      if (data && data.cues && data.cues.length) {
        bindVideoTextTracks();
      }
    });
    var recovered = 0;
    hls.on(Hls.Events.ERROR, function (_, d) {
      if (!d.fatal || token !== E.token) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && recovered < 4) {
        recovered++;
        if (recovered === 2) hls.swapAudioCodec();
        hls.recoverMediaError();
        return;
      }
      if (d.details === 'manifestParsingError' && !E.tsFallback && (window.MediaSource || window.ManagedMediaSource)) {
        // bukan manifest HLS → coba sebagai stream MPEG-TS (mpegts.js)
        E.tsFallback = true;
        try { hls.destroy(); } catch (e) {}
        E.hls = null;
        startTs(url, 'mpegts', token).then(function () {
          if (token === E.token) el.video.play().catch(function () {});
        }).catch(function () {
          if (token !== E.token) return;
          E.nativeFallback = true;
          startNative(url);
          el.video.play().catch(function () {});
        });
        return;
      }
      if (d.details === 'manifestParsingError' && !E.nativeFallback) {
        // bukan HLS → coba diputar langsung oleh browser
        E.nativeFallback = true;
        try { hls.destroy(); } catch (e) {}
        E.hls = null; startNative(url); el.video.play().catch(function () {});
        return;
      }
      var code = d.response ? d.response.code : undefined;
      fail({ kind: d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'media', code: code, detail: d.details }, token);
    });
    hls.loadSource(url);
    hls.attachMedia(el.video);
  });
}

function startDash(url, token, ch, currentClearKeys) {
  return loadLib('dash').then(function () {
    if (token !== E.token) return;
    var p = dashjs.MediaPlayer().create();
    E.dash = p; E.mode = 'dash';

    // 🚀 ULTRA-SMOOTH BUFFER & ANTI-STALL ENGINE (Better than OTT Navigator)
    p.updateSettings({
      streaming: {
        abandonLoadTimeout: 10000,
        manifestUpdateRetryInterval: 500,
        delay: {
          liveDelay: 12,
          useSuggestedPresentationDelay: false
        },
        buffer: {
          fastSwitchEnabled: false,
          reuseExistingSourceBuffers: true,
          bufferTimeDefault: 14,
          bufferTimeAtTopQuality: 20,
          bufferTimeAtTopQualityLongForm: 24,
          initialBufferLevel: 1.5,
          bufferToKeep: 30,
          stallThreshold: 0.35,
          enableSeekDecorrelationFix: true,
          useAppendWindow: true,
          setStallState: true
        },
        liveCatchup: {
          enabled: false
        },
        gaps: {
          jumpGaps: true,
          jumpLargeGaps: true,
          smallGapLimit: 1.8,
          threshold: 0.3,
          enableSeekFix: true,
          enableStallFix: true,
          stallSeek: 0.1,
          checkInterval: 250
        },
        abr: {
          autoSwitchBitrate: { video: true, audio: true },
          bandwidthSafetyFactor: 0.82,
          rules: {
            throughputRule: { active: true },
            bolaRule: { active: true },
            insufficientBufferRule: { active: true },
            switchHistoryRule: { active: true },
            droppedFramesRule: { active: false },
            abandonRequestsRule: { active: false }
          },
          initialBitrate: { video: 2200 }
        },
        retryIntervals: {
          mediaSegment: 400,
          initSegment: 400,
          mpd: 500
        },
        retryAttempts: {
          mediaSegment: 8,
          initSegment: 8,
          mpd: 8
        },
        scheduling: {
          defaultTimeout: 150,
          scheduleWhilePaused: true
        }
      }
    });

    var keys = currentClearKeys || (ch && ch.clearKeys);
    var ck = keys ? buildDashClearKeys(keys) : null;
    if (ck) {
      p.setProtectionData({
        'org.w3.clearkey': {
          clearkeys: ck,
          priority: 0
        },
        '1077efec-c0b2-4d02-ace3-3c1e52e2fb4b': {
          clearkeys: ck,
          priority: 0
        },
        'e2719d58-a985-b3c9-781a-b030af78d30e': {
          clearkeys: ck,
          priority: 0
        }
      });

      function injectClearKeyToManifest(manifest) {
        if (!manifest) return;
        try {
          var defKidFromKeys = null;
          if (keys) {
            var kList = Object.keys(keys);
            if (kList.length) defKidFromKeys = kList[0];
          }
          var periods = Array.isArray(manifest.Period) ? manifest.Period : (manifest.Period ? [manifest.Period] : []);
          periods.forEach(function (period) {
            var adaptSets = Array.isArray(period.AdaptationSet) ? period.AdaptationSet : (period.AdaptationSet ? [period.AdaptationSet] : []);
            adaptSets.forEach(function (as) {
              var reps = Array.isArray(as.Representation) ? as.Representation : (as.Representation ? [as.Representation] : []);
              var defKid = defKidFromKeys;
              var allCps = [].concat(as.ContentProtection || []);
              reps.forEach(function (r) { if (r.ContentProtection) allCps = allCps.concat(r.ContentProtection); });
              allCps.forEach(function (cp) {
                if (cp && (cp['cenc:default_KID'] || cp.cencDefaultKid || cp.default_KID)) {
                  defKid = cp['cenc:default_KID'] || cp.cencDefaultKid || cp.default_KID;
                }
              });

              // Bersihkan Widevine & PlayReady, gantikan dengan ClearKey & CENC (persis seperti ExoPlayer di OTT Navigator memaksa CLEARKEY_UUID)
              var cleanCps = [
                {
                  schemeIdUri: 'urn:mpeg:dash:mp4protection:2011',
                  value: 'cenc',
                  'cenc:default_KID': defKid,
                  cencDefaultKid: defKid
                },
                {
                  schemeIdUri: 'urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b',
                  value: 'ClearKey',
                  'cenc:default_KID': defKid,
                  cencDefaultKid: defKid
                },
                {
                  schemeIdUri: 'urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e',
                  value: 'ClearKey',
                  'cenc:default_KID': defKid,
                  cencDefaultKid: defKid
                }
              ];

              as.ContentProtection = cleanCps.slice();
              reps.forEach(function (r) {
                r.ContentProtection = cleanCps.slice();
              });
            });
          });
        } catch (err) {}
      }

      p.on(dashjs.MediaPlayer.events.MANIFEST_LOADED, function (e) {
        if (token !== E.token) return;
        injectClearKeyToManifest(e && e.data);
      });

      p.on(dashjs.MediaPlayer.events.MANIFEST_UPDATED, function (e) {
        if (token !== E.token) return;
        injectClearKeyToManifest(e && e.manifest);
      });
    }

    p.on(dashjs.MediaPlayer.events.PLAYBACK_PLAYING, function () {
      if (token !== E.token) return;
      setBusy(false);
      clearTimeout(E.stall);
    });

    p.on(dashjs.MediaPlayer.events.PLAYBACK_STALLED, function () {
      if (token !== E.token) return;
      healBufferGap();
    });

    p.on(dashjs.MediaPlayer.events.BUFFER_EMPTY, function () {
      if (token !== E.token) return;
      healBufferGap();
    });

    p.on(dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, function (e) {
      if (token !== E.token || (e && e.mediaType !== 'video')) return;
      var lvl = QUAL.levels && QUAL.levels[e.newQuality];
      if (lvl && lvl.height) {
        QUAL.activeHeight = lvl.height;
        updateQualBadge();
      }
    });

    p.on(dashjs.MediaPlayer.events.ERROR, function (e) {
      if (token !== E.token) return;
      var err = e && e.error ? e.error : e;
      var code = (err && (err.code || (err.error && err.error.code))) || 0;
      var msg = String((err && (err.message || err.code)) || '');
      var drm = /protect|key ?system|licen|drm|eme|encrypt/i.test(msg);
      // Jangan fail pada error fragment/segment download karena Dash.js punya retryAttempts internal (8x)
      if (!drm && (code === 27 || code === 25 || /download|fragment|segment/i.test(msg))) {
        return;
      }
      fail({ kind: drm ? 'drm' : 'network', detail: msg }, token);
    });

    p.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, function () {
      if (token !== E.token) return;
      try {
        var list = p.getBitrateInfoListFor('video') || [];
        QUAL.levels = list.map(function (b, idx) {
          return { index: idx, height: b.height || 0, width: b.width || 0, bitrate: b.bitrate || 0 };
        });
        applyDashQuality(p);
      } catch (e) {}
      bindVideoTextTracks();
      syncCcEngine();
      updateQualBadge();
      renderQualMenu();
    });
    p.initialize(el.video, url, true);
  });
}

function startShaka(url, token, ch, currentClearKeys) {
  return loadLib('shaka').then(function () {
    if (token !== E.token) return;
    if (typeof shaka === 'undefined') throw { kind: 'lib' };
    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported()) {
      throw { kind: 'unsupported', detail: 'Browser tidak mendukung EME Shaka' };
    }
    var p = new shaka.Player(el.video);
    E.shaka = p;
    E.mode = 'shaka';

    var cfg = {
      streaming: {
        bufferingGoal: 15,
        rebufferingGoal: 2,
        bufferBehind: 30,
        retryParameters: {
          maxAttempts: 8,
          baseDelay: 500,
          backoffFactor: 1.4,
          timeout: 10000
        },
        inaccurateManifestTolerance: 0,
        safeSeekOffset: 8
      },
      manifest: {
        retryParameters: {
          maxAttempts: 8,
          baseDelay: 500,
          backoffFactor: 1.4,
          timeout: 8000
        },
        dash: {
          autoCorrectDrift: true,
          ignoreMinBufferTime: true
        }
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 3000000,
        switchInterval: 4
      }
    };

    var keys = currentClearKeys || (ch && ch.clearKeys);
    if (keys) {
      var clearKeysObj = {};
      Object.keys(keys).forEach(function (rawKid) {
        var rawKey = keys[rawKid];
        var cleanKid = String(rawKid).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
        var cleanKey = String(rawKey).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
        if (cleanKid.length === 32 && cleanKey.length === 32) {
          clearKeysObj[cleanKid] = cleanKey;
        }
      });
      if (Object.keys(clearKeysObj).length) {
        cfg.drm = {
          clearKeys: clearKeysObj
        };
      }
    }

    p.configure(cfg);

    p.addEventListener('error', function (e) {
      if (token !== E.token) return;
      var detail = e && e.detail;
      var code = (detail && detail.code) || 0;
      var isDrm = (detail && detail.category === 6); // shaka.util.Error.Category.DRM
      if (code === 1002 || (code >= 6000 && !isDrm)) return;
      fail({ kind: isDrm ? 'drm' : 'network', code: code, detail: (detail && detail.message) || String(code) }, token);
    });

    p.addEventListener('adaptation', function () {
      if (token !== E.token) return;
      try {
        var tracks = p.getVariantTracks() || [];
        var active = tracks.find(function (t) { return t.active; });
        if (active && active.height) {
          QUAL.activeHeight = active.height;
          updateQualBadge();
        }
      } catch (err) {}
    });

    return p.load(url).then(function () {
      if (token !== E.token) return;
      try {
        var tracks = p.getVariantTracks() || [];
        QUAL.levels = tracks.filter(function (t) { return t.type === 'variant' && t.height; }).map(function (t, idx) {
          return { index: idx, id: t.id, height: t.height || 0, width: t.width || 0, bitrate: t.bandwidth || 0 };
        });
        applyShakaQuality(p);
      } catch (err) {}
      updateQualBadge();
      renderQualMenu();
      bindVideoTextTracks();
      syncCcEngine();
    });
  });
}

function applyShakaQuality(p) {
  if (!p) return;
  try {
    if (QUAL.mode === 'auto') {
      p.configure({ abr: { enabled: true } });
      applyClientEcoMode(0);
    } else if (QUAL.mode === 'manual' && QUAL.level >= 0) {
      p.configure({ abr: { enabled: false } });
      var tracks = p.getVariantTracks() || [];
      var targetTrack = tracks[QUAL.level];
      if (targetTrack) p.selectVariantTrack(targetTrack, false);
    } else if (QUAL.mode === 'target' || QUAL.mode === 'saver') {
      var maxH = QUAL.mode === 'saver' ? 480 : (QUAL.targetH || 720);
      p.configure({
        abr: {
          enabled: true,
          restrictions: { maxHeight: maxH }
        }
      });
      applyClientEcoMode(maxH);
    }
  } catch (e) {}
}

function startTs(url, type, token) {
  return loadLib('mpegts').then(function () {
    if (token !== E.token) return;
    if (!mpegts.isSupported()) throw { kind: 'unsupported' };
    var absUrl = new URL(url, location.href).href;
    var isSameOrigin = absUrl.indexOf(location.origin) === 0;
    var p = mpegts.createPlayer(
      { type: type, isLive: true, url: absUrl, cors: !isSameOrigin, withCredentials: isSameOrigin },
      {
        enableWorker: false,
        enableStashBuffer: true,
        stashInitialSize: 384 * 1024,
        isLive: true,
        lazyLoad: false,
        lazyLoadMaxDuration: 0,
        deferLoadAfterSourceOpen: false,
        liveBufferLatencyChasing: false,
        liveSync: false,
        fixAudioTimestampGap: true,
        accurateSeek: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 60,
        autoCleanupMinBackwardDuration: 30
      }
    );
    E.ts = p; E.mode = 'mpegts';
    var mediaRecuperated = 0;
    p.on(mpegts.Events.ERROR, function (type2, detail, info) {
      if (token !== E.token) return;
      if (type2 === mpegts.ErrorTypes.MEDIA_ERROR && mediaRecuperated < 4) {
        mediaRecuperated++;
        if (healBufferGap()) return;
      }
      fail({ kind: type2 === mpegts.ErrorTypes.NETWORK_ERROR ? 'network' : 'media', code: info && info.code, detail: (info && info.msg) || detail }, token);
    });
    p.attachMediaElement(el.video);
    p.load();
  });
}

el.video.addEventListener('error', function () {
  if (E.mode !== 'native' || !el.video.getAttribute('src')) return;
  var code = el.video.error ? el.video.error.code : 0;
  fail({ kind: code === 4 ? 'media' : 'network', code: 0 }, E.token);
});

function streamProxyUrl(rawUrl, ch, serverQ) {
  var q = location.origin + '/api/stream?u=' + encodeURIComponent(rawUrl);
  if (ch && ch.ua) q += '&ua=' + encodeURIComponent(ch.ua);
  if (ch && ch.ref) q += '&ref=' + encodeURIComponent(ch.ref);
  if (ch && ch.origin) q += '&org=' + encodeURIComponent(ch.origin);
  if (serverQ) q += '&q=' + encodeURIComponent(serverQ) + '&transcode=1';
  return q;
}

function isVerticalVideo() {
  if (el.video && el.video.videoHeight && el.video.videoWidth) {
    return el.video.videoHeight > el.video.videoWidth;
  }
  if (S.playing && (S.playing.isVod || S.playing.isVertical || S.playing.group === 'Short Drama')) return true;
  if (document.body.classList.contains('is-vod-mode') && S.playing) return true;
  return false;
}

function updateVideoAspect() {
  var isVert = isVerticalVideo();
  el.stage.classList.toggle('is-vertical', isVert);
  document.body.classList.toggle('is-stage-vertical', isVert);
  var fitBtn = $('#fitBtn');
  if (fitBtn) fitBtn.hidden = !isVert;
}

function play(ch, opts) {
  opts = opts || {};
  if (!ch) return;
  var token = ++E.token;
  if (!opts.retry) { E.retries = 0; E.hasPlayed = false; }
  E.tsFallback = false;
  E.nativeFallback = false;
  S.playing = ch; S.cued = null;
  LS.set('last', ch.url);
  updateVideoAspect();
  if (!opts.retry) { flushWatch(); W.ch = ch; W.last = 0; pushRecent(ch.url); showOSD(ch); sendPresence(); }
  markPlaying(); updateNow(); hideMsg();
  el.idle.hidden = true;
  setBusy(true);
  el.stage.classList.add('is-playing');
  destroyEngine();

  var srcIdx = (typeof opts.sourceIndex === 'number') ? opts.sourceIndex : (opts.retry ? (ch._sourceIndex || 0) : 0);
  if (!ch.sources || !ch.sources.length) {
    ch.sources = [{
      url: ch.url,
      ua: ch.ua || '',
      ref: ch.ref || '',
      origin: ch.origin || '',
      clearKeys: ch.clearKeys || null
    }];
  }
  if (srcIdx >= ch.sources.length) srcIdx = 0;
  ch._sourceIndex = srcIdx;
  var activeSrc = ch.sources[srcIdx];
  var currentUrl = activeSrc.url || ch.url;
  var currentUa = activeSrc.ua || ch.ua || '';
  var currentRef = activeSrc.ref || ch.ref || '';
  var currentOrg = activeSrc.origin || ch.origin || '';
  var currentClearKeys = activeSrc.clearKeys || ch.clearKeys || null;
  var currentNeedsHeaders = !!(currentUa || currentRef || currentOrg);

  var kind = kindOf(currentUrl);
  var isHttpOnHttps = location.protocol === 'https:' && /^http:\/\//i.test(currentUrl);
  var isTsOrStalker = kind === 'mpegts' || kind === 'flv' || /\/play\/live\.php\b/i.test(currentUrl);
  // Hanya gunakan forceServerQ jika sudah diverifikasi lewat preflight probe
  var wantServerQ = (opts.forceServerQ && !opts.noTranscode) ? opts.forceServerQ : 0;
  var useProxy = !!(wantServerQ || opts.viaProxy || currentNeedsHeaders || isHttpOnHttps || isTsOrStalker) && kind !== 'unsupported';
  E.viaProxy = useProxy;
  E.serverTranscode = !!wantServerQ;
  QUAL.serverQ = wantServerQ;
  var streamObj = {
    url: currentUrl,
    ua: currentUa,
    ref: currentRef,
    origin: currentOrg,
    clearKeys: currentClearKeys
  };
  var url = useProxy ? streamProxyUrl(currentUrl, streamObj, wantServerQ) : upgradeUrl(currentUrl);
  if (wantServerQ) {
    kind = 'mpegts';
    QUAL.activeHeight = wantServerQ;
  }
  updateQualBadge();
  renderQualMenu();
  var start;
  if (kind === 'unsupported') start = Promise.reject({ kind: 'unsupported' });
  else if (kind === 'hls') start = startHls(url, token);
  else if (kind === 'dash') {
    start = startShaka(url, token, ch, currentClearKeys).catch(function (e) {
      if (token !== E.token) throw e;
      return startDash(url, token, ch, currentClearKeys);
    });
  }
  else if (kind === 'flv' || kind === 'mpegts') start = startTs(url, kind, token);
  else { startNative(url); start = Promise.resolve(); }

  start.then(function () {
    if (token !== E.token) return;
    bindVideoTextTracks();
    syncCcEngine();
    var p = el.video.play();
    if (p && p.catch) {
      p.catch(function (e) {
        if (token !== E.token || !e || e.name !== 'NotAllowedError') return;
        el.video.muted = true; syncMute();
        el.video.play().then(function () {
          toast('Browser memulai tanpa suara. Tekan M atau ikon speaker untuk menyalakan.');
        }).catch(function () {});
      });
    }
  }).catch(function (err) {
    if (token === E.token) fail(err && err.kind ? err : { kind: 'network' }, token);
  });
}

function lockReason(info) {
  if (info.kind === 'drm') return 'drm';
  return '';
}

function fail(info, token) {
  if (token !== E.token) return;
  if (E.serverTranscode && S.playing) {
    S.playing._noServerTranscode = true;
    E.serverTranscode = false;
    QUAL.serverQ = 0;
    el.nowMeta.textContent = 'Kompresi server tidak tersedia untuk channel ini, kembali ke jalur langsung…';
    play(S.playing, { retry: true, viaProxy: false, noTranscode: true, sourceIndex: S.playing._sourceIndex });
    return;
  }
  if (!E.viaProxy && S.playing && info.kind !== 'drm' && info.kind !== 'unsupported' && info.kind !== 'lib') {
    var curUrl = (S.playing.sources && S.playing.sources[S.playing._sourceIndex || 0]) ? S.playing.sources[S.playing._sourceIndex || 0].url : S.playing.url;
    // Jangan relay stream DASH (.mpd) lewat /api/stream karena proxy server tidak merender segmen anak XML
    if (kindOf(curUrl) !== 'dash') {
      el.nowMeta.textContent = 'Mencoba memutar lewat jalur relay server…';
      play(S.playing, { retry: true, viaProxy: true, sourceIndex: S.playing._sourceIndex });
      return;
    }
  }

  // Multi-source fallback jika channel punya alternatif server / mirror stream
  // JANGAN otomatis pindah ke server backup jika stream saat ini SUDAH PERNAH JALAN (E.hasPlayed === true)
  // atau jika stream adalah DASH ber-ClearKey (karena server cadangan seringkali link mati/expired). Prioritaskan reconnect stream utama!
  var isDashOrDrm = (S.playing && (S.playing.clearKeys || kindOf(S.playing.url) === 'dash'));
  if (!isDashOrDrm && !E.hasPlayed && S.playing && S.playing.sources && S.playing.sources.length > 1) {
    var curIdx = S.playing._sourceIndex || 0;
    if (curIdx + 1 < S.playing.sources.length) {
      var nextIdx = curIdx + 1;
      S.playing._sourceIndex = nextIdx;
      el.nowMeta.textContent = 'Server ' + (curIdx + 1) + ' gagal, mencoba Server ' + (nextIdx + 1) + ' dari ' + S.playing.sources.length + '…';
      toast('Server ' + (curIdx + 1) + ' gagal, beralih ke Server ' + (nextIdx + 1) + '…');
      play(S.playing, { retry: true, viaProxy: false, sourceIndex: nextIdx });
      return;
    }
  }

  var lock = lockReason(info);
  var hopeless = !!lock || info.kind === 'unsupported' || info.kind === 'lib' ||
    info.code === 404 || info.code === 410;
  if (!hopeless && E.retries < 3) {
    E.retries++;
    var ch = S.playing;
    el.nowMeta.textContent = 'Sinyal terputus, menyambungkan ulang Server ' + ((ch._sourceIndex || 0) + 1) + ' (' + E.retries + ' dari 3)…';
    setTimeout(function () { if (token === E.token) play(ch, { retry: true, viaProxy: E.viaProxy, sourceIndex: ch._sourceIndex }); }, 1500 * E.retries);
    return;
  }
  destroyEngine();
  setBusy(false);
  el.liveTag.hidden = true;
  var x = explain(info, S.playing);
  el.msgTitle.textContent = x.title;
  el.msgBody.textContent = x.body + (lock ? ' Channel ini sudah disembunyikan dari daftar.' : '');
  el.msg.hidden = false;
  el.stage.classList.add('has-msg');
  el.nowMeta.textContent = x.title;
  if (S.playing) track('play_error', { channel: S.playing.name, reason: x.title });
  if (lock && S.playing) blockChannel(S.playing, lock);
}

function explain(info, ch) {
  var mixed = !E.viaProxy && location.protocol === 'https:' && /^http:\/\//i.test(ch.url);
  if (info.kind === 'drm') return { title: 'Channel ini terenkripsi (DRM)', body: 'Stream ini dilindungi enkripsi DRM tanpa kunci (ClearKey) yang valid di playlist.' };
  if (info.kind === 'lib') return { title: 'Komponen pemutar gagal dimuat', body: 'Periksa koneksi internet lalu coba lagi.' };
  if (info.kind === 'unsupported') return { title: 'Format ini tidak didukung browser', body: 'Alamat seperti rtmp:// atau udp:// tidak bisa diputar di browser. Coba buka di VLC.' };
  if (info.code === 511) return { title: 'Token sesi stream dikunci server (511)', body: 'Server Stalker/IPTV menolak sambungan ulang karena play_token bersifat sekali-pakai atau batas 1 koneksi aktif per MAC sedang terpakai. Klik Coba lagi.' };
  if (info.code === 401 || info.code === 403 || info.code === 451) return { title: 'Channel dibatasi pemilik siaran', body: 'Server stream menolak akses (kode ' + info.code + '). Jika ini stream Stalker/MAC, pastikan VLC sudah ditutup (maksimal 1 koneksi aktif) atau token tidak dikunci ke IP rumah.' };
  if (info.code === 404 || info.code === 410) return { title: 'Alamat stream sudah tidak aktif', body: 'Server menjawab dengan kode ' + info.code + '. Channel ini kemungkinan sudah mati atau pindah alamat. Coba perbarui playlist.' };
  if (info.code === 502) return { title: 'Server stream menolak koneksi VPS', body: 'Server ZanTV gagal mengambil stream (kode 502). Provider stream kemungkinan mengunci token ke IP internet rumahmu (memblokir IP VPS) atau tautannya sudah kedaluwarsa.' };
  if (mixed) return { title: 'Stream http diblokir browser', body: 'ZanTV dibuka lewat https, sedangkan alamat stream ini masih http dan servernya tidak menyediakan versi https. Browser memblokir campuran ini demi keamanan. Buka di VLC, atau jalankan ZanTV dari http://localhost.' };
  if (ch.needsHeaders && !E.viaProxy) return { title: 'Channel ini butuh pengaturan khusus', body: 'Playlist meminta User-Agent atau Referer tertentu, dan halaman web tidak diizinkan mengaturnya. Channel seperti ini biasanya hanya jalan di VLC atau aplikasi IPTV.' };
  if (info.kind === 'network') return { title: 'Stream tidak bisa dijangkau', body: 'Server sedang mati, token stream hanya berlaku di IP rumah (bukan IP VPS), atau koneksi terputus' + (info.code && info.code > 0 ? ' (kode ' + info.code + ')' : '') + '.' };
  return { title: 'Stream gagal diputar', body: 'Format video dari server ini tidak bisa dibaca browser ini atau stream kosong. Coba pastikan VLC sudah ditutup lalu klik Coba lagi.' };
}

var busyTimer = null;
function setBusy(on) {
  clearTimeout(busyTimer);
  if (on) {
    busyTimer = setTimeout(function () {
      el.spinner.hidden = false;
    }, 450); // Debounce: jangan tampilkan spinner jika jeda hanya micro-pause < 450ms
  } else {
    el.spinner.hidden = true;
  }
}
function hideMsg() { el.msg.hidden = true; el.stage.classList.remove('has-msg'); }

/* status video */
el.video.addEventListener('playing', function () {
  clearTimeout(E.stall); setBusy(false); E.retries = 0;
  el.liveTag.hidden = false; syncPlay(); updateNow();
  if (el.video.videoHeight) QUAL.activeHeight = el.video.videoHeight;
  if (QUAL.mode === 'saver' || (QUAL.mode === 'target' && QUAL.targetH > 0)) {
    applyClientEcoMode(QUAL.mode === 'saver' ? 480 : QUAL.targetH);
  }
  updateQualBadge();
  renderQualMenu();
  bindVideoTextTracks();
  syncCcEngine();
});
el.video.addEventListener('loadedmetadata', function () {
  if (el.video.videoHeight) QUAL.activeHeight = el.video.videoHeight;
  updateVideoAspect();
  updateQualBadge();
  renderQualMenu();
  bindVideoTextTracks();
});
el.video.addEventListener('resize', function () {
  if (el.video.videoHeight) {
    QUAL.activeHeight = el.video.videoHeight;
    updateQualBadge();
  }
  updateVideoAspect();
});
el.video.addEventListener('waiting', function () {
  if (healBufferGap()) { setBusy(false); return; }
  setBusy(true);
  var token = E.token;
  setTimeout(function () { if (token === E.token && el.video.readyState < 3 && healBufferGap()) setBusy(false); }, 350);
  clearTimeout(E.stall);
  E.stall = setTimeout(function () {
    if (token !== E.token || el.video.readyState >= 3) return;
    if (healBufferGap()) { setBusy(false); return; }
    fail({ kind: 'network' }, token);
  }, 35000);
});
el.video.addEventListener('stalled', function () {
  healBufferGap();
});
el.video.addEventListener('pause', syncPlay);
el.video.addEventListener('timeupdate', function () {
  if (el.video.paused || W.ch !== S.playing) { W.last = 0; return; }
  var now = Date.now();
  if (W.last) { var d = (now - W.last) / 1000; if (d > 0 && d < 3) W.secs += d; }
  W.last = now;
});
el.video.addEventListener('pause', function () { W.last = 0; });
el.video.addEventListener('waiting', function () { W.last = 0; });
el.video.addEventListener('volumechange', syncMute);
el.video.addEventListener('ended', function () {
  if (S.playing && S.playing.isVod && window.ZanVod) {
    var hasNext = window.ZanVod.playNextEpisode();
    if (hasNext) toast('Memutar episode berikutnya...');
  }
});
window.ZanTV = {
  playVod: function (vodCh) { play(vodCh); },
  playChannel: play
};

/* ------------------------------------------------------------------ */
/* Pilihan Resolusi (Quality Selector) & Mode Hemat Data               */
/* ------------------------------------------------------------------ */
function pickLevelForTarget(levels, maxH) {
  if (!levels || !levels.length) return -1;
  var bestIdx = -1, bestScore = -1, minIdx = levels[0].index, minScore = Infinity;
  for (var i = 0; i < levels.length; i++) {
    var h = levels[i].height || 0;
    var br = levels[i].bitrate || 0;
    var score = h || Math.round(br / 2000);
    if (score > 0 && score < minScore) { minScore = score; minIdx = levels[i].index; }
    var maxBr = maxH <= 360 ? 700000 : maxH <= 480 ? 1200000 : maxH <= 720 ? 2800000 : 99999999;
    if ((h > 0 && h <= maxH) || (!h && br > 0 && br <= maxBr)) {
      if (score >= bestScore) { bestScore = score; bestIdx = levels[i].index; }
    }
  }
  return bestIdx >= 0 ? bestIdx : minIdx;
}

function applyClientEcoMode(targetH) {
  var realH = (el.video && el.video.videoHeight) || QUAL.activeHeight || 0;
  if (!targetH || targetH <= 0 || (realH > 0 && targetH >= realH)) {
    QUAL.clientScaledH = 0;
    if (E.hls && E.hls.config) {
      E.hls.config.maxBufferLength = 30;
      E.hls.config.maxMaxBufferLength = 60;
      E.hls.config.backBufferLength = 30;
    }
    return;
  }
  QUAL.clientScaledH = targetH;
  if (E.hls && E.hls.config) {
    E.hls.config.maxBufferLength = targetH <= 360 ? 5 : targetH <= 480 ? 7 : 12;
    E.hls.config.maxMaxBufferLength = targetH <= 360 ? 10 : targetH <= 480 ? 14 : 24;
    E.hls.config.backBufferLength = 4;
  }
}

function applyHlsQuality(hls) {
  if (!hls) return;
  if (QUAL.mode === 'auto') {
    hls.autoLevelCapping = -1;
    hls.nextLevel = -1;
    applyClientEcoMode(0);
  } else if (QUAL.mode === 'saver') {
    var capIdx = pickLevelForTarget(QUAL.levels, 480);
    if (capIdx >= 0 && QUAL.levels.length > 1) {
      hls.autoLevelCapping = capIdx;
      hls.nextLevel = capIdx;
    }
    applyClientEcoMode(480);
  } else if (QUAL.mode === 'native' && QUAL.level >= 0 && QUAL.level < (hls.levels || []).length) {
    hls.autoLevelCapping = QUAL.level;
    hls.nextLevel = QUAL.level;
    var lv = QUAL.levels[QUAL.level];
    applyClientEcoMode(lv && lv.height ? lv.height : 0);
  } else if (QUAL.mode === 'target' && QUAL.targetH > 0) {
    var tIdx = pickLevelForTarget(QUAL.levels, QUAL.targetH);
    if (tIdx >= 0 && QUAL.levels.length > 1) {
      hls.autoLevelCapping = tIdx;
      hls.nextLevel = tIdx;
    }
    applyClientEcoMode(QUAL.targetH);
  }
}

function applyDashQuality(p) {
  if (!p) return;
  try {
    if (QUAL.mode === 'auto') {
      p.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true }, maxBitrate: { video: -1 } } } });
      applyClientEcoMode(0);
    } else if (QUAL.mode === 'saver') {
      p.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true }, maxBitrate: { video: 1000 } } } });
      var idx = pickLevelForTarget(QUAL.levels, 480);
      if (idx >= 0) p.setQualityFor('video', idx);
      applyClientEcoMode(480);
    } else if (QUAL.mode === 'native' && QUAL.level >= 0) {
      p.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
      p.setQualityFor('video', QUAL.level);
    } else if (QUAL.mode === 'target' && QUAL.targetH > 0) {
      var tIdx = pickLevelForTarget(QUAL.levels, QUAL.targetH);
      p.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
      if (tIdx >= 0) p.setQualityFor('video', tIdx);
      applyClientEcoMode(QUAL.targetH);
    }
  } catch (e) {}
}

function fmtBitrate(bps) {
  if (!bps || bps <= 0) return '';
  if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps';
  return Math.round(bps / 1000) + ' kbps';
}

function updateQualBadge() {
  var badge = $('#qualBadge');
  var btn = $('#qualBtn');
  var pill = $('#qualStatusPill');
  if (!badge || !btn) return;
  var realH = QUAL.activeHeight || (el.video && el.video.videoHeight) || 0;
  var effH = (QUAL.clientScaledH && (!realH || QUAL.clientScaledH < realH)) ? QUAL.clientScaledH : realH;
  var text = 'AUTO';
  var pillText = 'Otomatis';
  if (E.serverTranscode && QUAL.serverQ) {
    text = QUAL.serverQ + 'p⚡';
    pillText = 'Kompresi Server ' + QUAL.serverQ + 'p';
  } else if (QUAL.mode === 'saver') {
    text = effH ? 'HEMAT·' + effH + 'p' : 'HEMAT';
    pillText = effH ? 'Hemat Data (' + effH + 'p)' : 'Hemat Data (≤480p)';
  } else if (QUAL.mode === 'target' && QUAL.targetH) {
    text = QUAL.targetH + 'p';
    pillText = 'Dikunci ' + QUAL.targetH + 'p' + (QUAL.clientScaledH ? ' (Hemat Buffer)' : '');
  } else if (QUAL.mode === 'native' && QUAL.level >= 0) {
    var lv = QUAL.levels[QUAL.level];
    var lh = (lv && lv.height) || effH;
    text = lh ? lh + 'p' : 'MANUAL';
    pillText = lh ? 'Dikunci ' + lh + 'p' : 'Manual';
  } else {
    text = realH ? 'AUTO·' + realH + 'p' : 'AUTO';
    pillText = realH ? 'Otomatis (' + realH + 'p aktif)' : 'Otomatis';
  }
  badge.textContent = text;
  btn.setAttribute('aria-pressed', String(QUAL.mode !== 'auto'));
  if (pill) pill.textContent = pillText;
}

function renderQualMenu() {
  var box = $('#qualList');
  if (!box) return;
  var realH = QUAL.activeHeight || (el.video && el.video.videoHeight) || 0;
  var items = [];
  items.push({
    qmode: 'auto', level: -1, sq: 0,
    active: QUAL.mode === 'auto',
    label: '⚡ Otomatis (Sesuai Kecepatan Internet)',
    tag: realH && QUAL.mode === 'auto' ? realH + 'p' : 'ABR'
  });
  items.push({
    qmode: 'saver', level: -1, sq: 480,
    active: QUAL.mode === 'saver',
    label: '🍃 Mode Hemat Data (SD ≤ 480p)',
    tag: 'Hemat Kuota'
  });

  var hasNativeHeights = {};
  if (QUAL.levels && QUAL.levels.length > 1) {
    var sorted = QUAL.levels.slice().sort(function (a, b) {
      return (b.height - a.height) || (b.bitrate - a.bitrate);
    });
    var seen = {};
    sorted.forEach(function (lv) {
      var key = (lv.height || 0) + ':' + Math.round((lv.bitrate || 0) / 100000);
      if (seen[key]) return;
      seen[key] = true;
      if (lv.height) hasNativeHeights[lv.height] = true;
      var tag = fmtBitrate(lv.bitrate);
      var name = lv.height ? (lv.height + 'p' + (lv.height >= 1080 ? ' FHD' : lv.height >= 720 ? ' HD' : ' SD')) : ('Level ' + (lv.index + 1));
      items.push({
        qmode: 'native', level: lv.index, sq: lv.height || 0,
        active: (QUAL.mode === 'native' && QUAL.level === lv.index) || (QUAL.mode === 'target' && lv.height && QUAL.targetH === lv.height),
        label: '🎬 ' + name,
        tag: tag || 'Asli'
      });
    });
  }

  [
    { q: 1080, name: '🎬 1080p Full HD', tag: 'FHD' },
    { q: 720, name: '🎬 720p HD', tag: '~1.6 Mbps' },
    { q: 480, name: '🎬 480p SD (Stabil)', tag: '~850 kbps' },
    { q: 360, name: '🎬 360p Lancar (Hemat)', tag: '~480 kbps' }
  ].forEach(function (preset) {
    if (hasNativeHeights[preset.q]) return;
    if (preset.q === 1080 && realH > 0 && realH < 1080) return;
    items.push({
      qmode: 'target', level: -1, sq: preset.q,
      active: QUAL.mode === 'target' && QUAL.targetH === preset.q,
      label: preset.name,
      tag: preset.tag
    });
  });

  box.innerHTML = items.map(function (it) {
    return '<button type="button" class="player-pop-opt" data-qmode="' + esc(it.qmode) + '" data-level="' + it.level + '" data-sq="' + it.sq + '" aria-checked="' + String(!!it.active) + '">' +
      '<span>' + esc(it.label) + '</span>' +
      (it.tag ? '<small>' + esc(it.tag) + '</small>' : '') +
    '</button>';
  }).join('');

  if (S.playing && S.playing.sources && S.playing.sources.length > 1) {
    var curSrc = S.playing._sourceIndex || 0;
    var serverHtml = '<div class="player-pop-divider"><span>Pilih Server / Mirror</span></div>' +
      S.playing.sources.map(function (s, idx) {
        var isAct = idx === curSrc;
        var sKind = kindOf(s.url).toUpperCase();
        if (s.clearKeys) sKind += ' · ClearKey';
        return '<button type="button" class="player-pop-opt" data-source-idx="' + idx + '" aria-checked="' + String(isAct) + '">' +
          '<span>Server ' + (idx + 1) + '</span>' +
          '<small>' + esc(sKind) + '</small>' +
        '</button>';
      }).join('');
    box.innerHTML += serverHtml;
  }
}

function selectQualityOption(qmode, level, sq) {
  if (E.probeAc) { try { E.probeAc.abort(); } catch (e) {} E.probeAc = null; }
  QUAL.mode = qmode;
  QUAL.level = level;
  QUAL.targetH = sq || 0;
  LS.set('qual-mode', qmode);
  LS.set('qual-target-h', QUAL.targetH);
  LS.set('qual-server-q', 0);

  if (!S.playing) {
    updateQualBadge();
    renderQualMenu();
    return;
  }

  // Terapkan langsung pada player yang sedang berjalan (TANPA membuka koneksi kedua / memutus sesi stream!)
  if (E.hls) {
    applyHlsQuality(E.hls);
  } else if (E.shaka) {
    applyShakaQuality(E.shaka);
  } else if (E.dash) {
    applyDashQuality(E.dash);
  } else {
    applyClientEcoMode(qmode === 'saver' ? 480 : (qmode === 'target' ? QUAL.targetH : 0));
  }

  updateQualBadge();
  renderQualMenu();

  var wantedH = qmode === 'saver' ? 480 : (qmode === 'target' ? QUAL.targetH : 0);
  if (qmode === 'auto') {
    toast('Resolusi Otomatis aktif');
  } else if (QUAL.levels && QUAL.levels.length > 1) {
    toast(qmode === 'saver' ? 'Mode Hemat Data aktif (≤ 480p)' : 'Resolusi diubah ke ' + (wantedH || '') + 'p');
  } else {
    toast(qmode === 'saver' ? 'Mode Hemat Data (≤ 480p) aktif' : 'Resolusi ' + wantedH + 'p (Mode Hemat Buffer) aktif');
  }
}

/* ------------------------------------------------------------------ */
/* Auto CC (Subtitles + Auto-Translate Bahasa Indonesia / Inggris)     */
/* ------------------------------------------------------------------ */
function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clearCcDisplay() {
  clearTimeout(CC.hideTimer);
  var box = $('#ccBox'), txt = $('#ccText'), orig = $('#ccOrig');
  if (box) box.hidden = true;
  if (txt) txt.textContent = '';
  if (orig) { orig.hidden = true; orig.textContent = ''; }
}

function updateCcUi() {
  var btn = $('#ccBtn');
  var pill = $('#ccStatusPill');
  var list = $('#ccTargetList');
  var srcSel = $('#ccSrcLang');
  if (btn) btn.setAttribute('aria-pressed', String(CC.mode !== 'off'));
  if (srcSel && srcSel.value !== CC.srcLang) srcSel.value = CC.srcLang;
  if (list) {
    Array.prototype.forEach.call(list.querySelectorAll('[data-cc-target]'), function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-cc-target') === CC.mode));
    });
  }
  if (pill) {
    if (CC.mode === 'off') pill.textContent = 'Mati';
    else if (CC.hasTrack) pill.textContent = 'Aktif · Subtitle Stream';
    else if (CC.srRunning) pill.textContent = 'Aktif · Live Audio AI';
    else if (window.SpeechRecognition || window.webkitSpeechRecognition) pill.textContent = 'Aktif · Menunggu Suara…';
    else pill.textContent = 'Aktif · Menunggu Track CC';
  }
}

function showCcCue(rawText, isInterim, sourceLabel) {
  if (CC.mode === 'off') { clearCcDisplay(); return; }
  var clean = stripTags(rawText);
  if (!clean) return;
  var box = $('#ccBox'), txt = $('#ccText'), orig = $('#ccOrig');
  if (!box || !txt || !orig) return;

  clearTimeout(CC.hideTimer);
  CC.hideTimer = setTimeout(clearCcDisplay, isInterim ? 5000 : 7500);

  if (CC.mode === 'orig') {
    orig.hidden = true;
    txt.textContent = clean;
    box.hidden = false;
    return;
  }

  var target = CC.mode; // 'id' or 'en'
  var cacheKey = target + '|' + clean.toLowerCase();
  if (CC.cache[cacheKey]) {
    txt.textContent = CC.cache[cacheKey];
    if (CC.cache[cacheKey].toLowerCase() !== clean.toLowerCase()) {
      orig.textContent = clean;
      orig.hidden = false;
    } else {
      orig.hidden = true;
    }
    box.hidden = false;
    return;
  }

  // Tampilkan teks asli terlebih dahulu sambil menerjemahkan
  txt.textContent = clean;
  orig.hidden = true;
  box.hidden = false;

  // Jangan spam API saat interim masih sangat pendek
  if (isInterim && clean.length < 14) return;
  var seq = ++CC.reqSeq;
  var srcCode = CC.hasTrack ? 'auto' : String(CC.srcLang || 'auto').split('-')[0];
  api('POST', '/api/translate', { text: clean, target: target, source: srcCode }).then(function (r) {
    if (CC.mode === 'off' || !r || !r.translated) return;
    CC.cache[cacheKey] = r.translated;
    if (seq !== CC.reqSeq && isInterim) return;
    txt.textContent = r.translated;
    if (r.translated.toLowerCase() !== clean.toLowerCase()) {
      orig.textContent = clean;
      orig.hidden = false;
    } else {
      orig.hidden = true;
    }
    box.hidden = false;
  }).catch(function () {});
}

function bindVideoTextTracks() {
  var tracks = el.video && el.video.textTracks;
  if (!tracks) return;
  for (var i = 0; i < tracks.length; i++) {
    (function (tr) {
      if (tr.__zanBound) {
        tr.mode = CC.mode === 'off' ? 'disabled' : 'hidden';
        return;
      }
      tr.__zanBound = true;
      tr.mode = CC.mode === 'off' ? 'disabled' : 'hidden';
      tr.addEventListener('cuechange', function () {
        if (CC.mode === 'off') return;
        var active = tr.activeCues;
        if (!active || !active.length) return;
        CC.hasTrack = true;
        stopSpeechCc();
        updateCcUi();
        var lines = [];
        for (var j = 0; j < active.length; j++) {
          if (active[j] && active[j].text) lines.push(active[j].text);
        }
        var joined = lines.join(' ');
        if (joined) showCcCue(joined, false, 'Stream');
      });
    })(tracks[i]);
  }
}

if (el.video && el.video.textTracks && el.video.textTracks.addEventListener) {
  el.video.textTracks.addEventListener('addtrack', function () {
    CC.hasTrack = true;
    bindVideoTextTracks();
    syncCcEngine();
  });
}

function startSpeechCc() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || CC.mode === 'off' || CC.hasTrack || !S.playing) {
    updateCcUi();
    return;
  }
  if (CC.srRunning && CC.sr) {
    updateCcUi();
    return;
  }
  try {
    var rec = new SR();
    rec.lang = CC.srcLang || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = function () {
      CC.srRunning = true;
      updateCcUi();
    };
    rec.onresult = function (ev) {
      if (CC.mode === 'off') return;
      var interim = '', finalTxt = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var t = ev.results[i][0] ? ev.results[i][0].transcript : '';
        if (ev.results[i].isFinal) finalTxt += t + ' ';
        else interim += t;
      }
      var picked = finalTxt.trim() || interim.trim();
      if (picked) showCcCue(picked, !finalTxt.trim(), 'Audio AI');
    };
    rec.onerror = function (ev) {
      if (ev && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) {
        CC.srRunning = false;
        CC.sr = null;
        updateCcUi();
      }
    };
    rec.onend = function () {
      CC.srRunning = false;
      updateCcUi();
      if (CC.mode !== 'off' && !CC.hasTrack && S.playing && CC.sr === rec) {
        setTimeout(function () {
          if (CC.mode !== 'off' && !CC.hasTrack && S.playing && CC.sr === rec) {
            try { rec.start(); } catch (e) {}
          }
        }, 400);
      }
    };
    CC.sr = rec;
    rec.start();
  } catch (e) {
    CC.srRunning = false;
    updateCcUi();
  }
}

function stopSpeechCc() {
  var rec = CC.sr;
  CC.sr = null;
  CC.srRunning = false;
  if (rec) {
    try { rec.onend = null; rec.stop(); } catch (e) {}
  }
  updateCcUi();
}

function syncCcEngine() {
  bindVideoTextTracks();
  if (E.hls) {
    try {
      if (CC.mode !== 'off' && E.hls.subtitleTracks && E.hls.subtitleTracks.length > 0) {
        CC.hasTrack = true;
        E.hls.subtitleDisplay = false;
        if (E.hls.subtitleTrack < 0) E.hls.subtitleTrack = 0;
      } else if (CC.mode === 'off') {
        E.hls.subtitleTrack = -1;
      }
    } catch (e) {}
  }
  if (CC.mode === 'off') {
    stopSpeechCc();
    clearCcDisplay();
  } else if (CC.hasTrack) {
    stopSpeechCc();
  } else {
    startSpeechCc();
  }
  updateCcUi();
}

function setCcMode(mode) {
  CC.mode = mode;
  LS.set('cc-mode', mode);
  syncCcEngine();
  if (mode === 'off') {
    toast('Auto CC (Subtitle) dimatikan');
  } else {
    var label = mode === 'id' ? 'Terjemahan Indonesia' : mode === 'en' ? 'Terjemahan Inggris' : 'Bahasa Asli';
    toast('Auto CC aktif: ' + label);
    showCcCue(CC.hasTrack ? 'Subtitle stream aktif (' + label + ')' : 'Auto CC siap menerjemahkan dialog (' + label + ')…', true, 'System');
  }
}
function updateNow() {
  var c = S.playing || S.cued;
  var nowEpg = $('#nowEpg');
  var guideBtn = $('#epgGuideBtn');
  if (!c) {
    el.nowNo.textContent = '';
    el.nowName.textContent = S.channels.length ? 'Pilih channel' : 'Belum ada channel';
    el.nowMeta.textContent = S.channels.length ? 'Pilih dari daftar, atau ketik nomor channel.' : 'Tambahkan playlist M3U untuk mulai.';
    if (nowEpg) { nowEpg.hidden = true; nowEpg.innerHTML = ''; }
    if (guideBtn) guideBtn.hidden = !EPG.meta;
  } else if (c.isVod) {
    el.nowNo.textContent = '🎬';
    el.nowName.textContent = c.name;
    var provStr = (c.vodDrama && c.vodDrama.provider) ? (c.vodDrama.provider.toUpperCase() + ' • ') : '';
    var epInfo = (c.vodEp && c.vodEp.episode) ? ('Episode ' + c.vodEp.episode + (c.totalEpisodes ? ('/' + c.totalEpisodes) : '') + ' • ') : '';
    el.nowMeta.textContent = provStr + epInfo + ((c.vodDrama && (c.vodDrama.summary || c.vodDrama.title)) || 'Short Drama Series');
    if (nowEpg) { nowEpg.hidden = true; nowEpg.innerHTML = ''; }
    if (guideBtn) guideBtn.hidden = true;
  } else {
    el.nowNo.textContent = c.no;
    el.nowName.textContent = c.name;
    el.nowMeta.textContent = S.playing ? c.group : c.group + ', terakhir ditonton';
    var en = epgNowNext(c);
    if (nowEpg) {
      if (en && en.cur) {
        var range = fmtClockWib(en.cur.start) + ' – ' + fmtClockWib(en.cur.stop) + ' WIB';
        var nextHtml = en.next
          ? '<span class="now-epg-next">Selanjutnya ' + esc(fmtClockWib(en.next.start)) + ': <b>' + esc(en.next.title) + '</b></span>'
          : '';
        var barHtml = en.isLive
          ? '<span class="now-epg-bar"><i style="width:' + en.pct + '%"></i></span>'
          : '';
        nowEpg.innerHTML =
          '<div class="now-epg-cur">' +
            '<span class="now-epg-tag">' + (en.isLive ? 'LIVE EPG' : 'JADWAL') + '</span>' +
            '<strong class="now-epg-title">' + esc(en.cur.title) + '</strong>' +
            '<span class="now-epg-time">' + esc(range) + '</span>' +
          '</div>' +
          barHtml +
          nextHtml;
        nowEpg.hidden = false;
      } else {
        nowEpg.hidden = true;
        nowEpg.innerHTML = '';
      }
    }
    if (guideBtn) guideBtn.hidden = !(en || EPG.meta);
  }
  var fav = !!c && S.favs.has(c.url);
  el.favBtn.setAttribute('aria-pressed', String(fav));
  el.favBtn.setAttribute('aria-label', fav ? 'Hapus dari favorit' : 'Tambah ke favorit');
  document.title = S.playing ? S.playing.name + ' · ZanTV' : 'ZanTV';
}

function cue(ch) {
  S.cued = ch;
  el.idleText.textContent = 'Lanjut menonton ' + ch.name + '? Tekan Enter atau ketuk tombol putar.';
  updateNow(); markPlaying();
}

var osdTimer;
function showOSD(ch, digits) {
  if (ch && ch.isVod) {
    el.osdNo.textContent = '🎬';
    el.osdName.textContent = ch.name;
    el.osd.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { el.osd.classList.remove('show'); }, 2600);
    return;
  }
  el.osdNo.textContent = digits != null ? digits : ch.no;
  var label = digits != null ? (ch ? ch.name : '') : ch.name;
  if (digits == null && ch) {
    if (ch.sources && ch.sources.length > 1) {
      label += ' (Server ' + ((ch._sourceIndex || 0) + 1) + '/' + ch.sources.length + ')';
    }
    var en = epgNowNext(ch);
    if (en && en.cur) label += ' · ' + en.cur.title;
  }
  el.osdName.textContent = label;
  el.osd.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(function () { el.osd.classList.remove('show'); }, digits != null ? 1600 : 2600);
}

function pushRecent(url) {
  S.recent = [url].concat(S.recent.filter(function (u) { return u !== url; })).slice(0, 30);
  LS.set('recent', S.recent);
}

function zap(dir) {
  if (S.playing && S.playing.isVod && window.ZanVod) {
    if (dir > 0) window.ZanVod.playNextEpisode();
    else window.ZanVod.playPrevEpisode();
    return;
  }
  var list = S.view.length ? S.view : S.channels;
  if (!list.length) return;
  var cur = S.playing || S.cued;
  var idx = cur ? list.indexOf(cur) : -1;
  if (idx < 0 && cur) idx = list.findIndex(function (c) { return c.url === cur.url; });
  var next;
  if (idx < 0 && cur && S.gap && S.gap.url === cur.url && S.gap.idx >= 0) {
    // channel yang sedang dibuka barusan disembunyikan: maju = channel yang kini menempati posisinya
    next = dir > 0 ? S.gap.idx % list.length : (S.gap.idx - 1 + list.length) % list.length;
  } else {
    next = idx < 0 ? (dir > 0 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
  }
  play(list[next]);
  focusRowFor(list[next], false);
}

function toggleFav() {
  var c = S.playing || S.cued;
  if (!c) return;
  if (S.favs.has(c.url)) { S.favs.delete(c.url); toast('Dihapus dari favorit'); }
  else { S.favs.add(c.url); toast('Disimpan ke favorit'); }
  LS.set('favs', Array.from(S.favs));
  updateNow();
  var scroll = el.list.scrollTop;
  refreshView();
  el.list.scrollTop = scroll;
}

function togglePlay() {
  if (!S.playing) { if (S.cued) play(S.cued); else if (S.view[0]) play(S.view[0]); return; }
  if (el.video.paused) el.video.play().catch(function () {}); else el.video.pause();
}
function syncPlay() {
  el.playIcon.innerHTML = el.video.paused ? '<path d="M7 5v14l12-7z"/>' : '<path d="M8 5v14M16 5v14"/>';
}
function syncMute() {
  var m = el.video.muted || el.video.volume === 0;
  el.muteIcon.innerHTML = m ? '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>' : '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/>';
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.body.classList.contains('stage-theater-fullscreen'));
}

function enterFullscreen() {
  if (isFullscreen()) return;
  var isVert = isVerticalVideo();
  var req = el.stage.requestFullscreen || el.stage.webkitRequestFullscreen;
  if (req) {
    try {
      var p = req.call(el.stage);
      if (p && p.then) {
        p.then(function () {
          if (isVert) {
            lockPortrait();
          } else {
            lockLandscape();
          }
        }).catch(function () {
          document.body.classList.add('stage-theater-fullscreen');
        });
      }
    } catch (e) {
      document.body.classList.add('stage-theater-fullscreen');
    }
  } else if (el.video && el.video.webkitEnterFullscreen) {
    try { el.video.webkitEnterFullscreen(); } catch (e) {}
  } else {
    document.body.classList.add('stage-theater-fullscreen');
  }
}

function exitFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch (e) {}
  }
  document.body.classList.remove('stage-theater-fullscreen');
  unlockOrientation();
}

function toggleFullscreen() {
  if (isFullscreen()) {
    exitFullscreen();
  } else {
    enterFullscreen();
  }
}

function lockLandscape() {
  try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {}
}

function lockPortrait() {
  try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('portrait').catch(function () {}); } catch (e) {}
}

function unlockOrientation() {
  try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
}

/* Event sync saat fullscreen berubah atau ESC ditekan */
document.addEventListener('fullscreenchange', function () {
  if (!document.fullscreenElement) {
    document.body.classList.remove('stage-theater-fullscreen');
    unlockOrientation();
  }
});
document.addEventListener('webkitfullscreenchange', function () {
  if (!document.webkitFullscreenElement) {
    document.body.classList.remove('stage-theater-fullscreen');
    unlockOrientation();
  }
});
window.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && document.body.classList.contains('stage-theater-fullscreen')) {
    exitFullscreen();
  }
});

/* Rotasi Otomatis (Landscape -> Fullscreen, Portrait -> Tampilan Asli) */
(function initAutoFullscreenOnRotate() {
  var prevOrientation = null;

  function getOrientation() {
    if (screen.orientation && screen.orientation.type) {
      return screen.orientation.type.indexOf('landscape') === 0 ? 'landscape' : 'portrait';
    }
    if (window.matchMedia) {
      return window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
    }
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  }

  function handleOrientation() {
    var current = getOrientation();
    var isVert = isVerticalVideo();
    if (prevOrientation && prevOrientation !== current) {
      if (current === 'landscape') {
        // Hanya video horizontal yang auto-fullscreen saat landscape
        if ((S.playing || S.cued) && !isVert) {
          enterFullscreen();
          toast('Mode Landscape: Layar penuh otomatis');
        }
      } else if (current === 'portrait') {
        // Jangan keluar fullscreen kalau lagi nonton video vertikal (Dracin) di HP!
        if (isFullscreen() && !isVert) {
          exitFullscreen();
          toast('Mode Portrait: Kembali ke tampilan normal');
        }
      }
    }
    prevOrientation = current;
  }

  prevOrientation = getOrientation();

  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', handleOrientation);
  } else {
    window.addEventListener('orientationchange', handleOrientation);
  }

  if (window.matchMedia) {
    try {
      var mql = window.matchMedia('(orientation: landscape)');
      if (mql.addEventListener) {
        mql.addEventListener('change', handleOrientation);
      } else if (mql.addListener) {
        mql.addListener(handleOrientation);
      }
    } catch (e) {}
  }
})();

/* sembunyikan kontrol saat diam */
var idleUiTimer;
function isPlayerPopOpen() {
  var cm = $('#ccMenu'), qm = $('#qualMenu');
  return !!((cm && !cm.hidden) || (qm && !qm.hidden));
}
function closePlayerPops() {
  var cm = $('#ccMenu'), qm = $('#qualMenu');
  if (cm) cm.hidden = true;
  if (qm) qm.hidden = true;
}
function wakeUi() {
  el.stage.classList.remove('idle-ui');
  clearTimeout(idleUiTimer);
  idleUiTimer = setTimeout(function () {
    if (S.playing && !el.video.paused && !isPlayerPopOpen()) el.stage.classList.add('idle-ui');
  }, 3000);
}
['mousemove', 'touchstart', 'keydown'].forEach(function (ev) { el.stage.addEventListener(ev, wakeUi, { passive: true }); });

/* ------------------------------------------------------------------ */
/* Navigasi remote / keyboard                                          */
/* ------------------------------------------------------------------ */
function rows() { return el.list.querySelectorAll('.row'); }
function focusRowFor(ch, move) {
  var r = rows();
  for (var i = 0; i < r.length; i++) {
    if (S.view[+r[i].dataset.i] === ch) {
      r[i].scrollIntoView({ block: 'nearest' });
      if (move) r[i].focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}
function groupsVertical() { return getComputedStyle(el.groups).flexDirection === 'column'; }
function focusActiveGroup() {
  var g = el.groups.querySelector('[aria-pressed="true"]') || el.groups.querySelector('.grp');
  if (g) { g.focus(); g.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}
function focusList() {
  var cur = S.playing || S.cued;
  if (cur && focusRowFor(cur, true)) return;
  var r = rows()[0];
  if (r) r.focus();
}

var digitBuf = '', digitTimer;
function typeDigit(d) {
  digitBuf = (digitBuf + d).slice(-4);
  var n = parseInt(digitBuf, 10);
  var ch = S.channels[n - 1];
  showOSD(ch, digitBuf);
  clearTimeout(digitTimer);
  digitTimer = setTimeout(function () {
    digitBuf = '';
    if (ch) play(ch); else toast('Channel nomor ' + n + ' tidak ada');
  }, 1300);
}

document.addEventListener('keydown', function (e) {
  var t = e.target;
  var k = e.key;
  var inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  if (el.dialog.open || $('#acctDialog').open || $('#actDialog').open || !$('#gate').hidden) return;
  if (k === 'Escape' && isPlayerPopOpen()) { e.preventDefault(); closePlayerPops(); return; }

  if (inInput) {
    if (t === el.search && (k === 'ArrowDown' || k === 'Enter')) { e.preventDefault(); focusList(); }
    else if (t === el.search && k === 'Escape') { el.search.value = ''; S.query = ''; refreshView(); }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  /* tombol yang berlaku di mana saja */
  if (k === 'ChannelUp' || k === 'PageUp') { e.preventDefault(); zap(1); return; }
  if (k === 'ChannelDown' || k === 'PageDown') { e.preventDefault(); zap(-1); return; }
  if (/^[0-9]$/.test(k)) { e.preventDefault(); typeDigit(k); return; }
  if (k === '/') { e.preventDefault(); unlockSearch(); el.search.focus(); return; }
  if (k === 'f' || k === 'F') { e.preventDefault(); toggleFullscreen(); return; }
  if (k === 'z' || k === 'Z') { e.preventDefault(); if (isVerticalVideo()) toggleFitMode(); return; }
  if (k === 'c' || k === 'C') { e.preventDefault(); setCcMode(CC.mode === 'off' ? 'id' : 'off'); return; }
  if (k === 's' || k === 'S' || k === 'ContextMenu') { e.preventDefault(); toggleFav(); return; }
  if (k === 'm' || k === 'M') { el.video.muted = !el.video.muted; return; }
  if (k === 'MediaPlayPause') { togglePlay(); return; }

  var inStage = el.stage.contains(t) || isFullscreen();
  var row = t.closest && t.closest('.row');
  var grp = t.closest && t.closest('.grp');

  if (inStage) {
    if (t.classList && t.classList.contains('ic') && (k === 'ArrowLeft' || k === 'ArrowRight') && !isFullscreen()) {
      var btns = Array.prototype.slice.call(el.stage.querySelectorAll('.controls .ic'));
      var bi = btns.indexOf(t) + (k === 'ArrowRight' ? 1 : -1);
      e.preventDefault();
      if (bi >= 0 && bi < btns.length) btns[bi].focus(); else el.stage.focus();
      return;
    }
    if (k === 'ArrowUp') { e.preventDefault(); zap(1); return; }
    if (k === 'ArrowDown') { e.preventDefault(); zap(-1); return; }
    if (k === 'ArrowLeft' && !isFullscreen()) { e.preventDefault(); focusList(); return; }
    if (k === 'ArrowRight' && t === el.stage && !isFullscreen()) { e.preventDefault(); var b0 = el.stage.querySelector('.controls .ic'); if (b0) b0.focus(); return; }
    if ((k === 'Enter' || k === ' ') && t === el.stage) {
      e.preventDefault();
      if (!S.playing) togglePlay(); else if (k === ' ') togglePlay(); else toggleFullscreen();
      return;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { showOSD(S.playing || S.cued || { no: '', name: '' }); }
    return;
  }

  if (row) {
    var list = rows(), i = Array.prototype.indexOf.call(list, row);
    if (k === 'ArrowDown') { e.preventDefault(); if (list[i + 1]) list[i + 1].focus(); }
    else if (k === 'ArrowUp') {
      e.preventDefault();
      if (list[i - 1]) list[i - 1].focus();
      else if (!groupsVertical()) focusActiveGroup(); else el.search.focus();
    }
    else if (k === 'ArrowLeft') { e.preventDefault(); if (groupsVertical()) focusActiveGroup(); }
    else if (k === 'ArrowRight') { e.preventDefault(); el.stage.focus(); }
    return;
  }

  if (grp) {
    var gs = el.groups.querySelectorAll('.grp'), gi = Array.prototype.indexOf.call(gs, grp);
    var vertical = groupsVertical();
    var prevKey = vertical ? 'ArrowUp' : 'ArrowLeft', nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    if (k === nextKey) { e.preventDefault(); if (gs[gi + 1]) { gs[gi + 1].focus(); gs[gi + 1].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } }
    else if (k === prevKey) { e.preventDefault(); if (gs[gi - 1]) { gs[gi - 1].focus(); gs[gi - 1].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } else el.search.focus(); }
    else if ((vertical && k === 'ArrowRight') || (!vertical && k === 'ArrowDown')) { e.preventDefault(); focusList(); }
    else if (!vertical && k === 'ArrowUp') { e.preventDefault(); el.search.focus(); }
    return;
  }

  /* belum ada fokus sama sekali (misalnya baru buka di TV) */
  if (/^Arrow/.test(k) && (t === document.body || !t)) { e.preventDefault(); focusList(); }
});

/* ------------------------------------------------------------------ */
/* Event UI                                                            */
/* ------------------------------------------------------------------ */
el.groups.addEventListener('click', function (e) {
  var b = e.target.closest('.grp');
  if (!b) return;
  S.group = b.dataset.g;
  computeView(); renderList();
  Array.prototype.forEach.call(el.groups.querySelectorAll('.grp'), function (x) {
    x.setAttribute('aria-pressed', String(x === b));
  });
  el.list.scrollTop = 0;
});

el.list.addEventListener('click', function (e) {
  var act = e.target.closest('[data-act]');
  if (act) {
    var a = act.dataset.act;
    if (a === 'open-dialog') openDialog();
    else if (a === 'reload') { S.listError = ''; renderList(); fetchPlaylists(true); }
    else if (a === 'example' && isAdmin()) adminAdd({ name: 'TV Indonesia (iptv-org)', url: EXAMPLE_URL });
    return;
  }
  var r = e.target.closest('.row');
  if (!r) return;
  var ch = S.view[+r.dataset.i];
  if (!ch) return;
  if (S.playing === ch && el.msg.hidden) { el.stage.focus(); return; }
  play(ch);
  if (window.matchMedia('(max-width: 860px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* Kolom cari: cegah browser mengisi otomatis nama pengguna ke sini.
   - readonly sampai benar-benar disentuh/difokus pengguna
   - isian yang datang saat kolom tidak sedang difokus dianggap autofill dan dibuang */
function unlockSearch() { el.search.removeAttribute('readonly'); }
el.search.addEventListener('pointerdown', unlockSearch);
el.search.addEventListener('focus', unlockSearch);
el.search.addEventListener('blur', function () { if (!el.search.value) el.search.setAttribute('readonly', ''); });
function clearSearch() {
  el.search.value = '';
  if (S.query) { S.query = ''; computeView(); renderList(); }
}
el.search.addEventListener('input', debounce(function () {
  if (document.activeElement !== el.search) { clearSearch(); return; }
  S.query = el.search.value;
  computeView(); renderList();
  el.list.scrollTop = 0;
}, 120));

$('#playBtn').addEventListener('click', togglePlay);
$('#prevBtn').addEventListener('click', function () { zap(-1); });
$('#nextChBtn').addEventListener('click', function () { zap(1); });
$('#muteBtn').addEventListener('click', function () { el.video.muted = !el.video.muted; if (!el.video.muted && el.video.volume === 0) el.video.volume = 1; });
el.favBtn.addEventListener('click', toggleFav);
$('#fsBtn').addEventListener('click', toggleFullscreen);
function toggleFitMode() {
  var isCover = el.stage.classList.toggle('is-fit-cover');
  var btn = $('#fitBtn');
  if (btn) {
    btn.classList.toggle('is-active', isCover);
    btn.title = isCover ? 'Mode Layar: Penuh HP (Cover) - Klik untuk Muat Pas (Fit)' : 'Mode Layar: Muat Pas (Fit) - Klik untuk Penuh Layar (Cover)';
  }
  toast(isCover ? 'Layar Penuh HP (Edge-to-Edge)' : 'Layar Muat Utuh (Fit Original)');
}
var fitBtnEl = $('#fitBtn');
if (fitBtnEl) fitBtnEl.addEventListener('click', toggleFitMode);
$('#pipBtn').addEventListener('click', function () {
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () {});
  else if (el.video.requestPictureInPicture) el.video.requestPictureInPicture().catch(function () { toast('Picture-in-picture belum tersedia untuk channel ini'); });
  else toast('Browser ini belum mendukung picture-in-picture');
});
if (!document.pictureInPictureEnabled) $('#pipBtn').hidden = true;

(function initCcAndQualityUi() {
  var ccBtn = $('#ccBtn'), ccMenu = $('#ccMenu'), ccList = $('#ccTargetList'), ccSrc = $('#ccSrcLang');
  var qualBtn = $('#qualBtn'), qualMenu = $('#qualMenu'), qualList = $('#qualList');
  updateCcUi();
  updateQualBadge();
  renderQualMenu();

  if (ccBtn && ccMenu) {
    ccBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var nextOpen = ccMenu.hidden;
      closePlayerPops();
      ccMenu.hidden = !nextOpen;
      if (nextOpen) { updateCcUi(); wakeUi(); }
    });
  }
  if (ccList) {
    ccList.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cc-target]');
      if (!b) return;
      setCcMode(b.getAttribute('data-cc-target') || 'off');
      if (ccMenu) ccMenu.hidden = true;
    });
  }
  if (ccSrc) {
    ccSrc.addEventListener('change', function () {
      CC.srcLang = ccSrc.value || 'en-US';
      LS.set('cc-src', CC.srcLang);
      if (CC.srRunning) {
        stopSpeechCc();
        startSpeechCc();
      }
      toast('Bahasa sumber dialog disetel ke ' + (ccSrc.options[ccSrc.selectedIndex] ? ccSrc.options[ccSrc.selectedIndex].text : CC.srcLang));
    });
  }
  if (qualBtn && qualMenu) {
    qualBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var nextOpen = qualMenu.hidden;
      closePlayerPops();
      qualMenu.hidden = !nextOpen;
      if (nextOpen) { renderQualMenu(); updateQualBadge(); wakeUi(); }
    });
  }
  if (qualList) {
    qualList.addEventListener('click', function (e) {
      var sBtn = e.target.closest('[data-source-idx]');
      if (sBtn) {
        var sIdx = parseInt(sBtn.getAttribute('data-source-idx') || '0', 10);
        if (S.playing) {
          toast('Beralih ke Server ' + (sIdx + 1) + '…');
          play(S.playing, { sourceIndex: sIdx });
        }
        if (qualMenu) qualMenu.hidden = true;
        return;
      }
      var b = e.target.closest('[data-qmode]');
      if (!b) return;
      var qmode = b.getAttribute('data-qmode') || 'auto';
      var level = parseInt(b.getAttribute('data-level') || '-1', 10);
      var sq = parseInt(b.getAttribute('data-sq') || '0', 10);
      selectQualityOption(qmode, level, sq);
      if (qualMenu) qualMenu.hidden = true;
    });
  }
  document.addEventListener('click', function (e) {
    if (!isPlayerPopOpen()) return;
    if (e.target.closest && e.target.closest('#ccMenu, #qualMenu, #ccBtn, #qualBtn')) return;
    closePlayerPops();
  });
})();

$('#retryBtn').addEventListener('click', function () { if (S.playing) play(S.playing); });
$('#nextBtn').addEventListener('click', function () { zap(1); });
$('#copyBtn').addEventListener('click', function () {
  if (!S.playing) return;
  var url = S.playing.url;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function () { toast('Alamat stream disalin. Tempel di VLC: Media, Buka Aliran Jaringan.'); })
      .catch(function () { prompt('Salin alamat ini:', url); });
  } else prompt('Salin alamat ini:', url);
});
el.stage.addEventListener('dblclick', function (e) {
  if (e.target.closest('.controls, .msg, .player-pop')) return;
  if (isFullscreen() && isVerticalVideo()) {
    toggleFitMode();
  } else {
    toggleFullscreen();
  }
});
el.idle.addEventListener('click', function () { if (S.cued) play(S.cued); });

/* geser naik/turun di layar sentuh = ganti channel */
(function () {
  var y0 = null, x0 = null, t0 = 0;
  el.stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || e.target.closest('.controls, .msg, .player-pop')) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = Date.now();
  }, { passive: true });
  el.stage.addEventListener('touchend', function (e) {
    if (y0 == null) return;
    var dy = e.changedTouches[0].clientY - y0, dx = e.changedTouches[0].clientX - x0;
    y0 = null;
    if (Date.now() - t0 < 600 && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) zap(dy < 0 ? 1 : -1);
  }, { passive: true });
})();

$('#refreshBtn').addEventListener('click', function () { fetchPlaylists(false); });
$('#plRefresh').addEventListener('click', function () { el.dialog.close(); fetchPlaylists(false); });
$('#plUnblock').addEventListener('click', function () {
  if (confirm('Tampilkan lagi semua channel yang ditandai DRM/geo-lock untuk semua pengguna? Channel yang memang terkunci akan otomatis tersembunyi lagi begitu dibuka.')) restoreBlocked();
});
$('#playlistBtn').addEventListener('click', openDialog);
$('#acctBtn').addEventListener('click', openAccount);

/* ------------------------------------------------------------------ */
/* Dialog playlist                                                     */
/* ------------------------------------------------------------------ */
var ICON_DEL = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg>';
var ICON_EDIT = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>';
var ICON_REFRESH = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>';

function renderEpgStatus() {
  var st = $('#epgStatus');
  var tools = $('#epgActiveTools');
  var refBtn = $('#epgRefreshBtn');
  if (!st) return;
  if (EPG.meta) {
    var m = EPG.meta;
    st.textContent = 'EPG aktif: ' + (m.channelCount || 0) + ' channel · ' + (m.programmeCount || 0) + ' acara (' +
      (m.kind === 'file' ? 'dari file ' + m.source : m.source) + ')';
    if (tools) tools.hidden = !isAdmin();
    if (refBtn) refBtn.hidden = m.kind !== 'url';
  } else {
    st.textContent = 'Belum ada EPG aktif. Jika header M3U memiliki atribut url-tvg, server akan mengambilnya otomatis.';
    if (tools) tools.hidden = true;
  }
}

function renderPlaylistDialog() {
  $('#plAdmin').hidden = !isAdmin();
  renderEpgStatus();
  var nBlocked = Object.keys(BLOCKED).length;
  var ub = $('#plUnblock');
  if (ub) {
    ub.hidden = !isAdmin() || !nBlocked;
    ub.textContent = 'Tampilkan lagi ' + nBlocked + ' channel terkunci';
  }
  if (!S.playlists.length) {
    el.plList.innerHTML = '<li class="hint" style="padding:4px 10px 0">Belum ada playlist.</li>';
    return;
  }
  el.plList.innerHTML = S.playlists.map(function (p) {
    var meta = p.count + ' channel, ' + (p.kind === 'file' ? 'dari file ' + p.source : p.source);
    if (p.referer) meta += ' · Referer: ' + p.referer;
    if (p.httpsChecked) meta += (p.httpLeft ? ' · ' + p.httpLeft + ' alamat masih http' : ' · semua https');
    else if (p.httpsChecked === 0 || p.httpsChecked === undefined) meta += ' · sedang dicek https…';
    var tools = isAdmin()
      ? '<button class="ic" data-edit="' + esc(p.id) + '" aria-label="Ubah ' + esc(p.name) + '" title="Ubah nama, alamat, atau header">' + ICON_EDIT + '</button>' +
        (p.kind === 'url' ? '<button class="ic" data-refresh="' + esc(p.id) + '" aria-label="Perbarui ' + esc(p.name) + '" title="Ambil ulang dari alamatnya">' + ICON_REFRESH + '</button>' : '') +
        '<button class="ic" data-del="' + esc(p.id) + '" aria-label="Hapus playlist ' + esc(p.name) + '" title="Hapus">' + ICON_DEL + '</button>'
      : '';
    return '<li><button class="pl-item" data-id="' + esc(p.id) + '" aria-current="' + (p.id === S.activeId) + '"><strong>' +
      esc(p.name) + '</strong><span>' + esc(isAdmin() ? meta : p.count + ' channel') + '</span></button>' + tools + '</li>';
  }).join('');
}
function openEdit(id, li) {
  var p = S.playlists.filter(function (x) { return x.id === id; })[0];
  if (!p || !li) return;
  li.className = 'is-editing';
  li.innerHTML = '<form class="pl-edit">' +
    '<label>Nama<input name="name" value="' + esc(p.name) + '" maxlength="80" required></label>' +
    '<label>Alamat playlist' + (p.kind === 'file' ? ' (kosongkan kalau tetap dari file)' : '') +
    '<input name="url" type="url" inputmode="url" placeholder="https://contoh.com/playlist.m3u" value="' + esc(p.kind === 'url' ? p.source : '') + '"></label>' +
    '<label>Header Referer (opsional)<input name="referer" type="url" inputmode="url" placeholder="https://domain-asal.com/" value="' + esc(p.referer || '') + '"></label>' +
    '<label>Header User-Agent (opsional)<input name="userAgent" placeholder="Kosongkan untuk bawaan" value="' + esc(p.userAgent || '') + '"></label>' +
    '<p class="hint">Jika Referer/User-Agent diisi (atau ada #EXTVLCOPT di M3U), stream otomatis di-relay oleh server ZanTV dengan header tersebut.</p>' +
    '<div class="pl-edit-actions"><button class="btn primary" type="submit">Simpan</button><button class="btn ghost" type="button" data-cancel>Batal</button></div></form>';
  var form = li.querySelector('form');
  form.elements.name.focus();
  form.querySelector('[data-cancel]').addEventListener('click', renderPlaylistDialog);
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = form.elements.name.value.trim();
    var url = form.elements.url.value.trim();
    var referer = form.elements.referer.value.trim();
    var userAgent = form.elements.userAgent.value.trim();
    if (!name) { toast('Nama playlist tidak boleh kosong'); return; }
    if (url && !/^https?:\/\//i.test(url)) { toast('Alamat harus diawali http:// atau https://'); return; }
    var body = { name: name, referer: referer, userAgent: userAgent };
    if (url && url !== p.source) body.url = url;
    var btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    if (body.url) toast('Mengambil playlist dari alamat baru…');
    api('PATCH', '/api/playlists/' + id, body).then(function (np) {
      S.playlists = S.playlists.map(function (x) { return x.id === np.id ? np : x; });
      renderPlaylistDialog();
      setPlaylistLabel();
      toast(body.url ? 'Disimpan: ' + np.count + ' channel dari alamat baru' : 'Pengaturan playlist disimpan');
      if (np.id === S.activeId) loadPlaylist(np);
      if (body.url) setTimeout(fetchEPG, 2000);
    }).catch(function (err) { btn.disabled = false; toast(err.message); });
  });
}
function openDialog() {
  renderPlaylistDialog();
  el.dialog.showModal();
}
el.dialog.addEventListener('cancel', function (e) {
  if (el.plList.querySelector('.pl-edit')) { e.preventDefault(); renderPlaylistDialog(); }
});
el.plList.addEventListener('click', function (e) {
  var del = e.target.closest('[data-del]');
  var ref = e.target.closest('[data-refresh]');
  if (del) {
    var p = S.playlists.filter(function (x) { return x.id === del.dataset.del; })[0];
    if (p && confirm('Hapus playlist "' + p.name + '" untuk semua pengguna?')) adminDelete(p.id);
    return;
  }
  if (ref) { adminRefresh(ref.dataset.refresh); return; }
  var ed = e.target.closest('[data-edit]');
  if (ed) { openEdit(ed.dataset.edit, ed.closest('li')); return; }
  if (e.target.closest('.pl-edit')) return;
  var it = e.target.closest('.pl-item');
  if (it) { el.dialog.close(); if (it.dataset.id !== S.activeId) activate(it.dataset.id); }
});
$('#plAddUrl').addEventListener('click', function () {
  var url = $('#plUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { toast('Masukkan alamat yang diawali http:// atau https://'); $('#plUrl').focus(); return; }
  var name = $('#plName').value.trim();
  var referer = ($('#plRef') && $('#plRef').value.trim()) || '';
  var userAgent = ($('#plUa') && $('#plUa').value.trim()) || '';
  $('#plUrl').value = ''; $('#plName').value = '';
  if ($('#plRef')) $('#plRef').value = '';
  if ($('#plUa')) $('#plUa').value = '';
  adminAdd({ name: name, url: url, referer: referer, userAgent: userAgent }).then(function () { setTimeout(fetchEPG, 2500); });
});
$('#plFile').addEventListener('change', function (e) {
  var f = e.target.files && e.target.files[0];
  if (!f) return;
  f.text().then(function (text) {
    if (!parseM3U(text).length) { toast('File ini tidak berisi channel M3U'); return; }
    var name = $('#plName').value.trim() || f.name.replace(/\.(m3u8?|txt)$/i, '');
    var referer = ($('#plRef') && $('#plRef').value.trim()) || '';
    var userAgent = ($('#plUa') && $('#plUa').value.trim()) || '';
    $('#plName').value = '';
    if ($('#plRef')) $('#plRef').value = '';
    if ($('#plUa')) $('#plUa').value = '';
    adminAdd({ name: name, filename: f.name, text: text, referer: referer, userAgent: userAgent }).then(function () { setTimeout(fetchEPG, 2500); });
  });
  e.target.value = '';
});

/* Aksi Admin EPG + Dialog Jadwal Acara */
$('#epgAddUrl').addEventListener('click', function () {
  var url = $('#epgUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { toast('Masukkan alamat EPG (.xml / .xml.gz) yang diawali http:// atau https://'); $('#epgUrl').focus(); return; }
  var btn = $('#epgAddUrl');
  btn.disabled = true;
  toast('Mengambil dan memproses jadwal EPG dari server…');
  api('POST', '/api/epg', { url: url }).then(function (meta) {
    $('#epgUrl').value = '';
    toast('EPG aktif: ' + meta.channelCount + ' channel, ' + meta.programmeCount + ' acara');
    return fetchEPG();
  }).catch(function (err) { toast(err.message); }).then(function () { btn.disabled = false; });
});

$('#epgFile').addEventListener('change', function (e) {
  var f = e.target.files && e.target.files[0];
  if (!f) return;
  toast('Mengunggah dan memproses file EPG…');
  var reader = new FileReader();
  reader.onload = function () {
    var res = String(reader.result || '');
    var comma = res.indexOf(',');
    var b64 = comma >= 0 ? res.slice(comma + 1) : '';
    api('POST', '/api/epg', { filename: f.name, base64: b64 }).then(function (meta) {
      toast('EPG dari file aktif: ' + meta.channelCount + ' channel, ' + meta.programmeCount + ' acara');
      return fetchEPG();
    }).catch(function (err) { toast(err.message); });
  };
  reader.readAsDataURL(f);
  e.target.value = '';
});

$('#epgRefreshBtn').addEventListener('click', function () {
  toast('Memperbarui jadwal EPG…');
  api('POST', '/api/epg/refresh').then(function (meta) {
    toast('EPG diperbarui: ' + meta.channelCount + ' channel, ' + meta.programmeCount + ' acara');
    return fetchEPG();
  }).catch(function (err) { toast(err.message); });
});

$('#epgDelBtn').addEventListener('click', function () {
  if (!confirm('Hapus jadwal acara EPG untuk semua pengguna?')) return;
  api('DELETE', '/api/epg').then(function () {
    EPG = { meta: null, channels: {}, chNames: {}, aliases: {} };
    renderList();
    updateNow();
    renderEpgStatus();
    toast('EPG dihapus');
  }).catch(function (err) { toast(err.message); });
});

var epgDlg = $('#epgDialog');
function openEpgDialog() {
  if (!epgDlg) return;
  var c = S.playing || S.cued;
  var titleEl = $('#epgDialogTitle');
  var listEl = $('#epgModalList');
  var now = Date.now();
  var progs = c ? epgForChannel(c) : null;

  if (c && progs && progs.length) {
    titleEl.textContent = 'Jadwal Acara · ' + c.name;
    listEl.innerHTML = progs.map(function (p) {
      var isLive = p.start <= now && p.stop > now;
      var pct = isLive ? Math.max(3, Math.min(100, Math.round((now - p.start) / Math.max(1, p.stop - p.start) * 100))) : 0;
      return '<div class="epg-card' + (isLive ? ' is-live' : '') + '">' +
        '<div class="epg-card-head">' +
          '<span class="epg-card-time">' + esc(fmtClockWib(p.start) + ' – ' + fmtClockWib(p.stop) + ' WIB') + '</span>' +
          (isLive ? '<span class="ticker-live-badge"><span class="ticker-live-dot"></span>SEDANG TAYANG</span>' : (p.cat ? '<span class="epg-card-cat">' + esc(p.cat) + '</span>' : '')) +
        '</div>' +
        '<strong class="epg-card-title">' + esc(p.title) + '</strong>' +
        (p.desc ? '<p class="epg-card-desc">' + esc(p.desc) + '</p>' : '') +
        (isLive ? '<div class="now-epg-bar"><i style="width:' + pct + '%"></i></div>' : '') +
      '</div>';
    }).join('');
  } else if (EPG.meta && EPG.channels) {
    titleEl.textContent = 'Jadwal Acara TV (EPG)';
    var keys = Object.keys(EPG.channels);
    listEl.innerHTML = keys.slice(0, 60).map(function (k) {
      var arr = EPG.channels[k] || [];
      if (!arr.length) return '';
      var cur = arr[0];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].start <= now && arr[i].stop > now) { cur = arr[i]; break; }
      }
      var chTitle = (EPG.chNames && EPG.chNames[k]) || k;
      return '<div class="epg-card">' +
        '<div class="epg-card-head"><span class="epg-card-cat">' + esc(chTitle) + '</span><span class="epg-card-time">' + esc(fmtClockWib(cur.start) + ' – ' + fmtClockWib(cur.stop) + ' WIB') + '</span></div>' +
        '<strong class="epg-card-title">' + esc(cur.title) + '</strong>' +
        (cur.desc ? '<p class="epg-card-desc">' + esc(cur.desc) + '</p>' : '') +
      '</div>';
    }).join('') || '<p class="hint">Tidak ada jadwal acara untuk ditampilkan.</p>';
  } else {
    titleEl.textContent = 'Jadwal Acara TV (EPG)';
    listEl.innerHTML = '<p class="hint">Belum ada data EPG yang cocok untuk channel ini.</p>';
  }
  epgDlg.showModal();
}

if ($('#epgGuideBtn')) $('#epgGuideBtn').addEventListener('click', openEpgDialog);
if ($('#epgDialogClose')) $('#epgDialogClose').addEventListener('click', function () { epgDlg.close(); });
if (epgDlg) epgDlg.addEventListener('click', function (e) { if (e.target === epgDlg) epgDlg.close(); });

/* ------------------------------------------------------------------ */
/* Dialog akun & pengguna                                              */
/* ------------------------------------------------------------------ */
var acct = $('#acctDialog');
function roleLabel(r) { return r === 'admin' ? 'Admin' : 'User'; }
function openAccount() {
  $('#acctName').textContent = ME ? ME.name : '';
  $('#acctRole').textContent = ME ? roleLabel(ME.role) : '';
  $('#adminUsers').hidden = !isAdmin();
  $('#openActivity').hidden = !isAdmin();
  syncLocToggle();
  if (isAdmin()) loadUsers();
  acct.showModal();
}
function mapsUrl(lat, lng) {
  return 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng);
}
function loadUsers() {
  var ul = $('#userList');
  ul.innerHTML = '<li class="hint" style="padding:4px 10px 0">Memuat…</li>';
  api('GET', '/api/users').then(function (users) {
    ul.innerHTML = users.map(function (u) {
      var self = ME && u.name === ME.name;
      var topHtml =
        '<div class="user-item-top">' +
          '<div class="pl-item"><strong>' + esc(u.name) + (self ? ' (kamu)' : '') + '</strong><span>' + roleLabel(u.role) +
            (u.role === 'admin' ? ': bebas GPS & kelola sistem' : ': multi-user dengan whitelist titik GPS') + '</span></div>' +
          '<div class="user-item-actions">' +
            '<button class="ic" data-pw="' + esc(u.name) + '" title="Atur ulang kata sandi" aria-label="Atur ulang kata sandi ' + esc(u.name) + '">' +
              '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></button>' +
            (self ? '' : '<button class="ic" data-deluser="' + esc(u.name) + '" title="Hapus" aria-label="Hapus pengguna ' + esc(u.name) + '">' + ICON_DEL + '</button>') +
          '</div>' +
        '</div>';

      if (u.role === 'admin') {
        return '<li class="user-item">' + topHtml +
          '<div class="user-gps-box"><div class="user-gps-status"><span class="user-gps-badge is-ok">🔓 Bebas GPS (Admin)</span><span>Dapat login dari perangkat & lokasi mana saja.</span></div></div>' +
        '</li>';
      }

      var gpsList = Array.isArray(u.gpsList) ? u.gpsList : [];
      var pendingList = Array.isArray(u.pendingGpsList) ? u.pendingGpsList : [];
      var rad = u.gpsRadius || 2000;

      var statusHtml = '';
      if (gpsList.length > 0) {
        statusHtml = '<span class="user-gps-badge is-ok">📍 ' + gpsList.length + ' Titik GPS User Terdaftar</span>' +
          '<span>Hanya perangkat di dalam titik GPS berikut yang diizinkan masuk:</span>';
      } else {
        statusHtml = '<span class="user-gps-badge is-warn">⛔ Belum Ada Titik GPS Terdaftar</span>' +
          '<span>Semua login ke akun ini ditolak sampai titik GPS ditambahkan / disetujui.</span>';
      }
      if (u.gpsAutoBind) {
        statusHtml += ' <span class="user-gps-badge is-Wait">🔄 Auto-Tambah 1 User Baru Aktif</span>';
      }

      var itemsHtml = '';
      if (gpsList.length > 0) {
        itemsHtml = '<div class="user-gps-items">' + gpsList.map(function (g, idx) {
          var coordStr = g.lat + ', ' + g.lng;
          var gRad = g.radius || rad;
          var devStr = g.lastDevice ? fmtDevice(g.lastDevice) : '';
          return '<div class="user-gps-entry">' +
            '<div class="user-gps-entry-info">' +
              '<strong>👤 ' + esc(g.label || ('User #' + (idx + 1))) + '</strong>' +
              '<span><a class="user-gps-link" href="' + esc(mapsUrl(g.lat, g.lng)) + '" target="_blank" rel="noopener">' + esc(coordStr) + '</a> · radius <b>' + esc(gRad) + ' m</b>' +
                (devStr ? ' · <small>' + esc(devStr) + '</small>' : '') +
              '</span>' +
            '</div>' +
            '<div class="user-gps-entry-btns">' +
              '<button class="btn ghost" type="button" data-gps-edit="' + esc(u.name) + '" data-id="' + esc(g.id) + '" data-label="' + esc(g.label || '') + '" data-lat="' + esc(g.lat) + '" data-lng="' + esc(g.lng) + '" data-rad="' + esc(gRad) + '" title="Ubah nama/koordinat/radius">✏️ Ubah</button>' +
              '<button class="btn ghost" type="button" data-gps-del-item="' + esc(u.name) + '" data-id="' + esc(g.id) + '" data-label="' + esc(g.label || '') + '" title="Hapus GPS user ini">🗑️ Hapus</button>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
      }

      var pendingHtml = '';
      if (pendingList.length > 0) {
        pendingHtml = '<div class="user-gps-pending-list">' + pendingList.map(function (p) {
          var pCoord = p.lat + ', ' + p.lng;
          var pDev = fmtDevice(p.device);
          return '<div class="user-gps-pending">' +
            '<div class="user-gps-pending-info">' +
              '<strong>🔔 Menunggu Izin Masuk (' + fmtTime(p.at || Date.now()) + ')</strong>' +
              '<span>Koordinat: <a class="user-gps-link" href="' + esc(mapsUrl(p.lat, p.lng)) + '" target="_blank" rel="noopener">' + esc(pCoord) + '</a>' +
                (p.accuracy ? ' (±' + esc(p.accuracy) + 'm)' : '') +
                (pDev ? ' · ' + esc(pDev) : '') +
                (p.ip ? ' · IP ' + esc(p.ip) : '') +
              '</span>' +
            '</div>' +
            '<div class="user-gps-pending-btns">' +
              '<button class="btn primary" type="button" data-gps-approve="' + esc(u.name) + '" data-pid="' + esc(p.id) + '" data-rad="' + esc(rad) + '" data-next="' + (gpsList.length + 1) + '">✓ Setujui & Beri Nama</button>' +
              '<button class="btn ghost" type="button" data-gps-reject="' + esc(u.name) + '" data-pid="' + esc(p.id) + '">✕ Tolak</button>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
      }

      var btnsHtml =
        '<div class="user-gps-btns">' +
          '<button class="btn ghost" type="button" data-gps-add="' + esc(u.name) + '" data-rad="' + esc(rad) + '" data-next="' + (gpsList.length + 1) + '">➕ Tambah Titik GPS User</button>' +
          '<button class="btn ghost" type="button" data-gps-autobind="' + esc(u.name) + '" data-active="' + (u.gpsAutoBind ? '1' : '0') + '" data-rad="' + esc(rad) + '">' +
            (u.gpsAutoBind ? '⏸ Matikan Auto-Tambah' : '🔄 Auto-Tambah 1 Login Berikutnya') +
          '</button>' +
          ((gpsList.length > 0 || pendingList.length > 0) ? '<button class="btn ghost" type="button" data-gps-clear="' + esc(u.name) + '">🚫 Hapus Semua GPS</button>' : '') +
        '</div>';

      return '<li class="user-item">' + topHtml +
        '<div class="user-gps-box">' +
          '<div class="user-gps-status">' + statusHtml + '</div>' +
          itemsHtml +
          pendingHtml +
          btnsHtml +
        '</div>' +
      '</li>';
    }).join('');
  }).catch(function (e) { ul.innerHTML = '<li class="hint" style="padding:4px 10px 0">' + esc(e.message) + '</li>'; });
}
$('#userList').addEventListener('click', function (e) {
  var pw = e.target.closest('[data-pw]');
  var del = e.target.closest('[data-deluser]');
  var appGps = e.target.closest('[data-gps-approve]');
  var rejGps = e.target.closest('[data-gps-reject]');
  var addGps = e.target.closest('[data-gps-add]');
  var editGps = e.target.closest('[data-gps-edit]');
  var delItemGps = e.target.closest('[data-gps-del-item]');
  var autoGps = e.target.closest('[data-gps-autobind]');
  var clrGps = e.target.closest('[data-gps-clear]');
  if (pw) {
    var name = pw.dataset.pw;
    var np = prompt('Kata sandi baru untuk ' + name + ' (minimal 8 karakter):');
    if (np == null) return;
    api('POST', '/api/users/' + encodeURIComponent(name) + '/password', { password: np })
      .then(function () { toast('Kata sandi ' + name + ' diganti. Semua sesi harus masuk ulang.'); })
      .catch(function (err) { toast(err.message); });
  } else if (del) {
    var n = del.dataset.deluser;
    if (!confirm('Hapus pengguna "' + n + '"?')) return;
    api('DELETE', '/api/users/' + encodeURIComponent(n))
      .then(function () { toast('Pengguna ' + n + ' dihapus'); loadUsers(); })
      .catch(function (err) { toast(err.message); });
  } else if (appGps) {
    var uName = appGps.dataset.gpsApprove;
    var pId = appGps.dataset.pid;
    var defRad = appGps.dataset.rad || '2000';
    var defLabel = 'User #' + (appGps.dataset.next || '1');
    var labelIn = prompt('Beri nama / label untuk pemilik titik GPS ini (misal: Rumah Budi / Kosan Andi):', defLabel);
    if (labelIn == null) return;
    var radInput = prompt('Masukkan batas radius izin lokasi dalam meter (misal 2000 = 2 km):', defRad);
    if (radInput == null) return;
    api('POST', '/api/users/' + encodeURIComponent(uName) + '/gps', {
      action: 'approve',
      pendingId: pId,
      label: labelIn.trim() || defLabel,
      radius: +radInput || 2000
    }).then(function () {
      toast('Titik GPS "' + (labelIn.trim() || defLabel) + '" ditambahkan ke database ' + uName);
      loadUsers();
    }).catch(function (err) { toast(err.message); });
  } else if (rejGps) {
    var rName = rejGps.dataset.gpsReject;
    api('POST', '/api/users/' + encodeURIComponent(rName) + '/gps', {
      action: 'reject_pending',
      pendingId: rejGps.dataset.pid
    }).then(function () {
      toast('Permintaan GPS ditolak & dihapus');
      loadUsers();
    }).catch(function (err) { toast(err.message); });
  } else if (addGps) {
    var sName = addGps.dataset.gpsAdd;
    var nextNo = addGps.dataset.next || '1';
    var lbl = prompt('Nama / label untuk user GPS baru di akun "' + sName + '" (contoh: Rumah Budi):', 'User #' + nextNo);
    if (lbl == null) return;
    var coordIn = prompt('Masukkan koordinat GPS (Latitude, Longitude) untuk "' + (lbl || ('User #' + nextNo)) + '"\n(Salin dari Google Maps, contoh: -6.20000, 106.81666):', '');
    if (coordIn == null) return;
    var parts = coordIn.split(/[,\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length < 2 || !Number.isFinite(+parts[0]) || !Number.isFinite(+parts[1])) {
      toast('Format koordinat harus: latitude, longitude (contoh: -6.20000, 106.81666)');
      return;
    }
    var rIn = prompt('Masukkan radius maksimal izin lokasi dalam meter (contoh 2000 = 2 km):', addGps.dataset.rad || '2000');
    if (rIn == null) return;
    api('POST', '/api/users/' + encodeURIComponent(sName) + '/gps', {
      action: 'add',
      label: lbl.trim() || ('User #' + nextNo),
      lat: +parts[0],
      lng: +parts[1],
      radius: +rIn || 2000
    }).then(function () {
      toast('Titik GPS baru ditambahkan ke akun ' + sName);
      loadUsers();
    }).catch(function (err) { toast(err.message); });
  } else if (editGps) {
    var eName = editGps.dataset.gpsEdit;
    var gId = editGps.dataset.id;
    var curLbl = editGps.dataset.label || 'User';
    var newLbl = prompt('Ubah nama / label pemilik titik GPS ini:', curLbl);
    if (newLbl == null) return;
    var defCoord = editGps.dataset.lat + ', ' + editGps.dataset.lng;
    var newCoord = prompt('Ubah koordinat GPS (Latitude, Longitude):', defCoord);
    if (newCoord == null) return;
    var cParts = newCoord.split(/[,\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (cParts.length < 2 || !Number.isFinite(+cParts[0]) || !Number.isFinite(+cParts[1])) {
      toast('Format koordinat harus: latitude, longitude');
      return;
    }
    var newRad = prompt('Ubah batas radius izin lokasi (meter):', editGps.dataset.rad || '2000');
    if (newRad == null) return;
    api('POST', '/api/users/' + encodeURIComponent(eName) + '/gps', {
      action: 'set',
      gpsId: gId,
      label: newLbl.trim() || curLbl,
      lat: +cParts[0],
      lng: +cParts[1],
      radius: +newRad || 2000
    }).then(function () {
      toast('Titik GPS "' + (newLbl.trim() || curLbl) + '" diperbarui');
      loadUsers();
    }).catch(function (err) { toast(err.message); });
  } else if (delItemGps) {
    var dName = delItemGps.dataset.gpsDelItem;
    var dId = delItemGps.dataset.id;
    var dLbl = delItemGps.dataset.label || 'titik GPS ini';
    if (!confirm('Hapus akses GPS untuk "' + dLbl + '" dari akun ' + dName + '?\nPerangkat yang memakai lokasi ini akan langsung dikeluarkan, sedangkan user lain tetap aman.')) return;
    api('POST', '/api/users/' + encodeURIComponent(dName) + '/gps', {
      action: 'delete_item',
      gpsId: dId
    }).then(function () {
      toast('Akses GPS "' + dLbl + '" telah dihapus');
      loadUsers();
    }).catch(function (err) { toast(err.message); });
  } else if (autoGps) {
    var aName = autoGps.dataset.gpsAutobind;
    var isOn = autoGps.dataset.active === '1';
    api('POST', '/api/users/' + encodeURIComponent(aName) + '/gps', {
      action: 'autobind',
      enable: !isOn,
      radius: +autoGps.dataset.rad || 2000
    }).then(function () {
      toast(!isOn ? 'Auto-Tambah aktif: 1 user baru berikutnya yang login akan otomatis ditambahkan ke DB GPS' : 'Auto-Tambah dimatikan');
      loadUsers();
    }).catch(function (err) { toast(err.message); });
  } else if (clrGps) {
    var cName = clrGps.dataset.gpsClear;
    if (!confirm('Hapus SEMUA daftar titik GPS pada akun "' + cName + '"? Semua user yang sedang memakai akun ini akan langsung dikeluarkan.')) return;
    api('POST', '/api/users/' + encodeURIComponent(cName) + '/gps', { action: 'clear' })
      .then(function () { toast('Semua titik GPS pada ' + cName + ' telah dihapus'); loadUsers(); })
      .catch(function (err) { toast(err.message); });
  }
});
if ($('#nuRole')) {
  $('#nuRole').addEventListener('change', function () {
    if ($('#nuGpsBox')) $('#nuGpsBox').hidden = ($('#nuRole').value === 'admin');
  });
}
if ($('#nuGpsMode')) {
  $('#nuGpsMode').addEventListener('change', function () {
    if ($('#nuGpsCoordWrap')) $('#nuGpsCoordWrap').hidden = ($('#nuGpsMode').value !== 'manual');
  });
}
$('#nuAdd').addEventListener('click', function () {
  var role = $('#nuRole').value;
  var gpsMode = $('#nuGpsMode') ? $('#nuGpsMode').value : 'strict';
  var radius = $('#nuGpsRadius') ? (+$('#nuGpsRadius').value || 2000) : 2000;
  var body = {
    username: $('#nuName').value.trim().toLowerCase(),
    password: $('#nuPass').value,
    role: role,
    gpsMode: gpsMode,
    radius: radius
  };
  if (role !== 'admin' && gpsMode === 'manual') {
    var rawC = ($('#nuGpsCoord') ? $('#nuGpsCoord').value : '').trim();
    var p = rawC.split(/[,\s]+/).filter(Boolean);
    if (p.length < 2 || !Number.isFinite(+p[0]) || !Number.isFinite(+p[1])) {
      toast('Masukkan koordinat GPS manual dengan format: latitude, longitude');
      return;
    }
    body.lat = +p[0];
    body.lng = +p[1];
  }
  api('POST', '/api/users', body).then(function (u) {
    $('#nuName').value = ''; $('#nuPass').value = '';
    if ($('#nuGpsCoord')) $('#nuGpsCoord').value = '';
    toast('Pengguna ' + u.name + ' (' + roleLabel(u.role) + ') dibuat');
    loadUsers();
  }).catch(function (err) { toast(err.message); });
});
$('#pwSave').addEventListener('click', function () {
  api('POST', '/api/me/password', { current: $('#pwCur').value, password: $('#pwNew').value }).then(function () {
    $('#pwCur').value = ''; $('#pwNew').value = '';
    toast('Kata sandi diganti. Perangkat lain yang memakai akun ini sudah dikeluarkan.');
  }).catch(function (err) { toast(err.message); });
});
$('#logoutBtn').addEventListener('click', function () {
  acct.close();
  flushWatch();
  api('POST', '/api/logout').catch(function () {}).then(function () { onLoggedOut(); toast('Kamu sudah keluar'); });
});

/* ------------------------------------------------------------------ */
/* Aktivitas pengguna (khusus admin)                                    */
/* ------------------------------------------------------------------ */
var actDlg = $('#actDialog');
var ACT = { before: 0, users: [] };
var ACT_LABEL = {
  login: 'Masuk',
  login_failed: 'Gagal masuk (sandi)',
  login_gps_unregistered: 'Ditolak: GPS belum terdaftar',
  login_gps_mismatch: 'Ditolak: GPS belum terdaftar',
  login_gps_missing: 'Ditolak: Tanpa izin GPS',
  login_fake_gps_heuristic: '🚨 Ditolak: Fake GPS (Akurasi/Mock)',
  login_fake_gps_ip: '🚨 Ditolak: Fake GPS (VPN/IP)',
  login_fake_gps_teleport: '🚨 Ditolak: Fake GPS (Teleportasi)',
  logout: 'Keluar',
  watch: 'Menonton',
  play_error: 'Gagal memutar',
  location: 'Lokasi GPS',
  location_declined: 'Menolak berbagi lokasi'
};
function fmtTime(ts) {
  var d = new Date(ts);
  return d.getDate() + ' ' + BULAN_PENDEK[d.getMonth()] + ' ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
}
var BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtDur(s) { s = s || 0; if (s < 60) return s + ' detik'; var m = Math.round(s / 60); return m < 60 ? m + ' menit' : Math.floor(m / 60) + ' jam ' + (m % 60) + ' menit'; }
function fmtDevice(d) {
  if (!d) return '';
  return [d.type, d.model, d.os, d.browser].filter(function (x) { return x && x !== 'Tidak diketahui'; }).join(' · ');
}
function actDetail(e) {
  if (e.type === 'watch') return '<b>' + esc(e.channel) + '</b> selama ' + fmtDur(e.seconds) + (e.playlist ? '<small>' + esc(e.playlist) + (e.group ? ', ' + esc(e.group) : '') + '</small>' : '');
  if (e.type === 'play_error') return esc(e.channel) + '<small>' + esc(e.reason) + '</small>';
  if (e.type === 'login_failed') return 'Mencoba nama <b>' + esc(e.tried || '-') + '</b>';
  if (e.type === 'location') {
    var q = e.lat + ',' + e.lng;
    return '<a href="https://www.google.com/maps?q=' + encodeURIComponent(q) + '" target="_blank" rel="noopener">' + esc(q) + '</a><small>akurasi sekitar ' + e.accuracy + ' m</small>';
  }
  if (e.type === 'login_gps_unregistered' || e.type === 'login_gps_mismatch') {
    var qu = e.lat + ',' + e.lng;
    return '<a href="https://www.google.com/maps?q=' + encodeURIComponent(qu) + '" target="_blank" rel="noopener">' + esc(qu) + '</a><small>menunggu persetujuan Admin (±' + (e.accuracy || 0) + ' m)</small>';
  }
  if (e.type === 'login_gps_missing') {
    return '<small>Perangkat menolak / mematikan akses GPS (' + esc(e.reason || 'no_gps') + ')</small>';
  }
  if (e.type === 'login_fake_gps_heuristic') {
    return '<span style="color:#ff453a;font-weight:600">Terdeteksi Fake GPS (' + esc(e.code || 'heuristik') + ')</span><small>Akurasi: ' + (e.accuracy || 0) + ' m' + (e.isMock ? ' · isMock: true' : '') + '</small>';
  }
  if (e.type === 'login_fake_gps_ip') {
    return '<span style="color:#ff453a;font-weight:600">Terdeteksi VPN/IP Mismatch (' + esc(e.code || 'ip_geo') + ')</span><small>Koordinat: ' + (e.lat != null ? e.lat + ', ' + e.lng : '-') + '</small>';
  }
  if (e.type === 'login_fake_gps_teleport') {
    return '<span style="color:#ff453a;font-weight:600">Terdeteksi Teleportasi Instan (' + (e.speed || 0) + ' km/jam)</span><small>Lompatan ' + Math.round((e.dist || 0) / 1000) + ' km</small>';
  }
  return '';
}
function renderPresence(list) {
  var box = $('#actLive');
  if (!list.length) { box.innerHTML = '<p class="hint">Tidak ada yang aktif dalam 3 menit terakhir.</p>'; return; }
  box.innerHTML = list.map(function (p) {
    var uDisplay = esc(p.user) + (p.gpsLabel ? ' · 📍 ' + esc(p.gpsLabel) : '');
    return '<div class="live-item"><i></i><div><strong>' + uDisplay + '</strong><span>' +
      (p.channel ? 'menonton ' + esc(p.channel) : 'membuka aplikasi') + '</span><small>' + esc(fmtDevice(p.device)) + ' · ' + esc(p.ip) + '</small></div></div>';
  }).join('');
}
function loadActivity(more) {
  var params = [];
  var u = $('#actUser').value, t = $('#actType').value;
  if (u) params.push('user=' + encodeURIComponent(u));
  if (t) params.push('type=' + encodeURIComponent(t));
  if (more && ACT.before) params.push('before=' + ACT.before);
  var tbody = $('#actRows');
  if (!more) tbody.innerHTML = '<tr><td colspan="5" class="hint">Memuat…</td></tr>';
  api('GET', '/api/activity?' + params.join('&')).then(function (r) {
    var html = r.items.map(function (e) {
      var uCol = esc(e.user || '-') + (e.gpsLabel ? '<br><small style="color:var(--cyan)">📍 ' + esc(e.gpsLabel) + '</small>' : '');
      return '<tr class="t-' + esc(e.type) + '"><td>' + fmtTime(e.ts) + '</td><td>' + uCol + '</td><td><span class="tag">' +
        esc(ACT_LABEL[e.type] || e.type) + '</span>' + actDetail(e) + '</td><td>' + esc(fmtDevice(e.device)) + '</td><td class="ip">' + esc(e.ip) + '</td></tr>';
    }).join('');
    if (!more) tbody.innerHTML = html || '<tr><td colspan="5" class="hint">Belum ada catatan.</td></tr>';
    else tbody.insertAdjacentHTML('beforeend', html);
    if (r.items.length) ACT.before = r.items[r.items.length - 1].ts;
    $('#actMore').hidden = !r.more;
    $('#actKeep').textContent = 'Catatan disimpan ' + r.days + ' hari, lalu dihapus otomatis.';
  }).catch(function (err) { tbody.innerHTML = '<tr><td colspan="5" class="hint">' + esc(err.message) + '</td></tr>'; });
  if (!more) api('GET', '/api/presence').then(renderPresence).catch(function () {});
}
$('#openActivity').addEventListener('click', function () {
  acct.close();
  api('GET', '/api/users').then(function (users) {
    $('#actUser').innerHTML = '<option value="">Semua pengguna</option>' + users.map(function (u) { return '<option>' + esc(u.name) + '</option>'; }).join('');
  }).catch(function () {});
  ACT.before = 0;
  loadActivity(false);
  actDlg.showModal();
});
$('#actUser').addEventListener('change', function () { ACT.before = 0; loadActivity(false); });
$('#actType').addEventListener('change', function () { ACT.before = 0; loadActivity(false); });
$('#actRefresh').addEventListener('click', function () { ACT.before = 0; loadActivity(false); });
$('#actMore').addEventListener('click', function () { loadActivity(true); });

/* ------------------------------------------------------------------ */
/* Masuk (login)                                                       */
/* ------------------------------------------------------------------ */
var gate = $('#gate');
function showGate(message) {
  gate.hidden = false;
  $('#loginErr').textContent = message || '';
  setTimeout(function () { $('#loginUser').focus(); }, 50);
}
function onLoggedOut(reasonMsg) {
  if (!ME && !gate.hidden) {
    if (reasonMsg) $('#loginErr').textContent = reasonMsg;
    return;
  }
  ME = null;
  W.ch = null; W.secs = 0;
  $('#locBanner').hidden = true;
  E.token++;
  destroyEngine();
  S.playing = null; S.cued = null; S.channels = []; S.raw = []; S.hidden = 0; S.view = []; S.playlists = [];
  EPG = { meta: null, channels: {}, chNames: {}, aliases: {} };
  el.idle.hidden = false; hideMsg(); setBusy(false);
  el.stage.classList.remove('is-playing');
  if (el.dialog.open) el.dialog.close();
  if (acct.open) acct.close();
  if (actDlg.open) actDlg.close();
  if (epgDlg && epgDlg.open) epgDlg.close();
  document.body.classList.remove('is-admin');
  clearSearch();
  renderGroups(); renderList(); updateNow();
  showGate(reasonMsg || '');
}
function onLoggedIn(user) {
  ME = user;
  clearSearch();
  gate.hidden = true;
  document.body.classList.toggle('is-admin', isAdmin());
  $('#acctLabel').textContent = user.name;
  S.activeId = LS.get('active', null);
  syncBlocked();
  fetchPlaylists(true);
  fetchEPG();
  sendPresence();
  setTimeout(askLocation, 1200);
}
$('#loginForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var btn = $('#loginBtn');
  var origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Memverifikasi lokasi GPS…';
  $('#loginErr').textContent = '';
  var uName = $('#loginUser').value.trim();
  var uPass = $('#loginPass').value;
  getGpsPosition(8000).then(function (gps) {
    btn.textContent = 'Memeriksa akun…';
    return api('POST', '/api/login', {
      username: uName,
      password: uPass,
      lat: gps.lat,
      lng: gps.lng,
      accuracy: gps.accuracy,
      altitude: gps.altitude,
      altitudeAccuracy: gps.altitudeAccuracy,
      heading: gps.heading,
      speed: gps.speed,
      gpsTs: gps.gpsTs,
      clientTs: gps.clientTs || Date.now(),
      isMock: gps.isMock,
      gpsError: gps.error
    });
  }).then(function (u) {
    $('#loginPass').value = '';
    onLoggedIn(u);
    toast('Selamat datang, ' + u.name);
  }).catch(function (err) {
    $('#loginErr').textContent = err.message;
    $('#loginPass').select();
  }).then(function () {
    btn.disabled = false;
    btn.textContent = origText;
  });
});

/* ------------------------------------------------------------------ */
/* Mulai                                                               */
/* ------------------------------------------------------------------ */
syncMute(); syncPlay(); updateNow(); renderList();
api('GET', '/api/me').then(onLoggedIn).catch(function (err) {
  showGate(err.status === 401 ? '' : err.message);
});

/* splash: tampil minimal 1,6 detik, bisa dilewati dengan ketuk/tombol */
(function () {
  var sp = document.getElementById('splash');
  if (!sp) return;
  var start = window.performance && performance.now ? performance.now() : 0;
  var done = false;
  function hide() {
    if (done) return; done = true;
    try { sessionStorage.setItem('zantv:splash', '1'); } catch (e) {}
    sp.classList.add('out');
    setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 600);
  }
  var elapsed = start ? performance.now() : 0;
  setTimeout(hide, Math.max(0, 1600 - elapsed));
  sp.addEventListener('click', hide);
  document.addEventListener('keydown', function onKey() { hide(); document.removeEventListener('keydown', onKey, true); }, true);
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
