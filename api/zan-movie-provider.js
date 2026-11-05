'use strict';
/**
 * ZanTV Movie Provider Module (CloudX-V2 Port for Node.js)
 * Scraper & HLS Stream Extractor untuk Film Bioskop & Series Sub Indo
 * Crafted with love by Lody for ZanTV.
 */

let baseMirrorUrl = 'https://klikxxi.shop';
let lastMirrorCheck = 0;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CATEGORIES = [
  { id: 'terbaru', name: '🔥 Terbaru 2026', path: 'year/2026/page/%d/' },
  { id: 'popular', name: '⭐ Populer 2025', path: 'year/2025/page/%d/' },
  { id: 'series', name: '📺 TV Series', path: 'tv/page/%d/' },
  { id: 'action', name: '💥 Action', path: 'category/action/page/%d/' },
  { id: 'horror', name: '👻 Horror', path: 'category/horror/page/%d/' },
  { id: 'comedy', name: '😂 Comedy', path: 'category/comedy/page/%d/' },
  { id: 'romance', name: '❤️ Romance', path: 'category/roman/page/%d/' },
  { id: 'scifi', name: '🚀 Sci-Fi', path: 'category/science-fiction/page/%d/' },
  { id: 'thriller', name: '🔪 Thriller', path: 'category/thriller/page/%d/' },
  { id: 'animation', name: '🎨 Animasi', path: 'category/cartoon/page/%d/' },
  { id: 'drama', name: '🎭 Drama', path: 'category/drama/page/%d/' }
];

async function updateMirrorUrlIfNeeded() {
  const now = Date.now();
  if (now - lastMirrorCheck < 6 * 3600 * 1000) return baseMirrorUrl;
  lastMirrorCheck = now;
  try {
    const res = await fetch('https://raw.githubusercontent.com/Asm0d3usX/CloudX/builds/Website.json', {
      headers: { 'User-Agent': USER_AGENT }
    });
    if (res.ok) {
      const json = await res.json();
      const arr = json.klikxxi || json.filmlokal;
      if (Array.isArray(arr) && arr[0]) {
        baseMirrorUrl = arr[0].replace(/\/+$/, '');
      }
    }
  } catch (e) {
    // Fallback to default baseMirrorUrl
  }
  return baseMirrorUrl;
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
    const rawTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();

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

async function getCatalog(catId, page) {
  page = Math.max(1, +page || 1);
  catId = (catId || 'terbaru').toLowerCase();
  const cat = CATEGORIES.find(c => c.id === catId) || CATEGORIES[0];
  const baseUrl = await updateMirrorUrlIfNeeded();
  const reqPath = cat.path.replace('%d', page);
  const targetUrl = `${baseUrl}/${reqPath}`;

  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': baseUrl + '/'
    }
  });
  if (!res.ok) throw new Error(`Provider returned status ${res.status}`);
  const html = await res.text();
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
  const baseUrl = await updateMirrorUrlIfNeeded();
  const targetUrl = `${baseUrl}/page/${page}/?s=${encodeURIComponent(query)}&post_type[]=post&post_type[]=tv`;

  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': baseUrl + '/'
    }
  });
  if (!res.ok) throw new Error(`Search returned status ${res.status}`);
  const html = await res.text();
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
  const baseUrl = await updateMirrorUrlIfNeeded();
  const res = await fetch(itemUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': baseUrl + '/'
    }
  });
  if (!res.ok) throw new Error(`Detail returned status ${res.status}`);
  const html = await res.text();

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
    servers: servers.length ? servers : [{ id: 'p1', name: 'Server 1 (Auto)' }],
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
  const baseUrl = await updateMirrorUrlIfNeeded();
  tabId = tabId || 'p3'; // p3 is VOE on KlikXXi which has direct HLS

  const dRes = await fetch(movieUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': baseUrl + '/'
    }
  });
  if (!dRes.ok) throw new Error(`Movie page status ${dRes.status}`);
  const dHtml = await dRes.text();

  const postIdMatch = /id="muvipro_player_content_id"[^>]*data-id="(\d+)"/i.exec(dHtml);
  const postId = postIdMatch ? postIdMatch[1] : null;

  let iframeSrc = null;

  // 1. Try AJAX Muvipro for the specified tab (e.g. p3 for VOE, p1 for HgCloud)
  const tabsToTry = [tabId, 'p3', 'p1', 'p2', 'p4'].filter((v, i, a) => a.indexOf(v) === i);

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
          body: params.toString()
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
        headers: { 'User-Agent': USER_AGENT }
      });
      const voeHtml = await voeRes.text();
      const redirMatch = /window\.location\.href\s*=\s*'([^']+)'/i.exec(voeHtml);
      if (redirMatch) voeUrl = redirMatch[1];

      const realVoeRes = await fetch(voeUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': baseUrl + '/'
        }
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

module.exports = {
  CATEGORIES,
  getCatalog,
  search,
  getDetail,
  extractStream,
  updateMirrorUrlIfNeeded
};
