'use strict';
/**
 * ZanTV Movie Provider Module v2.0 (Dual-Engine: MovieBox Official BFF + KlikXXI CloudX Turbo)
 * - Engine 1 (Primary): MovieBox Official JSON BFF API (h5-api.aoneroom.com)
 *   -> 100% Pure JSON API, <300ms response, Direct CDN MP4 (1080p/720p/480p/360p), Official Sub Indo, 0% Judol/Ads
 * - Engine 2 (Fallback): KlikXXI CloudX Turbo (1-Hop VOE Direct HLS Extractor + PostID Cache)
 * Crafted with love by Lody for ZanTV.
 */

const crypto = require('crypto');

const KNOWN_MIRRORS = [
  'https://klikxxi.shop',
  'https://filmlokal.me',
  'https://ww11.pencurimovie.sbs'
];

let activeMirror = KNOWN_MIRRORS[0];
let activeEngine = 'moviebox'; // 'moviebox' | 'klikxxi'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MB_API_BASE = 'https://h5-api.aoneroom.com';
const MB_MAIN_URL = 'https://themoviebox.org';

const CATEGORIES = [
  { id: 'terbaru', name: '🔥 Terbaru 2026', path: 'year/2026/page/%d/', mbFilter: { year: '2026', sort: 'Latest' } },
  { id: 'popular', alt: 'populer', name: '⭐ Populer 2025', path: 'year/2025/page/%d/', mbFilter: { year: '2025', sort: 'Hottest' } },
  { id: 'indo', name: '🇮🇩 Film & Series Indo', path: 'country/indonesia/page/%d/', mbFilter: { country: 'Indonesia', sort: 'Hottest' } },
  { id: 'series', name: '📺 TV Series', path: 'tv/page/%d/', mbFilter: { tabId: 5, sort: 'Hottest' } },
  { id: 'kdrama', name: '🇰🇷 K-Drama', path: 'country/korea/page/%d/', mbFilter: { tabId: 5, country: 'Korea', sort: 'Hottest' } },
  { id: 'action', name: '💥 Action', path: 'category/action/page/%d/', mbFilter: { genre: 'Action', sort: 'Hottest' } },
  { id: 'horror', name: '👻 Horror', path: 'category/horror/page/%d/', mbFilter: { genre: 'Horror', sort: 'Hottest' } },
  { id: 'comedy', alt: 'komedi', name: '😂 Komedi', path: 'category/comedy/page/%d/', mbFilter: { genre: 'Comedy', sort: 'Hottest' } },
  { id: 'romance', name: '❤️ Romance', path: 'category/roman/page/%d/', mbFilter: { genre: 'Romance', sort: 'Hottest' } },
  { id: 'scifi', name: '🚀 Sci-Fi', path: 'category/science-fiction/page/%d/', mbFilter: { genre: 'Sci-Fi', sort: 'Hottest' } },
  { id: 'thriller', name: '🔪 Thriller', path: 'category/thriller/page/%d/', mbFilter: { genre: 'Thriller', sort: 'Hottest' } },
  { id: 'animation', alt: 'animasi', name: '🎨 Animasi', path: 'category/cartoon/page/%d/', mbFilter: { genre: 'Animation', sort: 'Hottest' } },
  { id: 'drama', name: '🎭 Drama', path: 'category/drama/page/%d/', mbFilter: { genre: 'Drama', sort: 'Hottest' } }
];

/* ============================================================================
   ENGINE 1: MOVIEBOX OFFICIAL JSON BFF API (h5-api.aoneroom.com)
   ============================================================================ */
let mbBearerToken = null;
let mbTokenExp = 0;

function mbClientTimeToken() {
  const ts = Math.floor(Date.now() / 1000);
  const rev = String(ts).split('').reverse().join('');
  const md5 = crypto.createHash('md5').update(rev).digest('hex');
  return `${ts},${md5}`;
}

function mbHeaders(extra = {}, includeClientToken = true) {
  const h = {
    'Accept': 'application/json',
    'User-Agent': USER_AGENT,
    'X-Client-Info': JSON.stringify({ timezone: 'Asia/Jakarta' }),
    'X-Request-Lang': 'en',
    'Referer': `${MB_MAIN_URL}/`,
    ...extra
  };
  if (includeClientToken) {
    h['X-Client-Token'] = mbClientTimeToken();
  }
  return h;
}

async function getMbBearerToken() {
  if (mbBearerToken && Date.now() < mbTokenExp) return mbBearerToken;
  try {
    const res = await fetch(`${MB_API_BASE}/wefeed-h5api-bff/home?host=themoviebox.org`, {
      headers: mbHeaders({ 'Authorization': '' }, true),
      signal: AbortSignal.timeout(6000)
    });
    const xUser = res.headers.get('x-user') || '';
    if (xUser) {
      const parsed = JSON.parse(xUser);
      if (parsed && parsed.token) {
        mbBearerToken = parsed.token;
        mbTokenExp = Date.now() + 2 * 3600 * 1000;
        return mbBearerToken;
      }
    }
  } catch (e) {}
  return mbBearerToken || '';
}

