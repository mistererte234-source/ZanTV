/* Khas Zandev: jam, tanggal Jawa (weton), tanggal Hijriah, dan jadwal shalat.
 * Jadwal shalat dihitung di perangkat dengan metode Kemenag RI
 * (Subuh -20°, Isya -18°, Asar Syafi'i, ihtiyat), tanpa API luar.
 */
(function () {
  'use strict';

  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var PASARAN = ['Legi', 'Pahing', 'Pon', 'Wage', 'Kliwon'];
  var HIJRI = ['Muharram', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syakban', 'Ramadan', 'Syawal', 'Zulkaidah', 'Zulhijah'];
  var JAWA = ['Sura', 'Sapar', 'Mulud', 'Bakda Mulud', 'Jumadilawal', 'Jumadilakir', 'Rejeb', 'Ruwah', 'Pasa', 'Sawal', 'Sela', 'Besar'];
  var REF_LEGI = Date.UTC(2026, 9, 31); // Sabtu Legi, 31 Oktober 2026
  var DEFAULT_LOC = { lat: -7.2575, lng: 112.7521, label: 'Surabaya' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- tanggal Jawa & Hijriah ---------- */
  function pasaran(d) {
    var n = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - REF_LEGI) / 86400000) % 5;
    return PASARAN[n < 0 ? n + 5 : n];
  }

  var hijriFmt = null;
  (function () {
    var cals = ['islamic-umalqura', 'islamic-civil'];
    for (var i = 0; i < cals.length; i++) {
      try {
        var f = new Intl.DateTimeFormat('en-u-ca-' + cals[i], { day: 'numeric', month: 'numeric', year: 'numeric' });
        if (f.resolvedOptions().calendar === cals[i] && f.formatToParts) {
          hijriFmt = { f: f, shift: cals[i] === 'islamic-civil' ? 1 : 0 };
          return;
        }
      } catch (e) {}
    }
  })();

  function hijri(d) {
    if (!hijriFmt) return null;
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + hijriFmt.shift, 12);
    var p = {};
    hijriFmt.f.formatToParts(day).forEach(function (x) { p[x.type] = x.value; });
    var dd = parseInt(p.day, 10), mm = parseInt(p.month, 10), yy = parseInt(p.year, 10);
    if (!dd || !mm || !yy || mm > 12) return null;
    return { d: dd, m: mm, y: yy };
  }

  /* ---------- waktu shalat ---------- */
  function prayerTimes(date, lat, lng, tz) {
    var rad = Math.PI / 180, deg = 180 / Math.PI;
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
    var jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5 - lng / 360;

    function sun(t) {
      var D = jd + t - 2451545.0;
      var g = (357.529 + 0.98560028 * D) % 360, q = (280.459 + 0.98564736 * D) % 360;
      var L = (q + 1.915 * Math.sin(g * rad) + 0.020 * Math.sin(2 * g * rad)) % 360;
      var e = 23.439 - 0.00000036 * D;
      var RA = Math.atan2(Math.cos(e * rad) * Math.sin(L * rad), Math.cos(L * rad)) * deg / 15;
      RA = (RA + 24) % 24;
      return { dec: Math.asin(Math.sin(e * rad) * Math.sin(L * rad)) * deg, eqt: q / 15 - RA };
    }
    function midDay(t) { var n = 12 - sun(t).eqt; return n - 24 * Math.round((n - 12) / 24); }
    function angleTime(angle, t, before) {
      var dec = sun(t).dec;
      var v = (-Math.sin(angle * rad) - Math.sin(dec * rad) * Math.sin(lat * rad)) / (Math.cos(dec * rad) * Math.cos(lat * rad));
      var a = Math.acos(Math.max(-1, Math.min(1, v))) * deg / 15;
      return midDay(t) + (before ? -a : a);
    }
    function asrTime(t) {
      var dec = sun(t).dec;
      return angleTime(-Math.atan(1 / (1 + Math.tan(Math.abs(lat - dec) * rad))) * deg, t);
    }
    var t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
    for (var i = 0; i < 2; i++) {
      t = {
        fajr: angleTime(20, t.fajr / 24, true),
        sunrise: angleTime(0.833, t.sunrise / 24, true),
        dhuhr: midDay(t.dhuhr / 24),
        asr: asrTime(t.asr / 24),
        sunset: angleTime(0.833, t.sunset / 24),
        isha: angleTime(18, t.isha / 24)
      };
    }
    var adj = tz - lng / 15;
    function at(h, ihtiyatMin) {
      var mins = Math.ceil((h + adj) * 60 + ihtiyatMin - 1e-6);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, mins);
    }
    return [
      { id: 'imsak', name: 'Imsak', time: at(t.fajr, 2 - 10), minor: true },
      { id: 'subuh', name: 'Subuh', time: at(t.fajr, 2) },
      { id: 'dzuhur', name: 'Dzuhur', time: at(t.dhuhr, 3) },
      { id: 'ashar', name: 'Ashar', time: at(t.asr, 2) },
      { id: 'maghrib', name: 'Maghrib', time: at(t.sunset, 3) },
      { id: 'isya', name: 'Isya', time: at(t.isha, 2) }
    ];
  }

  /* ---------- lokasi ---------- */
  function getLoc() {
    try { var v = JSON.parse(localStorage.getItem('zandev:loc')); if (v && typeof v.lat === 'number') return v; } catch (e) {}
    return DEFAULT_LOC;
  }
  function setLoc(v) { try { localStorage.setItem('zandev:loc', JSON.stringify(v)); } catch (e) {} }

  function tzLabel(tz) { return tz === 7 ? 'WIB' : tz === 8 ? 'WITA' : tz === 9 ? 'WIT' : 'GMT' + (tz >= 0 ? '+' : '') + tz; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function say(msg) { if (window.zanToast) window.zanToast(msg); }

  /* ---------- tampilan ---------- */
  var el = {};
  var cache = { key: '', list: null, tomorrowSubuh: null };

  function schedule(now) {
    var loc = getLoc(), tz = -now.getTimezoneOffset() / 60;
    var key = now.toDateString() + '|' + loc.lat + ',' + loc.lng + '|' + tz;
    if (cache.key !== key) {
      var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      cache = {
        key: key,
        list: prayerTimes(now, loc.lat, loc.lng, tz),
        tomorrowSubuh: prayerTimes(tomorrow, loc.lat, loc.lng, tz)[1]
      };
      renderPrayers();
    }
    return cache;
  }

  function renderPrayers() {
    el.pray.innerHTML = cache.list.filter(function (p) { return !p.minor; }).map(function (p) {
      return '<li data-p="' + p.id + '"><span>' + p.name + '</span><b>' + hhmm(p.time) + '</b><small></small></li>';
    }).join('');
    var loc = getLoc();
    el.loc.textContent = loc.label;
    el.loc.title = 'Lokasi jadwal shalat: ' + loc.label + '. Klik untuk ' + (loc === DEFAULT_LOC || loc.label === DEFAULT_LOC.label ? 'memakai lokasi perangkat.' : 'kembali ke Surabaya.');
  }

  var lastDateKey = '';
  function tick() {
    var now = new Date();
    var tz = -now.getTimezoneOffset() / 60;
    el.clock.textContent = hhmm(now) + ':' + pad(now.getSeconds());
    el.tz.textContent = tzLabel(tz);

    var dk = now.toDateString();
    if (dk !== lastDateKey) {
      lastDateKey = dk;
      el.date.textContent = HARI[now.getDay()] + ' ' + pasaran(now) + ', ' + now.getDate() + ' ' + BULAN[now.getMonth()] + ' ' + now.getFullYear();
      var h = hijri(now);
      el.hijri.textContent = h ? h.d + ' ' + HIJRI[h.m - 1] + ' ' + h.y + '\u00a0H · ' + JAWA[h.m - 1] + ' ' + (h.y + 512) + '\u00a0Jw' : '';
    }

    var s = schedule(now);
    var main = s.list.filter(function (p) { return !p.minor; });
    var next = null;
    for (var i = 0; i < main.length; i++) if (main[i].time > now) { next = main[i]; break; }
    var nextId = next ? next.id : 'subuh';
    var target = next ? next.time : s.tomorrowSubuh.time;
    var diff = Math.max(0, Math.round((target - now) / 60000));
    var label = diff >= 60 ? Math.floor(diff / 60) + 'j ' + (diff % 60) + 'm lagi' : diff + ' menit lagi';
    if (diff === 0) label = 'masuk waktu';
    Array.prototype.forEach.call(el.pray.children, function (li) {
      var on = li.getAttribute('data-p') === nextId;
      li.classList.toggle('is-next', on);
      li.querySelector('small').textContent = on ? label : '';
      if (!next && on) li.querySelector('b').textContent = hhmm(s.tomorrowSubuh.time);
    });
  }

  function onLocClick() {
    var loc = getLoc();
    if (loc.label !== DEFAULT_LOC.label) {
      if (confirm('Kembali memakai jadwal shalat Surabaya?')) {
        try { localStorage.removeItem('zandev:loc'); } catch (e) {}
        cache.key = ''; tick(); say('Jadwal shalat: Surabaya');
      }
      return;
    }
    if (!navigator.geolocation) { say('Perangkat ini tidak menyediakan lokasi'); return; }
    say('Meminta izin lokasi…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      setLoc({ lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4), label: 'Lokasi kamu' });
      cache.key = ''; tick(); say('Jadwal shalat memakai lokasi perangkat');
    }, function () {
      say('Izin lokasi ditolak. Jadwal tetap memakai Surabaya.');
    }, { timeout: 15000, maximumAge: 6 * 3600 * 1000 });
  }

  function init() {
    el = {
      clock: document.getElementById('sigClock'), tz: document.getElementById('sigTz'),
      date: document.getElementById('sigDate'), hijri: document.getElementById('sigHijri'),
      pray: document.getElementById('sigPray'), loc: document.getElementById('sigLoc')
    };
    if (!el.clock) return;
    el.loc.addEventListener('click', onLocClick);
    tick();
    setInterval(tick, 1000);
  }

  window.ZanSig = { prayerTimes: prayerTimes, pasaran: pasaran, hijri: hijri };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
