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
function parseM3U(text) {
  var lines = String(text).replace(/\r/g, '').split('\n');
  var out = [];
  var attrs = {}, name = null, ua = null, ref = null;
  var attrRe = /([\w-]+)="([^"]*)"/g;

  function reset() { attrs = {}; name = null; ua = null; ref = null; }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    if (line.indexOf('#EXTINF') === 0) {
      reset();
      var m;
      attrRe.lastIndex = 0;
      while ((m = attrRe.exec(line))) attrs[m[1].toLowerCase()] = m[2];
      var lastQuote = line.lastIndexOf('"');
      var comma = line.indexOf(',', lastQuote < 0 ? 0 : lastQuote);
      name = comma >= 0 ? line.slice(comma + 1).trim() : null;
    } else if (line.indexOf('#EXTVLCOPT:') === 0) {
      var opt = line.slice(11), eq = opt.indexOf('=');
      if (eq > 0) {
        var k = opt.slice(0, eq).trim().toLowerCase(), v = opt.slice(eq + 1).trim();
        if (k === 'http-user-agent') ua = v;
        else if (k === 'http-referrer' || k === 'http-referer') ref = v;
      }
    } else if (line.indexOf('#EXTGRP:') === 0) {
      if (!attrs['group-title']) attrs['group-title'] = line.slice(8).trim();
    } else if (line.charAt(0) === '#') {
      continue; // termasuk #KODIPROP (kunci DRM) yang sengaja diabaikan
    } else {
      var url = line, pipe = url.indexOf('|');
      if (pipe > 0) {
        var extra = url.slice(pipe + 1);
        url = url.slice(0, pipe);
        extra.split('&').forEach(function (kv) {
          var e = kv.indexOf('=');
          if (e <= 0) return;
          var key = kv.slice(0, e).toLowerCase(), val = kv.slice(e + 1);
          try { val = decodeURIComponent(val); } catch (x) {}
          if (key === 'user-agent') ua = val;
          else if (key === 'referer' || key === 'referrer') ref = val;
        });
      }
      if (!/^(https?|rtmp|rtsp|udp|file):|^\/\//i.test(url)) { reset(); continue; }
      var group = String(attrs['group-title'] || '').split(';')[0].trim() || 'Lainnya';
      out.push({
        no: out.length + 1,
        name: name || attrs['tvg-name'] || url,
        url: url,
        logo: attrs['tvg-logo'] || '',
        group: group,
        tvgId: attrs['tvg-id'] || '',
        needsHeaders: !!(ua || ref)
      });
      reset();
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

/* lokasi GPS: hanya dengan persetujuan pengguna, bisa diubah kapan saja di menu Akun */
function locKey() { return 'loc-consent:' + (ME ? ME.name : ''); }
function shareLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(function (pos) {
    track('location', { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
  }, function () {}, { enableHighAccuracy: true, timeout: 20000, maximumAge: 600000 });
}
function askLocation() {
  var c = LS.get(locKey(), null);
  if (c === 'yes') { shareLocation(); return; }
  if (c === 'no' || !navigator.geolocation) return;
  $('#locBanner').hidden = false;
}
$('#locYes').addEventListener('click', function () {
  LS.set(locKey(), 'yes'); $('#locBanner').hidden = true; shareLocation(); syncLocToggle();
});
$('#locNo').addEventListener('click', function () {
  LS.set(locKey(), 'no'); $('#locBanner').hidden = true; track('location_declined'); syncLocToggle();
});
function syncLocToggle() {
  var on = LS.get(locKey(), null) === 'yes';
  $('#locState').textContent = on ? 'Aktif: lokasi dikirim setiap kali kamu masuk.' : 'Nonaktif: lokasi tidak dikirim.';
  $('#locToggle').textContent = on ? 'Matikan' : 'Aktifkan';
}
$('#locToggle').addEventListener('click', function () {
  var on = LS.get(locKey(), null) === 'yes';
  if (on) { LS.set(locKey(), 'no'); toast('Berbagi lokasi dimatikan'); }
  else { LS.set(locKey(), 'yes'); shareLocation(); toast('Berbagi lokasi diaktifkan'); }
  syncLocToggle();
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
      if (r.status === 401 && url !== '/api/login') onLoggedOut();
      var err = new Error((data && data.error) || ('Server menjawab kode ' + r.status));
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

function applyChannels(list) {
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
  if (!S.playing && last) {
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
    applyChannels(parseM3U(text));
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
  S.channels = []; S.view = []; S.group = 'all';
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
  el.listCount.textContent = S.view.length + ' channel' + (S.query ? ' cocok dengan "' + S.query + '"' : '');
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
    var logo = c.logo
      ? '<img src="' + esc(c.logo) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
      : '<b>' + esc(initials(c.name)) + '</b>';
    html[i] = '<button class="row' + (c === active ? ' is-playing' : '') + '" role="option" data-i="' + i + '">' +
      '<span class="no">' + c.no + '</span><span class="logo">' + logo + '</span>' +
      '<span class="t"><strong>' + esc(c.name) + '</strong><span>' + esc(c.group) + '</span></span>' +
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

/* logo gagal dimuat → inisial */
el.list.addEventListener('error', function (e) {
  var img = e.target;
  if (img.tagName !== 'IMG') return;
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
  dash: 'vendor/dash-5.2.1.mediaplayer.min.js',
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

var E = { token: 0, retries: 0, mode: null, hls: null, dash: null, ts: null, stall: null, nativeFallback: false };

function destroyEngine() {
  clearTimeout(E.stall);
  if (E.hls) { try { E.hls.destroy(); } catch (e) {} E.hls = null; }
  if (E.dash) { try { E.dash.reset(); } catch (e) {} E.dash = null; }
  if (E.ts) { try { E.ts.pause(); E.ts.unload(); E.ts.detachMediaElement(); E.ts.destroy(); } catch (e) {} E.ts = null; }
  E.mode = null;
  el.video.removeAttribute('src');
  try { el.video.load(); } catch (e) {}
}

function kindOf(url) {
  var u = url.split(/[?#]/)[0].toLowerCase();
  if (/\.m3u8$/.test(u) || u.indexOf('.m3u8') >= 0) return 'hls';
  if (/\.mpd$/.test(u)) return 'dash';
  if (/\.flv$/.test(u)) return 'flv';
  if (/\.ts$/.test(u)) return 'mpegts';
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

function startHls(url, token) {
  var nativeHls = el.video.canPlayType('application/vnd.apple.mpegurl');
  if (nativeHls && !window.MediaSource && !window.ManagedMediaSource) { startNative(url); return Promise.resolve(); }
  return loadLib('hls').then(function () {
    if (token !== E.token) return;
    if (!window.Hls || !Hls.isSupported()) { startNative(url); return; }
    var hls = new Hls({ enableWorker: true, backBufferLength: 30, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 });
    E.hls = hls; E.mode = 'hls';
    var recovered = false;
    hls.on(Hls.Events.ERROR, function (_, d) {
      if (!d.fatal || token !== E.token) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
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

function startDash(url, token) {
  return loadLib('dash').then(function () {
    if (token !== E.token) return;
    var p = dashjs.MediaPlayer().create();
    E.dash = p; E.mode = 'dash';
    p.on(dashjs.MediaPlayer.events.ERROR, function (e) {
      if (token !== E.token) return;
      var err = e && e.error ? e.error : e;
      var msg = String((err && (err.message || err.code)) || '');
      var drm = /protect|key ?system|licen|drm|eme|encrypt/i.test(msg);
      fail({ kind: drm ? 'drm' : 'network', detail: msg }, token);
    });
    p.on(dashjs.MediaPlayer.events.MANIFEST_LOADED, function (ev) {
      var protectedStream = false;
      try { protectedStream = /contentprotection/i.test(JSON.stringify(ev && ev.data ? ev.data : {})); } catch (x) {}
      if (protectedStream && token === E.token) fail({ kind: 'drm' }, token);
    });
    p.initialize(el.video, url, true);
  });
}

function startTs(url, type, token) {
  return loadLib('mpegts').then(function () {
    if (token !== E.token) return;
    if (!mpegts.isSupported()) throw { kind: 'unsupported' };
    var p = mpegts.createPlayer({ type: type, isLive: true, url: url },
      { enableStashBuffer: false, liveBufferLatencyChasing: true, lazyLoad: false });
    E.ts = p; E.mode = 'mpegts';
    p.on(mpegts.Events.ERROR, function (type2, detail, info) {
      if (token !== E.token) return;
      fail({ kind: type2 === mpegts.ErrorTypes.NETWORK_ERROR ? 'network' : 'media', code: info && info.code, detail: detail }, token);
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

function play(ch, opts) {
  opts = opts || {};
  var token = ++E.token;
  if (!opts.retry) E.retries = 0;
  E.nativeFallback = false;
  S.playing = ch; S.cued = null;
  LS.set('last', ch.url);
  if (!opts.retry) { flushWatch(); W.ch = ch; W.last = 0; pushRecent(ch.url); showOSD(ch); sendPresence(); }
  markPlaying(); updateNow(); hideMsg();
  el.idle.hidden = true;
  setBusy(true);
  el.stage.classList.add('is-playing');
  destroyEngine();

  var kind = kindOf(ch.url);
  var url = upgradeUrl(ch.url);
  var start;
  if (kind === 'unsupported') start = Promise.reject({ kind: 'unsupported' });
  else if (kind === 'hls') start = startHls(url, token);
  else if (kind === 'dash') start = startDash(url, token);
  else if (kind === 'flv' || kind === 'mpegts') start = startTs(url, kind, token);
  else { startNative(url); start = Promise.resolve(); }

  start.then(function () {
    if (token !== E.token) return;
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

function fail(info, token) {
  if (token !== E.token) return;
  var hopeless = info.kind === 'drm' || info.kind === 'unsupported' || info.kind === 'lib' ||
    info.code === 401 || info.code === 403 || info.code === 404 || info.code === 410;
  if (!hopeless && E.retries < 2) {
    E.retries++;
    var ch = S.playing;
    el.nowMeta.textContent = 'Sinyal terputus, mencoba lagi (' + E.retries + ' dari 2)…';
    setTimeout(function () { if (token === E.token) play(ch, { retry: true }); }, 1500 * E.retries);
    return;
  }
  destroyEngine();
  setBusy(false);
  el.liveTag.hidden = true;
  var x = explain(info, S.playing);
  el.msgTitle.textContent = x.title;
  el.msgBody.textContent = x.body;
  el.msg.hidden = false;
  el.nowMeta.textContent = x.title;
  if (S.playing) track('play_error', { channel: S.playing.name, reason: x.title });
}

function explain(info, ch) {
  var mixed = location.protocol === 'https:' && /^http:\/\//i.test(ch.url);
  if (info.kind === 'drm') return { title: 'Channel ini terenkripsi', body: 'Stream ini dilindungi DRM, jadi tidak bisa diputar di ZanTV.' };
  if (info.kind === 'lib') return { title: 'Komponen pemutar gagal dimuat', body: 'Periksa koneksi internet lalu coba lagi.' };
  if (info.kind === 'unsupported') return { title: 'Format ini tidak didukung browser', body: 'Alamat seperti rtmp:// atau udp:// tidak bisa diputar di browser. Coba buka di VLC.' };
  if (info.code === 401 || info.code === 403) return { title: 'Server menolak akses', body: 'Server stream menjawab dengan kode ' + info.code + '. Biasanya karena dibatasi wilayah, butuh langganan, atau tautannya sudah kedaluwarsa.' };
  if (info.code === 404 || info.code === 410) return { title: 'Alamat stream sudah tidak aktif', body: 'Server menjawab dengan kode ' + info.code + '. Channel ini kemungkinan sudah mati atau pindah alamat. Coba perbarui playlist.' };
  if (mixed) return { title: 'Stream http diblokir browser', body: 'ZanTV dibuka lewat https, sedangkan alamat stream ini masih http dan servernya tidak menyediakan versi https. Browser memblokir campuran ini demi keamanan. Buka di VLC, atau jalankan ZanTV dari http://localhost.' };
  if (ch.needsHeaders) return { title: 'Channel ini butuh pengaturan khusus', body: 'Playlist meminta User-Agent atau Referer tertentu, dan halaman web tidak diizinkan mengaturnya. Channel seperti ini biasanya hanya jalan di VLC atau aplikasi IPTV.' };
  if (info.kind === 'network') return { title: 'Stream tidak bisa dijangkau', body: 'Server sedang mati, alamatnya berubah, atau server tidak mengizinkan diputar dari browser (CORS). Coba lagi nanti atau buka di VLC.' };
  return { title: 'Stream gagal diputar', body: 'Format video dari server ini tidak bisa dibaca browser ini. Coba browser lain atau VLC.' };
}

function setBusy(on) { el.spinner.hidden = !on; }
function hideMsg() { el.msg.hidden = true; }

/* status video */
el.video.addEventListener('playing', function () {
  clearTimeout(E.stall); setBusy(false); E.retries = 0;
  el.liveTag.hidden = false; syncPlay(); updateNow();
});
el.video.addEventListener('waiting', function () {
  setBusy(true);
  var token = E.token;
  clearTimeout(E.stall);
  E.stall = setTimeout(function () { if (token === E.token && el.video.readyState < 3) fail({ kind: 'network' }, token); }, 20000);
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

/* ------------------------------------------------------------------ */
/* Panel "sedang diputar", OSD, kontrol                                 */
/* ------------------------------------------------------------------ */
function updateNow() {
  var c = S.playing || S.cued;
  if (!c) {
    el.nowNo.textContent = '';
    el.nowName.textContent = S.channels.length ? 'Pilih channel' : 'Belum ada channel';
    el.nowMeta.textContent = S.channels.length ? 'Pilih dari daftar, atau ketik nomor channel.' : 'Tambahkan playlist M3U untuk mulai.';
  } else {
    el.nowNo.textContent = c.no;
    el.nowName.textContent = c.name;
    el.nowMeta.textContent = S.playing ? c.group : c.group + ', terakhir ditonton';
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
  el.osdNo.textContent = digits != null ? digits : ch.no;
  el.osdName.textContent = digits != null ? (ch ? ch.name : '') : ch.name;
  el.osd.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(function () { el.osd.classList.remove('show'); }, digits != null ? 1600 : 2600);
}

function pushRecent(url) {
  S.recent = [url].concat(S.recent.filter(function (u) { return u !== url; })).slice(0, 30);
  LS.set('recent', S.recent);
}

function zap(dir) {
  var list = S.view.length ? S.view : S.channels;
  if (!list.length) return;
  var cur = S.playing || S.cued;
  var idx = cur ? list.indexOf(cur) : -1;
  if (idx < 0 && cur) idx = list.findIndex(function (c) { return c.url === cur.url; });
  var next = idx < 0 ? (dir > 0 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
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

function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function toggleFullscreen() {
  if (isFullscreen()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }
  var req = el.stage.requestFullscreen || el.stage.webkitRequestFullscreen;
  if (req) {
    var p = req.call(el.stage);
    if (p && p.then) p.then(lockLandscape).catch(function () {});
  } else if (el.video.webkitEnterFullscreen) {
    el.video.webkitEnterFullscreen(); // iPhone
  }
}
function lockLandscape() {
  try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {}
}

/* sembunyikan kontrol saat diam */
var idleUiTimer;
function wakeUi() {
  el.stage.classList.remove('idle-ui');
  clearTimeout(idleUiTimer);
  idleUiTimer = setTimeout(function () { if (S.playing && !el.video.paused) el.stage.classList.add('idle-ui'); }, 3000);
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
  var inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  if (el.dialog.open || $('#acctDialog').open || $('#actDialog').open || !$('#gate').hidden) return;

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
$('#pipBtn').addEventListener('click', function () {
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () {});
  else if (el.video.requestPictureInPicture) el.video.requestPictureInPicture().catch(function () { toast('Picture-in-picture belum tersedia untuk channel ini'); });
  else toast('Browser ini belum mendukung picture-in-picture');
});
if (!document.pictureInPictureEnabled) $('#pipBtn').hidden = true;
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
el.stage.addEventListener('dblclick', function (e) { if (!e.target.closest('.controls, .msg')) toggleFullscreen(); });
el.idle.addEventListener('click', function () { if (S.cued) play(S.cued); });

/* geser naik/turun di layar sentuh = ganti channel */
(function () {
  var y0 = null, x0 = null, t0 = 0;
  el.stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || e.target.closest('.controls, .msg')) { y0 = null; return; }
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
$('#playlistBtn').addEventListener('click', openDialog);
$('#acctBtn').addEventListener('click', openAccount);

/* ------------------------------------------------------------------ */
/* Dialog playlist                                                     */
/* ------------------------------------------------------------------ */
var ICON_DEL = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg>';
var ICON_REFRESH = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>';

function renderPlaylistDialog() {
  $('#plAdmin').hidden = !isAdmin();
  if (!S.playlists.length) {
    el.plList.innerHTML = '<li class="hint" style="padding:4px 10px 0">Belum ada playlist.</li>';
    return;
  }
  el.plList.innerHTML = S.playlists.map(function (p) {
    var meta = p.count + ' channel, ' + (p.kind === 'file' ? 'dari file ' + p.source : p.source);
    var tools = isAdmin()
      ? (p.kind === 'url' ? '<button class="ic" data-refresh="' + esc(p.id) + '" aria-label="Perbarui ' + esc(p.name) + '" title="Ambil ulang dari alamatnya">' + ICON_REFRESH + '</button>' : '') +
        '<button class="ic" data-del="' + esc(p.id) + '" aria-label="Hapus playlist ' + esc(p.name) + '" title="Hapus">' + ICON_DEL + '</button>'
      : '';
    return '<li><button class="pl-item" data-id="' + esc(p.id) + '" aria-current="' + (p.id === S.activeId) + '"><strong>' +
      esc(p.name) + '</strong><span>' + esc(isAdmin() ? meta : p.count + ' channel') + '</span></button>' + tools + '</li>';
  }).join('');
}
function openDialog() {
  renderPlaylistDialog();
  el.dialog.showModal();
}
el.plList.addEventListener('click', function (e) {
  var del = e.target.closest('[data-del]');
  var ref = e.target.closest('[data-refresh]');
  if (del) {
    var p = S.playlists.filter(function (x) { return x.id === del.dataset.del; })[0];
    if (p && confirm('Hapus playlist "' + p.name + '" untuk semua pengguna?')) adminDelete(p.id);
    return;
  }
  if (ref) { adminRefresh(ref.dataset.refresh); return; }
  var it = e.target.closest('.pl-item');
  if (it) { el.dialog.close(); if (it.dataset.id !== S.activeId) activate(it.dataset.id); }
});
$('#plAddUrl').addEventListener('click', function () {
  var url = $('#plUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { toast('Masukkan alamat yang diawali http:// atau https://'); $('#plUrl').focus(); return; }
  var name = $('#plName').value.trim();
  $('#plUrl').value = ''; $('#plName').value = '';
  adminAdd({ name: name, url: url });
});
$('#plFile').addEventListener('change', function (e) {
  var f = e.target.files && e.target.files[0];
  if (!f) return;
  f.text().then(function (text) {
    if (!parseM3U(text).length) { toast('File ini tidak berisi channel M3U'); return; }
    var name = $('#plName').value.trim() || f.name.replace(/\.(m3u8?|txt)$/i, '');
    $('#plName').value = '';
    adminAdd({ name: name, filename: f.name, text: text });
  });
  e.target.value = '';
});

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
function loadUsers() {
  var ul = $('#userList');
  ul.innerHTML = '<li class="hint" style="padding:4px 10px 0">Memuat…</li>';
  api('GET', '/api/users').then(function (users) {
    ul.innerHTML = users.map(function (u) {
      var self = ME && u.name === ME.name;
      return '<li><div class="pl-item"><strong>' + esc(u.name) + (self ? ' (kamu)' : '') + '</strong><span>' + roleLabel(u.role) +
        (u.role === 'admin' ? ': kelola playlist dan pengguna' : ': hanya menonton') + '</span></div>' +
        '<button class="ic" data-pw="' + esc(u.name) + '" title="Atur ulang kata sandi" aria-label="Atur ulang kata sandi ' + esc(u.name) + '">' +
        '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></button>' +
        (self ? '' : '<button class="ic" data-deluser="' + esc(u.name) + '" title="Hapus" aria-label="Hapus pengguna ' + esc(u.name) + '">' + ICON_DEL + '</button>') +
        '</li>';
    }).join('');
  }).catch(function (e) { ul.innerHTML = '<li class="hint" style="padding:4px 10px 0">' + esc(e.message) + '</li>'; });
}
$('#userList').addEventListener('click', function (e) {
  var pw = e.target.closest('[data-pw]');
  var del = e.target.closest('[data-deluser]');
  if (pw) {
    var name = pw.dataset.pw;
    var np = prompt('Kata sandi baru untuk ' + name + ' (minimal 8 karakter):');
    if (np == null) return;
    api('POST', '/api/users/' + encodeURIComponent(name) + '/password', { password: np })
      .then(function () { toast('Kata sandi ' + name + ' diganti. Dia perlu masuk ulang.'); })
      .catch(function (err) { toast(err.message); });
  } else if (del) {
    var n = del.dataset.deluser;
    if (!confirm('Hapus pengguna "' + n + '"?')) return;
    api('DELETE', '/api/users/' + encodeURIComponent(n))
      .then(function () { toast('Pengguna ' + n + ' dihapus'); loadUsers(); })
      .catch(function (err) { toast(err.message); });
  }
});
$('#nuAdd').addEventListener('click', function () {
  var body = { username: $('#nuName').value.trim().toLowerCase(), password: $('#nuPass').value, role: $('#nuRole').value };
  api('POST', '/api/users', body).then(function (u) {
    $('#nuName').value = ''; $('#nuPass').value = '';
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
var ACT_LABEL = { login: 'Masuk', login_failed: 'Gagal masuk', logout: 'Keluar', watch: 'Menonton', play_error: 'Gagal memutar', location: 'Lokasi', location_declined: 'Menolak berbagi lokasi' };
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
  return '';
}
function renderPresence(list) {
  var box = $('#actLive');
  if (!list.length) { box.innerHTML = '<p class="hint">Tidak ada yang aktif dalam 3 menit terakhir.</p>'; return; }
  box.innerHTML = list.map(function (p) {
    return '<div class="live-item"><i></i><div><strong>' + esc(p.user) + '</strong><span>' +
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
      return '<tr class="t-' + esc(e.type) + '"><td>' + fmtTime(e.ts) + '</td><td>' + esc(e.user || '-') + '</td><td><span class="tag">' +
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
function onLoggedOut() {
  if (!ME && !gate.hidden) return;
  ME = null;
  W.ch = null; W.secs = 0;
  $('#locBanner').hidden = true;
  E.token++;
  destroyEngine();
  S.playing = null; S.cued = null; S.channels = []; S.view = []; S.playlists = [];
  el.idle.hidden = false; el.msg.hidden = true; setBusy(false);
  el.stage.classList.remove('is-playing');
  if (el.dialog.open) el.dialog.close();
  if (acct.open) acct.close();
  if (actDlg.open) actDlg.close();
  document.body.classList.remove('is-admin');
  clearSearch();
  renderGroups(); renderList(); updateNow();
  showGate();
}
function onLoggedIn(user) {
  ME = user;
  clearSearch();
  gate.hidden = true;
  document.body.classList.toggle('is-admin', isAdmin());
  $('#acctLabel').textContent = user.name;
  S.activeId = LS.get('active', null);
  fetchPlaylists(true);
  sendPresence();
  setTimeout(askLocation, 1200);
}
$('#loginForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var btn = $('#loginBtn');
  btn.disabled = true;
  $('#loginErr').textContent = '';
  api('POST', '/api/login', { username: $('#loginUser').value.trim(), password: $('#loginPass').value })
    .then(function (u) { $('#loginPass').value = ''; onLoggedIn(u); toast('Selamat datang, ' + u.name); })
    .catch(function (err) { $('#loginErr').textContent = err.message; $('#loginPass').select(); })
    .then(function () { btn.disabled = false; });
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