function formatMbSubject(s) {
  if (!s || !s.detailPath || !s.title) return null;
  const subjectId = String(s.subjectId || '');
  const detailPath = String(s.detailPath || '');
  const subjectType = Number(s.subjectType || 1);
  const isSeries = subjectType === 2 || subjectType === 3;
  const coverUrl = (s.cover && s.cover.url) ? s.cover.url : (s.image && s.image.url ? s.image.url : '');
  const ratingVal = s.imdbRatingValue ? Number(s.imdbRatingValue).toFixed(1) : '';
  const year = s.releaseDate ? String(s.releaseDate).slice(0, 4) : '';
  const itemUrl = `mb://${detailPath}?sid=${encodeURIComponent(subjectId)}&type=${subjectType}`;
  const fullTitle = year && !s.title.includes(year) ? `${s.title} (${year})` : s.title;

  return {
    id: Buffer.from(itemUrl).toString('base64url'),
    provider: 'moviebox',
    title: fullTitle,
    url: itemUrl,
    poster: coverUrl,
    quality: isSeries ? 'SERIES HD' : 'FHD 1080p',
    rating: ratingVal && Number(ratingVal) > 0 ? `⭐ ${ratingVal}` : '⭐ HD',
    isSeries
  };
}

async function mbGetCatalog(categoryId, page = 1) {
  const cat = CATEGORIES.find(c => c.id === categoryId || c.alt === categoryId) || CATEGORIES[0];
  const filterBody = {
    page: Number(page) || 1,
    perPage: 24,
    ...(cat.mbFilter || { sort: 'Hottest' })
  };

  const res = await fetch(`${MB_API_BASE}/wefeed-h5api-bff/subject/filter`, {
    method: 'POST',
    headers: mbHeaders({ 'Content-Type': 'application/json', 'Authorization': '' }, true),
    body: JSON.stringify(filterBody),
    signal: AbortSignal.timeout(7000)
  });

  if (!res.ok) throw new Error(`MovieBox filter HTTP ${res.status}`);
  const json = await res.json();
  const rawItems = (json.data && Array.isArray(json.data.items)) ? json.data.items : [];
  const items = rawItems.map(formatMbSubject).filter(Boolean);

  return {
    category: cat.id,
    categoryName: cat.name,
    page: Number(page) || 1,
    engine: 'moviebox',
    items
  };
}

