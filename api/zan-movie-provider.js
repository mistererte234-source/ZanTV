'use strict';
/**
 * ZanTV Movie Provider Engine (Multi-Provider CloudX-V2 Port for Node.js)
 * Koleksi Lengkap: Bioskop 21 (KlikXXi/Ngefilm), PusatMovie21, SarangFilm21, SaveFilm21, WGFilm21
 * Fitur:
 * - Multi-Provider switching via dynamic providers catalog
 * - Auto-sync mirrors dari CloudX repository (Website.json)
 * - Multi-Mirror Auto-Failover dengan strict timeout 4.5s (Anti-Hanging)
 * - Multi-Extractor HLS Stream Decryption:
 *     1. VOE (F7 rot13/shift/base64) -> Direct Master M3U8
 *     2. Morencius / Dingtezuni / Movearnpre (JS Unpack) -> Direct Master M3U8
 *     3. Muvipro Query & AJAX Server Tabs
 *     4. Clean HLS Resolver (100% Ad-Free, No Ad-Iframes) v1.7.28
 * Crafted with love by Lody for ZanTV.
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CLOUDX_MIRROR_JSON = 'https://raw.githubusercontent.com/Asm0d3usX/CloudX/builds/Website.json';

const UNIVERSAL_CATEGORIES = [
  { id: 'terbaru', name: '🔥 Terbaru 2026', path: 'year/2026/page/%d/' },
  { id: 'popular', alt: 'populer', name: '⭐ Populer 2025', path: 'year/2025/page/%d/' },
  { id: 'series', name: '📺 TV Series', path: 'tv/page/%d/' },
  { id: 'action', name: '💥 Action', path: 'category/action/page/%d/' },
  { id: 'horror', name: '👻 Horror', path: 'category/horror/page/%d/' },
  { id: 'comedy', alt: 'komedi', name: '😂 Komedi', path: 'category/comedy/page/%d/' },
  { id: 'romance', name: '❤️ Romance', path: 'category/roman/page/%d/' },
  { id: 'scifi', name: '🚀 Sci-Fi', path: 'category/science-fiction/page/%d/' },
  { id: 'thriller', name: '🔪 Thriller', path: 'category/thriller/page/%d/' },
  { id: 'animation', alt: 'animasi', name: '🎨 Animasi', path: 'category/cartoon/page/%d/' },
  { id: 'drama', name: '🎭 Drama', path: 'category/drama/page/%d/' }
];

const PROVIDERS = {
  klikxxi: {
    id: 'klikxxi',
    name: 'Bioskop 21 (KlikXXi)',
    shortName: 'Bioskop 21',
    icon: '🎬',
    description: 'Koleksi bioskop terlengkap & 100% bebas iklan (Direct HLS)',
    enabled: true,
    mirrors: [
      'https://new39.ngefilm.site',
      'https://klikxxi.shop',
      'https://filmlokal.me',
      'https://idmxl.ink',
      'https://ww11.pencurimovie.sbs'
    ],
    activeMirror: 'https://new39.ngefilm.site',
    categories: UNIVERSAL_CATEGORIES
  },
  pusatmovie: {
    id: 'pusatmovie',
    name: 'PusatMovie21',
    shortName: 'PusatMovie',
    icon: '🌟',
    description: 'Film box office barat & asia (Server VOE Clean)',
    enabled: false,
    mirrors: [
      'https://refugepdx.com'
    ],
    activeMirror: 'https://refugepdx.com',
    categories: [
      { id: 'terbaru', name: '🔥 Terbaru 2026', path: 'year/2026/page/%d/' },
      { id: 'series', name: '📺 TV Series', path: 'category/serial-tv/page/%d/' },
      { id: 'action', name: '💥 Action', path: 'category/action/page/%d/' },
      { id: 'horror', name: '👻 Horror', path: 'category/horror/page/%d/' },
      { id: 'comedy', alt: 'komedi', name: '😂 Komedi', path: 'category/comedy/page/%d/' },
      { id: 'romance', name: '❤️ Romance', path: 'category/romance/page/%d/' },
      { id: 'drama', name: '🎭 Drama', path: 'category/drama/page/%d/' }
    ]
  },
  sarangfilm: {
    id: 'sarangfilm',
    name: 'SarangFilm21',
    shortName: 'SarangFilm',
    icon: '🍿',
    description: 'Gudang film bioskop & drakor populer',
    enabled: false,
    mirrors: [
      'https://sarangfilm.diy',
      'https://sarangfilm.homes'
    ],
    activeMirror: 'https://sarangfilm.diy',
    categories: [
      { id: 'terbaru', name: '🔥 Terbaru 2026', path: 'year/2026/page/%d/' },
      { id: 'series', name: '📺 TV Series', path: 'category/series/page/%d/' },
      { id: 'action', name: '💥 Action', path: 'category/action/page/%d/' },
      { id: 'horror', name: '👻 Horror', path: 'category/horror/page/%d/' },
      { id: 'comedy', alt: 'komedi', name: '😂 Komedi', path: 'category/comedy/page/%d/' },
      { id: 'romance', name: '❤️ Romance', path: 'category/romance/page/%d/' },
      { id: 'drama', name: '🎭 Drama', path: 'category/drama/page/%d/' }
    ]
  },
  savefilm: {
    id: 'savefilm',
    name: 'SaveFilm21',
    shortName: 'SaveFilm',
    icon: '💾',
    description: 'Server stream Morencius & VOE',
    enabled: false,
    mirrors: [
      'https://new13.savefilm21info.com'
    ],
    activeMirror: 'https://new13.savefilm21info.com',
    categories: UNIVERSAL_CATEGORIES
  },
  wgfilm: {
    id: 'wgfilm',
    name: 'WGFilm21',
    shortName: 'WGFilm',
    icon: '⚡',
    description: 'Alternatif bioskop streaming',
    enabled: false,
    mirrors: [
      'https://alternatif3.wgfilm21.net'
    ],
    activeMirror: 'https://alternatif3.wgfilm21.net',
    categories: UNIVERSAL_CATEGORIES
  }
};

/* ---------------- DYNAMIC CLOUDX MIRRORS AUTO-SYNC ---------------- */
async function syncMirrorsFromCloudX() {
  try {
    const res = await fetch(CLOUDX_MIRROR_JSON, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) return;
    const data = await res.json();
    for (const [key, urls] of Object.entries(data)) {
      if (!Array.isArray(urls) || !urls.length) continue;
      const cleanUrls = urls.map(u => String(u || '').trim().replace(/\/+$/, '')).filter(Boolean);

      let targetId = null;
      const lk = key.toLowerCase();
      if (lk === 'klikxxi' || lk === 'ngefilm' || lk === 'filmlokal' || lk === 'indomax' || lk === 'pencurimovie') {
        targetId = 'klikxxi';
      } else if (lk === 'pusatmovie') {
        targetId = 'pusatmovie';
      } else if (lk === 'sarangfilm') {
        targetId = 'sarangfilm';
      } else if (lk === 'savefilm') {
        targetId = 'savefilm';
      } else if (lk === 'wgfilm21' || lk === 'wgfilm') {
        targetId = 'wgfilm';
      }

      if (targetId && PROVIDERS[targetId]) {
        for (const u of cleanUrls) {
          if (!PROVIDERS[targetId].mirrors.includes(u)) {
            PROVIDERS[targetId].mirrors.unshift(u);
          }
        }
      }
    }
  } catch (e) {
    // Abaikan kegagalan sync, tetap pakai mirror bawaan
  }
}

