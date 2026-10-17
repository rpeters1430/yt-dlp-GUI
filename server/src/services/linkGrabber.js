// Generic link grabber: fetches a web page (optionally following its rel="next" pagination,
// with cookies from a Netscape cookies.txt), collects the outbound links, embedded players and
// direct media files it contains, and hands a chosen set to a downloader — this app's own
// yt-dlp queue, JDownloader (Click'n'Load) or aria2 (JSON-RPC). It has no per-site scraping
// logic: anything a page links to is reported, grouped by host, and the user picks.
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const db = require('../db');
const ytdlp = require('./ytdlp');
const { COOKIES_FILE, CRAWLER_COOKIES_FILE, CONFIG_DIR } = require('./ytdlpPaths');
const { solveWithFlareSolverr, fetchWithCurlCffi, testSolverConnection } = require('./stealthFetch');

const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_LIMIT = 25;
const MAX_LINKS = 2000;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;
// Pause between page fetches so a multi-page crawl doesn't hammer the site.
const PAGE_DELAY_MS = 1500;
const FETCH_RETRIES = 2;
const RETRY_BASE_MS = 2000;
const MAX_RETRY_AFTER_MS = 30000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 520, 521, 522, 524]);
// Enough of an error page to recognise a Cloudflare challenge.
const ERROR_BODY_BYTES = 256 * 1024;
const USER_AGENT = process.platform === 'win32'
  ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

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
    let parts = line.split('\t');
    if (parts.length < 7) {
      // Fallback: split on whitespace (for copy-pasted or spaces-formatted Netscape cookies)
      // The first 6 tokens are domain, includeSubdomains, path, secure, expiry, name.
      // Token 7+ is the cookie value (which may contain spaces or symbols).
      const tokens = line.trim().split(/\s+/);
      if (tokens.length >= 6) {
        parts = [...tokens.slice(0, 6), tokens.slice(6).join(' ')];
      } else {
        continue;
      }
    }
    const name = parts[5];
    if (!name) continue;
    cookies.push({
      domain: parts[0].toLowerCase(),
      path: parts[2] || '/',
      secure: String(parts[3] || '').toUpperCase() === 'TRUE',
      expiry: Number(parts[4]) || 0,
      name,
      value: parts.length > 6 ? parts.slice(6).join('\t') : '',
    });
  }
  return cookies;
}

