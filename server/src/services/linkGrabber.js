// Generic link grabber: fetches a web page (optionally following its rel="next" pagination,
// with cookies from a Netscape cookies.txt), collects the outbound links, embedded players and
// direct media files it contains, and hands a chosen set to a downloader — this app's own
// yt-dlp queue, JDownloader (Click'n'Load) or aria2 (JSON-RPC). It has no per-site scraping
// logic: anything a page links to is reported, grouped by host, and the user picks.
const fs = require('fs');
const ytdlp = require('./ytdlp');
const { COOKIES_FILE } = require('./ytdlpPaths');

const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_LIMIT = 25;
const MAX_LINKS = 2000;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;
// Pause between page fetches so a multi-page crawl doesn't hammer the site.
const PAGE_DELAY_MS = 1500;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const VIDEO_EXT = /\.(?:mp4|m4v|webm|mkv|mov|avi|wmv|flv|ts|m3u8|mpd)(?:$|[?#])/i;
const AUDIO_EXT = /\.(?:mp3|m4a|aac|flac|opus|ogg|wav)(?:$|[?#])/i;
const ARCHIVE_EXT = /\.(?:zip|rar|7z|tar|gz)(?:$|[?#])/i;
// Page furniture that's never what anyone is grabbing.
const ASSET_EXT = /\.(?:css|js|mjs|json|xml|ico|woff2?|ttf|eot|svg)(?:$|[?#])/i;

// --- cookies ---------------------------------------------------------------------------

// Netscape cookies.txt rows: domain, includeSubdomains, path, secure, expiry, name, value.
// A "#HttpOnly_" prefix marks a real HttpOnly cookie, not a comment.
function parseNetscapeCookies(text) {
  const cookies = [];
  for (let line of String(text || '').split('\n')) {
    line = line.replace(/\r$/, '');
    if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length);
    else if (!line.trim() || line.trim().startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    cookies.push({
      domain: parts[0].toLowerCase(),
      path: parts[2] || '/',
      secure: parts[3].toUpperCase() === 'TRUE',
      expiry: Number(parts[4]) || 0,
      name: parts[5],
      value: parts.slice(6).join('\t'),
    });
  }
  return cookies;
}

// The Cookie header a browser would send to `url`: domain, path, secure and expiry all have
// to match, so a cookie is never leaked to a host it wasn't set for (including redirects).
function cookieHeaderFor(cookies, url, now = Date.now()) {
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  const host = parsed.hostname.toLowerCase();
  const nowSec = Math.floor(now / 1000);
  const pairs = [];
  for (const c of cookies) {
    const domain = c.domain.replace(/^\./, '');
    if (!domain || (host !== domain && !host.endsWith(`.${domain}`))) continue;
    if (c.secure && parsed.protocol !== 'https:') continue;
    if (c.expiry && c.expiry < nowSec) continue;
    const cookiePath = c.path || '/';
    if (!(parsed.pathname === cookiePath || parsed.pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`))) continue;
    pairs.push(`${c.name}=${c.value}`);
  }
  return pairs.join('; ');
}

function loadCookies({ cookiesText, useSavedCookies }) {
  const cookies = [];
  if (useSavedCookies && fs.existsSync(COOKIES_FILE)) {
    cookies.push(...parseNetscapeCookies(fs.readFileSync(COOKIES_FILE, 'utf8')));
  }
  if (cookiesText) cookies.push(...parseNetscapeCookies(cookiesText));
  return cookies;
}

// --- HTML parsing ----------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", '#47': '/', '#x2F': '/' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name) => {
    if (ENTITIES[name] !== undefined) return ENTITIES[name];
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (/^#/.test(name)) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return m;
  });
}

function resolveUrl(raw, baseUrl) {
  if (!raw) return null;
  const value = decodeEntities(raw.trim());
  if (!value || /^(?:javascript|mailto|tel|data|blob):/i.test(value) || value.startsWith('#')) return null;
  try {
    const u = new URL(value, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

// Forums and link shorteners often wrap outbound links in their own redirect page, e.g.
// /redirect?to=<url> or ?url=<base64>. Unwrap one level when a query value is itself a URL.
function unwrapRedirect(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return url; }
  for (const [, value] of parsed.searchParams) {
    if (/^https?:\/\//i.test(value)) return value;
    if (/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(value)) {
      try {
        const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        if (/^https?:\/\/[^\s]+$/i.test(decoded)) return decoded;
      } catch { /* not base64 */ }
    }
  }
  return url;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function pageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].replace(/\s+/g, ' ').trim()).slice(0, 300) : '';
}

// rel="next" on a <link> or <a> is how most forums, blogs and galleries mark the next page.
function findNextPage(html, baseUrl) {
  const tags = html.match(/<(?:link|a)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = (attr(tag, 'rel') || '').toLowerCase().split(/\s+/);
    if (rel.includes('next')) {
      const next = resolveUrl(attr(tag, 'href'), baseUrl);
      if (next) return next;
    }
  }
  return null;
}

// Returns [{ url, source }] where source is 'embed' (iframe/video/audio/source/embed),
// 'link' (an <a href>) or 'text' (a bare URL in the page text).
function extractLinks(html, baseUrl) {
  const found = [];
  const pageHost = hostOf(baseUrl);
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');

  for (const tag of body.match(/<(?:iframe|video|audio|source|embed)\b[^>]*>/gi) || []) {
    for (const name of ['src', 'data-src', 'data-url', 'data-video']) {
      const url = resolveUrl(attr(tag, name), baseUrl);
      if (url) found.push({ url, source: 'embed' });
    }
  }
  for (const tag of body.match(/<a\b[^>]*>/gi) || []) {
    const url = resolveUrl(attr(tag, 'href'), baseUrl);
    // Only the site's own links can be redirect wrappers; an outbound link's query string
    // (e.g. ?ref=https://...) is left alone.
    if (url) found.push({ url: hostOf(url) === pageHost ? unwrapRedirect(url) : url, source: 'link' });
  }
  const text = body.replace(/<[^>]+>/g, ' ');
  for (const m of decodeEntities(text).matchAll(/https?:\/\/[^\s"'<>()[\]{}]+/gi)) {
    const url = resolveUrl(m[0].replace(/[.,;:!?]+$/, ''), baseUrl);
    if (url) found.push({ url, source: 'text' });
  }
  return found;
}

function classify(url, source) {
  if (VIDEO_EXT.test(url)) return 'video';
  if (AUDIO_EXT.test(url)) return 'audio';
  if (ARCHIVE_EXT.test(url)) return 'archive';
  if (source === 'embed') return 'embed';
  return 'link';
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

// Drops the page's own navigation: links back to the crawled site are only kept when they're
// embeds or point straight at a media/archive file (e.g. an attachment the site hosts itself).
function shouldKeep(url, source, siteHost) {
  if (ASSET_EXT.test(url)) return false;
  const kind = classify(url, source);
  if (hostOf(url) === siteHost && kind === 'link') return false;
  return true;
}

// --- fetching --------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Page is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Follows redirects by hand so every hop passes the SSRF guard and gets only its own cookies.
async function fetchPage(url, { cookies, fetchImpl = fetch, assertUrl = ytdlp.assertPublicUrlResolved }) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrl(current);
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    };
    const cookieHeader = cookieHeaderFor(cookies, current);
    if (cookieHeader) headers.Cookie = cookieHeader;
    const res = await fetchImpl(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${current}`);
    const type = res.headers.get('content-type') || '';
    if (type && !/html|xml|text\/plain/i.test(type)) throw new Error(`Not a web page (${type.split(';')[0]})`);
    return { url: current, html: await readCapped(res, MAX_PAGE_BYTES) };
  }
  throw new Error('Too many redirects');
}

// Crawls `url` and up to maxPages-1 following pages. Returns
// { pages: [{ url, title }], links: [{ url, host, kind, source, page, count }], truncated, error }.
// A failure after the first page stops the crawl but still returns what was found.
async function crawl({ url, maxPages = DEFAULT_MAX_PAGES, cookiesText = '', useSavedCookies = false, fetchImpl, assertUrl, delayMs = PAGE_DELAY_MS }) {
  const startUrl = resolveUrl(ytdlp.normalizeUrl(url), undefined);
  if (!startUrl) throw new Error('A valid http(s) URL is required');
  const limit = Math.min(Math.max(parseInt(maxPages, 10) || DEFAULT_MAX_PAGES, 1), MAX_PAGES_LIMIT);
  const cookies = loadCookies({ cookiesText, useSavedCookies });
  const siteHost = hostOf(startUrl);

  const pages = [];
  const byUrl = new Map();
  const visited = new Set();
  let next = startUrl;
  let truncated = false;
  let error = null;

  while (next && pages.length < limit && !visited.has(next)) {
    visited.add(next);
    if (pages.length > 0 && delayMs > 0) await delay(delayMs);
    let page;
    try {
      page = await fetchPage(next, { cookies, fetchImpl, assertUrl });
    } catch (err) {
      if (pages.length === 0) throw err;
      error = err.message;
      break;
    }
    const pageNumber = pages.length + 1;
    pages.push({ url: page.url, title: pageTitle(page.html) });

    for (const { url: link, source } of extractLinks(page.html, page.url)) {
      if (!shouldKeep(link, source, siteHost)) continue;
      const existing = byUrl.get(link);
      if (existing) {
        existing.count++;
        // An embed is the more useful label when the same URL also appears as a plain link.
        if (source === 'embed' && existing.source !== 'embed') {
          existing.source = 'embed';
          existing.kind = classify(link, 'embed');
        }
        continue;
      }
      if (byUrl.size >= MAX_LINKS) { truncated = true; continue; }
      byUrl.set(link, { url: link, host: hostOf(link), kind: classify(link, source), source, page: pageNumber, count: 1 });
    }

    const candidate = findNextPage(page.html, page.url);
    next = candidate && hostOf(candidate) === siteHost ? candidate : null;
  }

  return { pages, links: [...byUrl.values()], truncated, error, hasMorePages: Boolean(next && !visited.has(next)) };
}

// --- senders ---------------------------------------------------------------------------

function cleanUrls(urls) {
  const list = (Array.isArray(urls) ? urls : []).map((u) => resolveUrl(String(u || ''), undefined)).filter(Boolean);
  return [...new Set(list)];
}

// JDownloader's Click'n'Load listener (port 9666). It only accepts connections from
// localhost unless remote Click'n'Load is enabled in JDownloader's advanced settings.
async function sendToJDownloader(urls, { baseUrl, packageName, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error('JDownloader address is not configured');
  const endpoint = new URL('/flash/add', baseUrl).toString();
  const body = new URLSearchParams({ urls: urls.join('\r\n'), source: 'yt-dlp-gui' });
  if (packageName) body.set('package', packageName);
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`JDownloader responded with HTTP ${res.status}`);
  return { sent: urls.length };
}

async function sendToAria2(urls, { rpcUrl, secret, dir, fetchImpl = fetch }) {
  if (!rpcUrl) throw new Error('aria2 RPC address is not configured');
  const options = dir ? { dir } : {};
  const calls = urls.map((u) => ({
    methodName: 'aria2.addUri',
    params: [...(secret ? [`token:${secret}`] : []), [u], options],
  }));
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'yt-dlp-gui', method: 'system.multicall', params: [calls] }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`aria2 responded with HTTP ${res.status}`);
  if (data.error) throw new Error(`aria2: ${data.error.message}`);
  const results = Array.isArray(data.result) ? data.result : [];
  const failed = results.filter((r) => r && r.faultString).map((r) => r.faultString);
  return { sent: results.length - failed.length, failed };
}

module.exports = {
  DEFAULT_MAX_PAGES,
  MAX_PAGES_LIMIT,
  parseNetscapeCookies,
  cookieHeaderFor,
  extractLinks,
  findNextPage,
  unwrapRedirect,
  classify,
  crawl,
  cleanUrls,
  sendToJDownloader,
  sendToAria2,
};