// Jalankan sync saat startup dan setiap 60 menit
syncMirrorsFromCloudX().catch(() => {});
setInterval(syncMirrorsFromCloudX, 60 * 60 * 1000);

/* ---------------- MULTI-MIRROR AUTO FAILOVER FETCH ---------------- */
function getProvider(provId) {
  provId = (provId || 'klikxxi').toLowerCase();
  return PROVIDERS[provId] || PROVIDERS.klikxxi;
}

async function fetchFromMirrors(pathOrUrl, options = {}, timeoutMs = 6500, provId = 'klikxxi') {
  const provider = getProvider(provId);
  const knownMirrors = provider.mirrors || [provider.activeMirror];

  let mirrorsToTry = [];
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    try {
      const u = new URL(pathOrUrl);
      const reqPath = u.pathname + u.search;
      mirrorsToTry = [pathOrUrl, provider.activeMirror, ...knownMirrors.filter(m => m !== provider.activeMirror)].map(m => {
        if (m === pathOrUrl) return pathOrUrl;
        return m + reqPath;
      });
    } catch (e) {
      mirrorsToTry = [pathOrUrl, ...knownMirrors];
    }
  } else {
    const cleanPath = pathOrUrl.replace(/^\/+/, '');
    mirrorsToTry = [provider.activeMirror, ...knownMirrors.filter(m => m !== provider.activeMirror)].map(m => `${m}/${cleanPath}`);
  }

  // Deduplikasi URL
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
        const text = await res.text();
        if (text && text.length > 200) {
          provider.activeMirror = origin;
          return { html: text, baseUrl: origin, currentUrl: targetUrl };
        }
      }
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error(`Provider ${provider.name} sedang sibuk atau diblokir ISP`);
}

