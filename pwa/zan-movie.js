/* ZanTV Bioskop 21 & Movie VOD Explorer v1.7.26
 * Integrasi Provider Streaming Film Indonesia (CloudX-V2 Scraper & Extractor)
 * Fitur: Koleksi Film Bioskop 2026, Series, Server Switcher, Full 16:9 Landscape Player
 * Desain iOS Glassmorphism Premium & Micro-animations
 * Crafted with love by Lody for ZanTV.
 */
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'terbaru', label: '🆕 Terbaru 2026' },
    { id: 'populer', label: '🔥 Populer 2025' },
    { id: 'series', label: '📺 TV Series' },
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
    selectedServer: 'p3', // Default p3 (VOE Embed stream)
    selectedEpisode: null
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
    var timer = setTimeout(function () { ac.abort(); }, 8000);
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
    var timer = setTimeout(function () { ac.abort(); }, 8000);
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
            ? 'Koneksi ke server film sedang sibuk atau timeout. Silakan klik tombol kategori di atas untuk coba lagi.'
            : 'Tidak ada film ditemukan.';
        }
      }
      if (el.movieLoadMoreWrap) el.movieLoadMoreWrap.hidden = true;
      return;
    }

    if (el.movieEmpty) el.movieEmpty.hidden = true;
    M.hasMore = items.length >= 20;
    if (el.movieLoadMoreWrap) el.movieLoadMoreWrap.hidden = !M.hasMore;

    renderMovieCards(items, append);
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
  }

  /* ---------------- BUKA DETAIL FILM (SHEET) ---------------- */
  async function openMovieDetail(item) {
    if (!item) return;
    M.currentMovie = item;
    M.currentDetail = null;
    M.selectedServer = 'p3'; // default p3 VOE
    M.selectedEpisode = null;

    // Tampilkan data awal seketika
    if (el.movieSheetCover) el.movieSheetCover.src = item.poster || 'icons/icon-192.png';
    if (el.movieSheetTitle) el.movieSheetTitle.textContent = item.title || 'Film Bioskop';
    if (el.movieSheetRating) {
      el.movieSheetRating.textContent = item.rating || '⭐ 8.0';
      el.movieSheetRating.hidden = !item.rating;
    }
    if (el.movieSheetQuality) el.movieSheetQuality.textContent = item.quality || 'HD';
    if (el.movieSheetBadge) el.movieSheetBadge.textContent = item.isSeries ? 'TV SERIES' : 'BIOSKOP 21';
    if (el.movieSheetMeta) el.movieSheetMeta.innerHTML = '<span>Memuat informasi lengkap...</span>';
    if (el.movieSheetDesc) el.movieSheetDesc.textContent = 'Mengambil sinopsis dan server streaming...';
    if (el.movieEpSection) el.movieEpSection.hidden = true;
    if (el.movieSheetServers) el.movieSheetServers.innerHTML = '<span class="movie-server-btn is-active">Server 3 (VOE)</span>';
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

    // Ambil detail lengkap dari backend ZanTV
    var detail = await apiGet('detail', { url: item.url });
    if (!detail) {
      if (el.movieSheetDesc) el.movieSheetDesc.textContent = 'Gagal memuat detail film. Silakan coba lagi.';
      if (el.movieSheetPlayBtn) {
        el.movieSheetPlayBtn.disabled = false;
        el.movieSheetPlayBtn.innerHTML = '<span>Coba Putar Langsung</span>';
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
    if (el.movieSheetMeta) el.movieSheetMeta.innerHTML = metaParts.join('<span style="opacity:0.4">•</span>') || '<span>Koleksi Bioskop 21</span>';

    // Render Server Tabs (Prioritaskan Server 3 VOE yang bersih direct HLS)
    var rawServers = detail.servers || [{ id: 'p3', name: 'Server 3' }, { id: 'p1', name: 'Server 1' }];
    var servers = rawServers.slice();
    servers.sort(function (a, b) {
      if (a.id === 'p3') return -1;
      if (b.id === 'p3') return 1;
      return 0;
    });
    servers.forEach(function (s) {
      if (s.id === 'p3') s.name = 'Server 3 (HD Bersih)';
      else if (s.name.indexOf('Cadangan') === -1) s.name = s.name.replace('Server', 'Cadangan');
    });
    var hasP3 = servers.some(function (s) { return s.id === 'p3'; });
    M.selectedServer = hasP3 ? 'p3' : (servers[0] ? servers[0].id : 'p1');

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
        el.movieSheetPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5v14l12-7z"/></svg><span>Putar ' + escapeHtml(detail.episodes[0].title || 'Episode 1') + '</span>';
      }
    } else {
      if (el.movieEpSection) el.movieEpSection.hidden = true;
      if (el.movieSheetPlayBtn) {
        el.movieSheetPlayBtn.disabled = false;
        el.movieSheetPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5v14l12-7z"/></svg><span>Putar Film Sekarang</span>';
      }
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
  async function playCurrentSelection() {
    var targetUrl = '';
    var playTitle = '';

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

    if (el.movieSheetPlayBtn) {
      el.movieSheetPlayBtn.disabled = true;
      el.movieSheetPlayBtn.innerHTML = '<span>Menyiapkan Stream...</span>';
    }

    showToast('🍿 Mengambil jalur stream ' + playTitle + '...');

    // Ambil stream dari backend ZanTV
    var streamRes = await apiGet('stream', { url: targetUrl, tab: M.selectedServer });

    // Fallback jika tab pilihan pertama gagal, coba server lain
    if (!streamRes || !streamRes.streamUrl) {
      var altTab = (M.selectedServer === 'p3') ? 'p1' : 'p3';
      showToast('Mengalihkan ke server cadangan (' + altTab.toUpperCase() + ')...');
      streamRes = await apiGet('stream', { url: targetUrl, tab: altTab });
    }

    if (el.movieSheetPlayBtn) {
      el.movieSheetPlayBtn.disabled = false;
      el.movieSheetPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5v14l12-7z"/></svg><span>Putar Sekarang</span>';
    }

    if (!streamRes || !streamRes.streamUrl) {
      showToast('❌ Server film sedang sibuk. Silakan pilih server lain.');
      return;
    }

    if (streamRes.kind === 'iframe' || (!streamRes.streamUrl.includes('.m3u8') && !streamRes.streamUrl.includes('cloudwindow') && streamRes.kind !== 'hls')) {
      showToast('⚠️ Server ini hanya menyediakan web player pihak ketiga dengan iklan. Silakan gunakan Server 3 (HD Bersih).');
      return;
    }

    // Bangun channel payload untuk player ZanTV
    var poster = (M.currentDetail && M.currentDetail.poster) || (M.currentMovie && M.currentMovie.poster) || 'icons/icon-192.png';
    var h = streamRes.headers || {};
    var streamRef = h.Referer || h.referer || streamRes.referer || 'https://klikxxi.shop/';
    var streamOrigin = h.Origin || h.origin || streamRes.origin || 'https://klikxxi.shop';
    var streamUa = h['User-Agent'] || h.ua || streamRes.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    var vodCh = {
      name: playTitle,
      url: streamRes.streamUrl,
      logo: poster,
      group: 'Bioskop 21',
      isVod: true,
      isMovie: true,
      isVertical: false, // 16:9 Landscape widescreen standard cinema
      ref: streamRef,
      ua: streamUa,
      origin: streamOrigin,
      servers: (M.currentDetail && M.currentDetail.servers) || [{ id: 'p3', name: 'Server 3' }, { id: 'p1', name: 'Server 1' }],
      activeServer: M.selectedServer,
      activeServerName: 'Server ' + (streamRes.server || M.selectedServer).toUpperCase(),
      sources: [
        {
          url: streamRes.streamUrl,
          name: 'Server ' + (streamRes.server || M.selectedServer).toUpperCase(),
          ref: streamRef,
          origin: streamOrigin,
          ua: streamUa,
          isHls: (streamRes.kind === 'hls' || streamRes.type === 'hls' || streamRes.streamUrl.indexOf('.m3u8') !== -1)
        }
      ]
    };

    closeMovieSheet();

    // Trigger pemutaran di stage player ZanTV
    if (window.ZanTV && typeof window.ZanTV.playVod === 'function') {
      window.ZanTV.playVod(vodCh);
    } else if (typeof window.playChannel === 'function') {
      window.playChannel(vodCh);
    }

    // Pada mobile, scroll ke stage agar video langsung terlihat
    if (window.innerWidth <= 860) {
      var stage = document.getElementById('stage');
      if (stage) stage.scrollIntoView({ behavior: 'smooth' });
    }

    showToast('▶️ Memutar: ' + playTitle);
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
  function init() {
    initElements();
    renderCategoryChips();

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
        var found = M.movies.find(function (x) { return x.url === itemUrl; });
        if (found) {
          openMovieDetail(found);
        } else {
          openMovieDetail({ url: itemUrl, title: card.querySelector('.movie-card-title').textContent });
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
      el.movieSheetPlayBtn.addEventListener('click', playCurrentSelection);
    }

    // Close Sheet
    if (el.movieSheetClose) {
      el.movieSheetClose.addEventListener('click', closeMovieSheet);
    }
    if (el.movieSheet) {
      el.movieSheet.addEventListener('click', function (e) {
        if (e.target === el.movieSheet) closeMovieSheet();
      });
    }

    // Admin Button di Movie Topbar & Dialog Akun
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

  /* ---------------- ADMIN: KELOLA MIRROR PROVIDER ---------------- */
  async function openMovieAdminDialog() {
    if (!el.movieAdminDialog) return;

    if (el.movieAdminList) {
      el.movieAdminList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted)">Memuat status mirror...</div>';
    }

    if (typeof el.movieAdminDialog.showModal === 'function') {
      try { el.movieAdminDialog.showModal(); } catch (e) { el.movieAdminDialog.setAttribute('open', ''); }
    } else {
      el.movieAdminDialog.setAttribute('open', '');
    }

    try {
      var info = await apiGet('admin/mirror');
      if (!info || !info.ok) throw new Error((info && info.error) || 'Gagal mengambil data mirror');
      renderAdminMirrorUI(info.active, info.mirrors || []);
    } catch (err) {
      if (el.movieAdminList) {
        el.movieAdminList.innerHTML = '<div style="padding:16px;text-align:center;color:#ef4444">⚠️ ' + escapeHtml(err.message || 'Gagal memuat status mirror') + '</div>';
      }
    }
  }

  function renderAdminMirrorUI(activeUrl, mirrors) {
    if (!el.movieAdminList) return;
    activeUrl = activeUrl || 'https://klikxxi.shop';
    var verified = ['https://klikxxi.shop', 'https://filmlokal.me', 'https://ww11.pencurimovie.sbs'];
    if (mirrors && mirrors.length) {
      mirrors.forEach(function (m) {
        if (!m.includes('ngefilm') && !m.includes('idmxl') && verified.indexOf(m) === -1) {
          verified.push(m);
        }
      });
    }
    if (verified.indexOf(activeUrl) === -1) verified.unshift(activeUrl);

    var chipsHtml = verified.map(function (m) {
      var isCur = m === activeUrl;
      return '<button type="button" class="movie-mirror-chip' + (isCur ? ' is-active' : '') + '" data-mirror="' + escapeHtml(m) + '">' +
        (isCur ? '✓ ' : '') + escapeHtml(m.replace(/^https?:\/\//, '')) + ' (HLS Clean)' +
      '</button>';
    }).join('');

    el.movieAdminList.innerHTML =
      '<div class="movie-admin-item">' +
        '<div class="movie-admin-head">' +
          '<div class="movie-admin-info">' +
            '<span class="movie-admin-icon">🎬</span>' +
            '<div class="movie-admin-title-box">' +
              '<strong class="movie-admin-title">Sumber Bioskop & Series 2026</strong>' +
              '<span class="movie-admin-status-pill">🟢 Aktif: ' + escapeHtml(activeUrl) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="movie-admin-desc">Gunakan mirror terverifikasi Direct HLS di bawah ini agar video bebas iklan dan dapat diputar langsung di player ZanTV.</div>' +
        '<div class="movie-admin-url-box">' +
          '<span class="movie-admin-url-label">Domain:</span>' +
          '<input type="url" class="movie-admin-url-input" id="movieMirrorInput" value="' + escapeHtml(activeUrl) + '" placeholder="https://klikxxi.shop" autocomplete="off" spellcheck="false">' +
          '<button type="button" class="btn primary movie-admin-url-btn" id="movieMirrorSaveBtn">Simpan Link</button>' +
        '</div>' +
        '<div style="margin-top:8px;">' +
          '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600;">Mirror Cadangan Terverifikasi Direct HLS:</div>' +
          '<div class="movie-mirror-chips" id="movieMirrorChips" style="display:flex;flex-wrap:wrap;gap:6px;">' +
            chipsHtml +
          '</div>' +
        '</div>' +
      '</div>';

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
          var res = await apiPost('admin/mirror', { url: newMirror });
          saveBtn.disabled = false;
          saveBtn.textContent = 'Tersimpan ✓';
          setTimeout(function () { saveBtn.textContent = 'Simpan Link'; }, 2000);

          showToast('✅ Link mirror bioskop berhasil diperbarui: ' + res.active);
          renderAdminMirrorUI(res.active, mirrors);
          // Muat ulang katalog agar langsung mengambil dari mirror baru
          loadMovies(false);
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Simpan Link';
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
    openAdmin: openMovieAdminDialog,
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
