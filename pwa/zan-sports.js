/* ZanTV Sports Ticker: Jadwal Bola Liga Inggris (EPL), Liga 1 Indonesia, & Liga Champions (UCL)
 * Modern glassmorphic running ticker with auto-search broadcast channel in ZanTV.
 * Crafted with love by Lody.
 */
(function () {
  'use strict';

  var MATCHES = [
    /* Premier League (Liga Inggris) */
    {
      id: 'epl-1',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Arsenal',
      away: 'Chelsea',
      homeCode: 'ARS',
      awayCode: 'CHE',
      day: 'Sabtu, 31 Okt',
      time: '19:30 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'upcoming'
    },
    {
      id: 'epl-2',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Newcastle',
      away: 'Tottenham',
      homeCode: 'NEW',
      awayCode: 'TOT',
      day: 'Sabtu, 31 Okt',
      time: '22:00 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'upcoming'
    },
    {
      id: 'epl-3',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Man United',
      away: 'Aston Villa',
      homeCode: 'MUN',
      awayCode: 'AVL',
      day: 'Minggu, 1 Nov',
      time: '21:00 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'upcoming'
    },
    {
      id: 'epl-4',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Man City',
      away: 'Liverpool',
      homeCode: 'MCI',
      awayCode: 'LIV',
      day: 'Minggu, 1 Nov',
      time: '23:30 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'upcoming'
    },

    /* Liga 1 Indonesia */
    {
      id: 'l1-1',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'Persebaya',
      away: 'Arema FC',
      homeCode: 'SBY',
      awayCode: 'ARE',
      day: 'Sabtu, 31 Okt',
      time: '19:00 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },
    {
      id: 'l1-2',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'Persib Bandung',
      away: 'Persija Jakarta',
      homeCode: 'PSB',
      awayCode: 'PSJ',
      day: 'Minggu, 1 Nov',
      time: '15:30 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },
    {
      id: 'l1-3',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'Bali United',
      away: 'PSM Makassar',
      homeCode: 'BLI',
      awayCode: 'PSM',
      day: 'Minggu, 1 Nov',
      time: '19:00 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },
    {
      id: 'l1-4',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'Borneo FC',
      away: 'Madura United',
      homeCode: 'BOR',
      awayCode: 'MAD',
      day: 'Senin, 2 Nov',
      time: '15:30 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },

    /* UEFA Champions League (Liga Champions) */
    {
      id: 'ucl-1',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'Real Madrid',
      away: 'Bayern München',
      homeCode: 'RMA',
      awayCode: 'BAY',
      day: 'Rabu, 4 Nov',
      time: '03:00 WIB',
      channel: 'SCTV / Vidio',
      searchKey: 'SCTV',
      status: 'upcoming'
    },
    {
      id: 'ucl-2',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'Liverpool',
      away: 'Bayer Leverkusen',
      homeCode: 'LIV',
      awayCode: 'LEV',
      day: 'Rabu, 4 Nov',
      time: '03:00 WIB',
      channel: 'Champions TV',
      searchKey: 'Champions',
      status: 'upcoming'
    },
    {
      id: 'ucl-3',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'Inter Milan',
      away: 'Arsenal',
      homeCode: 'INT',
      awayCode: 'ARS',
      day: 'Kamis, 5 Nov',
      time: '03:00 WIB',
      channel: 'Champions TV',
      searchKey: 'Champions',
      status: 'upcoming'
    },
    {
      id: 'ucl-4',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'Barcelona',
      away: 'Paris Saint-Germain',
      homeCode: 'BAR',
      awayCode: 'PSG',
      day: 'Kamis, 5 Nov',
      time: '03:00 WIB',
      channel: 'SCTV / Vidio',
      searchKey: 'SCTV',
      status: 'upcoming'
    }
  ];

  var currentFilter = 'all';
  var isPaused = false;
  var el = {};

  function say(msg) {
    if (window.zanToast) window.zanToast(msg);
  }

  function filterMatches(league) {
    if (!league || league === 'all') return MATCHES;
    return MATCHES.filter(function (m) { return m.league === league; });
  }

  /* Render running text marquee */
  function renderTicker() {
    if (!el.track) return;
    var list = filterMatches(currentFilter);
    if (!list.length) list = MATCHES;

    // Render duplicates so continuous loop is seamless
    function makeItem(m) {
      var hCode = m.homeCode || m.home.substring(0, 3).toUpperCase();
      var aCode = m.awayCode || m.away.substring(0, 3).toUpperCase();
      return (
        '<div class="ticker-match-item" data-id="' + m.id + '" data-channel="' + m.searchKey + '" role="button" tabindex="0" title="' + m.home + ' vs ' + m.away + ' (' + m.channel + ')">' +
          '<span class="ticker-badge ticker-badge--' + m.league + '">' + m.leagueBadge + '</span>' +
          '<span class="ticker-teams"><strong>' + hCode + '</strong> <small>vs</small> <strong>' + aCode + '</strong></span>' +
          '<span class="ticker-meta">' + m.time + '</span>' +
          '<span class="ticker-ch-pill">📺 ' + m.channel + '</span>' +
          '<span class="ticker-sep">◆</span>' +
        '</div>'
      );
    }

    var itemsHtml = list.map(makeItem).join('');
    // Clone twice for smooth seamless marquee scroll
    el.track.innerHTML = itemsHtml + itemsHtml;

    // Update Header Quick Pill if available
    if (el.sportsPill) {
      el.sportsPill.innerHTML = (
        '<span class="sports-pill-icon">⚽</span>' +
        '<span class="sports-pill-text">Jadwal Bola</span>' +
        '<span class="sports-pill-badge">' + list.length + ' Laga</span>'
      );
    }
  }

  /* Render Full Schedule Dialog */
  function renderModalSchedule(filter) {
    if (!el.modalList) return;
    var list = filterMatches(filter);

    el.modalList.innerHTML = list.map(function (m) {
      return (
        '<div class="sports-card sports-card--' + m.league + '">' +
          '<div class="sports-card-header">' +
            '<span class="ticker-badge ticker-badge--' + m.league + '">' + m.leagueBadge + ' ' + m.leagueName + '</span>' +
            '<span class="sports-card-kickoff">' + m.day + ' • ' + m.time + '</span>' +
          '</div>' +
          '<div class="sports-card-body">' +
            '<div class="sports-team sports-team--home">' +
              '<span class="sports-team-name">' + m.home + '</span>' +
            '</div>' +
            '<div class="sports-vs-pill">VS</div>' +
            '<div class="sports-team sports-team--away">' +
              '<span class="sports-team-name">' + m.away + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="sports-card-footer">' +
            '<span class="sports-card-ch">Siaran: <strong>' + m.channel + '</strong></span>' +
            '<button class="btn btn-sm sports-watch-btn" type="button" data-key="' + m.searchKey + '">' +
              '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
              'Cari Channel di ZanTV' +
            '</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  /* Search for channel in ZanTV search bar */
  function triggerChannelSearch(keyword) {
    var searchInput = document.getElementById('search');
    if (searchInput) {
      searchInput.value = keyword;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.focus();
      say('Mencari channel ' + keyword + ' di daftar ZanTV');
    }
  }

  /* Modal controls */
  function openModal() {
    if (!el.dialog) return;
    renderModalSchedule(currentFilter);
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

  /* Bersihkan Legacy Collapse State Supaya Bar Tidak Hilang */
  function clearLegacyCollapse() {
    try {
      localStorage.removeItem('zandev:sports_ticker_collapsed');
      if (el.ticker) el.ticker.classList.remove('is-collapsed');
    } catch (e) {}
  }

  function init() {
    el = {
      ticker: document.getElementById('sportsBar') || document.getElementById('liveBar') || document.getElementById('sportsTicker'),
      track: document.getElementById('sportsTrack'),
      filterBar: document.getElementById('sportsFilter'),
      toggleBtn: document.getElementById('liveToggleBtn') || document.getElementById('sportsToggleBtn'),
      pauseBtn: document.getElementById('sportsPauseBtn'),
      modalBtn: document.getElementById('sportsModalBtn'),
      sportsPill: document.getElementById('sportsPill'),

      /* Dialog Modal */
      dialog: document.getElementById('sportsDialog'),
      dialogClose: document.getElementById('sportsDialogClose'),
      modalTabs: document.getElementById('sportsModalTabs'),
      modalList: document.getElementById('sportsModalList')
    };

    if (!el.ticker && !el.track) return;

    clearLegacyCollapse();
    renderTicker();

    /* Filter buttons on ticker */
    if (el.filterBar) {
      el.filterBar.addEventListener('click', function (e) {
        var btn = e.target.closest('.sports-filter-btn');
        if (!btn) return;
        var league = btn.getAttribute('data-league');
        currentFilter = league || 'all';
        Array.prototype.forEach.call(el.filterBar.children, function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        renderTicker();
      });
    }

    /* Click on ticker item to find channel */
    if (el.track) {
      el.track.addEventListener('click', function (e) {
        var item = e.target.closest('.ticker-match-item');
        if (!item) return;
        var ch = item.getAttribute('data-channel');
        if (ch) {
          triggerChannelSearch(ch);
        }
      });
    }

    /* Pause button */
    if (el.pauseBtn) {
      el.pauseBtn.addEventListener('click', function () {
        isPaused = !isPaused;
        if (el.track) el.track.classList.toggle('is-paused', isPaused);
        el.pauseBtn.title = isPaused ? 'Jalankan running text' : 'Jeda running text';
        el.pauseBtn.innerHTML = isPaused
          ? '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
          : '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      });
    }

    /* Open modal buttons */
    if (el.modalBtn) el.modalBtn.addEventListener('click', openModal);
    if (el.sportsPill) el.sportsPill.addEventListener('click', openModal);

    /* Modal close */
    if (el.dialogClose) el.dialogClose.addEventListener('click', closeModal);
    if (el.dialog) {
      el.dialog.addEventListener('click', function (e) {
        if (e.target === el.dialog) closeModal();
      });
    }

    /* Modal League Tabs */
    if (el.modalTabs) {
      el.modalTabs.addEventListener('click', function (e) {
        var tab = e.target.closest('.sports-tab');
        if (!tab) return;
        var league = tab.getAttribute('data-league');
        Array.prototype.forEach.call(el.modalTabs.children, function (t) {
          t.classList.toggle('is-active', t === tab);
        });
        renderModalSchedule(league);
      });
    }

    /* Modal watch channel buttons */
    if (el.modalList) {
      el.modalList.addEventListener('click', function (e) {
        var btn = e.target.closest('.sports-watch-btn');
        if (!btn) return;
        var key = btn.getAttribute('data-key');
        if (key) {
          closeModal();
          triggerChannelSearch(key);
        }
      });
    }
  }

  window.ZanSports = {
    matches: MATCHES,
    openModal: openModal,
    closeModal: closeModal,
    filter: filterMatches
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