/* ---------------- STREAM EXTRACTOR ALGORITHMS ---------------- */
// 1. JS Unpacker untuk eval(function(p,a,c,k,e,d)...)
function unpackJs(packed) {
  const match = /eval\(function\(p,a,c,k,e,[rd]\)\{.*return p\}\('(.*)',(\d+),(\d+),'(.*)'\.split\('\|'\)/s.exec(packed);
  if (!match) return null;
  let [_, p, a, c, k] = match;
  a = parseInt(a, 10);
  c = parseInt(c, 10);
  k = k.split('|');

  function e(c) {
    return (c < a ? '' : e(Math.floor(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  }

  while (c--) {
    if (k[c]) {
      const regex = new RegExp('\\b' + e(c) + '\\b', 'g');
      p = p.replace(regex, k[c]);
    }
  }
  return p;
}

// 2. VOE Decryption Algorithm (Ported directly from CloudStream Voe.kt)
function rot13(str) {
  return str.replace(/[a-zA-Z]/g, function (c) {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function charShift(str, shift) {
  let res = '';
  for (let i = 0; i < str.length; i++) {
    res += String.fromCharCode(str.charCodeAt(i) - shift);
  }
  return res;
}

function decryptVoeF7(p8) {
  try {
    let v1 = rot13(p8);
    const patterns = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];
    for (const p of patterns) {
      v1 = v1.split(p).join('_');
    }
    const v3 = v1.split('_').join('');
    const v4 = Buffer.from(v3, 'base64').toString('latin1');
    const v5 = charShift(v4, 3);
    const v6 = v5.split('').reverse().join('');
    const v7 = Buffer.from(v6, 'base64').toString('utf8');
    return JSON.parse(v7);
  } catch (e) {
    return null;
  }
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&#8217;|&#39;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
    .replace(/<[^>]+>/g, '')
    .trim();
}

/* ---------------- ARTICLE PARSER ---------------- */
function parseArticles(html, baseUrl, provId) {
  const items = [];
  const articleRegex = /<article[^>]*class="[^"]*(?:item-infinite|item)[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const art = match[1];
    const linkMatch = /<h2[^>]*class="entry-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(art) ||
                      /<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"/i.exec(art);
    if (!linkMatch) continue;
    let url = linkMatch[1];
    if (url.startsWith('/')) url = baseUrl + url;
    const rawTitle = decodeHtmlEntities(linkMatch[2]);

    const imgMatch = /<img[^>]+(?:data-lazy-src|data-src|src)="([^"]+)"/i.exec(art);
    let poster = imgMatch ? imgMatch[1] : '';
    if (poster.startsWith('//')) poster = 'https:' + poster;
    poster = poster.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');

    const qualMatch = /<div[^>]*class="[^"]*(?:gmr-quality-item|gmr-qual)[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(art);
    const quality = qualMatch ? qualMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const ratingMatch = /<div[^>]*class="[^"]*gmr-rating-item[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(art);
    const rating = ratingMatch ? ratingMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const isSeries = url.includes('/tv/') || url.includes('/series/') || art.includes('gmr-numbeps');

    items.push({
      id: Buffer.from(url).toString('base64url'),
      provider: provId || 'klikxxi',
      title: rawTitle,
      url,
      poster,
      quality: quality || 'HD',
      rating: rating ? ('⭐ ' + rating) : '',
      isSeries: !!isSeries
    });
  }
  return items;
}

/* ---------------- API PUBLIK PROVIDER ---------------- */
function setProviderOverride(provId, { enabled, customUrl }) {
  if (!provId || !PROVIDERS[provId]) return;
  if (typeof enabled === 'boolean') {
    PROVIDERS[provId].enabled = enabled;
  }
  if (typeof customUrl === 'string') {
    const clean = customUrl.trim().replace(/\/+$/, '');
    PROVIDERS[provId].customUrl = clean;
    if (clean) {
      PROVIDERS[provId].activeMirror = clean;
      if (!PROVIDERS[provId].mirrors.includes(clean)) {
        PROVIDERS[provId].mirrors.unshift(clean);
      }
    } else {
      PROVIDERS[provId].activeMirror = (PROVIDERS[provId].mirrors && PROVIDERS[provId].mirrors[0]) || '';
    }
  }
}

function getProvidersList(isAdmin = false) {
  return Object.values(PROVIDERS)
    .filter(p => isAdmin || p.enabled !== false)
    .map(p => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      icon: p.icon,
      description: p.description,
      activeMirror: p.activeMirror,
      baseUrl: p.activeMirror,
      defaultUrl: (p.mirrors && p.mirrors[0]) || p.activeMirror || '',
      customUrl: p.customUrl || '',
      enabled: p.enabled !== false,
      mirrors: p.mirrors || [],
      categoriesCount: (p.categories || []).length
    }));
}

function getCategories(provId) {
  const p = getProvider(provId);
  return p.categories || UNIVERSAL_CATEGORIES;
}

async function getCatalog(catId, page, provId) {
  page = Math.max(1, +page || 1);
  provId = (provId || 'klikxxi').toLowerCase();
  const provider = getProvider(provId);
  catId = (catId || 'terbaru').toLowerCase();

  const categories = provider.categories || UNIVERSAL_CATEGORIES;
  const cat = categories.find(c => c.id === catId || c.alt === catId) || categories[0];
  const reqPath = cat.path.replace('%d', page);

  const { html, baseUrl } = await fetchFromMirrors(reqPath, {}, 6500, provId);
  return {
    provider: provider.id,
    providerName: provider.name,
    category: cat.id,
    categoryName: cat.name,
    page,
    items: parseArticles(html, baseUrl, provider.id)
  };
}

async function search(query, page, provId) {
  page = Math.max(1, +page || 1);
  provId = (provId || 'klikxxi').toLowerCase();
  const provider = getProvider(provId);
  if (!query) return { provider: provider.id, query: '', page, items: [] };

  const reqPath = `page/${page}/?s=${encodeURIComponent(query)}&post_type[]=post&post_type[]=tv`;
  const { html, baseUrl } = await fetchFromMirrors(reqPath, {}, 6500, provId);
  return {
    provider: provider.id,
    query,
    page,
    items: parseArticles(html, baseUrl, provider.id)
  };
}

async function getDetail(itemUrl, provId) {
  if (!itemUrl) throw new Error('Missing movie URL');
  if (!itemUrl.startsWith('http')) {
    try {
      itemUrl = Buffer.from(itemUrl, 'base64url').toString('utf8');
    } catch (e) {}
  }

  provId = (provId || 'klikxxi').toLowerCase();
  const provider = getProvider(provId);

  const { html, baseUrl, currentUrl } = await fetchFromMirrors(itemUrl, {}, 6500, provId);

  const titleMatch = /<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : 'Film Bioskop';

  const descMatch = /<div[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const synopsis = descMatch ? decodeHtmlEntities(descMatch[1]) : '';

  const posterMatch = /<figure[^>]*>[\s\S]*?<img[^>]+(?:data-lazy-src|data-src|src)="([^"]+)"/i.exec(html) ||
                      /<div[^>]*class="[^"]*content-thumbnail[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-lazy-src|data-src|src)="([^"]+)"/i.exec(html);
  let poster = posterMatch ? posterMatch[1] : '';
  if (poster.startsWith('//')) poster = 'https:' + poster;
  poster = poster.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');

  const postIdMatch = /id="muvipro_player_content_id"[^>]*data-id="(\d+)"/i.exec(html);
  const postId = postIdMatch ? postIdMatch[1] : null;

  // Server Tabs
  const servers = [];
  const tabRegex = /<ul[^>]*class="[^"]*muvipro-player-tabs[^"]*"[^>]*>([\s\S]*?)<\/ul>/i.exec(html);
  if (tabRegex) {
    const liRegex = /<li[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let tm;
    while ((tm = liRegex.exec(tabRegex[1])) !== null) {
      const tabHref = tm[1];
      const tabName = tm[2].replace(/<[^>]+>/g, '').trim();
      let tabId = 'player' + (servers.length + 1);
      if (tabHref.includes('?player=')) {
        const pm = /[?&]player=(\d+)/.exec(tabHref);
        if (pm) tabId = 'player' + pm[1];
      } else if (tabHref.startsWith('#')) {
        tabId = tabHref.replace('#', '') || ('player' + (servers.length + 1));
      }
      servers.push({
        id: tabId,
        name: tabName || ('Server ' + (servers.length + 1))
      });
    }
  }

  // Extract rich metadata from gmr-moviedata
  const getMovieData = (label) => {
    const rx = new RegExp(`<div[^>]*class="[^"]*gmr-moviedata[^"]*"[^>]*>\\s*<strong>${label}:?\\s*<\\/strong>([\\s\\S]*?)<\\/div>`, 'i');
    const m = rx.exec(html);
    if (!m) return '';
    return decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' '));
  };

  const genres = getMovieData('Genre');
  const quality = getMovieData('Quality') || 'HD';
  const year = getMovieData('Year');
  const duration = getMovieData('Duration');
  const director = getMovieData('Director');
  const cast = getMovieData('Cast');

  // Episodes (If TV Series)
  const episodes = [];
  const epsRegex = /<div[^>]*class="[^"]*(?:vid-episodes|gmr-listseries)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let em;
  while ((em = epsRegex.exec(html)) !== null) {
    const aRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let am;
    while ((am = aRegex.exec(em[1])) !== null) {
      const href = am[1];
      const epTitle = am[2].replace(/<[^>]+>/g, '').trim();
      if (!href.includes('/eps/')) continue;
      episodes.push({
        id: Buffer.from(href).toString('base64url'),
        title: epTitle,
        url: href
      });
    }
  }

  const isSeries = episodes.length > 0 || itemUrl.includes('/tv/') || itemUrl.includes('/series/');

  return {
    id: Buffer.from(currentUrl || itemUrl).toString('base64url'),
    provider: provider.id,
    providerName: provider.name,
    title,
    synopsis,
    poster,
    url: currentUrl || itemUrl,
    postId,
    genres,
    quality,
    year,
    duration,
    director,
    cast,
    servers: servers.length ? servers : [{ id: 'p3', name: 'Server 3 (VOE)' }, { id: 'p1', name: 'Server 1' }],
    isSeries,
    episodes
  };
}