async function mbSearch(query, page = 1) {
  const token = await getMbBearerToken();
  const headers = mbHeaders({
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
    'Cookie': token ? `token=${token}` : ''
  }, false);

  const res = await fetch(`${MB_API_BASE}/wefeed-h5api-bff/subject/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      keyword: String(query || '').trim(),
      page: Number(page) || 1,
      perPage: 24,
      subjectType: 0
    }),
    signal: AbortSignal.timeout(7000)
  });

  if (res.ok) {
    const json = await res.json();
    const rawItems = (json.data && Array.isArray(json.data.items)) ? json.data.items : [];
    const items = rawItems.map(formatMbSubject).filter(Boolean);
    if (items.length > 0) {
      return { query, page: Number(page) || 1, engine: 'moviebox', items };
    }
  }

  // Fallback filter search
  const fallbackCat = await mbGetCatalog('terbaru', 1);
  const qLower = String(query || '').toLowerCase();
  return {
    query,
    page: 1,
    engine: 'moviebox',
    items: (fallbackCat.items || []).filter(i => i.title.toLowerCase().includes(qLower))
  };
}

function parseMbUrl(rawUrl) {
  const clean = String(rawUrl || '').replace(/^mb:\/\//i, '');
  const [pathPart, qsPart] = clean.split('?');
  const detailPath = pathPart.replace(/^\/+|\/+$/g, '').split('/').pop();
  const params = new URLSearchParams(qsPart || '');
  return {
    detailPath,
    sid: params.get('sid') || params.get('id') || '',
    se: params.get('se') || '0',
    ep: params.get('ep') || '0'
  };
}

async function mbGetDetail(movieUrl) {
  const { detailPath, sid } = parseMbUrl(movieUrl);
  const res = await fetch(`${MB_API_BASE}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`, {
    headers: mbHeaders({ 'Authorization': '' }, true),
    signal: AbortSignal.timeout(7000)
  });

  if (!res.ok) throw new Error(`MovieBox detail HTTP ${res.status}`);
  const json = await res.json();
  const data = json.data || {};
  const subject = data.subject || {};
  const resource = data.resource || {};

  const subjectId = String(subject.subjectId || sid || '');
  const title = subject.title || 'Unknown Title';
  const synopsis = subject.description || 'Nikmati tayangan kualitas Full HD dengan subtitle Bahasa Indonesia.';
  const poster = (subject.cover && subject.cover.url) ? subject.cover.url : '';
  const genres = subject.genre || 'Cinema';
  const year = subject.releaseDate ? String(subject.releaseDate).slice(0, 4) : '2026';
  const durSec = Number(subject.duration || 0);
  const duration = durSec > 0 ? `${Math.round(durSec / 60)} Min` : '';
  const rating = subject.imdbRatingValue ? Number(subject.imdbRatingValue).toFixed(1) : '';

  const staffList = Array.isArray(subject.staffList) ? subject.staffList : [];
  const directors = staffList.filter(s => s.staffType === 1 || /director/i.test(s.role || '')).map(s => s.name).slice(0, 2).join(', ');
  const actors = staffList.filter(s => s.staffType !== 1).map(s => s.name).slice(0, 5).join(', ');

  // Cek dubbing Bahasa Indonesia jika tersedia
  const dubs = Array.isArray(subject.dubs) ? subject.dubs : [];
  const indoDub = dubs.find(d => /indones/i.test(String(d.lanName || '')));
  const primarySubjectId = subjectId;

  const seasons = Array.isArray(resource.seasons) ? resource.seasons : [];
  const isSeries = seasons.length > 0 && (Number(seasons[0].maxEp || 0) > 1 || Number(subject.subjectType) === 2 || Number(subject.subjectType) === 3);

  const episodes = [];
  if (isSeries) {
    for (const s of seasons) {
      const seNum = Number(s.se || 1);
      const maxEp = Number(s.maxEp || 0);
      const allEpStr = String(s.allEp || '').trim();
      const epNums = allEpStr
        ? allEpStr.split(',').map(x => Number(x.trim())).filter(n => n > 0)
        : Array.from({ length: maxEp }, (_, idx) => idx + 1);

      for (const epNum of epNums) {
        const epUrl = `mb://${detailPath}?sid=${encodeURIComponent(primarySubjectId)}&se=${seNum}&ep=${epNum}`;
        episodes.push({
          id: Buffer.from(epUrl).toString('base64url'),
          title: seasons.length > 1 ? `S${seNum}:E${epNum}` : `Episode ${epNum}`,
          url: epUrl,
          season: seNum,
          episode: epNum
        });
      }
    }
  }

  const servers = [
    { id: '1080', name: '🚀 Server 1080p (Full HD)' },
    { id: '720', name: '⚡ Server 720p (HD Cepat)' },
    { id: '480', name: '📱 Server 480p (Hemat Data)' },
    { id: '360', name: '🌐 Server 360p (Anti-Buffering)' }
  ];
  if (indoDub && String(indoDub.subjectId) !== primarySubjectId) {
    servers.unshift({ id: `dub:${indoDub.subjectId}`, name: '🇮🇩 Dubbing Bahasa Indonesia' });
  }

  return {
    id: Buffer.from(movieUrl).toString('base64url'),
    title,
    synopsis,
    poster,
    url: movieUrl,
    postId: primarySubjectId,
    genres,
    quality: isSeries ? 'SERIES HD' : 'FHD 1080p',
    rating: rating ? `⭐ ${rating}` : '⭐ HD',
    year,
    duration,
    director: directors,
    cast: actors,
    servers,
    isSeries,
    episodes
  };
}

