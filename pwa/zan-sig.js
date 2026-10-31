/* Khas Zandev: jam, tanggal Jawa (weton), tanggal Hijriah, dan jadwal shalat.
 * Jadwal shalat dihitung di perangkat dengan metode Kemenag RI
 * (Subuh -20°, Isya -18°, Asar Syafi'i, ihtiyat), tanpa API luar.
 * Redesigned with premium iOS glassmorphism by Lody.
 */
(function () {
  'use strict';

  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var PASARAN = ['Legi', 'Pahing', 'Pon', 'Wage', 'Kliwon'];
  var HIJRI = ['Muharram', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syakban', 'Ramadan', 'Syawal', 'Zulkaidah', 'Zulhijah'];
  var JAWA = ['Sura', 'Sapar', 'Mulud', 'Bakda Mulud', 'Jumadilawal', 'Jumadilakir', 'Rejeb', 'Ruwah', 'Pasa', 'Sawal', 'Sela', 'Besar'];
  var REF_LEGI = Date.UTC(2026, 9, 31); // Sabtu Legi, 31 Oktober 2026
  var DEFAULT_LOC = { lat: -7.2575, lng: 112.7521, label: 'Surabaya' };

  var PRESET_CITIES = [
    { label: 'Surabaya', lat: -7.2575, lng: 112.7521 },
    { label: 'Jakarta', lat: -6.2088, lng: 106.8456 },
    { label: 'Bandung', lat: -6.9175, lng: 107.6191 },
    { label: 'Semarang', lat: -6.9667, lng: 110.4167 },
    { label: 'Yogyakarta', lat: -7.7956, lng: 110.3695 },
    { label: 'Solo', lat: -7.5755, lng: 110.8243 },
    { label: 'Malang', lat: -7.9666, lng: 112.6326 },
    { label: 'Medan', lat: 3.5952, lng: 98.6722 },
    { label: 'Palembang', lat: -2.9761, lng: 104.7754 },
    { label: 'Makassar', lat: -5.1477, lng: 119.4327 },
    { label: 'Denpasar', lat: -8.6705, lng: 115.2126 },
    { label: 'Banjarmasin', lat: -3.3167, lng: 114.5900 }
  ];

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

  /* ---------- waktu shalat (Kemenag RI Hisab) ---------- */
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
      { id: 'terbit', name: 'Terbit', time: at(t.sunrise, -2), minor: true },
      { id: 'dzuhur', name: 'Dzuhur', time: at(t.dhuhr, 3) },
      { id: 'ashar', name: 'Ashar', time: at(t.asr, 2) },
      { id: 'maghrib', name: 'Maghrib', time: at(t.sunset, 3) },
      { id: 'isya', name: 'Isya', time: at(t.isha, 2) }
    ];
  }

  /* ---------- lokasi ---------- */
  function getLoc() {
    try {
      var v = JSON.parse(localStorage.getItem('zandev:loc'));
      if (v && typeof v.lat === 'number') return v;
    } catch (e) {}
    return DEFAULT_LOC;
  }
  function setLoc(v) {
    try { localStorage.setItem('zandev:loc', JSON.stringify(v)); } catch (e) {}
  }

  function tzLabel(tz) {
    return tz === 7 ? 'WIB' : tz === 8 ? 'WITA' : tz === 9 ? 'WIT' : 'GMT' + (tz >= 0 ? '+' : '') + tz;
  }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function say(msg) { if (window.zanToast) window.zanToast(msg); }

  /* ---------- cache & schedule ---------- */
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
      renderModalGrid(now);
    }
    return cache;
  }

  /* ---------- render prayers in ribbon & chips ---------- */
  function renderPrayers() {
    if (!el.pray) return;
    var mainPrayers = cache.list.filter(function (p) { return !p.minor; });
    el.pray.innerHTML = mainPrayers.map(function (p) {
      return (
        '<div class="sig-item" data-p="' + p.id + '" role="listitem" tabindex="0">' +
          '<div class="sig-item-head">' +
            '<span class="sig-p-name">' + p.name + '</span>' +
            '<strong class="sig-p-time">' + hhmm(p.time) + '</strong>' +
          '</div>' +
          '<span class="sig-p-badge"></span>' +
        '</div>'
      );
    }).join('');

    var loc = getLoc();
    if (el.locName) el.locName.textContent = loc.label;
    if (el.modalLocLabel) el.modalLocLabel.textContent = loc.label;

    renderCityChips();
  }

  function renderCityChips() {
    if (!el.cityChips) return;
    var loc = getLoc();
    el.cityChips.innerHTML = PRESET_CITIES.map(function (c) {
      var isCurrent = (loc.label === c.label) || (Math.abs(loc.lat - c.lat) < 0.05 && Math.abs(loc.lng - c.lng) < 0.05);
      return (
        '<button class="sig-chip' + (isCurrent ? ' is-active' : '') + '" type="button" data-label="' + c.label + '" data-lat="' + c.lat + '" data-lng="' + c.lng + '">' +
          c.label +
        '</button>'
      );
    }).join('');
  }

  function renderModalGrid(now) {
    if (!el.modalGrid) return;
    var s = cache;
    if (!s.list) return;

    var currentOrNext = null;
    for (var i = 0; i < s.list.length; i++) {
      if (s.list[i].time > now) { currentOrNext = s.list[i]; break; }
    }

    el.modalGrid.innerHTML = s.list.map(function (p) {
      var isNext = currentOrNext && currentOrNext.id === p.id;
      return (
        '<div class="sig-card' + (isNext ? ' is-next' : '') + (p.minor ? ' is-minor' : '') + '">' +
          '<div class="sig-card-top">' +
            '<span class="sig-card-name">' + p.name + '</span>' +
            (isNext ? '<span class="sig-card-pill">Berikutnya</span>' : (p.minor ? '<span class="sig-card-minor">Sunnah/Fajar</span>' : '')) +
          '</div>' +
          '<div class="sig-card-time">' + hhmm(p.time) + '</div>' +
        '</div>'
      );
    }).join('');
  }

  /* ---------- tick per detik ---------- */
  var lastDateKey = '';
  function tick() {
    var now = new Date();
    var tz = -now.getTimezoneOffset() / 60;
    var timeStr = hhmm(now) + ':' + pad(now.getSeconds());
    var tzStr = tzLabel(tz);

    if (el.clock) el.clock.textContent = timeStr;
    if (el.tz) el.tz.textContent = tzStr;
    if (el.modalClock) el.modalClock.textContent = timeStr;
    if (el.modalTz) el.modalTz.textContent = tzStr;

    var dk = now.toDateString();
    if (dk !== lastDateKey) {
      lastDateKey = dk;
      var dateFull = HARI[now.getDay()] + ' ' + pasaran(now) + ', ' + now.getDate() + ' ' + BULAN[now.getMonth()] + ' ' + now.getFullYear();
      var dateShort = HARI[now.getDay()] + ' ' + pasaran(now) + ', ' + now.getDate() + ' ' + BULAN_PENDEK[now.getMonth()];
      var h = hijri(now);
      var hijriFull = h ? h.d + ' ' + HIJRI[h.m - 1] + ' ' + h.y + ' H' : '';
      var jawaFull = h ? JAWA[h.m - 1] + ' ' + (h.y + 512) + ' Jawa' : '';

      if (el.date) el.date.textContent = dateShort;
      if (el.hijri) el.hijri.textContent = hijriFull;
      if (el.modalDate) el.modalDate.textContent = dateFull;
      if (el.modalHijri) el.modalHijri.textContent = hijriFull;
      if (el.modalJawa) el.modalJawa.textContent = jawaFull;
    }

    var s = schedule(now);
    var main = s.list.filter(function (p) { return !p.minor; });
    var next = null;
    for (var i = 0; i < main.length; i++) {
      if (main[i].time > now) { next = main[i]; break; }
    }
    var nextId = next ? next.id : 'subuh';
    var nextName = next ? next.name : 'Subuh';
    var target = next ? next.time : s.tomorrowSubuh.time;
    var diff = Math.max(0, Math.round((target - now) / 60000));
    var label = diff >= 60 ? Math.floor(diff / 60) + 'j ' + (diff % 60) + 'm lagi' : diff + 'm lagi';
    if (diff === 0) label = 'Masuk waktu!';

    /* Update pills in Ribbon */
    if (el.pray && el.pray.children) {
      Array.prototype.forEach.call(el.pray.children, function (item) {
        var on = item.getAttribute('data-p') === nextId;
        item.classList.toggle('is-next', on);
        var badge = item.querySelector('.sig-p-badge');
        if (badge) {
          badge.textContent = on ? label : '';
        }
        if (!next && on) {
          var timeEl = item.querySelector('.sig-p-time');
          if (timeEl) timeEl.textContent = hhmm(s.tomorrowSubuh.time);
        }
      });
    }

    /* Update Topbar Header Pill */
    if (el.pillName) el.pillName.textContent = nextName;
    if (el.pillTime) el.pillTime.textContent = next ? hhmm(next.time) : hhmm(s.tomorrowSubuh.time);
    if (el.pillBadge) el.pillBadge.textContent = label;

    /* Update Modal Next Countdown if open */
    if (el.modalNextCountdown) {
      el.modalNextCountdown.textContent = 'Menuju ' + nextName + ' (' + (next ? hhmm(next.time) : hhmm(s.tomorrowSubuh.time)) + ') · ' + label;
    }
  }

  /* ---------- Modal Dialog Controls ---------- */
  function openModal() {
    if (!el.dialog) return;
    renderPrayers();
    renderModalGrid(new Date());
    tick();
    if (typeof el.dialog.showModal === 'function') {
      try { el.dialog.showModal(); } catch (e) { el.dialog.setAttribute('open', ''); }
    } else {
      el.dialog.setAttribute('open', '');
    }
  }

  function closeModal() {
    if (!el.dialog) return;
    if (typeof el.dialog.close === 'function') {
      try { el.dialog.close(); } catch (e) { el.dialog.removeAttribute('open'); }
    } else {
      el.dialog.removeAttribute('open');
    }
  }

  /* ---------- Collapse / Expand Ribbon ---------- */
  function toggleRibbon() {
    if (!el.ribbon) return;
    var isCollapsed = el.ribbon.classList.toggle('is-collapsed');
    try { localStorage.setItem('zandev:sig_ribbon_collapsed', isCollapsed ? '1' : '0'); } catch (e) {}
    if (el.toggleBtn) {
      el.toggleBtn.title = isCollapsed ? 'Tampilkan bar jadwal shalat' : 'Sembunyikan bar jadwal shalat';
      el.toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    }
  }

  function initCollapseState() {
    try {
      var isCollapsed = localStorage.getItem('zandev:sig_ribbon_collapsed') === '1';
      if (isCollapsed && el.ribbon) {
        el.ribbon.classList.add('is-collapsed');
        if (el.toggleBtn) {
          el.toggleBtn.title = 'Tampilkan bar jadwal shalat';
          el.toggleBtn.setAttribute('aria-expanded', 'false');
        }
      }
    } catch (e) {}
  }

  /* ---------- Location Handling ---------- */
  function selectPresetCity(label, lat, lng) {
    setLoc({ lat: lat, lng: lng, label: label });
    cache.key = '';
    tick();
    say('Jadwal shalat: ' + label);
  }

  function requestGps() {
    if (!navigator.geolocation) {
      say('Perangkat ini tidak menyediakan GPS');
      return;
    }
    say('Mencari koordinat GPS…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = +pos.coords.latitude.toFixed(4);
      var lng = +pos.coords.longitude.toFixed(4);
      setLoc({ lat: lat, lng: lng, label: 'Lokasi Saya' });
      cache.key = '';
      tick();
      say('Jadwal shalat memakai lokasi GPS perangkat');
    }, function () {
      say('Izin lokasi ditolak. Tetap memakai ' + getLoc().label + '.');
    }, { timeout: 15000, maximumAge: 6 * 3600 * 1000 });
  }

  function init() {
    el = {
      ribbon: document.getElementById('liveBar') || document.getElementById('sigRibbon'),
      toggleBtn: document.getElementById('liveToggleBtn') || document.getElementById('sigToggleBtn'),
      timeChip: document.getElementById('sigTimeChip'),
      clock: document.getElementById('sigClock'),
      tz: document.getElementById('sigTz'),
      date: document.getElementById('sigDate'),
      hijri: document.getElementById('sigHijri'),
      pray: document.getElementById('sigPray'),
      loc: document.getElementById('sigLoc'),
      locName: document.getElementById('sigLocName'),
      detailBtn: document.getElementById('sigDetailBtn'),

      /* Live Bar / Header Prayer Display */
      pill: document.getElementById('sigTimeChip') || document.getElementById('sigPill'),
      pillName: document.getElementById('sigPrayNextName') || document.getElementById('sigPillName'),
      pillTime: document.getElementById('sigPrayNextTime') || document.getElementById('sigPillTime'),
      pillBadge: document.getElementById('sigPrayNextBadge') || document.getElementById('sigPillBadge'),

      /* Dialog Modal */
      dialog: document.getElementById('sigDialog'),
      dialogClose: document.getElementById('sigDialogClose'),
      modalClock: document.getElementById('sigModalClock'),
      modalTz: document.getElementById('sigModalTz'),
      modalDate: document.getElementById('sigModalDate'),
      modalHijri: document.getElementById('sigModalHijri'),
      modalJawa: document.getElementById('sigModalJawa'),
      modalNextCountdown: document.getElementById('sigModalNextCountdown'),
      modalLocLabel: document.getElementById('sigModalLocLabel'),
      modalGrid: document.getElementById('sigModalGrid'),
      cityChips: document.getElementById('sigCityChips'),
      gpsBtn: document.getElementById('sigGpsBtn')
    };

    if (!el.clock && !el.pill) return;

    initCollapseState();

    /* Events */
    if (el.toggleBtn) el.toggleBtn.addEventListener('click', toggleRibbon);
    if (el.pill) el.pill.addEventListener('click', openModal);
    if (el.timeChip) el.timeChip.addEventListener('click', openModal);
    if (el.detailBtn) el.detailBtn.addEventListener('click', openModal);
    if (el.loc) el.loc.addEventListener('click', openModal);

    if (el.pray) {
      el.pray.addEventListener('click', function (e) {
        var item = e.target.closest('.sig-item');
        if (item) openModal();
      });
    }

    if (el.dialogClose) el.dialogClose.addEventListener('click', closeModal);
    if (el.dialog) {
      el.dialog.addEventListener('click', function (e) {
        if (e.target === el.dialog) closeModal();
      });
    }

    if (el.gpsBtn) {
      el.gpsBtn.addEventListener('click', function () {
        requestGps();
      });
    }

    if (el.cityChips) {
      el.cityChips.addEventListener('click', function (e) {
        var chip = e.target.closest('.sig-chip');
        if (!chip) return;
        var label = chip.getAttribute('data-label');
        var lat = parseFloat(chip.getAttribute('data-lat'));
        var lng = parseFloat(chip.getAttribute('data-lng'));
        if (label && !isNaN(lat) && !isNaN(lng)) {
          selectPresetCity(label, lat, lng);
        }
      });
    }

    tick();
    setInterval(tick, 1000);
  }

  window.ZanSig = {
    prayerTimes: prayerTimes,
    pasaran: pasaran,
    hijri: hijri,
    openModal: openModal,
    closeModal: closeModal
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
