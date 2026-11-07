'use strict';
/**
 * ZanTV Movie Provider Module (CloudX-V2 Port for Node.js)
 * Scraper & HLS Stream Extractor untuk Film Bioskop & Series Sub Indo
 * Dilengkapi Multi-Mirror Auto-Failover & Strict Timeout (Anti-Hanging)
 * Crafted with love by Lody for ZanTV.
 */

const KNOWN_MIRRORS = [
  'https://klikxxi.shop',
  'https://filmlokal.me',
  'https://ww11.pencurimovie.sbs'
];

let activeMirror = KNOWN_MIRRORS[0];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CATEGORIES = [
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

/* ---------------- MULTI-MIRROR AUTO FAILOVER FETCH ---------------- */
async function fetchFromMirrors(pathOrUrl, options = {}, timeoutMs = 6000) {
  // Susun urutan: coba mirror aktif dulu, lalu mirror lainnya
  let mirrorsToTry = [];
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    // Jika path berupa absolute URL, ekstrak path-nya
    try {
      const u = new URL(pathOrUrl);
      const reqPath = u.pathname + u.search;
      mirrorsToTry = [activeMirror, ...KNOWN_MIRRORS.filter(m => m !== activeMirror)].map(m => m + reqPath);
      // Tambahkan URL aslinya di posisi paling depan
      mirrorsToTry.unshift(pathOrUrl);
    } catch (e) {
      mirrorsToTry = [pathOrUrl, ...KNOWN_MIRRORS];
    }
  } else {
    const cleanPath = pathOrUrl.replace(/^\/+/, '');
    mirrorsToTry = [activeMirror, ...KNOWN_MIRRORS.filter(m => m !== activeMirror)].map(m => `${m}/${cleanPath}`);
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
          activeMirror = origin;
          return { html: text, baseUrl: origin, currentUrl: targetUrl };
        }
      }
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('Semua mirror streaming film sedang offline atau diblokir ISP');
}

// VOE Decryption Algorithm (Ported directly from CloudStream Voe.kt)
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

function parseArticles(html, baseUrl) {
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

    const isSeries = url.includes('/tv/') || art.includes('gmr-numbeps');

    items.push({
      id: Buffer.from(url).toString('base64url'),
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
async function getCatalog(catId, page) {
  page = Math.max(1, +page || 1);
  catId = (catId || 'terbaru').toLowerCase();
  const cat = CATEGORIES.find(c => c.id === catId || c.alt === catId) || CATEGORIES[0];
  const reqPath = cat.path.replace('%d', page);

  const { html, baseUrl } = await fetchFromMirrors(reqPath);
  return {
    category: cat.id,
    categoryName: cat.name,
    page,
    items: parseArticles(html, baseUrl)
  };
}

async function search(query, page) {
  page = Math.max(1, +page || 1);
  if (!query) return { query: '', page, items: [] };
  const reqPath = `page/${page}/?s=${encodeURIComponent(query)}&post_type[]=post&post_type[]=tv`;

  const { html, baseUrl } = await fetchFromMirrors(reqPath);
  return {
    query,
    page,
    items: parseArticles(html, baseUrl)
  };
}

async function getDetail(itemUrl) {
  if (!itemUrl) throw new Error('Missing movie URL');
  if (!itemUrl.startsWith('http')) {
    try {
      itemUrl = Buffer.from(itemUrl, 'base64url').toString('utf8');
    } catch (e) {}
  }

  const { html, baseUrl } = await fetchFromMirrors(itemUrl);

  const titleMatch = /<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Film';

  const descMatch = /<div[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const synopsis = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

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
      const tabId = tabHref.replace('#', '') || 'p1';
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
    return m[1].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
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

  const isSeries = episodes.length > 0 || itemUrl.includes('/tv/');

  return {
    id: Buffer.from(itemUrl).toString('base64url'),
    title,
    synopsis,
    poster,
    url: itemUrl,
    postId,
    genres,
    quality,
    year,
    duration,
    director,
    cast,
    servers: servers.length ? servers : [{ id: 'p3', name: 'Server 3 (VOE)' }, { id: 'p1', name: 'Server 1 (Auto)' }],
    isSeries,
    episodes
  };
}

async function extractStream(movieUrl, tabId) {
  if (!movieUrl.startsWith('http')) {
    try {
      movieUrl = Buffer.from(movieUrl, 'base64url').toString('utf8');
    } catch (e) {}
  }
  tabId = tabId || 'p3';

  const { html: dHtml, baseUrl } = await fetchFromMirrors(movieUrl);

  const postIdMatch = /id="muvipro_player_content_id"[^>]*data-id="(\d+)"/i.exec(dHtml);
  const postId = postIdMatch ? postIdMatch[1] : null;

  let iframeSrc = null;

  // 1. Try AJAX Muvipro tabs to find a VOE direct stream first, or fallback to first available iframe
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
          if (!iframeSrc) iframeSrc = candidate;
          // Jika menemukan VOE player (VOE / shannoncoldalready), utamakan langsung dan berhenti mencari
          if (candidate.includes('voe.sx') || candidate.includes('shannoncoldalready') || candidate.includes('cloudwindow') || candidate.includes('voe-network') || candidate.includes('yugotehe')) {
            iframeSrc = candidate;
            break;
          }
        }
      } catch (e) {}
    }
  }

  // 2. Direct iframe fallback in page
  if (!iframeSrc) {
    const directIfm = /<div[^>]*class="[^"]*gmr-embed-responsive[^"]*"[^>]*>[\s\S]*?<iframe[^>]+src="([^"]+)"/i.exec(dHtml);
    if (directIfm) iframeSrc = directIfm[1];
  }

  if (!iframeSrc) {
    throw new Error('Video stream player not found for this title');
  }

  // 3. Resolve VOE if iframe is voe
  if (iframeSrc.includes('voe.sx') || iframeSrc.includes('shannoncoldalready') || iframeSrc.includes('/e/')) {
    try {
      let voeUrl = iframeSrc;
      const voeRes = await fetch(voeUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000)
      });
      const voeHtml = await voeRes.text();
      const redirMatch = /window\.location\.href\s*=\s*'([^']+)'/i.exec(voeHtml);
      if (redirMatch) voeUrl = redirMatch[1];

      const realVoeRes = await fetch(voeUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': baseUrl + '/'
        },
        signal: AbortSignal.timeout(5500)
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

  // Fallback: return iframe URL if direct stream resolution failed
  return {
    streamUrl: iframeSrc,
    kind: 'iframe',
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': baseUrl + '/'
    }
  };
}

function getActiveMirror() {
  return activeMirror;
}

function setActiveMirror(newMirror) {
  if (typeof newMirror === 'string' && newMirror.trim().startsWith('http')) {
    activeMirror = newMirror.trim().replace(/\/+$/, '');
    if (!KNOWN_MIRRORS.includes(activeMirror)) {
      KNOWN_MIRRORS.unshift(activeMirror);
    }
  }
  return activeMirror;
}

function getMirrors() {
  return {
    active: activeMirror,
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
  getMirrors
};