async function mbExtractStream(movieUrl, tabId = '1080') {
  let { detailPath, sid, se, ep } = parseMbUrl(movieUrl);
  let targetSubjectId = sid;

  if (String(tabId).startsWith('dub:')) {
    targetSubjectId = String(tabId).slice(4);
    tabId = '1080';
  }

  if (!targetSubjectId) {
    const det = await mbGetDetail(movieUrl);
    targetSubjectId = det.postId;
  }

  const tryConfigs = [[se || '0', ep || '0']];
  if ((se === '0' || !se) && (ep === '0' || !ep)) {
    tryConfigs.push(['1', '1']);
  } else {
    tryConfigs.push(['0', '0']);
  }

  for (const [curSe, curEp] of tryConfigs) {
    const spaReferer = `https://123movienow.cc/spa/videoPlayPage/movies/${detailPath}?id=${targetSubjectId}&type=/movie/detail&detailSe=${curSe}&detailEp=${curEp}&lang=en`;
    const playHeaders = mbHeaders({
      'X-Vip-Restrict': '0',
      'Referer': spaReferer
    }, true);

    const playUrl = `${MB_API_BASE}/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(targetSubjectId)}&se=${curSe}&ep=${curEp}&detailPath=${encodeURIComponent(detailPath)}&streamSignType=0`;
    const res = await fetch(playUrl, {
      headers: playHeaders,
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) continue;

    const json = await res.json();
    const playData = json.data || {};
    const streams = Array.isArray(playData.streams) ? playData.streams : [];
    const hlsList = Array.isArray(playData.hls) ? playData.hls : [];
    const allStreams = [...streams, ...hlsList].filter(s => s && s.url && String(s.url).startsWith('http'));

    if (!allStreams.length) continue;

    // Urutkan dari resolusi tertinggi ke terendah
    allStreams.sort((a, b) => (parseInt(b.resolutions, 10) || 0) - (parseInt(a.resolutions, 10) || 0));

    // Pilih sesuai tabId (misal '1080', '720', '480', '360') atau otomatis tertinggi
    const wantedRes = String(tabId || '1080').replace(/\D/g, '');
    let chosen = allStreams.find(s => String(s.resolutions) === wantedRes);
    if (!chosen) {
      // Cari yang paling mendekati atau ambil yang tertinggi (1080p/720p)
      chosen = allStreams[0];
    }

    // Ambil daftar subtitle (terutama Bahasa Indonesia & Inggris)
    const subtitles = [];
    const streamIdForCap = chosen.id || (allStreams[0] && allStreams[0].id);
    if (streamIdForCap) {
      try {
        const capUrl = `${MB_API_BASE}/wefeed-h5api-bff/subject/caption?format=MP4&id=${encodeURIComponent(streamIdForCap)}&subjectId=${encodeURIComponent(targetSubjectId)}&detailPath=${encodeURIComponent(detailPath)}`;
        const capRes = await fetch(capUrl, {
          headers: playHeaders,
          signal: AbortSignal.timeout(4500)
        });
        if (capRes.ok) {
          const capJson = await capRes.json();
          const capList = (capJson.data && Array.isArray(capJson.data.captions)) ? capJson.data.captions : [];
          for (const c of capList) {
            if (!c || !c.url) continue;
            const lan = String(c.lan || '').toLowerCase();
            const lanName = String(c.lanName || c.lan || 'Subtitle');
            const isIndo = lan.includes('id') || lan.includes('in') || /indones|melayu/i.test(lanName);
            const isEng = lan.includes('en') || /english/i.test(lanName);
            subtitles.push({
              lang: isIndo ? 'id' : (isEng ? 'en' : lan),
              label: isIndo ? '🇮🇩 Bahasa Indonesia' : (isEng ? '🇬🇧 English' : lanName),
              url: c.url,
              isDefault: isIndo
            });
          }
          // Prioritaskan Bahasa Indonesia di urutan pertama
          subtitles.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
        }
      } catch (e) {}
    }

    const isHls = /\.m3u8($|\?)/i.test(chosen.url) || String(chosen.format || '').toUpperCase() === 'HLS';
    return {
      streamUrl: chosen.url,
      mp4Url: isHls ? null : chosen.url,
      kind: isHls ? 'hls' : 'mp4',
      server: chosen.resolutions ? `${chosen.resolutions}p` : 'HD',
      title: `${detailPath} (${chosen.resolutions || 'HD'}p)`,
      qualities: allStreams.map(s => ({
        res: `${s.resolutions || 'HD'}p`,
        height: parseInt(s.resolutions, 10) || 720,
        url: s.url
      })),
      subtitles,
      headers: {
        'User-Agent': USER_AGENT,
        'Origin': 'https://123movienow.cc',
        'Referer': 'https://123movienow.cc/'
      }
    };
  }

  throw new Error('Stream film belum tersedia di CDN untuk judul ini');
}

/* ============================================================================
   ENGINE 2: KLIKXXI CLOUDX TURBO (VOE 1-Hop Direct HLS + PostID Cache)
   ============================================================================ */
const postIdCache = new Map();

async function fetchFromMirrors(pathOrUrl, options = {}, timeoutMs = 6000) {
  let mirrorsToTry = [];
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    try {
      const u = new URL(pathOrUrl);
      const reqPath = u.pathname + u.search;
      mirrorsToTry = [activeMirror, ...KNOWN_MIRRORS.filter(m => m !== activeMirror)].map(m => m + reqPath);
      mirrorsToTry.unshift(pathOrUrl);
    } catch (e) {
      mirrorsToTry = [pathOrUrl, ...KNOWN_MIRRORS];
    }
  } else {
    const cleanPath = pathOrUrl.replace(/^\/+/, '');
    mirrorsToTry = [activeMirror, ...KNOWN_MIRRORS.filter(m => m !== activeMirror)].map(m => `${m}/${cleanPath}`);
  }

  mirrorsToTry = mirrorsToTry.filter((v, i, a) => a.indexOf(v) === i);

  let lastError = null;
  for (const targetUrl of mirrorsToTry) {
    try {
      const origin = new URL(targetUrl).origin;
      const res = await fetch(targetUrl, {
        ...options,
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': origin + '/',
          ...(options.headers || {})
        },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (res.ok) {
        const html = await res.text();
        if (html && html.length > 500 && !html.includes('<title>Just a moment...</title>')) {
          return { html, baseUrl: origin, finalUrl: targetUrl };
        }
      }
      lastError = new Error(`HTTP ${res.status} from ${targetUrl}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Semua mirror provider film tidak dapat dijangkau');
}

function decryptVoeF7(p8) {
  try {
    let r = '';
    for (let i = 0; i < p8.length; i++) {
      let c = p8.charCodeAt(i);
      if (c >= 65 && c <= 90) c = ((c - 65 + 13) % 26) + 65;
      else if (c >= 97 && c <= 122) c = ((c - 97 + 13) % 26) + 97;
      r += String.fromCharCode(c);
    }
    const patterns = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];
    for (const pat of patterns) r = r.split(pat).join('_');
    r = r.split('_').join('');
    r = Buffer.from(r, 'base64').toString('utf8');
    let shifted = '';
    for (let i = 0; i < r.length; i++) shifted += String.fromCharCode(r.charCodeAt(i) - 3);
    const reversed = shifted.split('').reverse().join('');
    const finalJson = Buffer.from(reversed, 'base64').toString('utf8');
    return JSON.parse(finalJson);
  } catch (err) {
    return null;
  }
}

function parseArticles(html, baseUrl) {
  const items = [];
  const articleRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = articleRegex.exec(html)) !== null) {
    const block = m[1];
    const titleMatch = /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!titleMatch) continue;

    let href = titleMatch[1].trim();
    if (href.startsWith('/')) href = baseUrl + href;
    const rawTitle = titleMatch[2].replace(/<[^>]+>/g, '').replace(/&#8211;/g, '-').replace(/&#8217;/g, "'").replace(/&amp;/g, '&').trim();
    const cleanTitle = rawTitle.replace(/^Nonton\s+(Film|Series|Drama)?\s*/i, '').replace(/\s*Sub\s*Indo.*$/i, '').trim();

    let poster = '';
    const imgMatch = /<img[^>]+(?:data-lazy-src|data-src|src)="([^"]+)"/i.exec(block);
    if (imgMatch) {
      poster = imgMatch[1].trim();
      if (poster.startsWith('//')) poster = 'https:' + poster;
      else if (poster.startsWith('/')) poster = baseUrl + poster;
    }

    const qualMatch = /<div[^>]*class="[^"]*gmr-quality-item[^"]*"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i.exec(block);
    const quality = qualMatch ? qualMatch[1].trim() : 'HD';

    const rateMatch = /<div[^>]*class="[^"]*gmr-rating-item[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    let rating = '';
    if (rateMatch) rating = rateMatch[1].replace(/<[^>]+>/g, '').trim();

    const isSeries = href.includes('/tv/') || href.includes('/series/') || /<div[^>]*class="[^"]*gmr-numbeps[^"]*"/i.test(block);

    items.push({
      id: Buffer.from(href).toString('base64url'),
      provider: 'klikxxi',
      title: cleanTitle || rawTitle,
      url: href,
      poster,
      quality,
      rating: rating ? `⭐ ${rating}` : '',
      isSeries
    });
  }
  return items;
}

async function klikxxiGetCatalog(categoryId, page = 1) {
  const cat = CATEGORIES.find(c => c.id === categoryId || c.alt === categoryId) || CATEGORIES[0];
  const relPath = cat.path.replace('%d', String(page));
  const { html, baseUrl } = await fetchFromMirrors(relPath);
  const items = parseArticles(html, baseUrl);
  return {
    category: cat.id,
    categoryName: cat.name,
    page: Number(page) || 1,
    engine: 'klikxxi',
    items
  };
}

async function klikxxiSearch(query, page = 1) {
  const q = encodeURIComponent(query.trim());
  const relPath = page > 1 ? `page/${page}/?s=${q}&post_type%5B%5D=post&post_type%5B%5D=tv` : `?s=${q}&post_type%5B%5D=post&post_type%5B%5D=tv`;
  const { html, baseUrl } = await fetchFromMirrors(relPath);
  const items = parseArticles(html, baseUrl);
  return {
    query,
    page: Number(page) || 1,
    engine: 'klikxxi',
    items
  };
}

async function klikxxiGetDetail(movieUrl) {
  if (!movieUrl.startsWith('http')) {
    try { movieUrl = Buffer.from(movieUrl, 'base64url').toString('utf8'); } catch (e) {}
  }

  const { html, baseUrl } = await fetchFromMirrors(movieUrl);

  const titleMatch = /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Unknown Title';
  const title = rawTitle.replace(/^Nonton\s+(Film|Series|Drama)?\s*/i, '').replace(/\s*Sub\s*Indo.*$/i, '').trim();

  let synopsis = '';
  const descMatch = /<div[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i.exec(html) ||
                    /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (descMatch) {
    synopsis = descMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  let poster = '';
  const posterMatch = /<figure[^>]*class="[^"]*pull-left[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-lazy-src|data-src|src)="([^"]+)"/i.exec(html) ||
                      /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html);
  if (posterMatch) {
    poster = posterMatch[1].trim();
    if (poster.startsWith('//')) poster = 'https:' + poster;
  }

  const postIdMatch = /id="muvipro_player_content_id"[^>]*data-id="(\d+)"/i.exec(html) || /'post_id'\s*:\s*(\d+)/i.exec(html);
  const postId = postIdMatch ? postIdMatch[1] : null;
  if (postId) {
    postIdCache.set(movieUrl, { postId, baseUrl, ts: Date.now() });
  }

  const extractMeta = (label) => {
    const rx = new RegExp(`<strong>\\s*${label}\\s*:\\s*<\\/strong>([\\s\\S]*?)<\\/div>`, 'i');
    const m = rx.exec(html);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  };

  const genres = extractMeta('Genre');
  const quality = extractMeta('Quality') || 'HD';
  const year = extractMeta('Year');
  const duration = extractMeta('Duration');
  const director = extractMeta('Director');
  const cast = extractMeta('Actors') || extractMeta('Cast');

  const episodes = [];
  const epRegex = /<a[^>]+href="([^"]+\/eps\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let epM;
  while ((epM = epRegex.exec(html)) !== null) {
    const epUrl = epM[1].trim();
    const epName = epM[2].replace(/<[^>]+>/g, '').trim();
    if (epUrl && epName && !episodes.some(e => e.url === epUrl)) {
      episodes.push({
        id: Buffer.from(epUrl).toString('base64url'),
        title: epName,
        url: epUrl
      });
    }
  }

  const servers = [
    { id: 'p3', name: '🚀 Server 3 (VOE Clean HLS)' },
    { id: 'p1', name: '⚡ Server 1 (Cadangan)' },
    { id: 'p2', name: '🌐 Server 2 (Cadangan)' }
  ];

  return {
    id: Buffer.from(movieUrl).toString('base64url'),
    title,
    synopsis: synopsis || 'Tidak ada sinopsis untuk tayangan ini.',
    poster,
    url: movieUrl,
    postId,
    genres,
    quality,
    year,
    duration,
    director,
    cast,
    servers,
    isSeries: episodes.length > 0,
    episodes
  };
}

function unpackDeanEdwards(html) {
  try {
    const m = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/i.exec(html);
    if (!m) return '';
    let p = m[1];
    const a = parseInt(m[2], 10);
    let c = parseInt(m[3], 10);
    const k = m[4].split('|');
    while (c--) {
      if (k[c]) {
        p = p.replace(new RegExp('\\b' + c.toString(a) + '\\b', 'g'), k[c]);
      }
    }
    return p;
  } catch (e) {
    return '';
  }
}

async function tryExtractFromEmbedUrl(iframeSrc, refererUrl) {
  if (!iframeSrc) return null;
  if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;

  // 1) VOE / shannoncoldalready / /e/ extractor
  if (iframeSrc.includes('voe.sx') || iframeSrc.includes('shannoncoldalready') || iframeSrc.includes('cloudwindow') || iframeSrc.includes('voe-network') || iframeSrc.includes('yugotehe')) {
    try {
      let voeUrl = iframeSrc.replace(/^https?:\/\/voe\.sx\/e\//i, 'https://shannoncoldalready.com/e/');
      const realVoeRes = await fetch(voeUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://voe.sx/' },
        signal: AbortSignal.timeout(6000)
      });
      const realVoeHtml = await realVoeRes.text();
      const p8Match = /<script type="application\/json">\["([^"]+)"\]<\/script>/i.exec(realVoeHtml);
      if (p8Match) {
        const dec = decryptVoeF7(p8Match[1]);
        if (dec && dec.source) {
          return {
            streamUrl: dec.source,
            mp4Url: dec.direct_access_url || null,
            kind: 'hls',
            title: dec.title || '',
            headers: {
              'User-Agent': USER_AGENT,
              'Origin': 'https://' + new URL(voeUrl).hostname,
              'Referer': voeUrl
            }
          };
        }
      }
    } catch (e) {}
  }

  // 2) Morencius / StreamHG / Filemoon / VidHide JWPlayer packed HLS extractor
  if (iframeSrc.includes('morencius') || iframeSrc.includes('/embed/') || iframeSrc.includes('/e/')) {
    try {
      const emOrigin = new URL(iframeSrc).origin;
      const emRes = await fetch(iframeSrc, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': refererUrl || (emOrigin + '/') },
        signal: AbortSignal.timeout(6000)
      });
      const emHtml = await emRes.text();
      const unpacked = unpackDeanEdwards(emHtml) || emHtml;
      const hls4Match = /"hls4"\s*:\s*"([^"]+)"/i.exec(unpacked);
      const hls2Match = /"hls2"\s*:\s*"([^"]+)"/i.exec(unpacked);
      const fileMatch = /file\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/i.exec(unpacked);
      let hlsUrl = (hls4Match && hls4Match[1]) || (hls2Match && hls2Match[1]) || (fileMatch && fileMatch[1]) || '';
      if (hlsUrl) {
        if (hlsUrl.startsWith('/')) hlsUrl = emOrigin + hlsUrl;
        return {
          streamUrl: hlsUrl,
          mp4Url: null,
          kind: 'hls',
          server: 'HLS',
          headers: {
            'User-Agent': USER_AGENT,
            'Origin': emOrigin,
            'Referer': emOrigin + '/'
          }
        };
      }
    } catch (e) {}
  }

  return null;
}

async function mbFallbackBySlugOrTitle(movieUrl, tabId) {
  try {
    const u = new URL(movieUrl);
    const segs = u.pathname.split('/').filter(Boolean).filter(s => s !== 'tv' && s !== 'eps' && s !== 'movie');
    const rawSlug = segs[0] || '';
    if (!rawSlug) return null;
    const yearMatch = rawSlug.match(/\b(19\d{2}|20\d{2})\b/);
    const targetYear = yearMatch ? yearMatch[1] : '';
    const cleanQuery = rawSlug
      .replace(/^nonton-(film-|series-)?/i, '')
      .replace(/-sub-indo.*$/i, '')
      .replace(/\b(19\d{2}|20\d{2})\b/g, '')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanQuery) return null;

    const sRes = await mbSearch(cleanQuery, 1);
    const items = (sRes && sRes.items) || [];
    if (!items.length) return null;

    const qWords = cleanQuery.toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !['petaka', 'gunung', 'film', 'the'].includes(w));
    const allWords = cleanQuery.toLowerCase().split(/\s+/).filter(w => w.length >= 3);

    let best = items.find(it => {
      const t = String(it.title || '').toLowerCase();
      return allWords.every(w => t.includes(w));
    });
    if (!best && qWords.length) {
      best = items.find(it => {
        const t = String(it.title || '').toLowerCase();
        const yearOk = !targetYear || t.includes(targetYear);
        return yearOk && qWords.some(w => t.includes(w));
      });
    }
    if (!best) best = items[0];
    if (!best || !best.url) return null;

    let mbTab = '1080';
    if (tabId === 'p2' || tabId === '720') mbTab = '720';
    else if (tabId === '480') mbTab = '480';
    return await mbExtractStream(best.url, mbTab);
  } catch (e) {
    return null;
  }
}

async function klikxxiExtractStream(movieUrl, tabId) {
  if (!movieUrl.startsWith('http')) {
    try { movieUrl = Buffer.from(movieUrl, 'base64url').toString('utf8'); } catch (e) {}
  }
  tabId = tabId || 'p3';

  // Jika user memilih Server 1 / Server 2 (Cadangan) atau MovieBox punya stream MP4 langsung yang bersih:
  if (tabId === 'p1' || tabId === 'p2') {
    const mbDirect = await mbFallbackBySlugOrTitle(movieUrl, tabId);
    if (mbDirect && mbDirect.streamUrl) return mbDirect;
  }

  let postId = null;
  let baseUrl = activeMirror;
  let dHtml = '';

  const cached = postIdCache.get(movieUrl);
  if (cached && (Date.now() - cached.ts < 3600 * 1000)) {
    postId = cached.postId;
    baseUrl = cached.baseUrl;
  } else {
    try {
      const fetched = await fetchFromMirrors(movieUrl);
      dHtml = fetched.html;
      baseUrl = fetched.baseUrl;
      const postIdMatch = /id="muvipro_player_content_id"[^>]*data-id="(\d+)"/i.exec(dHtml);
      postId = postIdMatch ? postIdMatch[1] : null;
      if (postId) postIdCache.set(movieUrl, { postId, baseUrl, ts: Date.now() });
    } catch (err) {
      const mbRescue = await mbFallbackBySlugOrTitle(movieUrl, tabId);
      if (mbRescue && mbRescue.streamUrl) return mbRescue;
      throw err;
    }
  }

  const candidateIframes = [];
  const tabsToTry = ['p3', tabId, 'p1', 'p2', 'p4'].filter((v, i, a) => a.indexOf(v) === i);

  if (postId) {
    for (const tid of tabsToTry) {
      try {
        const params = new URLSearchParams({
          action: 'muvipro_player_content',
          tab: tid,
          post_id: postId
        });
        const ajaxRes = await fetch(`${baseUrl}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': USER_AGENT,
            'Referer': movieUrl
          },
          body: params.toString(),
          signal: AbortSignal.timeout(5000)
        });
        const ajaxHtml = await ajaxRes.text();
        const ifm = /<iframe[^>]+src="([^"]+)"/i.exec(ajaxHtml);
        if (ifm && ifm[1]) {
          const candidate = ifm[1];
          if (!candidateIframes.includes(candidate)) candidateIframes.push(candidate);
          if (candidate.includes('voe.sx') || candidate.includes('shannoncoldalready') || candidate.includes('morencius')) {
            break;
          }
        }
      } catch (e) {}
    }
  }

  if (dHtml) {
    const directIfm = /<div[^>]*class="[^"]*gmr-embed-responsive[^"]*"[^>]*>[\s\S]*?<iframe[^>]+src="([^"]+)"/i.exec(dHtml);
    if (directIfm && directIfm[1] && !candidateIframes.includes(directIfm[1])) {
      candidateIframes.push(directIfm[1]);
    }
  }

  // Untuk situs NGEFILM21 (new31/new39.ngefilm.site) yang memakai ?player=3 (morencius HLS) & ?player=2
  if (!postId) {
    const cleanBaseMovieUrl = movieUrl.split('?')[0];
    const playerNums = tabId === 'p2' ? [2, 3] : [3, 2];
    for (const pNum of playerNums) {
      try {
        const pFetched = await fetchFromMirrors(`${cleanBaseMovieUrl}?player=${pNum}`, {}, 5000);
        const pIfm = /<div[^>]*class="[^"]*gmr-embed-responsive[^"]*"[^>]*>[\s\S]*?<iframe[^>]+src="([^"]+)"/i.exec(pFetched.html);
        if (pIfm && pIfm[1] && !candidateIframes.includes(pIfm[1])) {
          // Prioritaskan morencius / voe di urutan paling depan
          if (pIfm[1].includes('morencius') || pIfm[1].includes('voe')) {
            candidateIframes.unshift(pIfm[1]);
          } else {
            candidateIframes.push(pIfm[1]);
          }
        }
      } catch (e) {}
    }
  }

  for (const cand of candidateIframes) {
    const extracted = await tryExtractFromEmbedUrl(cand, baseUrl + '/');
    if (extracted && extracted.streamUrl) {
      return extracted;
    }
  }

  // Cross-Engine Rescue ke MovieBox BFF (Direct 1080p MP4 + Sub Indo) sebelum menyerah ke iframe!
  const mbFallback = await mbFallbackBySlugOrTitle(movieUrl, tabId);
  if (mbFallback && mbFallback.streamUrl) {
    return mbFallback;
  }

  const iframeSrc = candidateIframes[0] || null;
  if (!iframeSrc) {
    throw new Error('Video stream player not found for this title');
  }

  return {
    streamUrl: iframeSrc,
    kind: 'iframe',
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': baseUrl + '/'
    }
  };
}

