/* ZanTV Resume v1.7.52
   Memori posisi tontonan VOD (film, series, short drama) ala Netflix / Disney+.
   - Disimpan di perangkat (localStorage) dan disinkronkan ke akun lewat /api/progress,
     jadi posisi terakhir ikut pindah antara laptop dan HP.
   - Modul ini sengaja berdiri sendiri (tidak menumpang di zan-movie.js) supaya tidak
     ikut terhapus kalau mesin film dirombak lagi.
   Design × Code by Zandev */
(function () {
  'use strict';

  var LS_KEY = 'zantv:resume:v1';
  var MAX_ITEMS = 60;        // jumlah judul yang diingat per perangkat
  var MIN_T = 10;            // di bawah 10 detik belum dianggap "sudah ditonton"
  var MIN_D = 60;            // durasi di bawah 1 menit tidak diingat
  var LOCAL_EVERY = 4000;    // simpan lokal paling sering tiap 4 detik
  var PUSH_EVERY = 15000;    // kirim ke server paling sering tiap 15 detik per judul
  var META = ['title', 'poster', 'kind', 'movieUrl', 'movieTitle', 'isSeries', 'epTitle', 'provider', 'quality', 'server'];

  var store = readLocal();
  var listeners = [];
  var lastPush = {};
  var hold = null;           // { k, until }: tahan penyimpanan selama lompat ke posisi resume belum selesai
  var emitTimer = null;
  var lastPull = 0;
  var serverOk = true;

  function readLocal() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }

  function writeLocal() {
    var keys = Object.keys(store);
    if (keys.length > MAX_ITEMS) {
      keys.sort(function (a, b) { return (store[b].at || 0) - (store[a].at || 0); });
      keys.slice(MAX_ITEMS).forEach(function (k) { delete store[k]; });
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {}
  }

  function emit(now) {
    clearTimeout(emitTimer);
    emitTimer = setTimeout(function () {
      listeners.forEach(function (fn) { try { fn(); } catch (e) { console.warn('[ZanResume] listener error:', e); } });
    }, now ? 0 : 400);
  }

  /* Film dianggap selesai kalau tinggal 5% terakhir (maksimal 5 menit kredit) atau < 15 detik. */
  function isDone(t, d) {
    if (!(d > 0)) return false;
    var tail = Math.max(15, Math.min(300, d * 0.05));
    return t >= d - tail;
  }

  function keyFor(ch) {
    if (!ch) return '';
    if (ch.vodKey) return String(ch.vodKey).slice(0, 600);
    if ((ch.isVod || ch.isMovie) && ch.name) return ('n:' + (ch.group || '') + ':' + ch.name).slice(0, 600);
    return '';
  }

  function metaOf(ch) {
    var m = ch.resumeMeta || {};
    return {
      title: String(m.title || ch.name || '').slice(0, 200),
      poster: String(m.poster || ch.logo || '').slice(0, 600),
      kind: m.kind || (ch.isMovie ? 'movie' : 'drama'),
      movieUrl: String(m.movieUrl || '').slice(0, 600),
      movieTitle: String(m.movieTitle || '').slice(0, 200),
      isSeries: !!m.isSeries,
      epTitle: String(m.epTitle || '').slice(0, 120),
      provider: String(m.provider || '').slice(0, 40),
      quality: String(m.quality || '').slice(0, 20),
      server: String(m.server || ch.activeServer || '').slice(0, 20)
    };
  }

  /* Entri yang masih layak dilanjutkan (bukan tanda hapus, bukan film yang sudah tamat). */
  function get(k) {
    var e = k && store[k];
    if (!e || e.gone || !(e.t >= MIN_T) || isDone(e.t, e.d)) return null;
    return e;
  }

  function positionFor(ch) {
    var e = get(keyFor(ch));
    return e ? e.t : 0;
  }

  function push(k, force) {
    if (!serverOk) return;
    var e = store[k];
    if (!e) return;
    var now = Date.now();
    if (!force && lastPush[k] && now - lastPush[k] < PUSH_EVERY) return;
    lastPush[k] = now;
    try {
      fetch('/api/progress', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-ZanTV': '1' },
        body: JSON.stringify(e)
      }).then(function (r) {
        // Server lama (belum di-update) menjawab 404: berhenti mencoba, memori lokal tetap jalan.
        if (r.status === 404) serverOk = false;
      }).catch(function () {});
    } catch (err) {}
  }

  /* Tanda hapus. fin=true berarti "sudah ditonton sampai tamat" (dipakai series untuk lompat ke episode berikutnya),
     tanpa fin berarti dihapus / diulang dari awal oleh penonton. Tanda ini ikut disinkronkan supaya
     perangkat lain tidak menghidupkan lagi posisi lama. */
  function markGone(k, silent, fin) {
    if (!k) return;
    var had = store[k] && !store[k].gone;
    store[k] = { k: k, t: 0, d: 0, at: Date.now(), gone: 1 };
    if (fin) store[k].fin = 1;
    writeLocal();
    push(k, true);
    if (had && !silent) emit(true);
  }

  /* Catat posisi. force=true dipakai saat jeda, pindah film, atau tab ditutup. */
  function record(ch, t, d, force) {
    var k = keyFor(ch);
    if (!k) return;
    if (hold && hold.k === k) {
      if (Date.now() < hold.until) return;
      hold = null;
    }
    t = +t; d = +d;
    if (!isFinite(t) || !isFinite(d) || d < MIN_D) return;
    var prev = store[k];
    if (isDone(t, d)) {
      if (!prev || !prev.fin) markGone(k, false, true);
      return;
    }
    // Awal film tidak boleh menimpa posisi lama (misal saat stream sedang disambung ulang).
    if (t < MIN_T) return;
    var now = Date.now();
    if (!force && prev && !prev.gone && now - prev.at < LOCAL_EVERY) return;
    if (prev && !prev.gone && Math.abs(prev.t - t) < 1) return;
    var isNew = !prev || prev.gone;
    var e = metaOf(ch);
    e.k = k; e.t = Math.round(t); e.d = Math.round(d); e.at = now;
    store[k] = e;
    writeLocal();
    push(k, force);
    emit(isNew || force);
  }

  function forget(k) { markGone(k); }

  /* Hapus satu judul dari Lanjut Nonton (untuk series: semua episodenya). */
  function forgetTitle(group) {
    if (!group) return;
    Object.keys(store).forEach(function (k) {
      var e = store[k];
      if (!e.gone && (e.movieUrl || k) === group) markGone(k, true);
    });
    emit(true);
  }

  function clearAll(kind) {
    Object.keys(store).forEach(function (k) {
      var e = store[k];
      if (e.gone) return;
      if (kind && e.kind !== kind) return;
      markGone(k, true);
    });
    emit(true);
  }

  /* Daftar "Lanjut Nonton": satu kartu per judul (series diwakili episode yang terakhir ditonton). */
  function list(kind) {
    var byTitle = {};
    Object.keys(store).forEach(function (k) {
      var e = get(k);
      if (!e) return;
      if (kind && e.kind !== kind) return;
      var g = e.movieUrl || k;
      if (!byTitle[g] || byTitle[g].at < e.at) byTitle[g] = e;
    });
    return Object.keys(byTitle).map(function (g) { return byTitle[g]; })
      .sort(function (a, b) { return b.at - a.at; });
  }

  /* Episode series yang terakhir ditonton (untuk memilih episode otomatis di lembar detail). */
  function latestOf(keys) {
    var best = null;
    (keys || []).forEach(function (k) {
      var e = store[k];
      if (!e) return;
      if (!best || e.at > best.at) best = e;
    });
    return best;
  }

  function clean(raw) {
    if (!raw || typeof raw.k !== 'string' || !raw.k || !(+raw.at > 0)) return null;
    var e = { k: raw.k.slice(0, 600), t: Math.max(0, Math.round(+raw.t || 0)), d: Math.max(0, Math.round(+raw.d || 0)), at: +raw.at };
    if (raw.gone) { e.gone = 1; if (raw.fin) e.fin = 1; return e; }
    META.forEach(function (f) { if (raw[f] != null) e[f] = raw[f]; });
    return e;
  }

  /* Ambil memori dari akun. Yang paling baru menang; yang hanya ada di perangkat ini dikirim balik. */
  function pull(force) {
    var now = Date.now();
    if (!force && now - lastPull < 60000) return Promise.resolve(false);
    lastPull = now;
    return fetch('/api/progress', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (r.status === 404) { serverOk = false; return null; }
      if (!r.ok) return null;
      serverOk = true;
      return r.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.items)) return false;
      var seen = {}, changed = false;
      data.items.forEach(function (raw) {
        var e = clean(raw);
        if (!e) return;
        seen[e.k] = e.at;
        var mine = store[e.k];
        if (!mine || e.at > mine.at) { store[e.k] = e; changed = true; }
      });
      Object.keys(store).forEach(function (k) {
        if (!seen[k] || store[k].at > seen[k]) push(k, true);
      });
      if (changed) { writeLocal(); emit(true); }
      return changed;
    }).catch(function () { return false; });
  }

  /* ---------------- sambungan ke elemen video ---------------- */
  function playing() {
    return (window.ZanTV && typeof window.ZanTV.getPlaying === 'function') ? window.ZanTV.getPlaying() : null;
  }

  function snap(force) {
    var v = document.getElementById('video');
    var ch = playing();
    if (!v || !ch || !(ch.isVod || ch.isMovie)) return;
    record(ch, v.currentTime, v.duration, force);
  }

  function bind() {
    var v = document.getElementById('video');
    if (!v) return;
    v.addEventListener('timeupdate', function () { snap(false); });
    v.addEventListener('pause', function () { snap(true); });
    v.addEventListener('seeked', function () {
      snap(true);
    });
    v.addEventListener('ended', function () {
      var k = keyFor(playing());
      if (k && !(store[k] && store[k].fin)) markGone(k, false, true);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') snap(true); else pull(false);
    });
    window.addEventListener('pagehide', function () { snap(true); });
    window.addEventListener('storage', function (ev) {
      if (ev.key === LS_KEY) { store = readLocal(); emit(true); }
    });
    pull(true);
  }

  window.ZanResume = {
    keyFor: keyFor,
    get: get,
    positionFor: positionFor,
    record: record,
    forget: forget,
    forgetTitle: forgetTitle,
    clearAll: clearAll,
    list: list,
    latestOf: latestOf,
    pull: pull,
    isDone: isDone,
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    /* Dipanggil pemutar saat mulai melompat ke posisi tersimpan, dan saat lompatan selesai. */
    /* Penonton sengaja menggeser ke awal film: lupakan posisi lama supaya besok mulai dari awal juga. */
    rewound: function (ch) { var k = keyFor(ch); if (get(k)) markGone(k); },
    expect: function (ch, ms) { var k = keyFor(ch); if (k) hold = { k: k, until: Date.now() + (ms || 30000) }; },
    release: function () { hold = null; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
