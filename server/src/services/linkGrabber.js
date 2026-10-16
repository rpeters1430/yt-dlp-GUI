// Generic link grabber: fetches a web page (optionally following its rel="next" pagination,
// with cookies from a Netscape cookies.txt), collects the outbound links, embedded players and
// direct media files it contains, and hands a chosen set to a downloader — this app's own
// yt-dlp queue, JDownloader (Click'n'Load) or aria2 (JSON-RPC). It has no per-site scraping
// logic: anything a page links to is reported, grouped by host, and the user picks.
const fs = require('fs');
const db = require('../db');
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

const PASSWORD_PATTERNS = [
  /(?:archive\s*)?pass(?:word)?\s*[:=]\s*["']?([^\s"'\n<>]+)/gi,
  /\bpw\s*[:=]\s*["']?([^\s"'\n<>]+)/gi,
  /\bpass\s*[:=]\s*["']?([^\s"'\n<>]+)/gi,
  /contrase[ñn]a\s*[:=]\s*["']?([^\s"'\n<>]+)/gi,
  /mot\s*de\s*passe\s*[:=]\s*["']?([^\s"'\n<>]+)/gi,
];

const IGNORE_PASSWORDS = new Set([
  'none', 'n/a', 'no', 'required', 'protected', 'unknown', 'null', 'false', 'true',
  'password', 'pass', 'pw', 'yes', 'link', 'download', 'here', 'mega', 'pixeldrain'
]);

function extractPasswords(text) {
  if (!text) return [];
  const found = new Set();
  for (const pat of PASSWORD_PATTERNS) {
    for (const m of text.matchAll(pat)) {
      const clean = m[1].replace(/^[.,;:"'!?\[\]()]+|[.,;:"'!?\[\]()]+$/g, '');
      if (clean && clean.length >= 2 && !IGNORE_PASSWORDS.has(clean.toLowerCase()) && !clean.startsWith('http')) {
        found.add(clean);
      }
    }
  }
  return [...found];
}

const BASE64_PATTERN = /(?:[A-Za-z0-9+/]{4}){4,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;

function extractBase64Links(text) {
  if (!text) return [];
  const found = [];
  const matches = text.match(BASE64_PATTERN) || [];
  for (const candidate of matches) {
    if (candidate.length < 16) continue;
    try {
      const padLen = (-candidate.length % 4 + 4) % 4;
      const padded = candidate + '='.repeat(padLen);
      const decoded = Buffer.from(padded, 'base64').toString('utf8');
      for (const m of decoded.matchAll(/https?:\/\/[^\s"'<>()[\]{}]+/gi)) {
        const clean = m[0].replace(/[.,;:!?]+$/, '');
        if (clean && !found.includes(clean)) {
          found.push(clean);
        }
      }
    } catch {
      // ignore invalid base64
    }
  }
  return found;
}

function stripQuotesAndBots(html, { skipQuotes = true, skipBots = true } = {}) {
  let cleaned = html;
  if (skipQuotes) {
    // Strip XenForo quote blocks and standard blockquote elements so replies quoting OP don't duplicate links
    cleaned = cleaned.replace(/<div\b[^>]*class="[^"]*bbCodeBlock--quote[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, ' ');
    cleaned = cleaned.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, ' ');
  }
  if (skipBots) {
    // Strip automated mirror re-upload bots (e.g. sussybot)
    cleaned = cleaned.replace(/<article\b[^>]*data-author="sussybot"[^>]*>[\s\S]*?<\/article>/gi, ' ');
  }
  return cleaned;
}

function cleanThreadTitle(title) {
  if (!title) return '';
  let clean = title.replace(/\s*\|\s*SimpCity.*$/i, '');
  clean = clean.replace(/\s+/g, ' ').trim();
  clean = clean.replace(/[\\/*?:"<>|]/g, '');
  return clean;
}

function parseThreadUrl(rawUrl) {
  const url = (rawUrl || '').split('?')[0].split('#')[0].replace(/\/+$/, '');
  const match = url.match(/^(https?:\/\/[^/]+\/threads\/[^/]+)(?:\/page-(\d+))?$/i);
  if (match) {
    const base = match[1].replace(/\/+$/, '') + '/';
    const page = match[2] ? parseInt(match[2], 10) : 1;
    return { isThread: true, baseUrl: base, page };
  }
  return { isThread: false, baseUrl: (rawUrl || '').replace(/\/+$/, '') + '/', page: 1 };
}

function getThreadPageUrl(baseUrl, pageNum) {
  const base = baseUrl.replace(/\/+$/, '') + '/';
  if (pageNum <= 1) return base;
  return `${base}page-${pageNum}`;
}

function detectMaxPage(html, currentPage = 1) {
  const pages = [currentPage];
  for (const m of html.matchAll(/class="[^"]*(?:pageNav-page|pageNav-main)[^"]*"[^>]*>(\d+)</gi)) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 0 && n < 100000) pages.push(n);
  }
  for (const m of html.matchAll(/\/page-(\d+)["'/?#]/gi)) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 0 && n < 100000) pages.push(n);
  }
  return Math.max(...pages);
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
// 'link' (an <a href>), 'text' (a bare URL in the page text), or 'base64' (decoded URL).
// Also attaches discovered archive passwords as `links.passwords = [...]`.
function extractLinks(html, baseUrl, options = {}) {
  const { skipQuotes = true, skipBots = true, decodeBase64 = true } = options;
  const cleanedHtml = stripQuotesAndBots(html, { skipQuotes, skipBots });
  const found = [];
  const pageHost = hostOf(baseUrl);
  const body = cleanedHtml.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');

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

  // Base64 decoded links
  if (decodeBase64) {
    const b64Urls = extractBase64Links(text);
    for (const b64Url of b64Urls) {
      const url = resolveUrl(b64Url, baseUrl);
      if (url) found.push({ url: hostOf(url) === pageHost ? unwrapRedirect(url) : url, source: 'base64' });
    }
  }

  // Passwords
  found.passwords = extractPasswords(text);
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

// Crawls `url` and following pages based on mode ('follow' | 'all' | 'last' | 'range' | 'single').
// Returns { pages, links, passwords, newCount, historyCount, maxPage, threadTitle, truncated, error, hasMorePages }.
async function crawl({
  url,
  mode = 'follow',
  maxPages = DEFAULT_MAX_PAGES,
  startPage,
  endPage,
  lastN,
  skipQuotes = true,
  skipBots = true,
  decodeBase64 = true,
  ignoreHistory = false,
  cookiesText = '',
  useSavedCookies = false,
  fetchImpl,
  assertUrl,
  delayMs = PAGE_DELAY_MS,
}) {
  const startUrl = resolveUrl(ytdlp.normalizeUrl(url), undefined);
  if (!startUrl) throw new Error('A valid http(s) URL is required');
  const limit = Math.min(Math.max(parseInt(maxPages, 10) || DEFAULT_MAX_PAGES, 1), MAX_PAGES_LIMIT);
  const cookies = loadCookies({ cookiesText, useSavedCookies });
  const siteHost = hostOf(startUrl);
  const threadInfo = parseThreadUrl(startUrl);

  const pages = [];
  const byUrl = new Map();
  const visited = new Set();
  const allPasswords = new Set();
  let truncated = false;
  let error = null;

  // 1. Fetch initial page
  const firstPage = await fetchPage(startUrl, { cookies, fetchImpl, assertUrl });
  visited.add(firstPage.url);
  visited.add(startUrl);

  const firstTitle = pageTitle(firstPage.html);
  pages.push({ url: firstPage.url, title: firstTitle, page: threadInfo.page });

  const detectedMaxPage = detectMaxPage(firstPage.html, threadInfo.page);

  function processPageLinks(html, pageUrl, pageNumber) {
    const extracted = extractLinks(html, pageUrl, { skipQuotes, skipBots, decodeBase64 });
    for (const pw of (extracted.passwords || [])) allPasswords.add(pw);

    for (const { url: link, source } of extracted) {
      if (!shouldKeep(link, source, siteHost)) continue;
      const existing = byUrl.get(link);
      if (existing) {
        existing.count++;
        if (source === 'embed' && existing.source !== 'embed') {
          existing.source = 'embed';
          existing.kind = classify(link, 'embed');
        }
        continue;
      }
      if (byUrl.size >= MAX_LINKS) { truncated = true; continue; }
      byUrl.set(link, { url: link, host: hostOf(link), kind: classify(link, source), source, page: pageNumber, count: 1 });
    }
  }

  processPageLinks(firstPage.html, firstPage.url, threadInfo.page);

  // 2. Fetch remaining pages based on mode
  if (threadInfo.isThread && ['all', 'last', 'range'].includes(mode)) {
    let targetPages = [];
    if (mode === 'all') {
      const maxToCrawl = Math.min(detectedMaxPage, MAX_PAGES_LIMIT);
      for (let p = 1; p <= maxToCrawl; p++) targetPages.push(p);
    } else if (mode === 'last') {
      const n = Math.min(Math.max(parseInt(lastN, 10) || 3, 1), MAX_PAGES_LIMIT);
      const startP = Math.max(1, detectedMaxPage - n + 1);
      for (let p = startP; p <= detectedMaxPage; p++) targetPages.push(p);
    } else if (mode === 'range') {
      const s = Math.max(1, parseInt(startPage, 10) || 1);
      const e = Math.min(detectedMaxPage, Math.max(s, parseInt(endPage, 10) || detectedMaxPage));
      for (let p = s; p <= Math.min(e, s + MAX_PAGES_LIMIT - 1); p++) targetPages.push(p);
    }

    targetPages = targetPages.filter((p) => p !== threadInfo.page);

    for (const pNum of targetPages) {
      if (pages.length >= MAX_PAGES_LIMIT || byUrl.size >= MAX_LINKS) break;
      const pageUrl = getThreadPageUrl(threadInfo.baseUrl, pNum);
      if (visited.has(pageUrl)) continue;
      visited.add(pageUrl);
      if (delayMs > 0) await delay(delayMs);
      try {
        const page = await fetchPage(pageUrl, { cookies, fetchImpl, assertUrl });
        pages.push({ url: page.url, title: pageTitle(page.html), page: pNum });
        processPageLinks(page.html, page.url, pNum);
      } catch (err) {
        error = err.message;
        break;
      }
    }
  } else if (mode !== 'single') {
    let candidate = findNextPage(firstPage.html, firstPage.url);
    let next = candidate && hostOf(candidate) === siteHost ? candidate : null;

    while (next && pages.length < limit && !visited.has(next)) {
      visited.add(next);
      if (delayMs > 0) await delay(delayMs);
      let page;
      try {
        page = await fetchPage(next, { cookies, fetchImpl, assertUrl });
      } catch (err) {
        error = err.message;
        break;
      }
      const pageNumber = pages.length + 1;
      pages.push({ url: page.url, title: pageTitle(page.html), page: pageNumber });
      processPageLinks(page.html, page.url, pageNumber);

      const nextCand = findNextPage(page.html, page.url);
      next = nextCand && hostOf(nextCand) === siteHost ? nextCand : null;
    }
  }

  // 3. SQLite History check
  const historySet = new Set();
  if (!ignoreHistory) {
    try {
      const urls = [...byUrl.keys()];
      const chunkSize = 500;
      for (let i = 0; i < urls.length; i += chunkSize) {
        const slice = urls.slice(i, i + chunkSize);
        const placeholders = slice.map(() => '?').join(',');
        const rows = db.prepare(`SELECT url FROM linkgrabber_history WHERE url IN (${placeholders})`).all(...slice);
        for (const r of rows) historySet.add(r.url);
      }
    } catch {
      // Non-fatal if history query fails
    }
  }

  for (const item of byUrl.values()) {
    item.isNew = !historySet.has(item.url);
  }

  const allLinks = [...byUrl.values()];
  const newCount = allLinks.filter((l) => l.isNew).length;
  const historyCount = allLinks.length - newCount;

  return {
    pages,
    links: allLinks,
    passwords: [...allPasswords],
    newCount,
    historyCount,
    maxPage: detectedMaxPage,
    threadTitle: cleanThreadTitle(firstTitle),
    truncated,
    error,
    hasMorePages: Boolean(threadInfo.isThread ? detectedMaxPage > pages.length : (findNextPage(firstPage.html, firstPage.url) && !visited.has(findNextPage(firstPage.html, firstPage.url)))),
  };
}

// --- history ---------------------------------------------------------------------------

function recordCrawledLinks(urls, threadTitle = '', threadUrl = '') {
  const list = cleanUrls(urls);
  if (list.length === 0) return 0;
  const now = new Date().toISOString();
  let count = 0;
  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO linkgrabber_history (url, thread_title, thread_url, discovered_at)
      VALUES (?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const u of list) {
        const res = insert.run(u, threadTitle || '', threadUrl || '', now);
        if (res.changes > 0) count++;
      }
    })();
  } catch {
    // Non-fatal
  }
  return count;
}

function getHistoryStats() {
  try {
    const row = db.prepare('SELECT COUNT(*) as totalLinks, COUNT(DISTINCT thread_url) as totalThreads FROM linkgrabber_history').get();
    return {
      totalLinks: row?.totalLinks || 0,
      totalThreads: row?.totalThreads || 0,
    };
  } catch {
    return { totalLinks: 0, totalThreads: 0 };
  }
}

function clearHistory() {
  try {
    db.exec('DELETE FROM linkgrabber_history');
    return { ok: true };
  } catch (err) {
    throw new Error(`Failed to clear history: ${err.message}`);
  }
}

// --- senders ---------------------------------------------------------------------------

function cleanUrls(urls) {
  const list = (Array.isArray(urls) ? urls : []).map((u) => resolveUrl(String(u || ''), undefined)).filter(Boolean);
  return [...new Set(list)];
}

// JDownloader's Click'n'Load listener (port 9666).
async function sendToJDownloader(urls, { baseUrl, packageName, passwords, packagePerPage, urlMetadata, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error('JDownloader address is not configured');
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Invalid JDownloader URL');
  }

  if (parsed.port === '5800') {
    throw new Error(
      `Port 5800 is JDownloader's Web UI (noVNC). Click'n'Load requires port 9666. Map port 9666 in your NAS Docker container (e.g. -p 9666:9666) and configure address as http://${parsed.hostname}:9666`
    );
  }

  const endpoint = new URL('/flash/add', baseUrl).toString();
  const passwordStr = Array.isArray(passwords) ? passwords.join(',') : (typeof passwords === 'string' ? passwords : '');

  // Package per page mode
  if (packagePerPage && Array.isArray(urlMetadata) && urlMetadata.length > 0) {
    const metaMap = new Map();
    for (const m of urlMetadata) {
      if (m && m.url) metaMap.set(m.url, m.page || 1);
    }
    const byPage = new Map();
    for (const u of urls) {
      const p = metaMap.get(u) || 1;
      if (!byPage.has(p)) byPage.set(p, []);
      byPage.get(p).push(u);
    }

    let totalSent = 0;
    for (const [pageNum, pageUrls] of byPage) {
      const pkg = packageName ? `[Page ${pageNum}] ${packageName}` : `[Page ${pageNum}]`;
      const body = new URLSearchParams({ urls: pageUrls.join('\r\n'), source: 'yt-dlp-gui' });
      body.set('package', pkg);
      if (passwordStr) body.set('passwords', passwordStr);

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`JDownloader responded with HTTP ${res.status}`);
      totalSent += pageUrls.length;
      if (byPage.size > 1) await delay(250);
    }
    recordCrawledLinks(urls, packageName, baseUrl);
    return { sent: totalSent };
  }

  // Single package mode
  const body = new URLSearchParams({ urls: urls.join('\r\n'), source: 'yt-dlp-gui' });
  if (packageName) body.set('package', packageName);
  if (passwordStr) body.set('passwords', passwordStr);

  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`JDownloader responded with HTTP ${res.status}`);
  recordCrawledLinks(urls, packageName, baseUrl);
  return { sent: urls.length };
}

async function testJDownloaderConnection(baseUrl, { fetchImpl = fetch } = {}) {
  if (!baseUrl) throw new Error('JDownloader address is not configured');
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Invalid JDownloader URL');
  }

  // Detect if pointing to noVNC port 5800
  if (parsed.port === '5800') {
    try {
      const res = await fetchImpl(baseUrl, { signal: AbortSignal.timeout(3000) });
      const text = await res.text().catch(() => '');
      if (text.includes('noVNC') || text.includes('JDownloader')) {
        return {
          ok: false,
          isWebUi: true,
          message: `Port 5800 is JDownloader's Web UI (noVNC). Click'n'Load requires port 9666. Map port 9666 in your NAS Docker container (e.g. -p 9666:9666) and configure address as http://${parsed.hostname}:9666.`,
        };
      }
    } catch {
      // Fall through to general test
    }
  }

  const checkUrl = new URL('/jdcheck.js', baseUrl).toString();
  try {
    const res = await fetchImpl(checkUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      return { ok: true, message: `Connected to JDownloader (Click'n'Load active on ${parsed.host}).` };
    }
  } catch {
    // Some JDownloader setups reject /jdcheck.js but accept /flash/add
  }

  const addUrl = new URL('/flash/add', baseUrl).toString();
  try {
    const addRes = await fetchImpl(addUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'urls=',
      signal: AbortSignal.timeout(4000),
    });
    if (addRes.ok || addRes.status === 200 || addRes.status === 204) {
      return { ok: true, message: `Connected to JDownloader Click'n'Load on ${parsed.host}.` };
    }
    return { ok: false, message: `JDownloader responded with HTTP ${addRes.status}` };
  } catch (err) {
    return {
      ok: false,
      message: `Could not connect to JDownloader at ${baseUrl}: ${err.message}. If running in Docker on a NAS, ensure port 9666 is mapped and "RemoteAPI: Extern Interface Localhost Only" is disabled in JDownloader Advanced Settings.`,
    };
  }
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
  extractPasswords,
  extractBase64Links,
  stripQuotesAndBots,
  cleanThreadTitle,
  parseThreadUrl,
  getThreadPageUrl,
  detectMaxPage,
  findNextPage,
  unwrapRedirect,
  classify,
  crawl,
  cleanUrls,
  recordCrawledLinks,
  getHistoryStats,
  clearHistory,
  sendToJDownloader,
  testJDownloaderConnection,
  sendToAria2,
};
