/* ZanTV VOD & Short Drama Explorer v1.7.21
 * Agregator 42 Platform Short Drama (ShortMax, GoodShort, JoyReels, RaptDrama)
 * Desain iOS Glassmorphism Premium & Auto-Next Episode Player
 * Crafted with love by Lody for ZanTV.
 */
(function () {
  'use strict';

  var PROVIDERS = [
    { id: 'shortmax', name: 'ShortMax', badge: 'Akamai 1080p', desc: 'Trending & Populer' },
    { id: 'goodshort', name: 'GoodShort', badge: '3.200+ Judul', desc: 'Dub & Sub Indo' },
    { id: 'joyreels', name: 'JoyReels', badge: '1.100+ Judul', desc: 'Koleksi HD' },
    { id: 'raptdrama', name: 'RaptDrama', badge: '320+ Judul', desc: 'Chinese Drama' }
  ];

  var S = {
    mode: 'live', // 'live' | 'vod'
    provider: 'shortmax',
    lang: 'id',
    type: 'popular',
    page: 1,
    query: '',
    loading: false,
    dramas: [],
    currentDrama: null,
    currentEpisodes: [],
    currentEpIndex: 0,
    activeEpNum: null
  };

  var el = {};

  function initElements() {
    el.navSegment = document.getElementById('navSegment');
    el.segLiveBtn = document.getElementById('segLiveBtn');
    el.segVodBtn = document.getElementById('segVodBtn');
    el.vodPane = document.getElementById('vodPane');
    el.vodGrid = document.getElementById('vodGrid');
    el.vodSearchInput = document.getElementById('vodSearchInput');
    el.vodSearchClear = document.getElementById('vodSearchClear');
    el.vodProvTabs = document.getElementById('vodProvTabs');
    el.vodLangToggle = document.getElementById('vodLangToggle');
    el.vodTypeChips = document.getElementById('vodTypeChips');
    el.vodLoading = document.getElementById('vodLoading');
    el.vodEmpty = document.getElementById('vodEmpty');
    el.vodSheet = document.getElementById('vodSheet');
    el.vodSheetClose = document.getElementById('vodSheetClose');
    el.vodSheetCover = document.getElementById('vodSheetCover');
    el.vodSheetTitle = document.getElementById('vodSheetTitle');
    el.vodSheetBadge = document.getElementById('vodSheetBadge');
    el.vodSheetDesc = document.getElementById('vodSheetDesc');
    el.vodSheetPlayFirst = document.getElementById('vodSheetPlayFirst');
    el.vodEpList = document.getElementById('vodEpList');
    el.vodEpRangeTabs = document.getElementById('vodEpRangeTabs');
  }

  /* ---------------- API CLIENT DENGAN FALLBACK ---------------- */
  async function apiGet(endpoint, params) {
    var qs = new URLSearchParams(params || {}).toString();
    var serverUrl = '/api/vod/' + endpoint + (qs ? '?' + qs : '');

    try {
      var res = await fetch(serverUrl, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // server offline / standalone PWA fallback
    }

    // Direct Upstream Fallback (CORS open)
    var p = params || {};
    var prov = p.provider || S.provider;
    var lang = p.lang || S.lang;
    var page = p.page || 1;
    var upUrl = '';

    if (endpoint === 'list') {
      if (prov === 'shortmax') {
        var t = p.type === 'new' ? 'new' : (p.type === 'hot' ? 'hot' : 'popular');
        upUrl = 'https://apishort.com/v1/shortmax/api/v1/' + t + '?lang=' + lang + '&page=' + page;
      } else if (prov === 'goodshort') {
        upUrl = p.type === 'feed'
          ? 'https://apishort.com/v1/goodshort/v1/feed?lang=' + lang + '&page=' + page
          : 'https://apishort.com/v1/goodshort/v1/browse?lang=' + lang + '&page=' + page + '&limit=24';
      } else if (prov === 'joyreels') {
        upUrl = 'https://apishort.com/v1/joyreels/dramas/browse?lang=' + lang + '&page=' + page + '&per_page=20';
      } else if (prov === 'raptdrama') {
        upUrl = 'https://apishort.com/v1/raptdrama/api/public/browse?page=' + page + '&limit=20';
      }
    } else if (endpoint === 'search') {
      var q = encodeURIComponent(p.q || '');
      if (prov === 'shortmax') upUrl = 'https://apishort.com/v1/shortmax/api/v1/search?lang=' + lang + '&q=' + q;
      else if (prov === 'goodshort') upUrl = 'https://apishort.com/v1/goodshort/v1/books/search?lang=' + lang + '&q=' + q;
      else if (prov === 'joyreels') upUrl = 'https://apishort.com/v1/joyreels/search?lang=' + lang + '&q=' + q + '&page=1';
      else if (prov === 'raptdrama') upUrl = 'https://apishort.com/v1/raptdrama/api/public/search?page=1&q=' + q;
    } else if (endpoint === 'drama') {
      var id = p.id;
      if (prov === 'shortmax') upUrl = 'https://apishort.com/v1/shortmax/api/v1/alleps/' + id + '?lang=' + lang;
      else if (prov === 'goodshort') upUrl = 'https://apishort.com/v1/goodshort/v1/book/' + id;
      else if (prov === 'joyreels') upUrl = 'https://apishort.com/v1/joyreels/drama/' + id + '/episodes?lang=' + lang;
      else if (prov === 'raptdrama') upUrl = 'https://apishort.com/v1/raptdrama/api/public/episodes/' + id;
    } else if (endpoint === 'stream') {
      if (prov === 'joyreels') upUrl = 'https://apishort.com/v1/joyreels/drama/' + p.id + '/episode/' + p.ep + '?lang=' + lang;
      else if (prov === 'goodshort') upUrl = 'https://apishort.com/v1/goodshort/v1/book/' + p.id + '/chapter/' + p.ep;
    }

    if (!upUrl) return { items: [] };

    var upRes = await fetch(upUrl, { headers: { 'Accept': 'application/json' } });
    if (!upRes.ok) throw new Error('Gagal memuat dari sumber VOD');
    var raw = await upRes.json();

    // Normalisasi fallback
    if (endpoint === 'list' || endpoint === 'search') {
      var items = [];
      if (prov === 'shortmax') {
        items = (raw.data || []).map(function (d) {
          return { id: String(d.id || d.code), title: d.name || '', cover: d.cover || '', episodes: d.episodes || 0, summary: d.summary || '', provider: 'shortmax', lang: lang };
        });
      } else if (prov === 'goodshort') {
        items = ((raw.data && (raw.data.books || raw.data.list)) || []).map(function (d) {
          return { id: String(d.id), title: d.title || '', cover: d.cover || '', episodes: d.total_chapters || 0, summary: d.desc || d.title || '', provider: 'goodshort', lang: d.lang || lang };
        });
      } else if (prov === 'joyreels') {
        items = (raw.items || []).map(function (d) {
          return { id: String(d.id), title: d.title || '', cover: d.poster || '', episodes: d.episode_count || 0, summary: d.category || '', provider: 'joyreels', lang: raw.language || lang };
        });
      } else if (prov === 'raptdrama') {
        items = (raw.data || []).map(function (d) {
          return { id: String(d.id), title: d.title || '', cover: d.cover || d.poster_original || '', episodes: d.total_episodes || 0, summary: d.desc || '', provider: 'raptdrama', lang: 'zh' };
        });
      }
      return { provider: prov, lang: lang, items: items };
    }

    if (endpoint === 'drama') {
      var dramaPayload = { provider: prov, id: p.id, lang: lang, title: '', cover: '', summary: '', totalEpisodes: 0, episodes: [] };
      if (prov === 'shortmax') {
        var smData = raw.data || {};
        dramaPayload.title = smData.name || '';
        dramaPayload.summary = smData.summary || '';
        dramaPayload.totalEpisodes = smData.totalEpisodes || (smData.episodes || []).length;
        dramaPayload.episodes = (smData.episodes || []).map(function (ep) {
          return {
            episode: ep.episode,
            title: 'Ep ' + ep.episode,
            stream: (ep.video && (ep.video.video_1080 || ep.video.video_720 || ep.video.video_480)) || '',
            cover: ep.cover || '',
            duration: ep.duration || 0
          };
        });
      } else if (prov === 'goodshort') {
        var gsData = raw.data || {};
        dramaPayload.title = gsData.title || '';
        dramaPayload.cover = gsData.cover || '';
        dramaPayload.summary = gsData.desc || gsData.title || '';
        dramaPayload.totalEpisodes = gsData.total_chapters || (gsData.chapters || []).length;
        dramaPayload.episodes = (gsData.chapters || []).map(function (ch) {
          return { episode: ch.chapter, title: 'Ep ' + ch.chapter, stream: ch.stream, quality: ch.quality || '1080p' };
        });
      } else if (prov === 'joyreels') {
        dramaPayload.totalEpisodes = raw.total_episodes || (raw.episodes || []).length;
        dramaPayload.episodes = (raw.episodes || []).map(function (ep) {
          return { episode: ep.idx, episodeId: ep.episode_id, title: 'Ep ' + ep.idx, cover: ep.poster || '', needsResolve: true };
        });
      } else if (prov === 'raptdrama') {
        var rdList = raw.data || [];
        dramaPayload.totalEpisodes = rdList.length;
        dramaPayload.episodes = rdList.map(function (ep) {
          return { episode: ep.idx, title: ep.title || ('Ep ' + ep.idx), stream: ep.url, segments: ep.segments };
        });
      }
      return dramaPayload;
    }

    if (endpoint === 'stream') {
      var sUrl = (prov === 'joyreels') ? (raw.content_resource_url || '') : ((raw.data && raw.data.stream) || '');
      return { provider: prov, id: p.id, ep: p.ep, stream: sUrl };
    }

    return raw;
  }

  /* ---------------- RENDER ENGINE UI ---------------- */
  function renderProviderTabs() {
    if (!el.vodProvTabs) return;
    el.vodProvTabs.innerHTML = '';
    PROVIDERS.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vod-prov-btn' + (p.id === S.provider ? ' is-active' : '');
      btn.setAttribute('data-prov', p.id);
      btn.innerHTML = '<span class="vod-prov-name">' + p.name + '</span><span class="vod-prov-badge">' + p.badge + '</span>';
      btn.addEventListener('click', function () {
        if (S.provider === p.id) return;
        S.provider = p.id;
        S.page = 1;
        S.query = '';
        if (el.vodSearchInput) el.vodSearchInput.value = '';
        updateProvChips();
        updateTypeChipsVisibility();
        loadDramas();
      });
      el.vodProvTabs.appendChild(btn);
    });
  }

  function updateProvChips() {
    if (!el.vodProvTabs) return;
    Array.prototype.forEach.call(el.vodProvTabs.children, function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-prov') === S.provider);
    });
  }

  function updateTypeChipsVisibility() {
    if (!el.vodTypeChips) return;
    // Hanya shortmax dan goodshort yang punya filter tipe
    el.vodTypeChips.hidden = !(S.provider === 'shortmax' || S.provider === 'goodshort');
    Array.prototype.forEach.call(el.vodTypeChips.children, function (chip) {
      chip.classList.toggle('is-active', chip.getAttribute('data-type') === S.type);
    });
  }

  function renderGrid(dramas) {
    if (!el.vodGrid) return;
    el.vodGrid.innerHTML = '';

    if (!dramas || !dramas.length) {
      if (el.vodEmpty) el.vodEmpty.hidden = false;
      return;
    }
    if (el.vodEmpty) el.vodEmpty.hidden = true;

    dramas.forEach(function (d) {
      var card = document.createElement('div');
      card.className = 'vod-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('data-id', d.id);

      var coverUrl = d.cover || 'icons/logo.jpg';
      var epText = d.episodes ? (d.episodes + ' Eps') : 'Short Drama';
      var langBadge = (d.lang === 'id' || S.lang === 'id') ? '🇮🇩 ID' : '🇬🇧 EN';

      card.innerHTML =
        '<div class="vod-card-media">' +
          '<img class="vod-card-img" src="' + escapeHtml(coverUrl) + '" alt="' + escapeHtml(d.title) + '" loading="lazy" onerror="this.src=\'icons/logo.jpg\'">' +
          '<div class="vod-card-top-badges">' +
            '<span class="vod-badge-ep">' + epText + '</span>' +
            '<span class="vod-badge-lang">' + langBadge + '</span>' +
          '</div>' +
          '<div class="vod-card-glow"></div>' +
        '</div>' +
        '<div class="vod-card-meta">' +
          '<h3 class="vod-card-title" title="' + escapeHtml(d.title) + '">' + escapeHtml(d.title) + '</h3>' +
          '<div class="vod-card-sub">' +
            '<span class="vod-card-prov">' + (d.provider || S.provider).toUpperCase() + '</span>' +
            '<span class="vod-card-play-ic">▶</span>' +
          '</div>' +
        '</div>';

      function handleCardClick() {
        openDramaDetail(d);
      }
      card.addEventListener('click', handleCardClick);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      });

      el.vodGrid.appendChild(card);
    });
  }

  /* ---------------- LOAD DATA ---------------- */
  async function loadDramas() {
    S.loading = true;
    if (el.vodLoading) el.vodLoading.hidden = false;
    if (el.vodEmpty) el.vodEmpty.hidden = true;

    try {
      var data;
      if (S.query.trim()) {
        data = await apiGet('search', {
          provider: S.provider,
          lang: S.lang,
          q: S.query.trim()
        });
      } else {
        data = await apiGet('list', {
          provider: S.provider,
          lang: S.lang,
          type: S.type,
          page: S.page
        });
      }

      S.dramas = (data && data.items) || [];
      renderGrid(S.dramas);
    } catch (err) {
      console.error('[ZanVOD] Error load dramas:', err);
      if (el.vodEmpty) {
        el.vodEmpty.hidden = false;
        el.vodEmpty.querySelector('.vod-empty-text').textContent = 'Gagal memuat drama. Periksa koneksi internet atau coba provider lain.';
      }
    } finally {
      S.loading = false;
      if (el.vodLoading) el.vodLoading.hidden = true;
    }
  }

  /* ---------------- BOTTOM SHEET & DETAIL ---------------- */
  async function openDramaDetail(drama) {
    if (!drama) return;
    S.currentDrama = drama;
    S.currentEpisodes = [];
    S.currentEpIndex = 0;

    if (el.vodSheetCover) el.vodSheetCover.src = drama.cover || 'icons/logo.jpg';
    if (el.vodSheetTitle) el.vodSheetTitle.textContent = drama.title || 'Short Drama';
    if (el.vodSheetBadge) {
      el.vodSheetBadge.textContent = (drama.provider || S.provider).toUpperCase() + ' • ' + (drama.episodes ? drama.episodes + ' Episode' : 'Lengkap');
    }
    if (el.vodSheetDesc) {
      el.vodSheetDesc.textContent = drama.summary || 'Koleksi Short Drama premium di ZanTV. Klik episode di bawah untuk memutar langsung.';
    }

    if (el.vodEpList) el.vodEpList.innerHTML = '<div class="vod-ep-loading">Mengambil daftar episode...</div>';
    if (el.vodEpRangeTabs) el.vodEpRangeTabs.innerHTML = '';
    if (el.vodSheetPlayFirst) {
      el.vodSheetPlayFirst.disabled = true;
      el.vodSheetPlayFirst.onclick = null;
    }

    if (el.vodSheet && typeof el.vodSheet.showModal === 'function') {
      try { el.vodSheet.showModal(); } catch (e) { el.vodSheet.setAttribute('open', ''); }
    }

    try {
      var detail = await apiGet('drama', {
        provider: drama.provider || S.provider,
        id: drama.id,
        lang: drama.lang || S.lang
      });

      var eps = (detail && detail.episodes) || [];
      // Jika episode kosong tapi totalEpisodes ada, generate placeholder episode numbers
      if (!eps.length && detail.totalEpisodes) {
        for (var i = 1; i <= detail.totalEpisodes; i++) {
          eps.push({ episode: i, title: 'Ep ' + i, needsResolve: true });
        }
      }
      S.currentEpisodes = eps;

      if (detail.summary && el.vodSheetDesc) el.vodSheetDesc.textContent = detail.summary;
      if (detail.title && el.vodSheetTitle) el.vodSheetTitle.textContent = detail.title;

      renderEpisodePicker(eps);

      if (el.vodSheetPlayFirst && eps.length) {
        el.vodSheetPlayFirst.disabled = false;
        el.vodSheetPlayFirst.onclick = function () {
          playEpisode(0);
        };
      }
    } catch (err) {
      console.error('[ZanVOD] Error load drama detail:', err);
      if (el.vodEpList) el.vodEpList.innerHTML = '<div class="vod-ep-err">Gagal memuat episode. Coba lagi nanti.</div>';
    }
  }

  function renderEpisodePicker(episodes) {
    if (!el.vodEpList) return;
    el.vodEpList.innerHTML = '';

    if (!episodes || !episodes.length) {
      el.vodEpList.innerHTML = '<div class="vod-ep-empty">Episode tidak tersedia</div>';
      return;
    }

    var total = episodes.length;
    var rangeSize = 30;

    // Range tabs jika episode banyak (> 30)
    if (el.vodEpRangeTabs) {
      el.vodEpRangeTabs.innerHTML = '';
      if (total > rangeSize) {
        var numRanges = Math.ceil(total / rangeSize);
        for (var r = 0; r < numRanges; r++) {
          var start = r * rangeSize + 1;
          var end = Math.min((r + 1) * rangeSize, total);
          var tabBtn = document.createElement('button');
          tabBtn.type = 'button';
          tabBtn.className = 'vod-range-btn' + (r === 0 ? ' is-active' : '');
          tabBtn.textContent = start + ' - ' + end;
          tabBtn.setAttribute('data-range-idx', r);
          (function (rangeIdx) {
            tabBtn.addEventListener('click', function () {
              Array.prototype.forEach.call(el.vodEpRangeTabs.children, function (t) {
                t.classList.toggle('is-active', t === tabBtn);
              });
              renderEpisodeButtons(episodes, rangeIdx * rangeSize, Math.min((rangeIdx + 1) * rangeSize, total));
            });
          })(r);
          el.vodEpRangeTabs.appendChild(tabBtn);
        }
      }
    }

    renderEpisodeButtons(episodes, 0, Math.min(rangeSize, total));
  }

  function renderEpisodeButtons(episodes, startIndex, endIndex) {
    if (!el.vodEpList) return;
    el.vodEpList.innerHTML = '';

    var slice = episodes.slice(startIndex, endIndex);
    slice.forEach(function (ep, idxInSlice) {
      var actualIdx = startIndex + idxInSlice;
      var btn = document.createElement('button');
      btn.type = 'button';
      var isPlayingThis = (S.currentDrama && S.activeEpNum === ep.episode);
      btn.className = 'vod-ep-btn' + (isPlayingThis ? ' is-active' : '');
      btn.innerHTML = '<span class="vod-ep-no">' + (ep.episode || (actualIdx + 1)) + '</span>';
      if (ep.duration) {
        btn.innerHTML += '<span class="vod-ep-dur">' + Math.round(ep.duration) + 's</span>';
      }

      btn.addEventListener('click', function () {
        playEpisode(actualIdx);
      });

      el.vodEpList.appendChild(btn);
    });
  }

  /* ---------------- PLAY EPISODE BRIDGE ---------------- */
  async function playEpisode(index) {
    if (!S.currentDrama || !S.currentEpisodes || !S.currentEpisodes[index]) return;
    S.currentEpIndex = index;
    var ep = S.currentEpisodes[index];
    S.activeEpNum = ep.episode || (index + 1);

    // Update active highlight pada episode buttons
    if (el.vodEpList) {
      Array.prototype.forEach.call(el.vodEpList.children, function (b) {
        var no = b.querySelector('.vod-ep-no');
        if (no && +no.textContent === S.activeEpNum) {
          b.classList.add('is-active');
        } else {
          b.classList.remove('is-active');
        }
      });
    }

    var streamUrl = ep.stream;

    // Jika butuh resolve dinamis (JoyReels / GoodShort chapter)
    if (!streamUrl || ep.needsResolve) {
      try {
        if (typeof showToast === 'function') showToast('Menghubungkan stream episode ' + S.activeEpNum + '...');
        var res = await apiGet('stream', {
          provider: S.currentDrama.provider || S.provider,
          id: S.currentDrama.id,
          ep: ep.episode || (index + 1),
          lang: S.currentDrama.lang || S.lang
        });
        if (res && res.stream) {
          streamUrl = res.stream;
          ep.stream = streamUrl;
        }
      } catch (err) {
        console.error('[ZanVOD] Error resolve stream:', err);
      }
    }

    if (!streamUrl) {
      alert('Gagal mengambil alamat video episode ini.');
      return;
    }

    // Bangun channel payload untuk pemutar ZanTV
    var vodCh = {
      name: (S.currentDrama.title || 'Drama') + ' - Ep ' + S.activeEpNum,
      url: streamUrl,
      group: 'Short Drama',
      logo: ep.cover || S.currentDrama.cover || 'icons/icon-192.png',
      isVod: true,
      isVertical: true,
      vodDrama: S.currentDrama,
      vodEp: ep,
      vodIndex: index,
      totalEpisodes: S.currentEpisodes.length
    };

    // Panggil window.ZanTV.playVod jika tersedia, atau direct window.play
    if (window.ZanTV && typeof window.ZanTV.playVod === 'function') {
      window.ZanTV.playVod(vodCh);
    } else if (typeof window.playChannel === 'function') {
      window.playChannel(vodCh);
    }

    // Tutup bottom sheet agar user bisa langsung nonton
    closeDramaSheet();

    // Scroll ke atas pada mobile
    if (window.innerWidth <= 860) {
      var stage = document.getElementById('stage');
      if (stage) stage.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function playNextEpisode() {
    if (!S.currentEpisodes || !S.currentEpisodes.length) return false;
    if (S.currentEpIndex + 1 < S.currentEpisodes.length) {
      playEpisode(S.currentEpIndex + 1);
      return true;
    }
    return false;
  }

  function playPrevEpisode() {
    if (!S.currentEpisodes || !S.currentEpisodes.length) return false;
    if (S.currentEpIndex > 0) {
      playEpisode(S.currentEpIndex - 1);
      return true;
    }
    return false;
  }

  function closeDramaSheet() {
    if (el.vodSheet) {
      if (typeof el.vodSheet.close === 'function') {
        try { el.vodSheet.close(); } catch (e) {}
      }
      el.vodSheet.removeAttribute('open');
    }
  }

  /* ---------------- MODE SWITCHER (LIVE TV vs SHORT DRAMA) ---------------- */
  function setMode(mode) {
    if (S.mode === mode) return;
    S.mode = mode;

    var isVod = (mode === 'vod');
    document.body.classList.toggle('is-vod-mode', isVod);

    if (el.segLiveBtn) el.segLiveBtn.classList.toggle('is-active', !isVod);
    if (el.segVodBtn) el.segVodBtn.classList.toggle('is-active', isVod);

    var groups = document.getElementById('groups');
    var listpane = document.querySelector('.listpane');
    var vodPane = document.getElementById('vodPane');

    if (groups) groups.hidden = isVod;
    if (listpane) listpane.hidden = isVod;
    if (vodPane) vodPane.hidden = !isVod;

    if (isVod && (!S.dramas || !S.dramas.length)) {
      loadDramas();
    }
  }

  /* ---------------- SEARCH DEBOUNCE ---------------- */
  var searchTimeout = null;
  function handleSearchInput() {
    if (!el.vodSearchInput) return;
    var val = el.vodSearchInput.value.trim();
    if (el.vodSearchClear) el.vodSearchClear.hidden = !val;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function () {
      S.query = val;
      S.page = 1;
      loadDramas();
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

  /* ---------------- INITIALIZE ---------------- */
  function init() {
    initElements();
    renderProviderTabs();
    updateTypeChipsVisibility();

    // Mode Toggle
    if (el.segLiveBtn) el.segLiveBtn.addEventListener('click', function () { setMode('live'); });
    if (el.segVodBtn) el.segVodBtn.addEventListener('click', function () { setMode('vod'); });

    // Language Toggle
    if (el.vodLangToggle) {
      el.vodLangToggle.addEventListener('click', function () {
        S.lang = (S.lang === 'id' ? 'en' : 'id');
        el.vodLangToggle.textContent = (S.lang === 'id' ? '🇮🇩 ID' : '🇬🇧 EN');
        S.page = 1;
        loadDramas();
      });
    }

    // Category / Type Chips
    if (el.vodTypeChips) {
      el.vodTypeChips.addEventListener('click', function (e) {
        var chip = e.target.closest('.vod-type-chip');
        if (!chip) return;
        var t = chip.getAttribute('data-type');
        if (!t || S.type === t) return;
        S.type = t;
        updateTypeChipsVisibility();
        S.page = 1;
        loadDramas();
      });
    }

    // Search input
    if (el.vodSearchInput) {
      el.vodSearchInput.addEventListener('input', handleSearchInput);
      el.vodSearchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSearchInput();
        }
      });
    }

    if (el.vodSearchClear) {
      el.vodSearchClear.addEventListener('click', function () {
        if (el.vodSearchInput) el.vodSearchInput.value = '';
        el.vodSearchClear.hidden = true;
        S.query = '';
        S.page = 1;
        loadDramas();
      });
    }

    // Sheet close
    if (el.vodSheetClose) {
      el.vodSheetClose.addEventListener('click', closeDramaSheet);
    }
    if (el.vodSheet) {
      el.vodSheet.addEventListener('click', function (e) {
        if (e.target === el.vodSheet) closeDramaSheet();
      });
    }
  }

  window.ZanVod = {
    setMode: setMode,
    loadDramas: loadDramas,
    openDramaDetail: openDramaDetail,
    playEpisode: playEpisode,
    playNextEpisode: playNextEpisode,
    playPrevEpisode: playPrevEpisode,
    getState: function () { return S; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