/* ============================================================================
   UNIFIED ROUTER & ADMIN MIRROR / ENGINE CONTROLS
   ============================================================================ */
function isMbUrl(u) {
  if (!u) return false;
  if (String(u).startsWith('mb://')) return true;
  try {
    const dec = Buffer.from(String(u), 'base64url').toString('utf8');
    if (dec.startsWith('mb://')) return true;
  } catch (e) {}
  return false;
}

async function getCatalog(categoryId, page = 1) {
  if (activeEngine === 'moviebox') {
    try {
      return await mbGetCatalog(categoryId, page);
    } catch (err) {
      console.warn('[MovieProvider] MovieBox catalog fallback to KlikXXI:', err.message);
      return await klikxxiGetCatalog(categoryId, page);
    }
  }
  try {
    return await klikxxiGetCatalog(categoryId, page);
  } catch (err) {
    console.warn('[MovieProvider] KlikXXI catalog fallback to MovieBox:', err.message);
    return await mbGetCatalog(categoryId, page);
  }
}

async function search(query, page = 1) {
  if (activeEngine === 'moviebox') {
    try {
      return await mbSearch(query, page);
    } catch (err) {
      return await klikxxiSearch(query, page);
    }
  }
  try {
    return await klikxxiSearch(query, page);
  } catch (err) {
    return await mbSearch(query, page);
  }
}

