/* ZanTV Sports Ticker: Jadwal Bola Liga Inggris (EPL), Liga 1 Indonesia, & Liga Champions (UCL)
 * Modern glassmorphic running ticker with auto-search broadcast channel in ZanTV.
 * Crafted with love by Lody.
 */
(function () {
  'use strict';

  var MATCHES = [
    /* Premier League (Liga Inggris) */
    {
      id: 'epl-mci-bha',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Man City',
      away: 'Brighton',
      homeCode: 'MCI',
      awayCode: 'BHA',
      day: 'Sabtu, 31 Okt',
      time: '22:00 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'live'
    },
    {
      id: 'epl-che-mun',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Chelsea',
      away: 'Man United',
      homeCode: 'CHE',
      awayCode: 'MUN',
      day: 'Sabtu, 31 Okt',
      time: '19:30 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'upcoming'
    },
    {
      id: 'epl-tot-cry',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Tottenham',
      away: 'Crystal Palace',
      homeCode: 'TOT',
      awayCode: 'CRY',
      day: 'Minggu, 1 Nov',
      time: '00:30 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'upcoming'
    },
    {
      id: 'epl-avl-ful',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Aston Villa',
      away: 'Fulham',
      homeCode: 'AVL',
      awayCode: 'FUL',
      day: 'Minggu, 1 Nov',
      time: '03:00 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'upcoming'
    },
    {
      id: 'epl-liv-ars',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Liverpool',
      away: 'Arsenal',
      homeCode: 'LIV',
      awayCode: 'ARS',
      day: 'Minggu, 1 Nov',
      time: '23:30 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'upcoming'
    },
    {
      id: 'epl-new-eve',
      league: 'epl',
      leagueName: 'Premier League',
      leagueBadge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',
      home: 'Newcastle',
      away: 'Everton',
      homeCode: 'NEW',
      awayCode: 'EVE',
      day: 'Selasa, 3 Nov',
      time: '03:00 WIB',
      channel: 'Vidio',
      searchKey: 'Vidio',
      status: 'upcoming'
    },

    /* BRI Liga 1 Indonesia */
    {
      id: 'l1-dew-psj',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'Dewa United',
      away: 'Persija',
      homeCode: 'DEW',
      awayCode: 'PSJ',
      day: 'Sabtu, 31 Okt',
      time: '19:00 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },
    {
      id: 'l1-psb-kal',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'Persib Bandung',
      away: 'Kalteng FC',
      homeCode: 'PSB',
      awayCode: 'KAL',
      day: 'Sabtu, 31 Okt',
      time: '15:30 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },
    {
      id: 'l1-are-bli',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'Arema FC',
      away: 'Bali United',
      homeCode: 'ARE',
      awayCode: 'BLI',
      day: 'Sabtu, 31 Okt',
      time: '15:30 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },
    {
      id: 'l1-psm-mad',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'PSM Makassar',
      away: 'Madura United',
      homeCode: 'PSM',
      awayCode: 'MAD',
      day: 'Sabtu, 31 Okt',
      time: '15:30 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },
    {
      id: 'l1-jog-bor',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'PSIM Jogja',
      away: 'Borneo FC',
      homeCode: 'JOG',
      awayCode: 'BOR',
      day: 'Minggu, 1 Nov',
      time: '15:30 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },
    {
      id: 'l1-grd-pss',
      league: 'liga1',
      leagueName: 'BRI Liga 1',
      leagueBadge: '🇮🇩 Liga 1',
      home: 'Garudayaksa',
      away: 'PSS Sleman',
      homeCode: 'GRD',
      awayCode: 'PSS',
      day: 'Minggu, 1 Nov',
      time: '19:00 WIB',
      channel: 'Indosiar',
      searchKey: 'Indosiar',
      status: 'upcoming'
    },

    /* UEFA Champions League (Liga Champions) */
    {
      id: 'ucl-bar-avl',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'Barcelona',
      away: 'Aston Villa',
      homeCode: 'BAR',
      awayCode: 'AVL',
      day: 'Rabu, 4 Nov',
      time: '03:00 WIB',
      channel: 'SCTV / Vidio',
      searchKey: 'SCTV',
      status: 'upcoming'
    },
    {
      id: 'ucl-atm-bay',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'Atlético Madrid',
      away: 'Bayern München',
      homeCode: 'ATM',
      awayCode: 'BAY',
      day: 'Rabu, 4 Nov',
      time: '03:00 WIB',
      channel: 'Champions TV',
      searchKey: 'Champions',
      status: 'upcoming'
    },
    {
      id: 'ucl-mun-rom',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'Man United',
      away: 'AS Roma',
      homeCode: 'MUN',
      awayCode: 'ROM',
      day: 'Rabu, 4 Nov',
      time: '03:00 WIB',
      channel: 'Champions TV',
      searchKey: 'Champions',
      status: 'upcoming'
    },
    {
      id: 'ucl-rbl-mci',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'RB Leipzig',
      away: 'Man City',
      homeCode: 'RBL',
      awayCode: 'MCI',
      day: 'Kamis, 5 Nov',
      time: '03:00 WIB',
      channel: 'Champions TV',
      searchKey: 'Champions',
      status: 'upcoming'
    },
    {
      id: 'ucl-sla-ars',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'Slavia Praha',
      away: 'Arsenal',
      homeCode: 'SLA',
      awayCode: 'ARS',
      day: 'Kamis, 5 Nov',
      time: '03:00 WIB',
      channel: 'Champions TV',
      searchKey: 'Champions',
      status: 'upcoming'
    },
    {
      id: 'ucl-aek-rma',
      league: 'ucl',
      leagueName: 'Champions League',
      leagueBadge: '⭐️ UCL',
      home: 'AEK Athens',
      away: 'Real Madrid',
      homeCode: 'AEK',
      awayCode: 'RMA',
      day: 'Rabu, 4 Nov',
      time: '00:45 WIB',
      channel: 'SCTV / Vidio',
      searchKey: 'SCTV',
      status: 'upcoming'
    }
  ];

  var currentFilter = 'all';
  var isPaused = false;
  var currentMatches = MATCHES.slice();
  var el = {};

  function say(msg) {
    if (window.zanToast) window.zanToast(msg);
  }

  function filterMatches(league) {
    var pool = currentMatches && currentMatches.length ? currentMatches : MATCHES;
    if (!league || league === 'all') return pool;
    return pool.filter(function (m) { return m.league === league; });
  }

  /* Load Real-Time Live Scores from ESPN API */
  function loadLiveScores() {
    var endpoints = [
      { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard', league: 'epl', name: 'Premier League', badge: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL', channel: 'Vidio' },
      { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/idn.1/scoreboard', league: 'liga1', name: 'BRI Liga 1', badge: '🇮🇩 Liga 1', channel: 'Indosiar' },
      { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard', league: 'ucl', name: 'Champions League', badge: '⭐️ UCL', channel: 'SCTV / Vidio' }
    ];

    Promise.all(endpoints.map(function (ep) {
      return fetch(ep.url, { cache: 'no-cache' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) { return { ep: ep, events: data && data.events ? data.events : [] }; })
        .catch(function () { return { ep: ep, events: [] }; });
    })).then(function (results) {
      var liveList = [];
      results.forEach(function (r) {
        var ep = r.ep;
        (r.events || []).forEach(function (e) {
          var comp = e.competitions && e.competitions[0];
          if (!comp || !comp.competitors) return;
          var home = null, away = null;
          comp.competitors.forEach(function (c) {
            if (c.homeAway === 'home') home = c;
            else if (c.homeAway === 'away') away = c;
          });
          if (!home || !away) return;

          var state = (e.status && e.status.type && e.status.type.state) || 'pre';
          var isLive = state === 'in';
          var isPost = state === 'post';
          var displayClock = (e.status && e.status.displayClock) || '';
          if (isLive && !displayClock) displayClock = 'LIVE';

          var date = new Date(e.date);
          var now = new Date();
          var isToday = date.toDateString() === now.toDateString();
          var isTomorrow = new Date(now.getTime() + 86400000).toDateString() === date.toDateString();
          var dayStr = 'Hari ini';
          if (isToday) dayStr = 'Hari ini';
          else if (isTomorrow) dayStr = 'Besok';
          else {
            try {
              dayStr = date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
            } catch (err) {
              dayStr = '';
            }
          }

          var timeStr = '';
          try {
            timeStr = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' WIB';
          } catch (err) {
            timeStr = (e.status && e.status.type && e.status.type.shortDetail) || '';
          }

          var hName = (home.team && (home.team.name || home.team.displayName)) || 'Home';
          var aName = (away.team && (away.team.name || away.team.displayName)) || 'Away';
          var hCode = (home.team && (home.team.abbreviation || hName.substring(0, 3))).toUpperCase();
          var aCode = (away.team && (away.team.abbreviation || aName.substring(0, 3))).toUpperCase();

          if (hCode === 'MNC') hCode = 'MCI';
          if (aCode === 'MNC') aCode = 'MCI';
          if (hCode === 'MAN') hCode = 'MUN';
          if (aCode === 'MAN') aCode = 'MUN';

          var matchClock = isLive ? displayClock : (isPost ? 'FT' : '');
          var matchTime = isLive ? displayClock : (isPost ? 'FT' : (isToday ? timeStr : dayStr + ' ' + timeStr));

          liveList.push({
            id: 'live-' + e.id,
            league: ep.league,
            leagueName: ep.name,
            leagueBadge: ep.badge,
            home: hName,
            away: aName,
            homeCode: hCode,
            awayCode: aCode,
            homeScore: home.score,
            awayScore: away.score,
            status: isLive ? 'live' : (isPost ? 'post' : 'upcoming'),
            isLive: isLive,
            isPost: isPost,
            clock: matchClock,
            day: dayStr,
            time: matchTime,
            channel: ep.channel,
            searchKey: ep.channel
          });
        });
      });

      if (liveList.length > 0) {
        var presentLeagues = {};
        liveList.forEach(function (m) { presentLeagues[m.league] = true; });
        MATCHES.forEach(function (m) {
          if (!presentLeagues[m.league]) {
            liveList.push(m);
          }
        });

        liveList.sort(function (a, b) {
          var weight = { live: 0, upcoming: 1, post: 2 };
          return (weight[a.status] || 1) - (weight[b.status] || 1);
        });
        currentMatches = liveList;
        renderTicker();
        if (el.modalList && el.dialog && el.dialog.hasAttribute('open')) {
          renderModalSchedule(currentFilter);
        }
      }
    }).catch(function () {});
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
      var isLive = m.status === 'live' || m.isLive;
      var isPost = m.status === 'post' || m.isPost;
      var hasScore = (isLive || isPost) && m.homeScore !== undefined && m.awayScore !== undefined && m.homeScore !== null && m.awayScore !== null;

      var statusBadge = '';
      if (isLive) {
        statusBadge = '<span class="ticker-live-badge"><span class="ticker-live-dot"></span>' + (m.clock || 'LIVE') + '</span>';
      } else if (isPost) {
        statusBadge = '<span class="ticker-ft-badge">FT</span>';
      }

      var teamsHtml = '';
      if (hasScore) {
        teamsHtml = '<span class="ticker-teams"><strong>' + hCode + '</strong> <span class="ticker-score">' + m.homeScore + ' - ' + m.awayScore + '</span> <strong>' + aCode + '</strong></span>';
      } else {
        teamsHtml = '<span class="ticker-teams"><strong>' + hCode + '</strong> <small>vs</small> <strong>' + aCode + '</strong></span>';
      }

      var metaHtml = '';
      if (!isLive && !isPost && m.time) {
        metaHtml = '<span class="ticker-meta">' + m.time + '</span>';
      }

      return (
        '<div class="ticker-match-item' + (isLive ? ' is-live' : '') + '" data-id="' + m.id + '" data-channel="' + m.searchKey + '" role="button" tabindex="0" title="' + m.home + ' vs ' + m.away + ' (' + m.channel + ')">' +
          '<span class="ticker-badge ticker-badge--' + m.league + '">' + m.leagueBadge + '</span>' +
          statusBadge +
          teamsHtml +
          metaHtml +
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
      var isLive = m.status === 'live' || m.isLive;
      var isPost = m.status === 'post' || m.isPost;
      var hasScore = (isLive || isPost) && m.homeScore !== undefined && m.awayScore !== undefined && m.homeScore !== null && m.awayScore !== null;

      var statusTag = '';
      if (isLive) {
        statusTag = '<span class="ticker-live-badge"><span class="ticker-live-dot"></span>LIVE ' + (m.clock || '') + '</span>';
      } else if (isPost) {
        statusTag = '<span class="ticker-ft-badge">SELESAI (FT)</span>';
      } else {
        statusTag = '<span class="sports-card-kickoff">' + m.day + ' • ' + m.time + '</span>';
      }

      var middleBody = '';
      if (hasScore) {
        middleBody = (
          '<div class="sports-score-box">' +
            '<span class="sports-score-num">' + m.homeScore + '</span>' +
            '<span class="sports-score-sep">-</span>' +
            '<span class="sports-score-num">' + m.awayScore + '</span>' +
          '</div>'
        );
      } else {
        middleBody = '<div class="sports-vs-pill">VS</div>';
      }

      return (
        '<div class="sports-card sports-card--' + m.league + (isLive ? ' is-live' : '') + '">' +
          '<div class="sports-card-header">' +
            '<span class="ticker-badge ticker-badge--' + m.league + '">' + m.leagueBadge + ' ' + m.leagueName + '</span>' +
            statusTag +
          '</div>' +
          '<div class="sports-card-body">' +
            '<div class="sports-team sports-team--home">' +
              '<span class="sports-team-name">' + m.home + '</span>' +
            '</div>' +
            middleBody +
            '<div class="sports-team sports-team--away">' +
              '<span class="sports-team-name">' + m.away + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="sports-card-footer">' +
            '<span class="sports-card-ch">Siaran: <strong>' + m.channel + '</strong></span>' +
            '<button class="btn btn-sm sports-watch-btn" type="button" data-key="' + m.searchKey + '">' +
              '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
              'Tonton di ZanTV' +
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
    loadLiveScores();
    setInterval(loadLiveScores, 60000);

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
    filter: filterMatches,
    refresh: loadLiveScores
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
