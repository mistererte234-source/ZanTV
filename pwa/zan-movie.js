/* ZanTV Bioskop & Movie VOD Explorer v1.7.29
 * Integrasi Multi-Provider Film Bioskop Indonesia (CloudX-V2 Scraper & Extractor)
 * Providers: Bioskop 21 (KlikXXi/Ngefilm), PusatMovie21, SarangFilm21, SaveFilm21, WGFilm21
 * Fitur: Multi-Provider Tabs, Auto-Failover Mirrors, Full 16:9 Landscape Player, Direct M3U8 & Stage Embed
 * Desain iOS Glassmorphism Premium & Smooth Micro-animations
 * Crafted with love by Lody for ZanTV.
 */
(function () {
  'use strict';

  var DEFAULT_PROVIDERS = [
    { id: 'klikxxi', name: 'Bioskop 21 (KlikXXi)', shortName: 'Bioskop 21', icon: '🎬' },
    { id: 'pusatmovie', name: 'PusatMovie21', shortName: 'PusatMovie', icon: '🌟' },
    { id: 'sarangfilm', name: 'SarangFilm21', shortName: 'SarangFilm', icon: '🍿' },
    { id: 'savefilm', name: 'SaveFilm21', shortName: 'SaveFilm', icon: '💾' },
    { id: 'wgfilm', name: 'WGFilm21', shortName: 'WGFilm', icon: '⚡' }
  ];

  var DEFAULT_CATEGORIES = [
    { id: 'terbaru', name: '🔥 Terbaru 2026' },
    { id: 'popular', alt: 'populer', name: '⭐ Populer 2025' },
    { id: 'series', name: '📺 TV Series' },
    { id: 'action', name: '💥 Action' },
    { id: 'horror', name: '👻 Horror' },
    { id: 'comedy', alt: 'komedi', name: '😂 Komedi' },
    { id: 'romance', name: '❤️ Romance' },
    { id: 'scifi', name: '🚀 Sci-Fi' },
    { id: 'thriller', name: '🔪 Thriller' },
    { id: 'animation', alt: 'animasi', name: '🎨 Animasi' },
    { id: 'drama', name: '🎭 Drama' }
  ];

  var M = {
    provider: localStorage.getItem('zan_movie_prov') || 'klikxxi',
    providers: DEFAULT_PROVIDERS,
    categories: DEFAULT_CATEGORIES,
    category: 'terbaru',
    page: 1,
    query: '',
    loading: false,
    hasMore: true,
    movies: [],
    currentMovie: null,
    currentDetail: null,
    selectedServer: 'p3', // Default p3 (VOE Embed stream)
    selectedEpisode: null,
    activePlayingMovie: null
  };

  var el = {};

  function initElements() {
    el.moviePane = document.getElementById('moviePane');
    el.movieGrid = document.getElementById('movieGrid');
    el.movieSearchInput = document.getElementById('movieSearchInput');
    el.movieSearchClear = document.getElementById('movieSearchClear');
    el.movieProvTabs = document.getElementById('movieProvTabs');
    el.movieCatChips = document.getElementById('movieCatChips');
    el.movieLoading = document.getElementById('movieLoading');
    el.movieEmpty = document.getElementById('movieEmpty');
    el.movieLoadMoreWrap = document.getElementById('movieLoadMoreWrap');
    el.movieLoadMoreBtn = document.getElementById('movieLoadMoreBtn');

    // Resume / Continue Watching Carousel
    el.movieResumeSection = document.getElementById('movieResumeSection');
    el.movieResumeList = document.getElementById('movieResumeList');
    el.movieResumeCount = document.getElementById('movieResumeCount');
    el.movieResumeClearBtn = document.getElementById('movieResumeClearBtn');

    // Admin Dialog Elements
    el.movieAdminBtn = document.getElementById('movieAdminBtn');
    el.acctMovieAdminBtn = document.getElementById('acctMovieAdminBtn');
    el.movieAdminDialog = document.getElementById('movieAdminDialog');
    el.movieAdminList = document.getElementById('movieAdminList');

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
    el.movieSheetPlayBtnText = document.getElementById('movieSheetPlayBtnText');
    el.movieSheetRestartBtn = document.getElementById('movieSheetRestartBtn');
    el.movieSheetResumeBox = document.getElementById('movieSheetResumeBox');
    el.movieSheetResumeText = document.getElementById('movieSheetResumeText');
    el.movieSheetResumeFill = document.getElementById('movieSheetResumeFill');
    el.movieEpSection = document.getElementById('movieEpSection');
    el.movieEpCount = document.getElementById('movieEpCount');
    el.movieEpList = document.getElementById('movieEpList');
  }

  /* ---------------- WATCH HISTORY & RESUME ENGINE (NETFLIX STYLE) ---------------- */
  var HISTORY_KEY = 'zantv_movie_history';
  var MAX_HISTORY = 30;

  function getWatchHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[ZanMovie] Gagal baca riwayat tontonan:', e);
      return [];
    }
  }

  function saveWatchHistoryItem(item) {
    if (!item || !item.url) return;
    try {
      var list = getWatchHistory();
      list = list.filter(function (x) { return x.url !== item.url; });
      list.unshift(item);
      if (list.length > MAX_HISTORY) list = list.slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[ZanMovie] Gagal simpan riwayat film:', e);
    }
  }

  function removeWatchHistoryItem(url) {
    if (!url) return;
    try {
      var list = getWatchHistory();
      list = list.filter(function (x) { return x.url !== url; });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[ZanMovie] Gagal hapus riwayat film:', e);
    }
  }

  function clearAllWatchHistory() {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch (e) {}
  }

  function getMovieProgress(url) {
    if (!url) return null;
    var list = getWatchHistory();
    return list.find(function (x) { return x.url === url; }) || null;
  }

  function formatVodDuration(sec) {
    if (sec == null || isNaN(sec) || !isFinite(sec) || sec < 0) return '00:00';
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return pad(m) + ':' + pad(s);
  }

  function formatRemainingText(cur, dur) {
    if (!dur || dur <= cur) return '';
    var remSec = Math.max(0, dur - cur);
    var remMin = Math.round(remSec / 60);
    if (remMin >= 60) {
      var h = Math.floor(remMin / 60);
      var m = remMin % 60;
      return 'Sisa ' + h + 'j' + (m > 0 ? ' ' + m + 'm' : '');
    }
    return 'Sisa ' + remMin + ' mnt';
  }

  function renderResumeCarousel() {
    if (!el.movieResumeSection || !el.movieResumeList) return;
    var history = getWatchHistory();
    if (!history || !history.length) {
      el.movieResumeSection.hidden = true;
      el.movieResumeList.innerHTML = '';
      return;
    }

    el.movieResumeSection.hidden = false;
    if (el.movieResumeCount) {
      el.movieResumeCount.textContent = history.length + ' Film';
    }

    el.movieResumeList.innerHTML = history.map(function (item) {
      var pct = Math.max(0, Math.min(100, item.progressPct || 0));
      var curStr = formatVodDuration(item.currentTime);
      var durStr = formatVodDuration(item.duration);
      var remStr = formatRemainingText(item.currentTime, item.duration);
      var posterUrl = item.poster || 'icons/icon-192.png';

      return '<div class="movie-resume-card" data-url="' + escapeHtml(item.url) + '" data-prov="' + escapeHtml(item.provider || '') + '" title="' + escapeHtml(item.title) + '">' +
        '<div class="movie-resume-thumb-wrap">' +
          '<img class="movie-resume-thumb" src="' + escapeHtml(posterUrl) + '" alt="' + escapeHtml(item.title) + '" loading="lazy" onerror="this.src=\'icons/icon-192.png\'">' +
          '<div class="movie-resume-overlay">' +
            '<div class="movie-resume-play-ic">' +
              '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="movie-resume-remove-btn" data-remove-url="' + escapeHtml(item.url) + '" title="Hapus dari daftar">✕</button>' +
          (item.quality ? '<span class="movie-resume-badge">' + escapeHtml(item.quality) + '</span>' : '') +
          '<div class="movie-resume-bar-wrap">' +
            '<div class="movie-resume-bar-fill" style="width: ' + pct + '%"></div>' +
          '</div>' +
        '</div>' +
        '<div class="movie-resume-meta">' +
          '<div class="movie-resume-name">' + escapeHtml(item.title) + '</div>' +
          '<div class="movie-resume-time-info">' +
            '<span class="movie-resume-time">' + curStr + ' / ' + durStr + '</span>' +
            (remStr ? '<span class="movie-resume-rem">' + escapeHtml(remStr) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  var lastProgressSaveTime = 0;
  function onPlaybackProgress(currentTime, duration) {
    if (!M.activePlayingMovie || !currentTime || !duration || duration < 30 || currentTime < 5) return;
    var now = Date.now();
    if (now - lastProgressSaveTime < 3000) return;
    lastProgressSaveTime = now;

    var cur = Math.floor(currentTime);
    var dur = Math.floor(duration);
    var pct = Math.round((cur / dur) * 100);

    // Jika sudah 95% ke atas (film selesai/credits), hapus dari daftar resume
    if (pct >= 95) {
      removeWatchHistoryItem(M.activePlayingMovie.url);
      renderResumeCarousel();
      return;
    }

    var histItem = {
      url: M.activePlayingMovie.url,
      title: M.activePlayingMovie.title,
      poster: M.activePlayingMovie.poster,
      rating: M.activePlayingMovie.rating || '',
      quality: M.activePlayingMovie.quality || '',
      provider: M.activePlayingMovie.provider || M.provider,
      providerName: M.activePlayingMovie.providerName || '',
      activeServer: M.activePlayingMovie.activeServer || M.selectedServer || 'p3',
      currentTime: cur,
      duration: dur,
      progressPct: pct,
      updatedAt: now
    };
    saveWatchHistoryItem(histItem);
    renderResumeCarousel();
  }

  /* ---------------- API CLIENT ---------------- */
  async function apiGet(endpoint, params) {
    var qs = new URLSearchParams(params || {}).toString();
    var url = '/api/movie/' + endpoint + (qs ? '?' + qs : '');
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, 8500);
    try {
      var res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'X-ZanTV': '1'
        },
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

  async function apiPost(endpoint, data) {
    var url = '/api/movie/' + endpoint;
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, 8500);
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-ZanTV': '1'
        },
        credentials: 'same-origin',
        body: JSON.stringify(data || {}),
        signal: ac.signal
      });
      clearTimeout(timer);
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.error || ('HTTP ' + res.status));
      }
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      console.warn('[ZanMovie] API POST error:', endpoint, e);
      throw e;
    }
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

  /* ---------------- RENDER PROVIDER TABS ---------------- */
  function renderProviderTabs() {
    if (!el.movieProvTabs) return;
    var list = (M.providers && M.providers.length)
      ? M.providers.filter(function (p) { return p.enabled !== false; })
      : DEFAULT_PROVIDERS;

    // Pastikan provider terpilih masih ada di daftar aktif
    if (list.length && !list.some(function (p) { return p.id === M.provider; })) {
      M.provider = list[0].id;
      localStorage.setItem('zan_movie_prov', M.provider);
    }

    el.movieProvTabs.innerHTML = list.map(function (p) {
      var active = (p.id === M.provider) ? ' is-active' : '';
      return '<button type="button" class="movie-prov-btn' + active + '" data-prov="' + p.id + '">' +
        '<span class="movie-prov-icon">' + (p.icon || '🎬') + '</span>' +
        '<span>' + escapeHtml(p.shortName || p.name) + '</span>' +
      '</button>';
    }).join('');
  }

  /* ---------------- RENDER KATEGORI CHIPS ---------------- */
  function renderCategoryChips() {
    if (!el.movieCatChips) return;
    var cats = (M.categories && M.categories.length) ? M.categories : DEFAULT_CATEGORIES;
    el.movieCatChips.innerHTML = cats.map(function (c) {
      var active = (c.id === M.category || c.alt === M.category) ? ' is-active' : '';
      return '<button type="button" class="movie-cat-chip' + active + '" data-cat="' + c.id + '">' + escapeHtml(c.name || c.label || c.id) + '</button>';
    }).join('');
  }

  /* ---------------- MUAT KATEGORI PROVIDER ---------------- */
  async function loadCategories() {
    try {
      var res = await apiGet('categories', { provider: M.provider });
      if (res && res.categories && res.categories.length) {
        M.categories = res.categories;
        var valid = M.categories.some(function (c) { return c.id === M.category || c.alt === M.category; });
        if (!valid) M.category = M.categories[0].id;
        renderCategoryChips();
      }
    } catch (e) {
      console.warn('[ZanMovie] Gagal muat kategori:', e);
    }
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
        res = await apiGet('search', { provider: M.provider, q: M.query, page: M.page });
      } else {
        res = await apiGet('list', { provider: M.provider, category: M.category, page: M.page });
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
            ? 'Koneksi ke server film sedang sibuk atau timeout. Silakan klik tab provider lain di atas atau coba lagi.'
            : 'Tidak ada film ditemukan.';
        }
      }
      if (el.movieLoadMoreWrap) el.movieLoadMoreWrap.hidden = true;
      return;
    }

    if (el.movieEmpty) el.movieEmpty.hidden = true;
    M.hasMore = items.length >= 15;
    if (el.movieLoadMoreWrap) el.movieLoadMoreWrap.hidden = !M.hasMore;

    renderMovieCards(items, append);
  }

  /* ---------------- RENDER KARTU FILM ---------------- */
  function renderMovieCards(items, append) {
    if (!el.movieGrid) return;
    var curProv = (M.providers && M.providers.find(function (p) { return p.id === M.provider; })) || {};
    var provLabel = curProv.shortName || 'Bioskop';

    var html = items.map(function (m) {
      var poster = m.poster || 'icons/icon-192.png';
      var ratingBadge = m.rating ? '<span class="movie-card-rating">' + escapeHtml(m.rating) + '</span>' : '';
      var qualityBadge = m.quality ? '<span class="movie-card-quality">' + escapeHtml(m.quality) + '</span>' : '';
      var typeTag = m.isSeries ? 'SERIES' : 'FILM';

      return '<div class="movie-card" data-url="' + escapeHtml(m.url) + '" data-prov="' + escapeHtml(m.provider || M.provider) + '" tabindex="0" role="button" aria-label="' + escapeHtml(m.title) + '">' +
        '<div class="movie-card-thumb-wrap">' +
          '<img class="movie-card-thumb" src="' + escapeHtml(poster) + '" alt="' + escapeHtml(m.title) + '" loading="lazy" onerror="this.src=\'icons/icon-192.png\'">' +
          ratingBadge +
          qualityBadge +
        '</div>' +
        '<div class="movie-card-info">' +
          '<h3 class="movie-card-title">' + escapeHtml(m.title) + '</h3>' +
          '<div class="movie-card-meta">' +
            '<span class="movie-card-type">' + typeTag + '</span>' +
            '<span>' + escapeHtml(provLabel) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    if (append) {
      el.movieGrid.insertAdjacentHTML('beforeend', html);
    } else {
      el.movieGrid.innerHTML = html;
    }
  }

  /* ---------------- BUKA DETAIL FILM (SHEET) ---------------- */
  async function openMovieDetail(item, opts) {
    if (!item) return;
    opts = opts || {};
    M.currentMovie = item;
    M.currentDetail = null;
    M.selectedServer = item.activeServer || 'p3'; // default p3 VOE
    M.selectedEpisode = null;

    var curProv = (M.providers && M.providers.find(function (p) { return p.id === (item.provider || M.provider); })) || {};
    var provBadge = (curProv.shortName || 'BIOSKOP').toUpperCase();

    // Cek progress tontonan dari riwayat lokal (Netflix / Disney+ style)
    var progress = getMovieProgress(item.url);
    if (progress && progress.currentTime > 5) {
      if (el.movieSheetResumeBox) {
        el.movieSheetResumeBox.hidden = false;
        if (el.movieSheetResumeText) {
          el.movieSheetResumeText.textContent = 'Terakhir ditonton sampai menit ' + formatVodDuration(progress.currentTime) + ' (' + (progress.progressPct || 0) + '%)';
        }
        if (el.movieSheetResumeFill) {
          el.movieSheetResumeFill.style.width = Math.min(100, Math.max(0, progress.progressPct || 0)) + '%';
        }
      }
      if (el.movieSheetPlayBtnText) {
        el.movieSheetPlayBtnText.textContent = 'Lanjut Nonton (' + formatVodDuration(progress.currentTime) + ')';
      }
      if (el.movieSheetRestartBtn) {
        el.movieSheetRestartBtn.hidden = false;
      }
    } else {
      if (el.movieSheetResumeBox) el.movieSheetResumeBox.hidden = true;
      if (el.movieSheetPlayBtnText) el.movieSheetPlayBtnText.textContent = 'Putar Film Sekarang';
      if (el.movieSheetRestartBtn) el.movieSheetRestartBtn.hidden = true;
    }

    // Tampilkan data awal seketika
    if (el.movieSheetCover) el.movieSheetCover.src = item.poster || 'icons/icon-192.png';
    if (el.movieSheetTitle) el.movieSheetTitle.textContent = item.title || 'Film Bioskop';
    if (el.movieSheetRating) {
      el.movieSheetRating.textContent = item.rating || '⭐ 8.0';
      el.movieSheetRating.hidden = !item.rating;
    }
    if (el.movieSheetQuality) el.movieSheetQuality.textContent = item.quality || 'HD';
    if (el.movieSheetBadge) el.movieSheetBadge.textContent = item.isSeries ? 'TV SERIES' : provBadge;
    if (el.movieSheetMeta) el.movieSheetMeta.innerHTML = '<span>Memuat informasi lengkap...</span>';
    if (el.movieSheetDesc) el.movieSheetDesc.textContent = 'Mengambil sinopsis dan server streaming...';
    if (el.movieEpSection) el.movieEpSection.hidden = true;
    if (el.movieSheetServers) el.movieSheetServers.innerHTML = '<span class="movie-server-btn is-active">Server 3 (VOE)</span>';
    if (el.movieSheetPlayBtn) {
      el.movieSheetPlayBtn.disabled = true;
      if (el.movieSheetPlayBtnText) el.movieSheetPlayBtnText.textContent = 'Menyiapkan...';
    }

    if (el.movieSheet) {
      if (typeof el.movieSheet.showModal === 'function') {
        try { el.movieSheet.showModal(); } catch (e) { el.movieSheet.setAttribute('open', ''); }
      } else {
        el.movieSheet.setAttribute('open', '');
      }
    }

    // Ambil detail lengkap dari backend ZanTV
    var targetProv = item.provider || M.provider;
    var detail = await apiGet('detail', { provider: targetProv, url: item.url });
    if (!detail) {
      if (el.movieSheetDesc) el.movieSheetDesc.textContent = 'Gagal memuat detail film. Silakan coba lagi.';
      if (el.movieSheetPlayBtn) {
        el.movieSheetPlayBtn.disabled = false;
        if (el.movieSheetPlayBtnText) el.movieSheetPlayBtnText.textContent = 'Coba Putar Langsung';
      }
      return;
    }

    M.currentDetail = detail;

    // Update banner & teks
    if (el.movieSheetCover && detail.poster) el.movieSheetCover.src = detail.poster;
    if (el.movieSheetTitle) el.movieSheetTitle.textContent = detail.title;
    if (el.movieSheetDesc) el.movieSheetDesc.textContent = detail.synopsis || 'Sinopsis belum tersedia untuk judul ini.';
    if (el.movieSheetQuality) el.movieSheetQuality.textContent = detail.quality || 'HD';

    // Metadata bar (Genre, Tahun, Durasi, Sutradara)
    var metaParts = [];
    if (detail.genres) metaParts.push('<span>' + escapeHtml(detail.genres) + '</span>');
    if (detail.year) metaParts.push('<span>📅 ' + escapeHtml(detail.year) + '</span>');
    if (detail.duration) metaParts.push('<span>⏱️ ' + escapeHtml(detail.duration) + '</span>');
    if (detail.director) metaParts.push('<span>🎬 ' + escapeHtml(detail.director) + '</span>');
    if (el.movieSheetMeta) el.movieSheetMeta.innerHTML = metaParts.join('<span style="opacity:0.4">•</span>') || '<span>Koleksi Bioskop ' + escapeHtml(provBadge) + '</span>';

    // Render Server Tabs
    var servers = detail.servers || [{ id: 'p3', name: 'Server 3' }, { id: 'p1', name: 'Server 1' }];
    var preferredServer = (progress && progress.activeServer) || M.selectedServer || 'p3';
    var hasPref = servers.some(function (s) { return s.id === preferredServer; });
    M.selectedServer = hasPref ? preferredServer : (servers[0] ? servers[0].id : 'p3');

    if (el.movieSheetServers) {
      el.movieSheetServers.innerHTML = servers.map(function (s) {
        var active = (s.id === M.selectedServer) ? ' is-active' : '';
        return '<button type="button" class="movie-server-btn' + active + '" data-tab="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</button>';
      }).join('');
    }

    // Series Episode list
    if (detail.isSeries && detail.episodes && detail.episodes.length) {
      if (el.movieEpSection) el.movieEpSection.hidden = false;
      if (el.movieEpCount) el.movieEpCount.textContent = detail.episodes.length + ' Episode Tersedia';
      M.selectedEpisode = detail.episodes[0];

      if (el.movieEpList) {
        el.movieEpList.innerHTML = detail.episodes.map(function (ep, idx) {
          var active = (idx === 0) ? ' is-active' : '';
          return '<button type="button" class="movie-ep-btn' + active + '" data-idx="' + idx + '">' + escapeHtml(ep.title || ('Ep ' + (idx + 1))) + '</button>';
        }).join('');
      }

      if (el.movieSheetPlayBtn) {
        el.movieSheetPlayBtn.disabled = false;
        if (el.movieSheetPlayBtnText) {
          el.movieSheetPlayBtnText.textContent = 'Putar ' + (detail.episodes[0].title || 'Episode 1');
        }
      }
    } else {
      if (el.movieEpSection) el.movieEpSection.hidden = true;
      if (el.movieSheetPlayBtn) {
        el.movieSheetPlayBtn.disabled = false;
        if (el.movieSheetPlayBtnText) {
          el.movieSheetPlayBtnText.textContent = (progress && progress.currentTime > 5)
            ? ('Lanjut Nonton (' + formatVodDuration(progress.currentTime) + ')')
            : 'Putar Film Sekarang';
        }
      }
    }

    // Jika dipanggil dengan flag autoResume (misal klik kartu di Carousel Lanjut Nonton), langsung putar!
    if (opts && opts.autoResume && progress && progress.currentTime > 5) {
      playCurrentSelection({ seekTime: progress.currentTime });
    }
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
    opts = opts || {};
    var targetUrl = '';
    var playTitle = '';
    var targetProv = (M.currentDetail && M.currentDetail.provider) || (M.currentMovie && M.currentMovie.provider) || M.provider;

    if (M.currentDetail && M.currentDetail.isSeries && M.selectedEpisode) {
      targetUrl = M.selectedEpisode.url;
      playTitle = (M.currentDetail.title || 'Series') + ' - ' + (M.selectedEpisode.title || 'Episode');
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

    var progress = getMovieProgress(targetUrl);
    var seekTime = 0;
    if (typeof opts.seekTime === 'number') {
      seekTime = opts.seekTime;
    } else if (!opts.restart && progress && progress.currentTime > 5) {
      seekTime = progress.currentTime;
    }

    if (el.movieSheetPlayBtn) {
      el.movieSheetPlayBtn.disabled = true;
      if (el.movieSheetPlayBtnText) el.movieSheetPlayBtnText.textContent = 'Menyiapkan Stream...';
    }

    showToast('🍿 Menghubungkan jalur stream: ' + playTitle + '...');

    // Ambil stream dari backend ZanTV
    var streamRes = await apiGet('stream', {
      provider: targetProv,
      url: targetUrl,
      tab: M.selectedServer
    });

    // Fallback jika tab pilihan pertama gagal, coba tab cadangan (p1 atau p3)
    if (!streamRes || !streamRes.streamUrl) {
      var altTab = (M.selectedServer === 'p3') ? 'p1' : 'p3';
      showToast('Mengalihkan ke server cadangan (' + altTab.toUpperCase() + ')...');
      streamRes = await apiGet('stream', {
        provider: targetProv,
        url: targetUrl,
        tab: altTab
      });
      if (streamRes && streamRes.streamUrl) {
        M.selectedServer = altTab;
      }
    }

    if (el.movieSheetPlayBtn) {
      el.movieSheetPlayBtn.disabled = false;
      if (el.movieSheetPlayBtnText) {
        el.movieSheetPlayBtnText.textContent = (seekTime > 0)
          ? ('Lanjut Nonton (' + formatVodDuration(seekTime) + ')')
          : 'Putar Sekarang';
      }
    }

    if (!streamRes || !streamRes.streamUrl) {
      showToast('❌ Server film sedang sibuk. Silakan pilih server lain.');
      return;
    }

    closeMovieSheet();

    // Jika stream berupa iframe third-party (misal ad-player), tolak agar user tidak kena iklan
    if (streamRes.kind === 'iframe') {
      showToast('⚠️ Stream ini memerlukan player iframe pihak ketiga yang dinonaktifkan demi bebas iklan.');
      return;
    }

    // Bangun channel payload untuk pemutar ZanTV (Direct HLS Clean)
    var poster = (M.currentDetail && M.currentDetail.poster) || (M.currentMovie && M.currentMovie.poster) || 'icons/icon-192.png';
    var serverList = (M.currentDetail && M.currentDetail.servers) || [];
    var activeServerObj = serverList.find(function (s) { return s.id === M.selectedServer; });
    var activeServerName = activeServerObj ? activeServerObj.name : ('Server ' + (M.selectedServer || 1));

    var h = streamRes.headers || {};
    var streamRef = h.Referer || h.referer || '';
    var streamOrigin = h.Origin || h.origin || '';
    var streamUa = h['User-Agent'] || h.ua || '';

    // Simpan referensi film yang sedang aktif diputar untuk auto-save watch history
    M.activePlayingMovie = {
      url: targetUrl,
      title: playTitle,
      poster: poster,
      rating: (M.currentDetail && M.currentDetail.rating) || (M.currentMovie && M.currentMovie.rating) || '',
      quality: (M.currentDetail && M.currentDetail.quality) || (M.currentMovie && M.currentMovie.quality) || '',
      provider: targetProv,
      providerName: (M.currentDetail && M.currentDetail.providerName) || 'Bioskop 21',
      activeServer: M.selectedServer || 'p3'
    };

    var vodCh = {
      name: playTitle,
      url: streamRes.streamUrl,
      logo: poster,
      ref: streamRef,
      origin: streamOrigin,
      ua: streamUa,
      group: (M.currentDetail && M.currentDetail.providerName) || 'Bioskop 21',
      isVod: true,
      isMovie: true,
      isVertical: false, // 16:9 Landscape widescreen standard cinema
      servers: serverList,
      activeServer: M.selectedServer,
      activeServerName: activeServerName,
      sources: [
        {
          url: streamRes.streamUrl,
          name: activeServerName,
          ref: streamRef,
          origin: streamOrigin,
          ua: streamUa,
          isHls: true
        }
      ]
    };

    // Pastikan bar slider timeline VOD aktif dan berada di dalam controls
    var bar = document.getElementById('stageVodBar');
    var ctrls = document.getElementById('controls');
    if (bar) {
      if (ctrls && bar.parentElement !== ctrls) {
        ctrls.insertBefore(bar, ctrls.firstChild);
      }
      bar.hidden = false;
      bar.removeAttribute('hidden');
      bar.style.display = 'flex';
    }

    // Trigger pemutaran di stage player ZanTV dengan seekTime
    if (window.ZanTV && typeof window.ZanTV.playVod === 'function') {
      window.ZanTV.playVod(vodCh, { seekTime: seekTime });
    } else if (typeof window.playChannel === 'function') {
      window.playChannel(vodCh, { seekTime: seekTime });
    }

    // Pada mobile, scroll ke stage agar video langsung terlihat
    if (window.innerWidth <= 860) {
      var s = document.getElementById('stage');
      if (s) s.scrollIntoView({ behavior: 'smooth' });
    }

    if (seekTime > 0) {
      showToast('🍿 Melanjutkan: ' + playTitle + ' (' + formatVodDuration(seekTime) + ')');
    } else {
      showToast('▶️ Memutar: ' + playTitle);
    }
  }

  /* Ganti server streaming dari in-player dialog tanpa keluar dari film */
  async function switchServer(serverId, seekTime) {
    if (!serverId) return;
    M.selectedServer = serverId;
    var targetUrl = '';
    var playTitle = '';
    var targetProv = (M.currentDetail && M.currentDetail.provider) || (M.currentMovie && M.currentMovie.provider) || M.provider;

    if (M.currentDetail && M.currentDetail.isSeries && M.selectedEpisode) {
      targetUrl = M.selectedEpisode.url;
      playTitle = (M.currentDetail.title || 'Series') + ' - ' + (M.selectedEpisode.title || 'Episode');
    } else if (M.currentDetail && M.currentDetail.url) {
      targetUrl = M.currentDetail.url;
      playTitle = M.currentDetail.title;
    } else if (M.currentMovie && M.currentMovie.url) {
      targetUrl = M.currentMovie.url;
      playTitle = M.currentMovie.title;
    }

    if (!targetUrl) {
      showToast('⚠️ Data film tidak ditemukan untuk ganti server.');
      return;
    }

    var serverList = (M.currentDetail && M.currentDetail.servers) || [];
    var activeServerObj = serverList.find(function (s) { return s.id === serverId; });
    var activeServerName = activeServerObj ? activeServerObj.name : ('Server ' + serverId);

    // Dapatkan posisi tontonan saat ini agar tetap lanjut dari detik yang sama
    var curTime = 0;
    var vid = document.getElementById('video');
    if (vid && isFinite(vid.currentTime) && vid.currentTime > 0) {
      curTime = vid.currentTime;
    }
    if (typeof seekTime === 'number') curTime = seekTime;

    showToast('🔄 Beralih ke ' + activeServerName + '...');

    var streamRes = await apiGet('stream', {
      provider: targetProv,
      url: targetUrl,
      tab: serverId
    });

    if (!streamRes || !streamRes.streamUrl) {
      showToast('❌ ' + activeServerName + ' sedang sibuk. Silakan pilih server lain.');
      return;
    }

    if (streamRes.kind === 'iframe') {
      showToast('⚠️ Server ini memerlukan iframe pihak ketiga.');
      return;
    }

    var poster = (M.currentDetail && M.currentDetail.poster) || (M.currentMovie && M.currentMovie.poster) || 'icons/icon-192.png';
    var h = streamRes.headers || {};
    var streamRef = h.Referer || h.referer || '';
    var streamOrigin = h.Origin || h.origin || '';
    var streamUa = h['User-Agent'] || h.ua || '';

    if (M.activePlayingMovie) {
      M.activePlayingMovie.activeServer = serverId;
    }

    var vodCh = {
      name: playTitle,
      url: streamRes.streamUrl,
      logo: poster,
      ref: streamRef,
      origin: streamOrigin,
      ua: streamUa,
      group: (M.currentDetail && M.currentDetail.providerName) || 'Bioskop 21',
      isVod: true,
      isMovie: true,
      isVertical: false,
      servers: serverList,
      activeServer: serverId,
      activeServerName: activeServerName,
      sources: [
        {
          url: streamRes.streamUrl,
          name: activeServerName,
          ref: streamRef,
          origin: streamOrigin,
          ua: streamUa,
          isHls: true
        }
      ]
    };

    if (window.ZanTV && typeof window.ZanTV.playVod === 'function') {
      window.ZanTV.playVod(vodCh, { seekTime: curTime });
    }
    showToast('⚡ Tersambung ke ' + activeServerName);
  }

  /* ---------------- SEARCH DEBOUNCE ---------------- */
  var searchTimeout = null;
  function handleSearchInput() {
    if (!el.movieSearchInput) return;
    var val = el.movieSearchInput.value.trim();
    if (el.movieSearchClear) el.movieSearchClear.hidden = !val;

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function () {
      M.query = val;
      M.page = 1;
      loadMovies(false);
    }, 450);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------------- EVENT LISTENERS & INIT ---------------- */
  async function init() {
    initElements();
    renderProviderTabs();
    renderCategoryChips();
    renderResumeCarousel();

    // Ambil daftar provider dari backend jika tersedia
    try {
      var pRes = await apiGet('providers');
      if (pRes && pRes.providers && pRes.providers.length) {
        M.providers = pRes.providers;
        var validProv = M.providers.some(function (p) { return p.id === M.provider; });
        if (!validProv) M.provider = M.providers[0].id;
        renderProviderTabs();
      }
    } catch (e) {}

    // Ambil kategori untuk provider aktif
    await loadCategories();

    // Klik Provider Tab (Bioskop 21, PusatMovie, SarangFilm, SaveFilm, WGFilm)
    if (el.movieProvTabs) {
      el.movieProvTabs.addEventListener('click', async function (e) {
        var btn = e.target.closest('.movie-prov-btn');
        if (!btn) return;
        var prov = btn.getAttribute('data-prov');
        if (!prov || prov === M.provider) return;

        M.provider = prov;
        localStorage.setItem('zan_movie_prov', prov);
        renderProviderTabs();

        M.page = 1;
        M.query = '';
        if (el.movieSearchInput) el.movieSearchInput.value = '';
        if (el.movieSearchClear) el.movieSearchClear.hidden = true;

        await loadCategories();
        loadMovies(false);
      });
    }

    // Klik Kategori Chip
    if (el.movieCatChips) {
      el.movieCatChips.addEventListener('click', function (e) {
        var chip = e.target.closest('.movie-cat-chip');
        if (!chip) return;
        var cat = chip.getAttribute('data-cat');
        if (!cat || cat === M.category) return;
        M.category = cat;
        renderCategoryChips();
        M.page = 1;
        M.query = '';
        if (el.movieSearchInput) el.movieSearchInput.value = '';
        if (el.movieSearchClear) el.movieSearchClear.hidden = true;
        loadMovies(false);
      });
    }

    // Search Input
    if (el.movieSearchInput) {
      el.movieSearchInput.addEventListener('input', handleSearchInput);
      el.movieSearchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSearchInput();
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

    // Load More Button
    if (el.movieLoadMoreBtn) {
      el.movieLoadMoreBtn.addEventListener('click', function () {
        M.page++;
        loadMovies(true);
      });
    }

    // Klik Kartu Film di Grid
    if (el.movieGrid) {
      el.movieGrid.addEventListener('click', function (e) {
        var card = e.target.closest('.movie-card');
        if (!card) return;
        var itemUrl = card.getAttribute('data-url');
        var itemProv = card.getAttribute('data-prov') || M.provider;
        var found = M.movies.find(function (x) { return x.url === itemUrl; });
        if (found) {
          openMovieDetail(found);
        } else {
          openMovieDetail({
            url: itemUrl,
            provider: itemProv,
            title: card.querySelector('.movie-card-title').textContent
          });
        }
      });
    }

    // Modal Sheet Server Tabs
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

    // Modal Sheet Episode List
    if (el.movieEpList) {
      el.movieEpList.addEventListener('click', function (e) {
        var btn = e.target.closest('.movie-ep-btn');
        if (!btn) return;
        var idx = +btn.getAttribute('data-idx');
        if (isNaN(idx) || !M.currentDetail || !M.currentDetail.episodes) return;
        M.selectedEpisode = M.currentDetail.episodes[idx];
        var all = el.movieEpList.querySelectorAll('.movie-ep-btn');
        all.forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        if (el.movieSheetPlayBtn && M.selectedEpisode) {
          el.movieSheetPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5v14l12-7z"/></svg><span>Putar ' + escapeHtml(M.selectedEpisode.title || ('Episode ' + (idx + 1))) + '</span>';
        }
      });
    }

    // Play Button di Sheet
    if (el.movieSheetPlayBtn) {
      el.movieSheetPlayBtn.addEventListener('click', function () {
        playCurrentSelection();
      });
    }

    // Tombol Ulang dari Awal di Sheet
    if (el.movieSheetRestartBtn) {
      el.movieSheetRestartBtn.addEventListener('click', function () {
        playCurrentSelection({ seekTime: 0, restart: true });
      });
    }

    // Tombol Bersihkan Riwayat Lanjut Nonton
    if (el.movieResumeClearBtn) {
      el.movieResumeClearBtn.addEventListener('click', function () {
        if (confirm('Bersihkan semua riwayat Lanjut Nonton?')) {
          clearAllWatchHistory();
          renderResumeCarousel();
          showToast('🗑️ Riwayat tontonan telah dibersihkan');
        }
      });
    }

    // Delegasi Klik Kartu & Tombol Hapus pada Carousel Lanjut Nonton
    if (el.movieResumeList) {
      el.movieResumeList.addEventListener('click', function (e) {
        var removeBtn = e.target.closest('.movie-resume-remove-btn');
        if (removeBtn) {
          e.stopPropagation();
          var rmUrl = removeBtn.getAttribute('data-remove-url');
          if (rmUrl) {
            removeWatchHistoryItem(rmUrl);
            renderResumeCarousel();
            showToast('🗑️ Film dihapus dari Lanjut Nonton');
          }
          return;
        }

        var card = e.target.closest('.movie-resume-card');
        if (!card) return;
        var url = card.getAttribute('data-url');
        var prov = card.getAttribute('data-prov') || M.provider;
        var history = getWatchHistory();
        var item = history.find(function (h) { return h.url === url; });
        if (item) {
          if (prov && prov !== M.provider) {
            M.provider = prov;
            renderProviderTabs();
          }
          openMovieDetail(item, { autoResume: true });
        }
      });
    }

    // Auto-save history saat pemutaran dijeda (pause)
    var vid = document.getElementById('video');
    if (vid) {
      vid.addEventListener('pause', function () {
        if (M.activePlayingMovie && vid.currentTime && vid.duration && vid.duration >= 30) {
          var cur = Math.floor(vid.currentTime);
          var dur = Math.floor(vid.duration);
          var pct = Math.round((cur / dur) * 100);
          if (pct < 95 && cur > 5) {
            saveWatchHistoryItem(Object.assign({}, M.activePlayingMovie, {
              currentTime: cur,
              duration: dur,
              progressPct: pct,
              updatedAt: Date.now()
            }));
            renderResumeCarousel();
          }
        }
      });
    }

    // Auto-save saat tab/browser hendak ditutup
    window.addEventListener('beforeunload', function () {
      if (M.activePlayingMovie) {
        var v = document.getElementById('video');
        if (v && v.currentTime && v.duration && v.duration >= 30) {
          var cur = Math.floor(v.currentTime);
          var dur = Math.floor(v.duration);
          var pct = Math.round((cur / dur) * 100);
          if (pct < 95 && cur > 5) {
            saveWatchHistoryItem(Object.assign({}, M.activePlayingMovie, {
              currentTime: cur,
              duration: dur,
              progressPct: pct,
              updatedAt: Date.now()
            }));
          }
        }
      }
    });

    // Close Sheet
    if (el.movieSheetClose) {
      el.movieSheetClose.addEventListener('click', closeMovieSheet);
    }
    if (el.movieSheet) {
      el.movieSheet.addEventListener('click', function (e) {
        if (e.target === el.movieSheet) closeMovieSheet();
      });
    }

    // Admin Button click in Movie topbar & Account dialog
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

    // Admin List Delegation (Toggle & Save URL)
    if (el.movieAdminList) {
      // Toggle Switch Provider On/Off
      el.movieAdminList.addEventListener('change', async function (e) {
        var toggle = e.target.closest('.movie-admin-toggle');
        if (!toggle) return;
        var provId = toggle.getAttribute('data-prov');
        var isEnabled = toggle.checked;

        try {
          toggle.disabled = true;
          await apiPost('admin/provider-toggle', { provider: provId, enabled: isEnabled });
          toggle.disabled = false;

          // Update state lokal
          var prov = M.providers && M.providers.find(function (p) { return p.id === provId; });
          if (prov) prov.enabled = isEnabled;

          // Update pill & status di card
          var card = el.movieAdminList.querySelector('[data-card-prov="' + provId + '"]');
          if (card) {
            card.classList.toggle('is-disabled', !isEnabled);
            var pill = card.querySelector('.movie-admin-status-pill');
            if (pill) {
              pill.className = 'movie-admin-status-pill' + (isEnabled ? '' : ' is-disabled');
              pill.textContent = isEnabled ? '🟢 Aktif' : '🔴 Nonaktif';
            }
          }

          renderProviderTabs();

          // Jika provider yang sedang dibuka dinonaktifkan, pindah ke provider lain
          if (!isEnabled && M.provider === provId) {
            var firstActive = M.providers.find(function (p) { return p.enabled !== false; });
            if (firstActive) {
              M.provider = firstActive.id;
              localStorage.setItem('zan_movie_prov', M.provider);
              renderProviderTabs();
              await loadCategories();
              loadMovies(false);
            }
          }

          showToast((isEnabled ? '🟢 ' : '🔴 ') + (prov ? (prov.shortName || prov.name) : provId) + (isEnabled ? ' diaktifkan' : ' dinonaktifkan'));
        } catch (err) {
          toggle.disabled = false;
          toggle.checked = !isEnabled; // Revert
          showToast('❌ Gagal mengubah status provider: ' + (err.message || 'Error'));
        }
      });

      // Simpan URL Mirror Baru
      el.movieAdminList.addEventListener('click', async function (e) {
        var btn = e.target.closest('.movie-admin-url-btn');
        if (!btn) return;
        var provId = btn.getAttribute('data-prov');
        var input = el.movieAdminList.querySelector('.movie-admin-url-input[data-prov="' + provId + '"]');
        if (!input) return;
        var newUrl = input.value.trim();

        try {
          btn.disabled = true;
          btn.textContent = 'Menyimpan...';
          var res = await apiPost('admin/provider-url', { provider: provId, customUrl: newUrl });
          btn.disabled = false;
          btn.textContent = 'Tersimpan ✓';
          setTimeout(function () { btn.textContent = 'Simpan Link'; }, 2000);

          var prov = M.providers && M.providers.find(function (p) { return p.id === provId; });
          if (prov) {
            prov.customUrl = newUrl;
            prov.activeMirror = (res && res.activeMirror) || newUrl || prov.defaultUrl;
            prov.baseUrl = prov.activeMirror;
          }

          showToast('✅ Link mirror provider ' + provId + ' berhasil disimpan');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Simpan Link';
          showToast('❌ Gagal menyimpan URL: ' + (err.message || 'Error'));
        }
      });
    }
  }

  /* ---------------- ADMIN: KELOLA PROVIDER & MIRROR ---------------- */
  async function openMovieAdminDialog() {
    if (!el.movieAdminDialog) return;

    try {
      var res = await apiGet('providers');
      if (res && res.providers) {
        M.providers = res.providers;
      }
    } catch (e) {
      console.warn('[ZanMovie] Gagal refresh providers untuk admin:', e);
    }

    renderAdminDialogList();

    if (typeof el.movieAdminDialog.showModal === 'function') {
      try { el.movieAdminDialog.showModal(); } catch (e) { el.movieAdminDialog.setAttribute('open', ''); }
    } else {
      el.movieAdminDialog.setAttribute('open', '');
    }
  }

  function renderAdminDialogList() {
    if (!el.movieAdminList) return;
    var list = M.providers || DEFAULT_PROVIDERS;

    el.movieAdminList.innerHTML = list.map(function (p) {
      var isEnabled = p.enabled !== false;
      var activePill = isEnabled
        ? '<span class="movie-admin-status-pill">🟢 Aktif</span>'
        : '<span class="movie-admin-status-pill is-disabled">🔴 Nonaktif</span>';

      var currentUrl = p.customUrl || p.activeMirror || p.baseUrl || '';
      var defaultUrl = p.defaultUrl || (p.mirrors && p.mirrors[0]) || p.activeMirror || '';

      return '<div class="movie-admin-item' + (isEnabled ? '' : ' is-disabled') + '" data-card-prov="' + escapeHtml(p.id) + '">' +
        '<div class="movie-admin-head">' +
          '<div class="movie-admin-info">' +
            '<span class="movie-admin-icon">' + (p.icon || '🎬') + '</span>' +
            '<div class="movie-admin-title-box">' +
              '<div class="movie-admin-title">' +
                '<span>' + escapeHtml(p.name || p.id) + '</span>' +
                activePill +
              '</div>' +
              '<span class="movie-admin-desc">' + escapeHtml(p.description || '') + '</span>' +
            '</div>' +
          '</div>' +
          '<label class="ios-switch" title="Aktifkan / Nonaktifkan sumber ini">' +
            '<input type="checkbox" class="movie-admin-toggle" data-prov="' + escapeHtml(p.id) + '"' + (isEnabled ? ' checked' : '') + '>' +
            '<span class="ios-slider"></span>' +
          '</label>' +
        '</div>' +
        '<div class="movie-admin-body">' +
          '<div class="movie-admin-url-box">' +
            '<span class="movie-admin-url-label">Link Mirror:</span>' +
            '<input type="url" class="movie-admin-url-input" data-prov="' + escapeHtml(p.id) + '" placeholder="Default: ' + escapeHtml(defaultUrl) + '" value="' + escapeHtml(currentUrl) + '" autocomplete="off" spellcheck="false">' +
            '<button type="button" class="btn ghost movie-admin-url-btn" data-prov="' + escapeHtml(p.id) + '">Simpan Link</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ---------------- PUBLIC API EXPORTS ---------------- */
  window.ZanMovie = {
    loadMovies: loadMovies,
    openMovieDetail: openMovieDetail,
    playCurrentSelection: playCurrentSelection,
    switchServer: switchServer,
    openAdmin: openMovieAdminDialog,
    getWatchHistory: getWatchHistory,
    removeWatchHistoryItem: removeWatchHistoryItem,
    clearAllWatchHistory: clearAllWatchHistory,
    onPlaybackProgress: onPlaybackProgress,
    renderResumeCarousel: renderResumeCarousel,
    onEnter: function () {
      renderResumeCarousel();
      if (!M.movies || !M.movies.length) {
        loadMovies(false);
      }
    },
    isPlayingMovie: function () {
      return !!(window.ZanTV && window.ZanTV.isPlayingVod && window.ZanTV.isPlayingVod() &&
                document.body.classList.contains('is-movie-mode'));
    },
    stopMovieIframe: function () {
      // No-op karena iframe ad player sudah dihilangkan sepenuhnya
    },
    getState: function () { return M; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