async function extractStream(movieUrl, tabId, provId) {
  if (!movieUrl.startsWith('http')) {
    try {
      movieUrl = Buffer.from(movieUrl, 'base64url').toString('utf8');
    } catch (e) {}
  }
  tabId = tabId || 'p3';
  provId = (provId || 'klikxxi').toLowerCase();

  const { html: dHtml, baseUrl, currentUrl } = await fetchFromMirrors(movieUrl, {}, 6500, provId);
  const targetOrigin = new URL(currentUrl || movieUrl).origin;

  const postIdMatch = /id="muvipro_player_content_id"[^>]*data-id="(\d+)"/i.exec(dHtml);
  const postId = postIdMatch ? postIdMatch[1] : null;

  let iframeSrc = null;

  // 1. Jika tab berupa query param (e.g. player1, player2, player3)
  if (tabId.startsWith('player')) {
    const playerNum = tabId.replace('player', '');
    if (playerNum === '1') {
      const directIfm = /<div[^>]*class="[^"]*gmr-embed-responsive[^"]*"[^>]*>[\s\S]*?<iframe[^>]+src="([^"]+)"/i.exec(dHtml) ||
                        /<iframe[^>]+src="([^"]+)"/i.exec(dHtml);
      if (directIfm && directIfm[1]) iframeSrc = directIfm[1];
    }
    if (!iframeSrc) {
      try {
        const qUrl = `${movieUrl.split('?')[0]}?player=${playerNum}`;
        const qRes = await fetch(qUrl, {
          headers: { 'User-Agent': USER_AGENT, 'Referer': movieUrl },
          signal: AbortSignal.timeout(4000)
        });
        const qHtml = await qRes.text();
        const ifm = /<div[^>]*class="[^"]*gmr-embed-responsive[^"]*"[^>]*>[\s\S]*?<iframe[^>]+src="([^"]+)"/i.exec(qHtml);
        if (ifm && ifm[1]) iframeSrc = ifm[1];
      } catch (e) {}
    }
  }

  // 2. Jika ada postId Muvipro, coba via AJAX admin-ajax.php dengan origin yang tepat
  if (!iframeSrc && postId) {
    const tabsToTry = [tabId, 'p3', 'p1', 'p2', 'p4'].filter((v, i, a) => a.indexOf(v) === i);
    for (const tid of tabsToTry) {
      try {
        const params = new URLSearchParams({
          action: 'muvipro_player_content',
          tab: tid,
          post_id: postId
        });
        const ajaxRes = await fetch(`${targetOrigin}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': USER_AGENT,
            'Referer': currentUrl || movieUrl,
            'Origin': targetOrigin
          },
          body: params.toString(),
          signal: AbortSignal.timeout(4000)
        });
        const ajaxHtml = await ajaxRes.text();
        const ifm = /<iframe[^>]+src="([^"]+)"/i.exec(ajaxHtml);
        if (ifm && ifm[1]) {
          iframeSrc = ifm[1];
          break;
        }
      } catch (e) {}
    }
  }

  // 3. Direct iframe di dalam halaman
  if (!iframeSrc) {
    const directIfm = /<div[^>]*class="[^"]*gmr-embed-responsive[^"]*"[^>]*>[\s\S]*?<iframe[^>]+src="([^"]+)"/i.exec(dHtml) ||
                      /<iframe[^>]+src="([^"]+)"/i.exec(dHtml);
    if (directIfm && directIfm[1]) iframeSrc = directIfm[1];
  }

  if (!iframeSrc) {
    throw new Error('Video stream player not found for this title');
  }

  // Helper ekstraksi M3U8 bersih (VOE / Morencius / Direct HLS)
  async function resolveCleanHls(rawIframeUrl) {
    if (!rawIframeUrl) return null;
    let target = rawIframeUrl.trim();
    if (target.startsWith('//')) target = 'https:' + target;

    // 1. VOE (Direct Master M3U8 via F7 Decryption)
    if (target.includes('voe.sx') || target.includes('shannoncoldalready') || target.includes('/e/')) {
      try {
        let voeUrl = target;
        const voeRes = await fetch(voeUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(4000) });
        const voeHtml = await voeRes.text();
        const redirMatch = /window\.location\.href\s*=\s*'([^']+)'/i.exec(voeHtml);
        if (redirMatch) voeUrl = redirMatch[1];

        const realVoeRes = await fetch(voeUrl, {
          headers: { 'User-Agent': USER_AGENT, 'Referer': targetOrigin + '/' },
          signal: AbortSignal.timeout(4500)
        });
        const realVoeHtml = await realVoeRes.text();
        const p8Match = /<script type="application\/json">\["([^"]+)"\]<\/script>/i.exec(realVoeHtml);
        if (p8Match) {
          const dec = decryptVoeF7(p8Match[1]);
          if (dec && dec.source) {
            let sUrl = dec.source.trim();
            if (sUrl.startsWith('//')) sUrl = 'https:' + sUrl;
            else if (sUrl.startsWith('/')) {
              try { sUrl = new URL(sUrl, voeUrl).href; } catch (e) {}
            }
            return {
              streamUrl: sUrl,
              mp4Url: dec.direct_access_url || null,
              kind: 'hls',
              extractor: 'VOE',
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

    // 2. Morencius / Dingtezuni / Movearnpre (Direct Master M3U8 via JS Unpack)
    if (target.includes('morencius.com') || target.includes('dingtezuni.com') || target.includes('movearnpre.com')) {
      try {
        const res = await fetch(target, {
          headers: { 'User-Agent': USER_AGENT, 'Referer': targetOrigin + '/' },
          signal: AbortSignal.timeout(4000)
        });
        const html = await res.text();
        const packedMatch = html.match(/eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\.split\('\|'\)\)\)/);
        if (packedMatch) {
          const unpacked = unpackJs(packedMatch[0]);
          const m3u8Match = /"([^"]+m3u8[^"]*)"/i.exec(unpacked || '');
          if (m3u8Match) {
            let sUrl = m3u8Match[1].trim();
            if (sUrl.startsWith('//')) sUrl = 'https:' + sUrl;
            else if (sUrl.startsWith('/')) {
              try { sUrl = new URL(sUrl, target).href; } catch (e) {}
            }
            return {
              streamUrl: sUrl,
              kind: 'hls',
              extractor: 'Morencius',
              headers: {
                'User-Agent': USER_AGENT,
                'Origin': new URL(target).origin,
                'Referer': target
              }
            };
          }
        }
      } catch (e) {}
    }

    // 3. Direct M3U8 check inside iframe page
    try {
      const rawRes = await fetch(target, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': targetOrigin + '/' },
        signal: AbortSignal.timeout(3500)
      });
      const rawHtml = await rawRes.text();
      const m3u8Match = /(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i.exec(rawHtml);
      if (m3u8Match) {
        let sUrl = m3u8Match[1].trim();
        if (sUrl.startsWith('//')) sUrl = 'https:' + sUrl;
        else if (sUrl.startsWith('/')) {
          try { sUrl = new URL(sUrl, target).href; } catch (e) {}
        }
        return {
          streamUrl: sUrl,
          kind: 'hls',
          extractor: 'DirectHLS',
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': target
          }
        };
      }
    } catch (e) {}

    return null;
  }

  // Coba tab yang diminta terlebih dahulu
  if (iframeSrc) {
    const cleanStream = await resolveCleanHls(iframeSrc);
    if (cleanStream) return cleanStream;
  }

  // Auto-failover ke tab lain untuk mencari server bebas iklan (VOE / Morencius)
  const candidateTabs = ['p3', 'player3', 'p2', 'player2', 'p1', 'player1', 'p4', 'player4'];
  for (const tid of candidateTabs) {
    if (tid === tabId) continue;
    let altIframe = null;

    if (tid.startsWith('player')) {
      const pNum = tid.replace('player', '');
      try {
        const qUrl = `${movieUrl.split('?')[0]}?player=${pNum}`;
        const qRes = await fetch(qUrl, { headers: { 'User-Agent': USER_AGENT, 'Referer': movieUrl }, signal: AbortSignal.timeout(3500) });
        const qHtml = await qRes.text();
        const ifm = /<div[^>]*class="[^"]*gmr-embed-responsive[^"]*"[^>]*>[\s\S]*?<iframe[^>]+src="([^"]+)"/i.exec(qHtml);
        if (ifm && ifm[1]) altIframe = ifm[1];
      } catch (e) {}
    } else if (postId) {
      try {
        const p = new URLSearchParams({ action: 'muvipro_player_content', tab: tid, post_id: postId });
        const ajaxRes = await fetch(`${targetOrigin}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': USER_AGENT,
            'Referer': currentUrl || movieUrl,
            'Origin': targetOrigin
          },
          body: p.toString(),
          signal: AbortSignal.timeout(3500)
        });
        const ajaxHtml = await ajaxRes.text();
        const ifm = /<iframe[^>]+src="([^"]+)"/i.exec(ajaxHtml);
        if (ifm && ifm[1]) altIframe = ifm[1];
      } catch (e) {}
    }

    if (altIframe) {
      const cleanStream = await resolveCleanHls(altIframe);
      if (cleanStream) return cleanStream;
    }
  }

  throw new Error('Stream langsung m3u8 (bebas iklan) belum tersedia pada server ini. Silakan coba judul lain.');
}

module.exports = {
  UNIVERSAL_CATEGORIES,
  PROVIDERS,
  getProvidersList,
  setProviderOverride,
  getCategories,
  getCatalog,
  search,
  getDetail,
  extractStream,
  syncMirrorsFromCloudX
};
