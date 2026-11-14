/* ZanTV Bioskop 21 & Movie VOD Explorer v2.0 (Argon Cinema Edition)
 * Dual-Engine: MovieBox Official BFF API (Direct CDN 1080p/720p + Sub Indo) + KlikXXI CloudX Turbo
 * Fitur: Admin Bioskop Toggle (ON/OFF), Custom Watermark Logo & Brand Layar, Auto Subtitle Indonesia
 * Desain iOS Glassmorphism Premium & Micro-animations
 * Crafted with love by Lody for ZanTV.
 */
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'terbaru', label: '🆕 Terbaru 2026' },
    { id: 'indo', label: '🇮🇩 Film & Series Indo' },
    { id: 'populer', label: '🔥 Populer 2025' },
    { id: 'series', label: '📺 TV Series' },
    { id: 'kdrama', label: '🇰🇷 K-Drama' },
    { id: 'action', label: '💥 Action' },
    { id: 'horror', label: '👻 Horror' },
    { id: 'comedy', label: '😂 Komedi' },
    { id: 'romance', label: '❤️ Romance' },
    { id: 'scifi', label: '🚀 Sci-Fi' },
    { id: 'thriller', label: '🔪 Thriller' },
    { id: 'animasi', label: '🎨 Animasi' },
    { id: 'drama', label: '🎭 Drama' }
  ];

  var M = {
    category: 'terbaru',
    page: 1,
    query: '',
    loading: false,
    hasMore: true,
    movies: [],
    currentMovie: null,
    currentDetail: null,
    selectedServer: '1080',
    selectedEpisode: null,
    selectedEpisodeIdx: 0,
    appConfig: {
      movieEnabled: true,
      movieEngine: 'moviebox',
      movieMirror: 'https://klikxxi.shop',
      watermarkLogo: '',
      watermarkText: 'ZanTV'
    }
  };

  var el = {};

  function initElements() {
    el.moviePane = document.getElementById('moviePane');
    el.movieGrid = document.getElementById('movieGrid');
    el.movieSearchInput = document.getElementById('movieSearchInput');
    el.movieSearchClear = document.getElementById('movieSearchClear');
    el.movieCatChips = document.getElementById('movieCatChips');
    el.movieLoading = document.getElementById('movieLoading');
    el.movieEmpty = document.getElementById('movieEmpty');
    el.movieLoadMoreWrap = document.getElementById('movieLoadMoreWrap');
    el.movieLoadMoreBtn = document.getElementById('movieLoadMoreBtn');

    // Dialog / Bottom Sheet
    el.movieSheet = document.getElementById('movieSheet');
    el.movieSheetClose = document.getElementById('movieSheetClose');
    el.movieSheetCover = document.getElementById('movieSheetCover');
    el.movieSheetTitle = document.getElementById('movieSheetTitle');
    el.movieSheetRating = document.getElementById('movieSheetRating');
    el.movieSheetQuality = document.getElementById('movieSheetQuality');
    el.movieSheetBadge = document.getElementById('movieSheetBadge');
    el.movieSheetMeta = document.getElementById('movieSheetMeta');
    el.movieSheetDesc = document.getElementById('movieSheetDesc');
    el.movieSheetServersWrap = document.getElementById('movieSheetServersWrap');
    el.movieSheetServers = document.getElementById('movieSheetServers');
    el.movieSheetPlayBtn = document.getElementById('movieSheetPlayBtn');
    el.movieEpSection = document.getElementById('movieEpSection');
    el.movieEpCount = document.getElementById('movieEpCount');
    el.movieEpList = document.getElementById('movieEpList');

    // Lanjut Nonton (memori tontonan, lihat zan-resume.js)
    el.movieResumeSection = document.getElementById('movieResumeSection');
    el.movieResumeList = document.getElementById('movieResumeList');
    el.movieResumeCount = document.getElementById('movieResumeCount');
    el.movieResumeClearBtn = document.getElementById('movieResumeClearBtn');
    el.movieSheetResumeBox = document.getElementById('movieSheetResumeBox');
    el.movieSheetResumeText = document.getElementById('movieSheetResumeText');
    el.movieSheetResumeFill = document.getElementById('movieSheetResumeFill');
    el.movieSheetRestartBtn = document.getElementById('movieSheetRestartBtn');

    // Admin Dialog Elements
    el.movieAdminBtn = document.getElementById('movieAdminBtn');
    el.acctMovieAdminBtn = document.getElementById('acctMovieAdminBtn');
    el.movieAdminDialog = document.getElementById('movieAdminDialog');
    el.movieAdminList = document.getElementById('movieAdminList');
  }

  /* ---------------- API CLIENT ---------------- */
  async function apiGet(endpoint, params) {
    var qs = new URLSearchParams(params || {}).toString();
    var url = '/api/movie/' + endpoint + (qs ? '?' + qs : '');
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, 18000);
    try {
      var res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin',
        signal: ac.signal
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      console.warn('[ZanMovie] API error:', endpoint, e);
      return null;
    }
  }

  async function apiPost(endpoint, body) {
    var url = '/api/movie/' + endpoint;
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, 18000);
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-ZanTV': '1' },
        credentials: 'same-origin',
        body: JSON.stringify(body || {}),
        signal: ac.signal
      });
      clearTimeout(timer);
      var data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
      return data;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  /* ---------------- GLOBAL CONFIG: WATERMARK & BIOSKOP TOGGLE ---------------- */
  var LOCAL_CFG_KEY = 'zantv_app_config_v1';

  function loadLocalAppConfig() {
    try {
      var raw = localStorage.getItem(LOCAL_CFG_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return {};
  }

  function saveLocalAppConfig(patch) {
    try {
      var cur = loadLocalAppConfig();
      var next = Object.assign({}, cur, patch || {});
      localStorage.setItem(LOCAL_CFG_KEY, JSON.stringify(next));
      return next;
    } catch (e) {
      return patch || {};
    }
  }

  function formatBrandHtml(txt) {
    var clean = String(txt || 'ZanTV').trim() || 'ZanTV';
    if (/tv$/i.test(clean) && clean.length > 2) {
      return escapeHtml(clean.slice(0, -2)) + '<b>' + escapeHtml(clean.slice(-2)) + '</b>';
    }
    return '<b>' + escapeHtml(clean) + '</b>';
  }

  function applyAppConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    M.appConfig = Object.assign({}, M.appConfig, cfg);
    saveLocalAppConfig({
      movieEnabled: M.appConfig.movieEnabled !== false,
      movieEngine: M.appConfig.movieEngine || 'moviebox',
      movieMirror: M.appConfig.movieMirror || 'https://klikxxi.shop',
      watermarkLogo: M.appConfig.watermarkLogo || '',
      watermarkText: M.appConfig.watermarkText || 'ZanTV'
    });

    // 1. Update Watermark Logo & Brand Text di layar player
    var wmBox = document.getElementById('stageWatermark');
    if (wmBox) {
      var wmImg = wmBox.querySelector('.wm-icon');
      var wmBrand = wmBox.querySelector('.wm-brand');
      var logoSrc = (M.appConfig.watermarkLogo && String(M.appConfig.watermarkLogo).trim()) ? String(M.appConfig.watermarkLogo).trim() : 'icons/icon-192.png';
      if (wmImg) {
        wmImg.src = logoSrc;
        wmImg.onerror = function () { this.src = 'icons/icon-192.png'; };
      }
      if (wmBrand) {
        wmBrand.innerHTML = formatBrandHtml(M.appConfig.watermarkText || 'ZanTV');
      }
    }

    // 2. Toggle Aktif / Nonaktif Tab Bioskop 21
    var segMovieBtn = document.getElementById('segMovieBtn');
    var enabled = M.appConfig.movieEnabled !== false;
    if (segMovieBtn) {
      segMovieBtn.hidden = !enabled;
      segMovieBtn.style.display = enabled ? '' : 'none';
      if (!enabled && document.body.classList.contains('is-movie-mode')) {
        var segLiveBtn = document.getElementById('segLiveBtn');
        if (segLiveBtn) segLiveBtn.click();
      }
    }
  }

  async function syncGlobalConfig() {
    var localCfg = loadLocalAppConfig();
    if (localCfg && Object.keys(localCfg).length) {
      applyAppConfig(localCfg);
    }
    try {
      var res = await fetch('/api/config', { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' });
      if (res.ok) {
        var data = await res.json();
        if (data && data.config) applyAppConfig(data.config);
      }
    } catch (e) {}
  }

  /* ---------------- NOTIFIKASI TOAST ---------------- */
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('is-shown');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () {
      t.classList.remove('is-shown');
    }, 3200);
  }

  /* ---------------- RENDER KATEGORI CHIPS ---------------- */
  function renderCategoryChips() {
    if (!el.movieCatChips) return;
    el.movieCatChips.innerHTML = CATEGORIES.map(function (c) {
      var active = (c.id === M.category) ? ' is-active' : '';
      return '<button type="button" class="movie-cat-chip' + active + '" data-cat="' + c.id + '">' + c.label + '</button>';
    }).join('');
  }

  /* ---------------- MUAT DAFTAR FILM ---------------- */
  async function loadMovies(append) {
    if (M.loading) return;
    M.loading = true;

    if (!append) {
      if (el.movieLoading) el.movieLoading.hidden = false;
      if (el.movieEmpty) el.movieEmpty.hidden = true;
      if (el.movieLoadMoreWrap) el.movieLoadMoreWrap.hidden = true;
      if (el.movieGrid) el.movieGrid.innerHTML = '';
      M.movies = [];
    } else {
      if (el.movieLoadMoreBtn) {
        el.movieLoadMoreBtn.disabled = true;
        el.movieLoadMoreBtn.innerHTML = '<span>Memuat film...</span>';
      }
    }

    var res = null;
    try {
      if (M.query) {
        res = await apiGet('search', { q: M.query, page: M.page });
      } else {
        res = await apiGet('list', { category: M.category, page: M.page });
      }
    } catch (e) {
      console.error('[ZanMovie] Load movies exception:', e);
    } finally {
      if (el.movieLoading) el.movieLoading.hidden = true;
      if (el.movieLoadMoreBtn) {
        el.movieLoadMoreBtn.disabled = false;
        el.movieLoadMoreBtn.innerHTML = '<span>Muat Lebih Banyak Film</span><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
      }
      M.loading = false;
    }

    var items = (res && res.items) || [];
    if (!append) {
      M.movies = items;
    } else {
      M.movies = M.movies.concat(items);
    }

    if (!M.movies.length) {
      if (el.movieEmpty) {
        el.movieEmpty.hidden = false;
        var emptyText = el.movieEmpty.querySelector('.movie-empty-text');
        if (emptyText) {
          emptyText.textContent = (res === null)
            ? 'Koneksi ke server film sedang sibuk. Silakan klik kategori lain atau coba lagi.'
            : 'Tidak ada film ditemukan.';
        }
      }
      if (el.movieLoadMoreWrap) el.movieLoadMoreWrap.hidden = true;
      return;
    }

    if (el.movieEmpty) el.movieEmpty.hidden = true;
    M.hasMore = items.length >= 16;
    if (el.movieLoadMoreWrap) el.movieLoadMoreWrap.hidden = !M.hasMore;

    renderMovieCards(items, append);
  }

  /* ---------------- LANJUT NONTON (memori tontonan) ---------------- */
  var PLAY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>';

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(+sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return (h > 0 ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
  }

  function fmtRemaining(t, d) {
    var min = Math.max(1, Math.round((d - t) / 60));
    if (min >= 60) return 'Sisa ' + Math.floor(min / 60) + ' j' + (min % 60 ? ' ' + (min % 60) + ' mnt' : '');
    return 'Sisa ' + min + ' mnt';
  }

  function resumeKey(url) { return url ? 'm:' + url : ''; }

  function selectedTargetUrl() {
    if (M.currentDetail && M.currentDetail.isSeries && M.selectedEpisode) return M.selectedEpisode.url;
    if (M.currentDetail && M.currentDetail.url) return M.currentDetail.url;
    return (M.currentMovie && M.currentMovie.url) || '';
  }

  function setPlayLabel(text) {
    if (!el.movieSheetPlayBtn) return;
    el.movieSheetPlayBtn.innerHTML = PLAY_SVG + '<span id="movieSheetPlayBtnText">' + escapeHtml(text) + '</span>';
  }

  /* Sesuaikan lembar detail dengan memori: kotak "terakhir ditonton", label tombol, tombol ulang dari awal */
  function refreshSheetResume() {
    var R = window.ZanResume;
    var e = R ? R.get(resumeKey(selectedTargetUrl())) : null;
    var isSeries = !!(M.currentDetail && M.currentDetail.isSeries && M.selectedEpisode);
    var epName = isSeries ? (M.selectedEpisode.title || ('Episode ' + (M.selectedEpisodeIdx + 1))) : '';
    if (el.movieSheetResumeBox) el.movieSheetResumeBox.hidden = !e;
    if (el.movieSheetRestartBtn) el.movieSheetRestartBtn.hidden = !e;
    if (e) {
      var pct = e.d > 0 ? Math.max(0, Math.min(100, Math.round((e.t / e.d) * 100))) : 0;
      if (el.movieSheetResumeText) {
        el.movieSheetResumeText.textContent = 'Terakhir ditonton sampai ' + fmtTime(e.t) + ' dari ' + fmtTime(e.d) + ' (' + pct + '%)';
      }
      if (el.movieSheetResumeFill) el.movieSheetResumeFill.style.width = pct + '%';
      setPlayLabel(isSeries ? ('Lanjut ' + epName + ' (' + fmtTime(e.t) + ')') : ('Lanjut Nonton (' + fmtTime(e.t) + ')'));
    } else {
      setPlayLabel(isSeries ? ('Putar ' + epName) : 'Putar Film Sekarang');
    }
  }

  function selectEpisode(idx) {
    if (!M.currentDetail || !M.currentDetail.episodes || !M.currentDetail.episodes[idx]) return;
    M.selectedEpisodeIdx = idx;
    M.selectedEpisode = M.currentDetail.episodes[idx];
    if (el.movieEpList) {
      el.movieEpList.querySelectorAll('.movie-ep-btn').forEach(function (b) {
        var on = +b.getAttribute('data-idx') === idx;
        b.classList.toggle('is-active', on);
        if (on && b.scrollIntoView) { try { b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
      });
    }
  }

  /* Series: buka di episode yang terakhir ditonton; kalau episode itu sudah tamat, lompat ke episode berikutnya */
  function pickEpisodeFromMemory(episodes, resumeEntry) {
    var R = window.ZanResume;
    if (!R || !episodes || !episodes.length) return 0;
    var last = R.latestOf(episodes.map(function (ep) { return resumeKey(ep.url); }));
    var idx = -1;
    if (last) {
      for (var i = 0; i < episodes.length; i++) {
        if (resumeKey(episodes[i].url) === last.k) { idx = i; break; }
      }
    }
    var fallback = resumeEntry || (M.currentMovie && R.list('movie').filter(function (x) { return x.movieUrl === M.currentMovie.url; })[0]) || null;
    if (idx < 0 && fallback) {
      var targetTitle = String(fallback.epTitle || '').trim().toLowerCase();
      var targetNumMatch = targetTitle.match(/(\d+)/) || String(fallback.k || '').match(/[?&]ep=(\d+)/i);
      var targetNum = targetNumMatch ? parseInt(targetNumMatch[1], 10) : NaN;
      for (var j = 0; j < episodes.length; j++) {
        var epT = String(episodes[j].title || '').trim().toLowerCase();
        var epNumM = epT.match(/(\d+)/) || String(episodes[j].url || '').match(/[?&]ep=(\d+)/i);
        var epN = epNumM ? parseInt(epNumM[1], 10) : (j + 1);
        if ((targetTitle && epT === targetTitle) || (!isNaN(targetNum) && epN === targetNum)) {
          idx = j;
          last = fallback;
          var newKey = resumeKey(episodes[j].url);
          if (newKey && fallback.k !== newKey && fallback.t > 0 && typeof R.save === 'function') {
            R.save(newKey, fallback.t, fallback.d, fallback);
          }
          break;
        }
      }
    }
    if (idx < 0) return 0;
    var ref = last || fallback;
    var finished = ref && (!!ref.fin || (!ref.gone && R.isDone(ref.t, ref.d)));
    if (finished && idx + 1 < episodes.length) idx++;
    return idx;
  }

  function renderResumeCarousel() {
    if (!el.movieResumeSection || !el.movieResumeList) return;
    var R = window.ZanResume;
    var items = R ? R.list('movie').filter(function (e) { return e.movieUrl; }) : [];
    if (!items.length) {
      el.movieResumeSection.hidden = true;
      el.movieResumeList.innerHTML = '';
    } else {
      el.movieResumeSection.hidden = false;
      if (el.movieResumeCount) el.movieResumeCount.textContent = items.length + ' Judul';
      el.movieResumeList.innerHTML = items.map(function (e) {
        var pct = e.d > 0 ? Math.max(2, Math.min(100, (e.t / e.d) * 100)) : 0;
        var name = e.movieTitle || e.title || 'Film';
        var sub = (e.isSeries && e.epTitle)
          ? (e.epTitle + ' · ' + fmtRemaining(e.t, e.d))
          : (fmtTime(e.t) + ' / ' + fmtTime(e.d) + ' · ' + fmtRemaining(e.t, e.d));
        return '<div class="movie-resume-card" data-url="' + escapeHtml(e.movieUrl) + '" tabindex="0" role="button" aria-label="Lanjutkan ' + escapeHtml(name) + '" title="' + escapeHtml(name) + '">' +
          '<div class="movie-resume-thumb-wrap">' +
            '<img class="movie-resume-thumb" src="' + escapeHtml(e.poster || 'icons/icon-192.png') + '" alt="" loading="lazy" onerror="this.src=\'icons/icon-192.png\'">' +
            '<div class="movie-resume-overlay"><div class="movie-resume-play-ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg></div></div>' +
            '<button type="button" class="movie-resume-remove-btn" data-remove-url="' + escapeHtml(e.movieUrl) + '" title="Hapus dari Lanjut Nonton" aria-label="Hapus ' + escapeHtml(name) + ' dari Lanjut Nonton">✕</button>' +
            (e.quality ? '<span class="movie-resume-badge">' + escapeHtml(e.quality) + '</span>' : '') +
            '<div class="movie-resume-bar-wrap"><div class="movie-resume-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
          '</div>' +
          '<div class="movie-resume-meta">' +
            '<div class="movie-resume-title">' + escapeHtml(name) + '</div>' +
            '<div class="movie-resume-sub">' + escapeHtml(sub) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    paintCardProgress();
  }

  /* Garis progres di kartu grid untuk film yang sudah pernah ditonton */
  function paintCardProgress() {
    if (!el.movieGrid) return;
    var R = window.ZanResume;
    var map = {};
    if (R) R.list('movie').forEach(function (e) { if (e.movieUrl) map[e.movieUrl] = e; });
    el.movieGrid.querySelectorAll('.movie-card').forEach(function (card) {
      var wrap = card.querySelector('.movie-card-thumb-wrap');
      if (!wrap) return;
      var e = map[card.getAttribute('data-url')];
      var bar = wrap.querySelector('.movie-card-progress');
      if (!e || !(e.d > 0)) { if (bar) bar.remove(); return; }
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'movie-card-progress';
        bar.innerHTML = '<i></i>';
        wrap.appendChild(bar);
      }
      bar.firstChild.style.width = Math.max(2, Math.min(100, (e.t / e.d) * 100)).toFixed(1) + '%';
    });
  }

  function openFromResume(url) {
    var R = window.ZanResume;
    var e = R ? R.list('movie').filter(function (x) { return x.movieUrl === url; })[0] : null;
    if (!e) return;
    var known = M.movies.find(function (m) { return m.url === url; });
    openMovieDetail(known || {
      url: e.movieUrl, title: e.movieTitle || e.title, poster: e.poster,
      isSeries: !!e.isSeries, provider: e.provider || '', quality: e.quality || ''
    }, { autoPlay: true, resumeEntry: e });
  }

  /* ---------------- RENDER KARTU FILM ---------------- */
  function renderMovieCards(items, append) {
    if (!el.movieGrid) return;
    var html = items.map(function (m) {
      var poster = m.poster || 'icons/icon-192.png';
      var ratingBadge = m.rating ? '<span class="movie-card-rating">' + escapeHtml(m.rating) + '</span>' : '';
      var qualityBadge = m.quality ? '<span class="movie-card-quality">' + escapeHtml(m.quality) + '</span>' : '';
      var typeTag = m.isSeries ? 'SERIES' : 'FILM';

      return '<div class="movie-card" data-url="' + escapeHtml(m.url) + '" tabindex="0" role="button" aria-label="' + escapeHtml(m.title) + '">' +
        '<div class="movie-card-thumb-wrap">' +
          '<img class="movie-card-thumb" src="' + escapeHtml(poster) + '" alt="' + escapeHtml(m.title) + '" loading="lazy" onerror="this.src=\'icons/icon-192.png\'">' +
          ratingBadge +
          qualityBadge +
        '</div>' +
        '<div class="movie-card-info">' +
          '<h3 class="movie-card-title">' + escapeHtml(m.title) + '</h3>' +
          '<div class="movie-card-meta">' +
            '<span class="movie-card-type">' + typeTag + '</span>' +
            '<span>Bioskop 21</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    if (append) {
      el.movieGrid.insertAdjacentHTML('beforeend', html);
    } else {
      el.movieGrid.innerHTML = html;
    }
    paintCardProgress();
  }

  /* ---------------- BUKA DETAIL FILM (SHEET) ---------------- */
  async function openMovieDetail(item, opts) {
    if (!item) return;
    opts = opts || {};
    M.currentMovie = item;
    M.currentDetail = null;
    var isMb = String(item.url || '').indexOf('mb://') === 0 || item.provider === 'moviebox';
    M.selectedServer = isMb ? '1080' : 'p3';
    M.selectedEpisode = null;
    M.selectedEpisodeIdx = 0;

    if (el.movieSheetCover) el.movieSheetCover.src = item.poster || 'icons/icon-192.png';
    if (el.movieSheetTitle) el.movieSheetTitle.textContent = item.title || 'Film Bioskop';
    if (el.movieSheetRating) {
      el.movieSheetRating.textContent = item.rating || '⭐ 8.0';
      el.movieSheetRating.hidden = !item.rating;
    }
    if (el.movieSheetQuality) el.movieSheetQuality.textContent = item.quality || 'FHD 1080p';
    if (el.movieSheetBadge) el.movieSheetBadge.textContent = item.isSeries ? 'TV SERIES' : 'BIOSKOP 21';
    if (el.movieSheetMeta) el.movieSheetMeta.innerHTML = '<span>Memuat informasi lengkap...</span>';
    if (el.movieSheetDesc) el.movieSheetDesc.textContent = 'Mengambil sinopsis dan daftar kualitas server...';
    if (el.movieEpSection) el.movieEpSection.hidden = true;
    if (el.movieSheetResumeBox) el.movieSheetResumeBox.hidden = true;
    if (el.movieSheetRestartBtn) el.movieSheetRestartBtn.hidden = true;
    if (el.movieSheetServers) {
      el.movieSheetServers.innerHTML = '<span class="movie-server-btn is-active">' + (isMb ? '🚀 Server 1080p (Full HD)' : '🚀 Server 3 (VOE Clean)') + '</span>';
    }
    if (el.movieSheetPlayBtn) {
      el.movieSheetPlayBtn.disabled = true;
      el.movieSheetPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5v14l12-7z"/></svg><span>Menyiapkan...</span>';
    }

    if (el.movieSheet) {
      if (typeof el.movieSheet.showModal === 'function') {
        try { el.movieSheet.showModal(); } catch (e) { el.movieSheet.setAttribute('open', ''); }
      } else {
        el.movieSheet.setAttribute('open', '');
      }
    }

    var detail = await apiGet('detail', { url: item.url });
    // Lembar sudah dipakai film lain selagi menunggu jawaban server: jangan timpa
    if (M.currentMovie !== item) return;
    if (!detail) {
      var resEntry = opts.resumeEntry || (window.ZanResume ? window.ZanResume.list('movie').filter(function (x) { return x.movieUrl === item.url; })[0] : null);
      if (resEntry && (item.isSeries || resEntry.isSeries)) {
        var savedEpUrl = resEntry.k ? String(resEntry.k).replace(/^m:/, '') : item.url;
        var savedEpTitle = resEntry.epTitle || 'Episode Terakhir';
        M.selectedEpisode = { url: savedEpUrl, title: savedEpTitle };
        M.selectedEpisodeIdx = 0;
        M.currentDetail = {
          title: item.title || resEntry.movieTitle || resEntry.title || 'Series',
          url: item.url,
          poster: item.poster || resEntry.poster || '',
          isSeries: true,
          episodes: [M.selectedEpisode]
        };
        if (resEntry.server) M.selectedServer = resEntry.server;
        if (el.movieEpSection) el.movieEpSection.hidden = false;
        if (el.movieEpCount) el.movieEpCount.textContent = savedEpTitle;
        if (el.movieEpList) {
          el.movieEpList.innerHTML = '<button type="button" class="movie-ep-btn is-active" data-idx="0">' + escapeHtml(savedEpTitle) + '</button>';
        }
      }
      if (el.movieSheetDesc) el.movieSheetDesc.textContent = 'Siap diputar langsung dari posisi terakhir. Klik tombol Putar di bawah.';
      if (el.movieSheetPlayBtn) el.movieSheetPlayBtn.disabled = false;
      refreshSheetResume();
      if (opts.autoPlay) playCurrentSelection();
      return;
    }

    M.currentDetail = detail;

    if (el.movieSheetCover && detail.poster) el.movieSheetCover.src = detail.poster;
    if (el.movieSheetTitle) el.movieSheetTitle.textContent = detail.title;
    if (el.movieSheetDesc) el.movieSheetDesc.textContent = detail.synopsis || 'Sinopsis belum tersedia untuk judul ini.';
    if (el.movieSheetQuality) el.movieSheetQuality.textContent = detail.quality || 'HD';
    if (detail.rating && el.movieSheetRating) {
      el.movieSheetRating.textContent = detail.rating;
      el.movieSheetRating.hidden = false;
    }

    var metaParts = [];
    if (detail.genres) metaParts.push('<span>' + escapeHtml(detail.genres) + '</span>');
    if (detail.year) metaParts.push('<span>📅 ' + escapeHtml(detail.year) + '</span>');
    if (detail.duration) metaParts.push('<span>⏱️ ' + escapeHtml(detail.duration) + '</span>');
    if (detail.director) metaParts.push('<span>🎬 ' + escapeHtml(detail.director) + '</span>');
    if (el.movieSheetMeta) el.movieSheetMeta.innerHTML = metaParts.join('<span style="opacity:0.4">•</span>') || '<span>Koleksi Bioskop 21</span>';

    var rawServers = detail.servers || (isMb
      ? [{ id: '1080', name: '🚀 Server 1080p (Full HD)' }, { id: '720', name: '⚡ Server 720p (HD)' }, { id: '480', name: '📱 Server 480p' }]
      : [{ id: 'p3', name: '🚀 Server 3 (VOE Clean)' }, { id: 'p1', name: 'Server 1' }]);
    var servers = rawServers.slice();
    M.selectedServer = (opts.resumeEntry && opts.resumeEntry.server && servers.some(function (s) { return s.id === opts.resumeEntry.server; }))
      ? opts.resumeEntry.server
      : (servers[0] ? servers[0].id : (isMb ? '1080' : 'p3'));

    if (el.movieSheetServers) {
      el.movieSheetServers.innerHTML = servers.map(function (s) {
        var active = (s.id === M.selectedServer) ? ' is-active' : '';
        return '<button type="button" class="movie-server-btn' + active + '" data-tab="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</button>';
      }).join('');
    }

    if (detail.isSeries && detail.episodes && detail.episodes.length) {
      if (el.movieEpSection) el.movieEpSection.hidden = false;
      if (el.movieEpCount) el.movieEpCount.textContent = detail.episodes.length + ' Episode Tersedia';
      M.selectedEpisode = detail.episodes[0];
      M.selectedEpisodeIdx = 0;

      if (el.movieEpList) {
        el.movieEpList.innerHTML = detail.episodes.map(function (ep, idx) {
          var active = (idx === 0) ? ' is-active' : '';
          return '<button type="button" class="movie-ep-btn' + active + '" data-idx="' + idx + '">' + escapeHtml(ep.title || ('Ep ' + (idx + 1))) + '</button>';
        }).join('');
      }

      selectEpisode(pickEpisodeFromMemory(detail.episodes, opts.resumeEntry));
    } else {
      if (el.movieEpSection) el.movieEpSection.hidden = true;
    }
    if (el.movieSheetPlayBtn) el.movieSheetPlayBtn.disabled = false;
    refreshSheetResume();
    // Dibuka dari kartu "Lanjut Nonton": langsung putar dari posisi terakhir
    if (opts.autoPlay) playCurrentSelection();
  }

  function closeMovieSheet() {
    if (el.movieSheet) {
      if (typeof el.movieSheet.close === 'function') {
        try { el.movieSheet.close(); } catch (e) {}
      }
      el.movieSheet.removeAttribute('open');
    }
  }

  /* ---------------- PUTAR FILM / EPISODE ---------------- */
  async function playCurrentSelection(opts) {
    opts = (opts && opts.fromStart) ? { fromStart: true } : {};
    var targetUrl = '';
    var playTitle = '';

    if (M.currentDetail && M.currentDetail.isSeries && M.selectedEpisode) {
      targetUrl = M.selectedEpisode.url;
      playTitle = (M.currentDetail.title || 'Series') + ' · ' + (M.selectedEpisode.title || 'Episode');
    } else if (M.currentDetail && M.currentDetail.url) {
      targetUrl = M.currentDetail.url;
      playTitle = M.currentDetail.title;
    } else if (M.currentMovie && M.currentMovie.url) {
      targetUrl = M.currentMovie.url;
      playTitle = M.currentMovie.title;
    }

    if (!targetUrl) {
      showToast('⚠️ Alamat film tidak valid.');
      return;
    }

    if (el.movieSheetPlayBtn) {
      el.movieSheetPlayBtn.disabled = true;
      el.movieSheetPlayBtn.innerHTML = '<span>Menyiapkan Stream...</span>';
    }

    showToast('🍿 Menyiapkan ' + playTitle + '...');

    var streamRes = await apiGet('stream', { url: targetUrl, tab: M.selectedServer });

    if (!streamRes || !streamRes.streamUrl || streamRes.kind === 'iframe') {
      var altTab = (M.selectedServer === '1080') ? '720' : ((M.selectedServer === 'p3') ? 'p1' : '1080');
      var altRes = await apiGet('stream', { url: targetUrl, tab: altTab });
      if (altRes && altRes.streamUrl) streamRes = altRes;
    }

    if (el.movieSheetPlayBtn) el.movieSheetPlayBtn.disabled = false;
    refreshSheetResume();

    if (!streamRes || !streamRes.streamUrl) {
      showToast('❌ Server film sedang sibuk. Silakan pilih server lain.');
      return;
    }

    if (streamRes.kind === 'iframe') {
      showToast('⚠️ Server ini hanya menyediakan web player pihak ketiga dengan iklan. Silakan gunakan Server utama.');
      return;
    }

    var poster = (M.currentDetail && M.currentDetail.poster) || (M.currentMovie && M.currentMovie.poster) || 'icons/icon-192.png';
    var h = streamRes.headers || {};
    var streamRef = h.Referer || h.referer || streamRes.referer || 'https://123movienow.cc/';
    var streamOrigin = h.Origin || h.origin || streamRes.origin || 'https://123movienow.cc';
    var streamUa = h['User-Agent'] || h.ua || streamRes.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    var isHlsStream = (streamRes.kind === 'hls' || streamRes.type === 'hls' || streamRes.streamUrl.indexOf('.m3u8') !== -1);

    var epList = (M.currentDetail && M.currentDetail.episodes) || [];
    var hasNextEp = epList.length > 0 && M.selectedEpisodeIdx + 1 < epList.length;

    var vodCh = {
      name: playTitle,
      url: streamRes.streamUrl,
      logo: poster,
      group: 'Bioskop 21',
      isVod: true,
      isMovie: true,
      isVertical: false,
      // Kunci memori tontonan: alamat halaman film / episode (stabil), BUKAN alamat stream yang berganti tiap putar
      vodKey: resumeKey(targetUrl),
      resumeMeta: {
        kind: 'movie',
        title: playTitle,
        movieTitle: (M.currentDetail && M.currentDetail.title) || (M.currentMovie && M.currentMovie.title) || playTitle,
        movieUrl: (M.currentMovie && M.currentMovie.url) || (M.currentDetail && M.currentDetail.url) || targetUrl,
        poster: poster,
        isSeries: !!(M.currentDetail && M.currentDetail.isSeries),
        epTitle: (M.currentDetail && M.currentDetail.isSeries && M.selectedEpisode) ? (M.selectedEpisode.title || ('Episode ' + (M.selectedEpisodeIdx + 1))) : '',
        provider: (M.currentMovie && M.currentMovie.provider) || '',
        quality: (M.currentDetail && M.currentDetail.quality) || (M.currentMovie && M.currentMovie.quality) || '',
        server: M.selectedServer
      },
      ref: streamRef,
      ua: streamUa,
      origin: streamOrigin,
      subtitles: streamRes.subtitles || [],
      qualities: streamRes.qualities || [],
      hasNextEpisode: hasNextEp,
      nextEpisodeTitle: hasNextEp ? (epList[M.selectedEpisodeIdx + 1].title || ('Episode ' + (M.selectedEpisodeIdx + 2))) : '',
      servers: (M.currentDetail && M.currentDetail.servers) || [{ id: '1080', name: 'Server 1080p' }, { id: '720', name: 'Server 720p' }],
      activeServer: M.selectedServer,
      activeServerName: streamRes.server ? ('Server ' + streamRes.server) : ('Server ' + String(M.selectedServer).toUpperCase()),
      sources: [
        {
          url: streamRes.streamUrl,
          name: streamRes.server ? ('Server ' + streamRes.server) : ('Server ' + String(M.selectedServer).toUpperCase()),
          ref: streamRef,
          origin: streamOrigin,
          ua: streamUa,
          isHls: isHlsStream
        }
      ]
    };

    closeMovieSheet();

    if (window.ZanTV && typeof window.ZanTV.playVod === 'function') {
      window.ZanTV.playVod(vodCh, opts);
    } else if (typeof window.playChannel === 'function') {
      window.playChannel(vodCh, opts);
    }

    if (window.innerWidth <= 860) {
      var stage = document.getElementById('stage');
      if (stage) stage.scrollIntoView({ behavior: 'smooth' });
    }

    var subNotice = (streamRes.subtitles && streamRes.subtitles.length) ? ' · 🇮🇩 Sub Indo Aktif' : '';
    showToast('▶️ Memutar: ' + playTitle + subNotice);
  }

  function playNextEpisode() {
    if (!M.currentDetail || !M.currentDetail.episodes) return;
    var nextIdx = M.selectedEpisodeIdx + 1;
    if (nextIdx < M.currentDetail.episodes.length) {
      M.selectedEpisodeIdx = nextIdx;
      M.selectedEpisode = M.currentDetail.episodes[nextIdx];
      playCurrentSelection();
    }
  }

  /* ---------------- SEARCH DEBOUNCE ---------------- */
  var searchTimeout = null;
  function handleSearchInput() {
    if (!el.movieSearchInput) return;
    var val = el.movieSearchInput.value.trim();
    if (el.movieSearchClear) el.movieSearchClear.hidden = !val;

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function () {
      if (val === M.query) return;
      M.query = val;
      M.page = 1;
      loadMovies(false);
    }, 450);
  }

  /* ---------------- HELPERS ---------------- */
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Compress image file to crisp Data URI for Watermark Logo */
  function compressLogoFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Gagal membaca file gambar')); };
      reader.onload = function (ev) {
        var dataUrl = String(ev.target.result || '');
        if (file.type === 'image/svg+xml' && dataUrl.length < 250000) {
          return resolve(dataUrl);
        }
        var img = new Image();
        img.onerror = function () { reject(new Error('File bukan gambar yang valid')); };
        img.onload = function () {
          var maxDim = 160;
          var w = img.width || 128;
          var h = img.height || 128;
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
            else { w = Math.round((w * maxDim) / h); h = maxDim; }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------------- INIT & EVENT LISTENERS ---------------- */
  function init() {
    initElements();
    syncGlobalConfig();
    if (!el.moviePane) return;

    renderCategoryChips();

    if (el.movieCatChips) {
      el.movieCatChips.addEventListener('click', function (e) {
        var btn = e.target.closest('.movie-cat-chip');
        if (!btn) return;
        var cat = btn.getAttribute('data-cat');
        if (!cat || (cat === M.category && !M.query && M.movies.length > 0)) return;

        M.category = cat;
        M.page = 1;
        M.query = '';
        if (el.movieSearchInput) el.movieSearchInput.value = '';
        if (el.movieSearchClear) el.movieSearchClear.hidden = true;

        renderCategoryChips();
        loadMovies(false);
      });
    }

    if (el.movieSearchInput) {
      el.movieSearchInput.addEventListener('input', handleSearchInput);
      el.movieSearchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(searchTimeout);
          M.query = el.movieSearchInput.value.trim();
          M.page = 1;
          loadMovies(false);
        }
      });
    }

    if (el.movieSearchClear) {
      el.movieSearchClear.addEventListener('click', function () {
        if (el.movieSearchInput) el.movieSearchInput.value = '';
        el.movieSearchClear.hidden = true;
        M.query = '';
        M.page = 1;
        loadMovies(false);
      });
    }

    if (el.movieLoadMoreBtn) {
      el.movieLoadMoreBtn.addEventListener('click', function () {
        if (M.loading || !M.hasMore) return;
        M.page += 1;
        loadMovies(true);
      });
    }

    if (el.movieGrid) {
      el.movieGrid.addEventListener('click', function (e) {
        var card = e.target.closest('.movie-card');
        if (!card) return;
        var url = card.getAttribute('data-url');
        var found = M.movies.find(function (m) { return m.url === url; });
        if (found) openMovieDetail(found);
      });
    }

    if (el.movieSheetServers) {
      el.movieSheetServers.addEventListener('click', function (e) {
        var btn = e.target.closest('.movie-server-btn');
        if (!btn) return;
        var tab = btn.getAttribute('data-tab');
        if (!tab || tab === M.selectedServer) return;
        M.selectedServer = tab;
        var all = el.movieSheetServers.querySelectorAll('.movie-server-btn');
        all.forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      });
    }

    if (el.movieEpList) {
      el.movieEpList.addEventListener('click', function (e) {
        var btn = e.target.closest('.movie-ep-btn');
        if (!btn) return;
        var idx = +btn.getAttribute('data-idx');
        if (isNaN(idx) || !M.currentDetail || !M.currentDetail.episodes) return;
        selectEpisode(idx);
        refreshSheetResume();
      });
    }

    if (el.movieSheetPlayBtn) {
      el.movieSheetPlayBtn.addEventListener('click', function () { playCurrentSelection(); });
    }
    if (el.movieSheetRestartBtn) {
      el.movieSheetRestartBtn.addEventListener('click', function () { playCurrentSelection({ fromStart: true }); });
    }

    if (el.movieResumeList) {
      el.movieResumeList.addEventListener('click', function (e) {
        var rm = e.target.closest('[data-remove-url]');
        if (rm) {
          e.stopPropagation();
          if (window.ZanResume) window.ZanResume.forgetTitle(rm.getAttribute('data-remove-url'));
          return;
        }
        var card = e.target.closest('.movie-resume-card');
        if (card) openFromResume(card.getAttribute('data-url'));
      });
      el.movieResumeList.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var card = e.target.closest('.movie-resume-card');
        if (!card || e.target.closest('[data-remove-url]')) return;
        e.preventDefault();
        openFromResume(card.getAttribute('data-url'));
      });
    }
    if (el.movieResumeClearBtn) {
      el.movieResumeClearBtn.addEventListener('click', function () {
        if (!window.ZanResume) return;
        if (!window.confirm('Hapus semua riwayat Lanjut Nonton? Posisi terakhir semua film akan dilupakan.')) return;
        window.ZanResume.clearAll('movie');
      });
    }
    if (window.ZanResume) window.ZanResume.on(renderResumeCarousel);
    renderResumeCarousel();

    if (el.movieSheetClose) {
      el.movieSheetClose.addEventListener('click', closeMovieSheet);
    }
    if (el.movieSheet) {
      el.movieSheet.addEventListener('click', function (e) {
        if (e.target === el.movieSheet) closeMovieSheet();
      });
    }

    if (el.movieAdminBtn) {
      el.movieAdminBtn.addEventListener('click', openMovieAdminDialog);
    }
    if (el.acctMovieAdminBtn) {
      el.acctMovieAdminBtn.addEventListener('click', function () {
        var acctDlg = document.getElementById('acctDialog');
        if (acctDlg && typeof acctDlg.close === 'function') {
          try { acctDlg.close(); } catch (e) {}
        }
        openMovieAdminDialog();
      });
    }
  }

  /* ---------------- ADMIN: KELOLA BIOSKOP 21, ENGINE & WATERMARK LOGO ---------------- */
  async function saveAdminConfig(payload, prevInfo) {
    payload = payload || {};
    var localCur = Object.assign({}, loadLocalAppConfig(), M.appConfig || {}, prevInfo || {});
    var merged = {
      ok: true,
      active: payload.url && /^https?:\/\//i.test(payload.url) ? payload.url : (localCur.active || localCur.movieMirror || 'https://klikxxi.shop'),
      engine: payload.engine || localCur.engine || localCur.movieEngine || 'moviebox',
      movieEnabled: typeof payload.movieEnabled === 'boolean' ? payload.movieEnabled : (localCur.movieEnabled !== false),
      watermarkLogo: typeof payload.watermarkLogo === 'string' ? payload.watermarkLogo : (localCur.watermarkLogo || ''),
      watermarkText: typeof payload.watermarkText === 'string' ? payload.watermarkText : (localCur.watermarkText || 'ZanTV'),
      mirrors: (prevInfo && prevInfo.mirrors) || ['https://klikxxi.shop', 'https://filmlokal.me', 'https://ww11.pencurimovie.sbs']
    };
    merged.config = {
      movieEnabled: merged.movieEnabled,
      movieEngine: merged.engine,
      movieMirror: merged.active,
      watermarkLogo: merged.watermarkLogo,
      watermarkText: merged.watermarkText
    };
    applyAppConfig(merged.config);

    try {
      var res = await apiPost('admin/mirror', payload);
      if (res && res.ok) {
        if (res.config) applyAppConfig(res.config);
        return Object.assign({}, merged, res);
      }
    } catch (err) {
      // Fallback ke endpoint legacy /api/movie/admin/providers jika server lama masih jalan
      if (payload.url && /^https?:\/\//i.test(payload.url)) {
        try {
          await apiPost('admin/providers', { providerId: 'klikxxi', mirror: payload.url });
        } catch (e2) {}
      }
    }
    return merged;
  }

  async function openMovieAdminDialog() {
    if (!el.movieAdminDialog) return;

    if (el.movieAdminList) {
      el.movieAdminList.innerHTML = '<div style="padding:18px;text-align:center;color:var(--muted)">Memuat pengaturan Admin...</div>';
    }

    if (typeof el.movieAdminDialog.showModal === 'function') {
      try { el.movieAdminDialog.showModal(); } catch (e) { el.movieAdminDialog.setAttribute('open', ''); }
    } else {
      el.movieAdminDialog.setAttribute('open', '');
    }

    var localCfg = Object.assign({}, loadLocalAppConfig(), M.appConfig || {});
    var fallbackInfo = {
      ok: true,
      active: localCfg.movieMirror || 'https://klikxxi.shop',
      engine: localCfg.movieEngine || 'moviebox',
      movieEnabled: localCfg.movieEnabled !== false,
      watermarkLogo: localCfg.watermarkLogo || '',
      watermarkText: localCfg.watermarkText || 'ZanTV',
      mirrors: ['https://klikxxi.shop', 'https://filmlokal.me', 'https://ww11.pencurimovie.sbs']
    };

    try {
      var info = await apiGet('admin/mirror');
      if (info && info.ok) {
        renderAdminMirrorUI(Object.assign({}, fallbackInfo, info));
        return;
      }
    } catch (e) {}

    // Fallback ke /api/config + /api/movie/providers jika endpoint admin/mirror belum aktif
    try {
      var cfgRes = await fetch('/api/config', { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' });
      if (cfgRes.ok) {
        var cfgData = await cfgRes.json();
        if (cfgData && cfgData.config) {
          fallbackInfo.movieEnabled = cfgData.config.movieEnabled !== false;
          fallbackInfo.engine = cfgData.config.movieEngine || fallbackInfo.engine;
          fallbackInfo.active = cfgData.config.movieMirror || fallbackInfo.active;
          fallbackInfo.watermarkLogo = cfgData.config.watermarkLogo || fallbackInfo.watermarkLogo;
          fallbackInfo.watermarkText = cfgData.config.watermarkText || fallbackInfo.watermarkText;
        }
      }
    } catch (e) {}

    try {
      var prov = await apiGet('providers');
      if (prov && Array.isArray(prov.providers) && prov.providers.length) {
        var p0 = prov.providers[0];
        if (p0.activeMirror && !p0.activeMirror.includes('ngefilm') && !p0.activeMirror.includes('idmxl')) {
          fallbackInfo.active = p0.activeMirror;
        }
        if (Array.isArray(p0.mirrors)) {
          fallbackInfo.mirrors = p0.mirrors;
        }
      }
    } catch (e) {}

    renderAdminMirrorUI(fallbackInfo);
  }

  function renderAdminMirrorUI(info) {
    if (!el.movieAdminList) return;
    info = info || {};
    var activeUrl = info.active || 'https://klikxxi.shop';
    var activeEngine = info.engine || 'moviebox';
    var movieEnabled = info.movieEnabled !== false;
    var wmLogo = info.watermarkLogo || '';
    var wmText = info.watermarkText || 'ZanTV';
    var previewLogo = wmLogo || 'icons/icon-192.png';

    var verified = ['https://klikxxi.shop', 'https://filmlokal.me', 'https://ww11.pencurimovie.sbs'];
    if (info.mirrors && info.mirrors.length) {
      info.mirrors.forEach(function (m) {
        if (!m.includes('ngefilm') && !m.includes('idmxl') && verified.indexOf(m) === -1) {
          verified.push(m);
        }
      });
    }
    if (verified.indexOf(activeUrl) === -1) verified.unshift(activeUrl);

    var chipsHtml = verified.map(function (m) {
      var isCur = m === activeUrl;
      return '<button type="button" class="movie-mirror-chip' + (isCur ? ' is-active' : '') + '" data-mirror="' + escapeHtml(m) + '">' +
        (isCur ? '✓ ' : '') + escapeHtml(m.replace(/^https?:\/\//, '')) +
      '</button>';
    }).join('');

    el.movieAdminList.innerHTML =
      /* 1. KARTU TOGGLE AKTIF / NONAKTIF BIOSKOP 21 */
      '<div class="movie-admin-item" style="margin-bottom:12px;">' +
        '<div class="movie-admin-head" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
          '<div class="movie-admin-info">' +
            '<span class="movie-admin-icon">🍿</span>' +
            '<div class="movie-admin-title-box">' +
              '<strong class="movie-admin-title">Status Fitur Bioskop 21</strong>' +
              '<span class="movie-admin-status-pill" style="background:' + (movieEnabled ? 'rgba(16,185,129,0.18);color:#34d399' : 'rgba(239,68,68,0.18);color:#f87171') + '">' +
                (movieEnabled ? '🟢 AKTIF UNTUK SEMUA USER' : '🔴 DINONAKTIFKAN') +
              '</span>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn ' + (movieEnabled ? 'ghost' : 'primary') + '" id="adminToggleBioskopBtn" style="min-width:130px;justify-content:center;">' +
            (movieEnabled ? '⏸ Matikan Bioskop' : '▶️ Aktifkan Bioskop') +
          '</button>' +
        '</div>' +
        '<div class="movie-admin-desc">Jika dimatikan, menu tab <b>Bioskop 21</b> akan disembunyikan dari layar utama seluruh pengguna secara instan.</div>' +
      '</div>' +

      /* 2. KARTU WATERMARK LOGO & BRAND LAYAR */
      '<div class="movie-admin-item" style="margin-bottom:12px;">' +
        '<div class="movie-admin-head" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
          '<div class="movie-admin-info">' +
            '<span class="movie-admin-icon">✨</span>' +
            '<div class="movie-admin-title-box">' +
              '<strong class="movie-admin-title">Custom Logo & Watermark Layar</strong>' +
              '<span class="movie-admin-status-pill">Tampil di Pojok Kanan Atas Video</span>' +
            '</div>' +
          '</div>' +
          '<div id="adminWmPreview" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:rgba(10,14,24,0.78);border:1px solid rgba(255,255,255,0.16);box-shadow:0 4px 14px rgba(0,0,0,0.4);">' +
            '<img id="adminWmPreviewImg" src="' + escapeHtml(previewLogo) + '" alt="" width="20" height="20" style="border-radius:5px;object-fit:contain;">' +
            '<span id="adminWmPreviewText" style="font-size:13px;font-weight:600;color:#fff;letter-spacing:0.3px;">' + formatBrandHtml(wmText) + '</span>' +
            '<span style="font-size:9px;font-weight:800;padding:2px 5px;border-radius:4px;background:linear-gradient(135deg,#22d3ee,#a855f7);color:#000;">HD</span>' +
          '</div>' +
        '</div>' +
        '<div class="movie-admin-desc">Ganti logo dan teks watermark di layar player menggunakan URL gambar atau unggah langsung file logo (PNG/WebP/SVG/JPG) dari perangkatmu.</div>' +
        '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px;">' +
          '<input type="text" class="movie-admin-url-input" id="adminWmLogoInput" value="' + escapeHtml(wmLogo) + '" placeholder="URL Logo (https://...) atau klik Unggah File ➡️" autocomplete="off" spellcheck="false">' +
          '<label class="btn ghost" style="cursor:pointer;margin:0;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">' +
            '<span>📁 Unggah Logo</span>' +
            '<input type="file" id="adminWmLogoFile" accept="image/*" hidden>' +
          '</label>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;margin-top:8px;">' +
          '<input type="text" class="movie-admin-url-input" id="adminWmTextInput" value="' + escapeHtml(wmText) + '" placeholder="Teks Brand (contoh: ZanTV)" maxlength="28">' +
          '<button type="button" class="btn ghost" id="adminWmResetBtn" title="Kembalikan ke logo bawaan ZanTV">Reset</button>' +
          '<button type="button" class="btn primary" id="adminWmSaveBtn">💾 Simpan Logo</button>' +
        '</div>' +
      '</div>' +

      /* 3. KARTU DUAL-ENGINE PROVIDER BIOSKOP */
      '<div class="movie-admin-item">' +
        '<div class="movie-admin-head">' +
          '<div class="movie-admin-info">' +
            '<span class="movie-admin-icon">🚀</span>' +
            '<div class="movie-admin-title-box">' +
              '<strong class="movie-admin-title">Mesin Provider Bioskop & Series</strong>' +
              '<span class="movie-admin-status-pill">🟢 Mesin Aktif: ' + (activeEngine === 'moviebox' ? 'MovieBox Official CDN (Utama)' : ('KlikXXI (' + escapeHtml(activeUrl) + ')')) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="movie-admin-desc">Pilih mesin utama pengambil katalog & video. <b>MovieBox Official CDN</b> sangat direkomendasikan karena menggunakan JSON API murni (1080p/720p cepat, Subtitle Indonesia otomatis, 0% judol & bebas blokir).</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0;">' +
          '<button type="button" class="movie-mirror-chip' + (activeEngine === 'moviebox' ? ' is-active' : '') + '" id="engineBtnMoviebox" style="padding:10px 12px;text-align:left;display:flex;flex-direction:column;gap:3px;border-radius:12px;">' +
            '<strong style="font-size:12.5px;">' + (activeEngine === 'moviebox' ? '✓ ' : '') + '⚡ MovieBox Official API</strong>' +
            '<span style="font-size:10.5px;opacity:0.8;">Direct CDN 1080p · Sub Indo · Anti-Macet</span>' +
          '</button>' +
          '<button type="button" class="movie-mirror-chip' + (activeEngine === 'klikxxi' ? ' is-active' : '') + '" id="engineBtnKlikxxi" style="padding:10px 12px;text-align:left;display:flex;flex-direction:column;gap:3px;border-radius:12px;">' +
            '<strong style="font-size:12.5px;">' + (activeEngine === 'klikxxi' ? '✓ ' : '') + '🎞️ KlikXXI CloudX (VOE)</strong>' +
            '<span style="font-size:10.5px;opacity:0.8;">Scraper WordPress + Mirror Domain</span>' +
          '</button>' +
        '</div>' +
        '<div id="klikxxiMirrorBox" style="' + (activeEngine === 'klikxxi' ? '' : 'opacity:0.65;') + 'margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);">' +
          '<div class="movie-admin-url-box">' +
            '<span class="movie-admin-url-label">Mirror KlikXXI:</span>' +
            '<input type="url" class="movie-admin-url-input" id="movieMirrorInput" value="' + escapeHtml(activeUrl) + '" placeholder="https://klikxxi.shop" autocomplete="off" spellcheck="false">' +
            '<button type="button" class="btn primary movie-admin-url-btn" id="movieMirrorSaveBtn">Simpan Mirror</button>' +
          '</div>' +
          '<div style="margin-top:8px;">' +
            '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600;">Mirror Cadangan KlikXXI:</div>' +
            '<div class="movie-mirror-chips" id="movieMirrorChips" style="display:flex;flex-wrap:wrap;gap:6px;">' +
              chipsHtml +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Bind Toggle Bioskop ON/OFF
    var toggleBioskopBtn = document.getElementById('adminToggleBioskopBtn');
    if (toggleBioskopBtn) {
      toggleBioskopBtn.addEventListener('click', async function () {
        var nextState = !movieEnabled;
        try {
          toggleBioskopBtn.disabled = true;
          toggleBioskopBtn.textContent = 'Menyimpan...';
          var res = await saveAdminConfig({ movieEnabled: nextState }, info);
          showToast(nextState ? '✅ Fitur Bioskop 21 diaktifkan!' : '⏸ Fitur Bioskop 21 dinonaktifkan.');
          renderAdminMirrorUI(Object.assign({}, info, res));
        } catch (err) {
          toggleBioskopBtn.disabled = false;
          showToast('❌ Gagal mengubah status Bioskop: ' + (err.message || 'Error'));
        }
      });
    }

    // Bind Watermark Logo Upload, Preview & Save
    var wmLogoInput = document.getElementById('adminWmLogoInput');
    var wmLogoFile = document.getElementById('adminWmLogoFile');
    var wmTextInput = document.getElementById('adminWmTextInput');
    var wmSaveBtn = document.getElementById('adminWmSaveBtn');
    var wmResetBtn = document.getElementById('adminWmResetBtn');
    var wmPrevImg = document.getElementById('adminWmPreviewImg');
    var wmPrevTxt = document.getElementById('adminWmPreviewText');

    function updateWmPreview() {
      var lVal = (wmLogoInput && wmLogoInput.value.trim()) || 'icons/icon-192.png';
      var tVal = (wmTextInput && wmTextInput.value.trim()) || 'ZanTV';
      if (wmPrevImg) wmPrevImg.src = lVal;
      if (wmPrevTxt) wmPrevTxt.innerHTML = formatBrandHtml(tVal);
    }

    if (wmLogoInput) wmLogoInput.addEventListener('input', updateWmPreview);
    if (wmTextInput) wmTextInput.addEventListener('input', updateWmPreview);

    if (wmLogoFile) {
      wmLogoFile.addEventListener('change', async function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          showToast('⏳ Memproses logo...');
          var dataUri = await compressLogoFile(file);
          if (wmLogoInput) wmLogoInput.value = dataUri;
          updateWmPreview();
          showToast('✅ Logo siap disimpan! Klik tombol Simpan Logo.');
        } catch (err) {
          showToast('❌ ' + (err.message || 'Gagal memuat gambar'));
        }
      });
    }

    if (wmResetBtn) {
      wmResetBtn.addEventListener('click', async function () {
        if (wmLogoInput) wmLogoInput.value = '';
        if (wmTextInput) wmTextInput.value = 'ZanTV';
        updateWmPreview();
        try {
          var res = await saveAdminConfig({ watermarkLogo: '', watermarkText: 'ZanTV' }, info);
          showToast('🔄 Watermark dikembalikan ke bawaan ZanTV');
          renderAdminMirrorUI(Object.assign({}, info, res));
        } catch (err) {
          showToast('❌ ' + (err.message || 'Gagal mereset watermark'));
        }
      });
    }

    if (wmSaveBtn) {
      wmSaveBtn.addEventListener('click', async function () {
        var newLogo = wmLogoInput ? wmLogoInput.value.trim() : '';
        var newText = wmTextInput ? wmTextInput.value.trim() : 'ZanTV';
        try {
          wmSaveBtn.disabled = true;
          wmSaveBtn.textContent = 'Menyimpan...';
          var res = await saveAdminConfig({ watermarkLogo: newLogo, watermarkText: newText }, info);
          showToast('✅ Watermark layar berhasil diperbarui!');
          renderAdminMirrorUI(Object.assign({}, info, res));
        } catch (err) {
          wmSaveBtn.disabled = false;
          wmSaveBtn.textContent = '💾 Simpan Logo';
          showToast('❌ Gagal menyimpan logo: ' + (err.message || 'Error'));
        }
      });
    }

    // Bind Engine Switcher (MovieBox vs KlikXXI)
    var btnMb = document.getElementById('engineBtnMoviebox');
    var btnKx = document.getElementById('engineBtnKlikxxi');

    async function switchEngineTo(eng) {
      try {
        var res = await saveAdminConfig({ engine: eng }, info);
        showToast('🚀 Mesin Bioskop 21 dialihkan ke: ' + (eng === 'moviebox' ? 'MovieBox Official CDN' : 'KlikXXI CloudX'));
        renderAdminMirrorUI(Object.assign({}, info, res));
        M.page = 1;
        loadMovies(false);
      } catch (err) {
        showToast('❌ Gagal mengganti mesin: ' + (err.message || 'Error'));
      }
    }

    if (btnMb) btnMb.addEventListener('click', function () { switchEngineTo('moviebox'); });
    if (btnKx) btnKx.addEventListener('click', function () { switchEngineTo('klikxxi'); });

    // Bind KlikXXI Mirror Saver
    var saveBtn = document.getElementById('movieMirrorSaveBtn');
    var inputEl = document.getElementById('movieMirrorInput');
    var chipsWrap = document.getElementById('movieMirrorChips');

    if (chipsWrap && inputEl) {
      chipsWrap.addEventListener('click', function (e) {
        var chip = e.target.closest('.movie-mirror-chip');
        if (!chip) return;
        var targetMirror = chip.getAttribute('data-mirror');
        if (targetMirror) {
          inputEl.value = targetMirror;
          chipsWrap.querySelectorAll('.movie-mirror-chip').forEach(function (c) {
            c.classList.toggle('is-active', c === chip);
          });
        }
      });
    }

    if (saveBtn && inputEl) {
      saveBtn.addEventListener('click', async function () {
        var newMirror = inputEl.value.trim();
        if (!newMirror || !/^https?:\/\//i.test(newMirror)) {
          showToast('⚠️ Masukkan alamat lengkap (harus diawali https://)');
          return;
        }
        try {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Menyimpan...';
          var res = await saveAdminConfig({ url: newMirror, engine: 'klikxxi' }, info);
          showToast('✅ Mirror KlikXXI disimpan & diaktifkan: ' + res.active);
          renderAdminMirrorUI(Object.assign({}, info, res));
          M.page = 1;
          loadMovies(false);
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Simpan Mirror';
          showToast('❌ Gagal menyimpan mirror: ' + (err.message || 'Error'));
        }
      });
    }
  }

  /* ---------------- PUBLIC API EXPORTS ---------------- */
  window.ZanMovie = {
    loadMovies: loadMovies,
    openMovieDetail: openMovieDetail,
    playCurrentSelection: playCurrentSelection,
    playNextEpisode: playNextEpisode,
    openAdmin: openMovieAdminDialog,
    applyAppConfig: applyAppConfig,
    switchServer: function (tabId) {
      if (!tabId) return;
      M.selectedServer = tabId;
      playCurrentSelection();
    },
    onEnter: function () {
      if (!M.movies || !M.movies.length) {
        loadMovies(false);
      }
    },
    isPlayingMovie: function () {
      return !!(window.ZanTV && window.ZanTV.isPlayingVod && window.ZanTV.isPlayingVod() &&
                document.body.classList.contains('is-movie-mode'));
    },
    getState: function () { return M; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