// Parses cookies from Netscape format, JSON array (Cookie-Editor format), or key=value headers.
function parseCookiesContent(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];

  // Try JSON (e.g. Cookie-Editor export)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([k, v]) => ({ name: k, value: String(v) }));
      const cookies = [];
      for (const item of list) {
        if (!item || !item.name) continue;
        cookies.push({
          domain: (item.domain || '').toLowerCase().replace(/^\./, ''),
          path: item.path || '/',
          secure: Boolean(item.secure),
          expiry: Number(item.expirationDate || item.expiry || 0),
          name: item.name,
          value: String(item.value ?? ''),
        });
      }
      if (cookies.length > 0) return cookies;
    } catch {
      // Fall through
    }
  }

  // Netscape cookies.txt
  const netscape = parseNetscapeCookies(trimmed);
  if (netscape.length > 0) return netscape;

  // Raw header fallback: "name=val; name2=val2"
  if (trimmed.includes('=')) {
    const cookies = [];
    for (const part of trimmed.split(';')) {
      const p = part.trim();
      if (!p || !p.includes('=')) continue;
      const [k, ...v] = p.split('=');
      cookies.push({
        domain: '',
        path: '/',
        secure: false,
        expiry: 0,
        name: k.trim(),
        value: v.join('=').trim(),
      });
    }
    if (cookies.length > 0) return cookies;
  }

  return [];
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
    const domain = (c.domain || '').replace(/^\./, '');
    if (domain && host !== domain && !host.endsWith(`.${domain}`)) continue;
    if (c.secure && parsed.protocol !== 'https:') continue;
    if (c.expiry === 1) continue;
    if (c.expiry && c.expiry < nowSec && !/^(__ddg|cf_|yMzi|xf_)/i.test(c.name)) continue;
    const cookiePath = c.path || '/';
    if (!(parsed.pathname === cookiePath || parsed.pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`))) continue;
    pairs.push(`${c.name}=${c.value}`);
  }
  return pairs.join('; ');
}

function getCrawlerCookiesStatus() {
  if (fs.existsSync(CRAWLER_COOKIES_FILE)) {
    try {
      const content = fs.readFileSync(CRAWLER_COOKIES_FILE, 'utf8');
      const cookies = parseCookiesContent(content);
      const domains = [...new Set(cookies.map((c) => c.domain).filter(Boolean))];
      return {
        configured: true,
        cookieCount: cookies.length,
        domains,
        hasFile: true,
      };
    } catch {
      return { configured: false, cookieCount: 0, domains: [] };
    }
  }
  // Check if global COOKIES_FILE exists as fallback
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const content = fs.readFileSync(COOKIES_FILE, 'utf8');
      const cookies = parseCookiesContent(content);
      const domains = [...new Set(cookies.map((c) => c.domain).filter(Boolean))];
      return {
        configured: false,
        fallbackAvailable: true,
        cookieCount: cookies.length,
        domains,
      };
    } catch {
      // ignore
    }
  }
  return { configured: false, cookieCount: 0, domains: [] };
}

function saveCrawlerCookies(content) {
  if (!content || typeof content !== 'string' || !content.trim()) {
    throw new Error('Cookie content is required');
  }
  const cookies = parseCookiesContent(content);
  if (cookies.length === 0) {
    throw new Error('No valid cookies found. Please paste Netscape cookies.txt or JSON cookie export.');
  }
  const dir = path.dirname(CRAWLER_COOKIES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CRAWLER_COOKIES_FILE, content.trim(), { mode: 0o600 });
  const domains = [...new Set(cookies.map((c) => c.domain).filter(Boolean))];
  return { ok: true, cookieCount: cookies.length, domains };
}

function deleteCrawlerCookies() {
  if (fs.existsSync(CRAWLER_COOKIES_FILE)) {
    fs.unlinkSync(CRAWLER_COOKIES_FILE);
  }
  return { ok: true };
}

// Cookies pasted for one crawl replace the saved ones rather than adding to them. Saved cookies
// come from the crawler's own file, else the global cookies.txt, and only when useSavedCookies.
// A cookie with no domain (pasted as a "name=val; ..." header) is scoped to the crawled site,
// so a redirect to another host can't carry it along.
function loadCookies({ cookiesText, useSavedCookies, siteHost }) {
  let cookies = cookiesText ? parseCookiesContent(cookiesText) : [];
  if (cookies.length === 0 && useSavedCookies) {
    const candidateFiles = [
      CRAWLER_COOKIES_FILE,
      COOKIES_FILE,
      path.resolve(path.dirname(CONFIG_DIR), 'crawler', 'cookies.txt'),
    ];
    const file = candidateFiles.find((f) => fs.existsSync(f));
    if (file) cookies = parseCookiesContent(fs.readFileSync(file, 'utf8'));
  }
  return cookies.map((c) => (c.domain ? c : { ...c, domain: siteHost }));
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

const BARE_HOST_REGEX = /\b((?:(?:https?:\/\/)?(?:[a-z0-9-]+\.)?(?:pixeldrain\.com|gofile\.io|turbo\.cr|saint2\.su|1fichier\.com|rapidgator\.net|mediafire\.com|krakenfiles\.com|workupload\.com|send\.cm|qiwi\.gg|terabox\.com|teraboxapp\.com|katfile\.com|filecrypt\.(?:cc|co)|buzzheavier\.com|fastupload\.io|catbox\.moe|quax\.is|mega\.(?:nz|co\.nz)|(?:bunkr|filester|cyberdrop)\.[a-z]{2,8}))\/[^\s"'<>()[\]{}]+)/gi;

// \b keeps words like "bypass:" and "compass =" from reading as a password label.
const PASSWORD_PATTERNS = [
  /\b(?:archive\s*)?pass(?:word)?\s*(?:is|:|=)\s*["']([^"'\n<]{2,60})["']/gi,
  /\bpw\s*(?:is|:|=)\s*["']([^"'\n<]{2,60})["']/gi,
  /\b(?:archive\s*)?pass(?:word)?\s*(?:is|:|=)\s*["']?([^\s"'\n<>]+)/gi,
  /\bpw\s*(?:is|:|=)\s*["']?([^\s"'\n<>]+)/gi,
  /\bpass\s*(?:is|:|=)\s*["']?([^\s"'\n<>]+)/gi,
  /contrase[ñn]a\s*(?:is|:|=)\s*["']?([^\s"'\n<>]+)/gi,
  /mot\s*de\s*passe\s*(?:is|:|=)\s*["']?([^\s"'\n<>]+)/gi,
];

const IGNORE_PASSWORDS = new Set([
  'none', 'n/a', 'no', 'required', 'protected', 'unknown', 'null', 'false', 'true',
  'password', 'pass', 'pw', 'yes', 'link', 'download', 'here', 'mega', 'pixeldrain', 'forgot',
]);

function extractPasswords(text) {
  if (!text) return [];
  const found = new Set();
  for (const pat of PASSWORD_PATTERNS) {
    for (const m of text.matchAll(pat)) {
      const clean = m[1].replace(/^[.,;:"'!?[\]()]+|[.,;:"'!?[\]()]+$/g, '');
      if (clean && clean.length >= 2 && !IGNORE_PASSWORDS.has(clean.toLowerCase()) && !clean.startsWith('http')) {
        found.add(clean);
      }
    }
  }
  return [...found];
}

const BASE64_PATTERN = /(?:[A-Za-z0-9+/_-]{4}){4,}(?:[A-Za-z0-9+/_-]{2}==|[A-Za-z0-9+/_-]{3}=)?/g;

function extractBase64Links(text) {
  if (!text) return [];
  const found = [];
  const matches = text.match(BASE64_PATTERN) || [];
  for (const candidate of matches) {
    if (candidate.length < 16) continue;
    try {
      const normalized = candidate.replace(/-/g, '+').replace(/_/g, '/');
      const padLen = (-normalized.length % 4 + 4) % 4;
      const padded = normalized + '='.repeat(padLen);
      const decoded = Buffer.from(padded, 'base64').toString('utf8');
      for (const m of decoded.matchAll(/https?:\/\/[^\s"'<>()[\]{}]+/gi)) {
        const clean = m[0].replace(/[.,;:!?]+$/, '');
        if (clean && !found.includes(clean)) {
          found.push(clean);
        }
      }
      for (const m of decoded.matchAll(BARE_HOST_REGEX)) {
        let clean = m[1].replace(/[.,;:!?]+$/, '');
        if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
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

// Automated mirror re-upload accounts whose posts only repeat links from earlier posts.
const BOT_AUTHORS = new Set(['sussybot']);
// XenForo's post container. Pages without one are read whole, minus PAGE_CHROME.
const POST_SELECTOR = 'article.message--post';
const QUOTE_SELECTOR = '.bbCodeBlock--quote, blockquote';
// Site furniture and signatures: their links (ads, socials, "similar threads") are never the
// content being grabbed.
const PAGE_CHROME = 'header, nav, footer, aside, .message-signature, .p-breadcrumbs, .block--similarContents';

// Quotes go so a reply quoting the OP doesn't re-list its links; nested quotes go with them.
function removeQuotesAndBots($, { skipQuotes, skipBots }) {
  if (skipQuotes) $(QUOTE_SELECTOR).remove();
  if (skipBots) {
    $('article[data-author]')
      .filter((_, el) => BOT_AUTHORS.has(String($(el).attr('data-author')).trim().toLowerCase()))
      .remove();
  }
}

function stripQuotesAndBots(html, { skipQuotes = true, skipBots = true } = {}) {
  const $ = cheerio.load(html);
  removeQuotesAndBots($, { skipQuotes, skipBots });
  return $.html();
}

// XenForo marks a post as data-content="post-123" (id="js-post-123" on older themes).
function postInfo($post) {
  const raw = $post.attr('data-content') || $post.attr('id') || '';
  const id = (raw.match(/post-(\d+)/) || [])[1] || '';
  return { postId: id, author: String($post.attr('data-author') || '').trim() };
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

// Only /page-N links under `baseUrl` count, so a post linking another thread's page 400
// doesn't inflate this thread's page count.
function detectMaxPage(html, currentPage = 1, baseUrl = '') {
  const pages = [currentPage];
  for (const m of html.matchAll(/class="[^"]*(?:pageNav-page|pageNav-main)[^"]*"[^>]*>(\d+)</gi)) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 0 && n < 100000) pages.push(n);
  }
  let threadPath = '';
  try {
    threadPath = new URL(baseUrl).pathname.replace(/\/+$/, '');
  } catch {
    // No base URL: the pageNav markup above is all there is to go on
  }
  if (!threadPath) return Math.max(...pages);
  const escaped = threadPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of html.matchAll(new RegExp(`${escaped}/page-(\\d+)["'/?#]`, 'gi'))) {
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

// Returns [{ url, source, postId, author, passwords }] where source is 'embed'
// (iframe/video/audio/source/embed or a data-* media attribute), 'link' (an <a href>),
// 'text' (a bare URL in the text) or 'base64' (a decoded URL). On a forum page each link
// carries the post it came from and the passwords given in that post; elsewhere postId and
// author are ''. All passwords found are also attached as `links.passwords = [...]`.
function extractLinks(html, baseUrl, options = {}) {
  const { skipQuotes = true, skipBots = true, decodeBase64 = true } = options;
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  removeQuotesAndBots($, { skipQuotes, skipBots });
  $(PAGE_CHROME).remove();

  const pageHost = hostOf(baseUrl);
  // Only the site's own links can be redirect wrappers; an outbound link's query string
  // (e.g. ?ref=https://...) is left alone.
  const unwrapOwn = (url) => (hostOf(url) === pageHost ? unwrapRedirect(url) : url);
  const posts = $(POST_SELECTOR).toArray();
  const blocks = posts.length ? posts.map((el) => $(el)) : [$.root()];
  const found = [];
  const allPasswords = new Set();

  for (const $block of blocks) {
    const info = posts.length ? postInfo($block) : { postId: '', author: '' };
    // Tags become spaces so "Password: abc<br>Mirror" doesn't read as one word.
    const text = decodeEntities(($block.html() || '').replace(/<[^>]+>/g, ' '));
    const passwords = extractPasswords(text);
    for (const pw of passwords) allPasswords.add(pw);
    const seen = new Set();
    const add = (url, source) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      found.push({ url, source, ...info, passwords });
    };

    $block.find('iframe, video, audio, source, embed').each((_, el) => {
      for (const name of ['src', 'data-src', 'data-url', 'data-video']) add(resolveUrl($(el).attr(name), baseUrl), 'embed');
    });
    // Lazy-loaded players and XenForo media wrappers keep their URL in a data attribute.
    $block.find('[data-url], [data-src], [data-href], [data-video]').each((_, el) => {
      for (const name of ['data-url', 'data-src', 'data-href', 'data-video']) {
        const url = resolveUrl($(el).attr(name), baseUrl);
        if (url) add(unwrapOwn(url), 'embed');
      }
    });
    $block.find('a[href]').each((_, el) => {
      const url = resolveUrl($(el).attr('href'), baseUrl);
      if (url) add(unwrapOwn(url), 'link');
    });

    for (const m of text.matchAll(/https?:\/\/[^\s"'<>()[\]{}]+/gi)) {
      add(resolveUrl(m[0].replace(/[.,;:!?]+$/, ''), baseUrl), 'text');
    }
    // Known hoster URLs written without a scheme (gofile.io/d/..., pixeldrain.com/u/...).
    for (const m of text.matchAll(BARE_HOST_REGEX)) {
      const raw = m[1].replace(/[.,;:!?]+$/, '');
      add(resolveUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`, baseUrl), 'text');
    }
    if (decodeBase64) {
      for (const b64Url of extractBase64Links(text)) {
        const url = resolveUrl(b64Url, baseUrl);
        if (url) add(unwrapOwn(url), 'base64');
      }
    }
  }

  found.passwords = [...allPasswords];
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

// File hosts: what a forum thread's links are usually for, as opposed to socials, shops and
// the like. Drives the "File hosts only" filter and thread watches' default filter.
const KNOWN_HOSTERS = [
  'mega.nz', 'mega.co.nz', 'pixeldrain.com', 'gofile.io', 'saint2.su', '1fichier.com', 'rapidgator.net',
  'mediafire.com', 'drive.google.com', 'dropbox.com', 'krakenfiles.com', 'workupload.com', 'send.cm', 'qiwi.gg',
  'terabox.com', 'teraboxapp.com', 'katfile.com', 'coomer.su', 'coomer.party', 'kemono.su', 'kemono.party',
  'filedm.com', 'streamtape.com', 'doodstream.com', 'vidoza.net', 'turbo.cr', 'filecrypt.cc', 'filecrypt.co',
  'buzzheavier.com', 'fastupload.io', 'catbox.moe', 'quax.is',
];
// Hosts that rotate through TLDs (bunkr.si, bunkr.fi, bunkr.black, ...): one file, many URLs.
const MIRROR_FAMILY = /^(?:[a-z0-9-]+\.)*(bunkrr?|cyberdrop|filester)\.[a-z]{2,8}$/;

function isKnownHoster(host) {
  return MIRROR_FAMILY.test(host) || KNOWN_HOSTERS.some((h) => host === h || host.endsWith(`.${h}`));
}

// One key per file, for de-duplication and history: the scheme, www., a trailing slash,
// tracking parameters and a mirror family's current TLD don't make it a different file.
function canonicalUrl(url) {
  let u;
  try { u = new URL(url); } catch { return String(url); }
  let host = u.hostname.toLowerCase().replace(/^www\./, '');
  const family = host.match(MIRROR_FAMILY);
  if (family) host = family[1] === 'bunkrr' ? 'bunkr' : family[1];
  for (const key of [...u.searchParams.keys()]) {
    if (/^(?:utm_.*|fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
  }
  const query = u.searchParams.toString();
  const pathname = u.pathname.replace(/\/+$/, '') || '/';
  return `${host}${u.port ? `:${u.port}` : ''}${pathname}${query ? `?${query}` : ''}`;
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

// Rejects with the signal's reason as soon as it aborts, so a cancelled crawl doesn't sit out
// its politeness delay.
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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

// A Cloudflare interstitial ("Just a moment...") rather than the forum's own error page.
function isCloudflareChallenge(res, body) {
  if (res.headers.get('cf-mitigated') === 'challenge') return true;
  if (!/cloudflare/i.test(res.headers.get('server') || '')) return false;
  return /<title>\s*Just a moment|challenge-platform|cf-chl-|cf_chl_/i.test(body);
}

// DDoS-Guard's own check page, as opposed to a site behind it answering 403 itself.
function isDdosGuardChallenge(res, body) {
  if (!/ddos-guard/i.test(res.headers.get('server') || '')) return false;
  return /<title>\s*DDoS-Guard|check\.ddos-guard|ddos-guard\.net\/(?:js|static)/i.test(body);
}

// Cookies a site sets during a crawl (DDoS-Guard's __ddg*, a refreshed XenForo session) are
// kept for the rest of that crawl, as a browser would. They're never written to the saved file.
function rememberSetCookies(cookies, res, url) {
  const headers = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (!headers.length) return;
  const host = new URL(url).hostname.toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);
  for (const header of headers) {
    const [pair, ...attrs] = header.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const cookie = { domain: host, path: '/', secure: false, expiry: 0, name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
    let foreign = false;
    let maxAge = null;
    for (const attr of attrs) {
      const [rawKey, ...rest] = attr.split('=');
      const key = rawKey.trim().toLowerCase();
      const val = rest.join('=').trim();
      if (key === 'domain' && val) {
        const d = val.replace(/^\./, '').toLowerCase();
        // A host may set cookies for itself or a parent domain, never for another site.
        if (d.includes('.') && (host === d || host.endsWith(`.${d}`))) cookie.domain = d;
        else foreign = true;
      } else if (key === 'path' && val.startsWith('/')) {
        cookie.path = val;
      } else if (key === 'secure') {
        cookie.secure = true;
      } else if (key === 'max-age' && Number.isFinite(Number(val))) {
        maxAge = Number(val);
      } else if (key === 'expires') {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) cookie.expiry = Math.max(1, Math.floor(t / 1000));
      }
    }
    if (foreign) continue;
    // Max-Age wins over Expires; zero or less deletes the cookie (an expiry in the past does too).
    if (maxAge !== null) cookie.expiry = maxAge > 0 ? nowSec + maxAge : 1;
    const i = cookies.findIndex((c) => c.name === cookie.name && (c.domain || '').replace(/^\./, '') === cookie.domain && (c.path || '/') === cookie.path);
    if (i >= 0) cookies[i] = cookie;
    else cookies.push(cookie);
  }
}

function rememberSolverCookies(cookies, newCookies) {
  if (!Array.isArray(newCookies)) return;
  for (const nc of newCookies) {
    if (!nc || !nc.name) continue;
    const domain = (nc.domain || '').replace(/^\./, '').toLowerCase();
    const cookie = {
      name: nc.name,
      value: String(nc.value ?? ''),
      domain,
      path: nc.path || '/',
      secure: Boolean(nc.secure),
      expiry: typeof nc.expiry === 'number' ? nc.expiry : 0,
    };
    const i = cookies.findIndex((c) => c.name === cookie.name && (!cookie.domain || (c.domain || '').replace(/^\./, '') === cookie.domain));
    if (i >= 0) cookies[i] = cookie;
    else cookies.push(cookie);
  }
}

// What a 403 most likely means, from the cookies that went with the request.
function forbiddenMessage(url, cookieHeader) {
  const host = new URL(url).host;
  const names = cookieHeader ? cookieHeader.split('; ').map((p) => p.split('=')[0]) : [];
  if (!names.length) {
    return `HTTP 403 from ${host}: no cookies for ${host} were sent, so it treated the crawler as a guest. `
      + `Save cookies exported from ${host} while logged in under Crawler cookies, and keep "Use saved cookies" ticked `
      + '(cookies exported from an old domain of the site don\'t count).';
  }
  const xenforo = names.some((n) => n.startsWith('xf_'));
  const login = names.includes('xf_user');
  return `HTTP 403 from ${host} with ${names.length} cookie${names.length === 1 ? '' : 's'} sent (${names.slice(0, 8).join(', ')}${names.length > 8 ? ', ...' : ''}). `
    + (xenforo && !login
      ? 'There is no xf_user among them, the cookie that keeps you logged in: sign in with "Stay logged in" ticked, then export again.'
      : 'They have probably expired or been signed out: sign in again in your browser and export fresh ones.');
}

// Retry-After is seconds or an HTTP date; anything else falls back to backoff.
function retryAfterMs(res) {
  const value = res.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

// Rate limits, server errors and network failures are retried with backoff. A Cloudflare
// 403/503 isn't: it's a challenge, and asking again only gets the same challenge.
async function requestWithRetry(url, init, { fetchImpl, retryBaseMs, signal }) {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= FETCH_RETRIES;
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      if (last) throw new Error(`Could not fetch ${url}: ${err.message}`, { cause: err });
      await delay(retryBaseMs * 2 ** attempt, signal);
      continue;
    }
    const challenge = /cloudflare/i.test(res.headers.get('server') || '') && (res.status === 403 || res.status === 503);
    if (last || challenge || !RETRY_STATUSES.has(res.status)) return res;
    const wait = retryAfterMs(res) ?? retryBaseMs * 2 ** attempt;
    await res.body?.cancel();
    await delay(Math.min(wait, MAX_RETRY_AFTER_MS), signal);
  }
}

// Follows redirects by hand so every hop passes the SSRF guard and gets only its own cookies.
async function fetchPage(url, {
  cookies, fetchImpl = fetch, assertUrl = ytdlp.assertPublicUrlResolved, userAgent, retryBaseMs = RETRY_BASE_MS, signal, solverUrl, referer,
}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrl(current);
    const headers = {
      'User-Agent': userAgent || USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };
    if (referer) headers.Referer = referer;
    const cookieHeader = cookieHeaderFor(cookies, current);
    if (cookieHeader) headers.Cookie = cookieHeader;
    const res = await requestWithRetry(current, { headers, redirect: 'manual' }, { fetchImpl, retryBaseMs, signal });
    rememberSetCookies(cookies, res, current);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    if (!res.ok) {
      const body = await readCapped(res, ERROR_BODY_BYTES).catch(() => '');
      const cfChallenge = isCloudflareChallenge(res, body);
      const ddgChallenge = isDdosGuardChallenge(res, body);

      // Attempt challenge solving via Solverr or stealth curl_cffi fallback
      if (cfChallenge || ddgChallenge || res.status === 403 || res.status === 503) {
        if (solverUrl) {
          try {
            const solved = await solveWithFlareSolverr(solverUrl, current, cookies, { signal });
            if (solved && solved.html) {
              rememberSolverCookies(cookies, solved.cookies);
              return { url: solved.url, html: solved.html };
            }
          } catch (solverErr) {
            console.warn(`[linkgrabber] solver at ${solverUrl} failed: ${solverErr.message}`);
          }
        }
        try {
          const stealth = await fetchWithCurlCffi(current, { headers, cookies, signal });
          if (stealth && stealth.status >= 200 && stealth.status < 300 && stealth.html) {
            rememberSolverCookies(cookies, stealth.cookies);
            return { url: current, html: stealth.html };
          }
        } catch { /* curl_cffi not available or failed */ }
      }

      if (cfChallenge) {
        throw new Error(
          `Cloudflare challenge on ${new URL(current).host}. Export fresh cookies (including cf_clearance) from your browser, `
          + 'and set the crawler User-Agent to that browser\'s exact User-Agent: Cloudflare only honours cf_clearance from the browser it was issued to.'
          + (solverUrl ? '' : ' Or configure a Challenge Solver (FlareSolverr/Solverr) URL in Settings.')
        );
      }
      if (ddgChallenge) {
        throw new Error(
          `DDoS-Guard check on ${new URL(current).host}. Export fresh cookies (including the __ddg ones) from your browser, `
          + 'and set the crawler User-Agent to that browser\'s exact User-Agent.'
          + (solverUrl ? '' : ' Or configure a Challenge Solver (FlareSolverr/Solverr) URL in Settings.')
        );
      }
      if (res.status === 403) throw new Error(forbiddenMessage(current, cookieHeader));
      throw new Error(`HTTP ${res.status} fetching ${current}`);
    }
    const type = res.headers.get('content-type') || '';
    if (type && !/html|xml|text\/plain/i.test(type)) throw new Error(`Not a web page (${type.split(';')[0]})`);
    return { url: current, html: await readCapped(res, MAX_PAGE_BYTES) };
  }
  throw new Error('Too many redirects');
}

const CANCELLED = 'Cancelled';

// Crawls `url` and following pages based on mode ('follow' | 'all' | 'last' | 'range' | 'single').
// Returns { pages, links, passwords, newCount, historyCount, maxPage, threadTitle, truncated, error,
// cancelled, hasMorePages }. `onPage` hears about each page as it's read; aborting `signal` stops
// the crawl and keeps what it found so far (error 'Cancelled'), unless it was still on the first page.
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
  userAgent = '',
  retryBaseMs,
  signal,
  onPage = () => {},
  solverUrl = '',
}) {
  const startUrl = resolveUrl(ytdlp.normalizeUrl(url), undefined);
  if (!startUrl) throw new Error('A valid http(s) URL is required');
  const limit = Math.min(Math.max(parseInt(maxPages, 10) || DEFAULT_MAX_PAGES, 1), MAX_PAGES_LIMIT);
  const siteHost = hostOf(startUrl);
  const cookies = loadCookies({ cookiesText, useSavedCookies, siteHost });
  const fetchOpts = { cookies, fetchImpl, assertUrl, userAgent, retryBaseMs, signal, solverUrl };
  const threadInfo = parseThreadUrl(startUrl);

  const pages = [];
  // Keyed by canonicalUrl, so a file linked through two mirror domains is listed once.
  const byKey = new Map();
  const visited = new Set();
  const allPasswords = new Set();
  const pagePasswords = {};
  let truncated = false;
  let error = null;
  let pagesPlanned = 1;
  const failed = (err) => (signal?.aborted ? CANCELLED : err.message);

  // 1. Fetch initial page
  const firstPage = await fetchPage(startUrl, fetchOpts);
  visited.add(firstPage.url);
  visited.add(startUrl);

  const firstTitle = pageTitle(firstPage.html);
  const detectedMaxPage = detectMaxPage(firstPage.html, threadInfo.page, threadInfo.isThread ? threadInfo.baseUrl : '');

  function addPage(page, pageNumber) {
    pages.push({ url: page.url, title: pageTitle(page.html), page: pageNumber });
    const extracted = extractLinks(page.html, page.url, { skipQuotes, skipBots, decodeBase64 });
    for (const pw of (extracted.passwords || [])) {
      allPasswords.add(pw);
      pagePasswords[pageNumber] = [...new Set([...(pagePasswords[pageNumber] || []), pw])];
    }

    for (const { url: link, source, postId, author, passwords } of extracted) {
      if (!shouldKeep(link, source, siteHost)) continue;
      const key = canonicalUrl(link);
      const existing = byKey.get(key);
      if (existing) {
        existing.count++;
        if (source === 'embed' && existing.source !== 'embed') {
          existing.source = 'embed';
          existing.kind = classify(existing.url, 'embed');
        }
        continue;
      }
      if (byKey.size >= MAX_LINKS) { truncated = true; continue; }
      const host = hostOf(link);
      // The first post a link appears in is where it was shared; later ones are reposts.
      byKey.set(key, {
        url: link, host, hoster: isKnownHoster(host), kind: classify(link, source), source, page: pageNumber, count: 1, postId, author, passwords,
      });
    }
    onPage({ page: pageNumber, pagesDone: pages.length, pagesPlanned, links: byKey.size, title: cleanThreadTitle(firstTitle) });
  }

  // 2. Fetch remaining pages based on mode
  const threadMode = threadInfo.isThread && ['all', 'last', 'range'].includes(mode);
  let hasMorePages;
  if (threadMode) {
    // Every page the mode asks for, before the per-crawl cap; whatever isn't crawled from it
    // (cap, link limit or a failed page) is what hasMorePages reports.
    const requested = [];
    if (mode === 'all') {
      for (let p = 1; p <= detectedMaxPage; p++) requested.push(p);
    } else if (mode === 'last') {
      const n = Math.min(Math.max(parseInt(lastN, 10) || 3, 1), MAX_PAGES_LIMIT);
      for (let p = Math.max(1, detectedMaxPage - n + 1); p <= detectedMaxPage; p++) requested.push(p);
    } else {
      const s = Math.max(1, parseInt(startPage, 10) || 1);
      if (s > detectedMaxPage) {
        throw new Error(`Page ${s} is past the end of the thread (it has ${detectedMaxPage} page${detectedMaxPage === 1 ? '' : 's'})`);
      }
      const e = Math.min(detectedMaxPage, Math.max(s, parseInt(endPage, 10) || detectedMaxPage));
      for (let p = s; p <= e; p++) requested.push(p);
    }
    let targetPages = requested.slice(0, MAX_PAGES_LIMIT);
    pagesPlanned = targetPages.length;

    // The first page was only fetched to find the page count; its links count only when it
    // is one of the requested pages.
    if (targetPages.includes(threadInfo.page)) addPage(firstPage, threadInfo.page);
    targetPages = targetPages.filter((p) => p !== threadInfo.page);

    for (const pNum of targetPages) {
      if (pages.length >= MAX_PAGES_LIMIT || byKey.size >= MAX_LINKS) break;
      const pageUrl = getThreadPageUrl(threadInfo.baseUrl, pNum);
      if (visited.has(pageUrl)) continue;
      visited.add(pageUrl);
      try {
        if (delayMs > 0) await delay(delayMs, signal);
        addPage(await fetchPage(pageUrl, { ...fetchOpts, referer: firstPage.url }), pNum);
      } catch (err) {
        error = failed(err);
        break;
      }
    }
    const crawledPages = new Set(pages.map((p) => p.page));
    hasMorePages = requested.some((p) => !crawledPages.has(p));
  } else {
    pagesPlanned = mode === 'single' ? 1 : limit;
    addPage(firstPage, threadInfo.page);

    const sameSiteNext = (html, pageUrl) => {
      const candidate = findNextPage(html, pageUrl);
      return candidate && hostOf(candidate) === siteHost ? candidate : null;
    };
    let next = sameSiteNext(firstPage.html, firstPage.url);
    let lastPage = threadInfo.page;
    while (mode !== 'single' && next && pages.length < limit && !visited.has(next)) {
      visited.add(next);
      let page;
      try {
        if (delayMs > 0) await delay(delayMs, signal);
        page = await fetchPage(next, { ...fetchOpts, referer: page ? page.url : firstPage.url });
      } catch (err) {
        error = failed(err);
        break;
      }
      // A thread's own page numbers, so a crawl started on page 27 labels the next one 28.
      const pageNumber = threadInfo.isThread ? parseThreadUrl(page.url).page : pages.length + 1;
      addPage(page, pageNumber);
      lastPage = pageNumber;
      next = sameSiteNext(page.html, page.url);
    }
    hasMorePages = Boolean(next && !visited.has(next)) || (threadInfo.isThread && detectedMaxPage > lastPage);
  }

  // 3. History check
  const allLinks = [...byKey.values()];
  if (ignoreHistory) {
    for (const item of allLinks) item.isNew = true;
  } else {
    markHistory(allLinks);
  }
  const newCount = allLinks.filter((l) => l.isNew).length;

  return {
    pages,
    links: allLinks,
    passwords: [...allPasswords],
    pagePasswords,
    newCount,
    historyCount: allLinks.length - newCount,
    maxPage: detectedMaxPage,
    threadUrl: threadInfo.isThread ? threadInfo.baseUrl : firstPage.url,
    threadTitle: cleanThreadTitle(firstTitle),
    truncated,
    error,
    cancelled: error === CANCELLED,
    hasMorePages,
  };
}

// --- history ---------------------------------------------------------------------------

// Rows from before the canonical column (and the Python crawler's imported history) get their
// key computed once, in JS, since SQL can't apply canonicalUrl.
let historyKeysReady = false;
function ensureHistoryKeys() {
  if (historyKeysReady) return;
  const rows = db.prepare('SELECT url FROM linkgrabber_history WHERE canonical IS NULL').all();
  if (rows.length) {
    const update = db.prepare('UPDATE linkgrabber_history SET canonical = ? WHERE url = ?');
    db.transaction(() => { for (const r of rows) update.run(canonicalUrl(r.url), r.url); })();
  }
  historyKeysReady = true;
}

// Sets isNew on each link: false when the same file (by canonicalUrl) was sent or copied before.
function markHistory(links) {
  const seen = new Set();
  try {
    ensureHistoryKeys();
    const keys = [...new Set(links.map((l) => canonicalUrl(l.url)))];
    for (let i = 0; i < keys.length; i += 500) {
      const slice = keys.slice(i, i + 500);
      const rows = db.prepare(`SELECT canonical FROM linkgrabber_history WHERE canonical IN (${slice.map(() => '?').join(',')})`).all(...slice);
      for (const r of rows) seen.add(r.canonical);
    }
  } catch (err) {
    console.error(`[linkgrabber] History lookup failed: ${err.message}`);
  }
  for (const l of links) l.isNew = !seen.has(canonicalUrl(l.url));
  return links;
}

function recordCrawledLinks(urls, threadTitle = '', threadUrl = '') {
  const list = cleanUrls(urls);
  if (list.length === 0) return 0;
  const now = new Date().toISOString();
  let count = 0;
  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO linkgrabber_history (url, canonical, thread_title, thread_url, discovered_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const u of list) {
        const res = insert.run(u, canonicalUrl(u), threadTitle || '', threadUrl || '', now);
        if (res.changes > 0) count++;
      }
    })();
  } catch (err) {
    console.error(`[linkgrabber] Could not record history: ${err.message}`);
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
    throw new Error(`Failed to clear history: ${err.message}`, { cause: err });
  }
}

// --- senders ---------------------------------------------------------------------------

function cleanUrls(urls) {
  const list = (Array.isArray(urls) ? urls : []).map((u) => resolveUrl(String(u || ''), undefined)).filter(Boolean);
  return [...new Set(list)];
}

// JDownloader's Click'n'Load listener (port 9666).
// In package-per-page mode each package gets its own page's passwords when `pagePasswords`
// ({ [page]: [...] }) is given, and each page is recorded in history as soon as it is accepted.
async function sendToJDownloader(urls, { baseUrl, packageName, passwords, packagePerPage, urlMetadata, pagePasswords, threadUrl = '', fetchImpl = fetch }) {
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
  const joinPasswords = (pws) => (Array.isArray(pws) ? pws.filter((p) => typeof p === 'string').join(',') : (typeof pws === 'string' ? pws : ''));
  const passwordStr = joinPasswords(passwords);
  const perPagePasswords = pagePasswords && typeof pagePasswords === 'object' && !Array.isArray(pagePasswords) ? pagePasswords : null;

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
      const pagePw = perPagePasswords ? joinPasswords(perPagePasswords[pageNum]) : passwordStr;
      if (pagePw) body.set('passwords', pagePw);

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const sentNote = totalSent ? ` after ${totalSent} of ${urls.length} links were sent` : '';
        throw new Error(`JDownloader responded with HTTP ${res.status}${sentNote}`);
      }
      recordCrawledLinks(pageUrls, packageName, threadUrl);
      totalSent += pageUrls.length;
      if (byPage.size > 1) await delay(250);
    }
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
  recordCrawledLinks(urls, packageName, threadUrl);
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
  // multicall answers in call order: each entry is [gid] or a fault.
  const results = Array.isArray(data.result) ? data.result : [];
  const failed = results.filter((r) => r && r.faultString).map((r) => r.faultString);
  const accepted = urls.filter((u, i) => results[i] && !results[i].faultString);
  return { sent: results.length - failed.length, failed, accepted };
}

function resolveDirectDownloadUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const pdMatch = url.match(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)?pixeldrain\.com\/u\/([a-zA-Z0-9_-]+)/i);
  if (pdMatch) {
    return `https://pixeldrain.com/api/file/${pdMatch[1]}?download`;
  }
  return url;
}

module.exports = {
  DEFAULT_MAX_PAGES,
  MAX_PAGES_LIMIT,
  MAX_LINKS,
  parseNetscapeCookies,
  parseCookiesContent,
  cookieHeaderFor,
  getCrawlerCookiesStatus,
  saveCrawlerCookies,
  deleteCrawlerCookies,
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
  hostOf,
  isKnownHoster,
  canonicalUrl,
  crawl,
  cleanUrls,
  markHistory,
  recordCrawledLinks,
  getHistoryStats,
  clearHistory,
  sendToJDownloader,
  testJDownloaderConnection,
  testSolverConnection,
  sendToAria2,
  resolveDirectDownloadUrl,
};