async function getDetail(movieUrl) {
  let decoded = movieUrl;
  if (!String(movieUrl).startsWith('http') && !String(movieUrl).startsWith('mb://')) {
    try { decoded = Buffer.from(String(movieUrl), 'base64url').toString('utf8'); } catch (e) {}
  }
  if (isMbUrl(decoded)) {
    return await mbGetDetail(decoded);
  }
  return await klikxxiGetDetail(decoded);
}

async function extractStream(movieUrl, tabId) {
  let decoded = movieUrl;
  if (!String(movieUrl).startsWith('http') && !String(movieUrl).startsWith('mb://')) {
    try { decoded = Buffer.from(String(movieUrl), 'base64url').toString('utf8'); } catch (e) {}
  }
  if (isMbUrl(decoded)) {
    return await mbExtractStream(decoded, tabId);
  }
  return await klikxxiExtractStream(decoded, tabId);
}

function getActiveMirror() {
  return activeMirror;
}

function setActiveMirror(newMirror) {
  if (typeof newMirror === 'string') {
    const clean = newMirror.trim();
    if (clean === 'moviebox' || clean.includes('aoneroom') || clean.includes('themoviebox')) {
      activeEngine = 'moviebox';
      return activeMirror;
    }
    if (clean === 'klikxxi') {
      activeEngine = 'klikxxi';
      return activeMirror;
    }
    if (clean.startsWith('http')) {
      activeMirror = clean.replace(/\/+$/, '');
      if (!KNOWN_MIRRORS.includes(activeMirror)) {
        KNOWN_MIRRORS.unshift(activeMirror);
      }
    }
  }
  return activeMirror;
}

function getActiveEngine() {
  return activeEngine;
}

function setActiveEngine(eng) {
  if (eng === 'moviebox' || eng === 'klikxxi') {
    activeEngine = eng;
  }
  return activeEngine;
}

function getMirrors() {
  return {
    active: activeMirror,
    engine: activeEngine,
    mirrors: KNOWN_MIRRORS
  };
}

module.exports = {
  CATEGORIES,
  getCatalog,
  search,
  getDetail,
  extractStream,
  getActiveMirror,
  setActiveMirror,
  getActiveEngine,
  setActiveEngine,
  getMirrors
};
