const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const siteProfiles = require('./siteProfiles');

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '..', '..', 'downloads');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
const COOKIES_FILE = path.join(CONFIG_DIR, 'cookies.txt');
const YTDLP_CACHE_DIR = path.join(CONFIG_DIR, 'yt-dlp-cache');
const CUSTOM_BIN_DIR = path.join(CONFIG_DIR, 'bin');
const FFMPEG_BUILD_MARKER = path.join(CONFIG_DIR, 'ffmpeg-build-id');
const DENO_BUILD_MARKER = path.join(CONFIG_DIR, 'deno-build-id');

// Ensure custom/persisted bin dir is in process.env.PATH if it exists
if (fs.existsSync(CUSTOM_BIN_DIR)) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  if (!paths.includes(CUSTOM_BIN_DIR)) {
    process.env.PATH = `${CUSTOM_BIN_DIR}${path.delimiter}${process.env.PATH}`;
  }
}

function getDenoBin() {
  const binName = process.platform === 'win32' ? 'deno.exe' : 'deno';
  if (fs.existsSync(path.join(CUSTOM_BIN_DIR, binName))) {
    return path.join(CUSTOM_BIN_DIR, binName);
  }
  return 'deno';
}

function getFfmpegDir() {
  if (process.env.FFMPEG_DIR) return process.env.FFMPEG_DIR;
  const binName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (fs.existsSync(path.join(CUSTOM_BIN_DIR, binName))) {
    return CUSTOM_BIN_DIR;
  }
  return null;
}

function getFfmpegBin() {
  const dir = getFfmpegDir();
  if (dir) {
    const binName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    return path.join(dir, binName);
  }
  return 'ffmpeg';
}

// If a cookies.txt (Netscape format) has been saved via Settings, pass it to yt-dlp so
// age-restricted/members-only/private videos work. Absent by default.
function cookieArgs() {
  return fs.existsSync(COOKIES_FILE) ? ['--cookies', COOKIES_FILE] : [];
}

// The Twitch auth-token is stored as a real cookie in the shared cookies.txt rather than
// injected via --add-header, because yt-dlp's own Twitch extractor authenticates by reading
// self._get_cookies('https://gql.twitch.tv').get('auth-token') — confirmed by reading
// yt-dlp's installed twitch.py source. A header only happened to work before because of an
// incidental header-merge order, not because it's what the extractor actually reads. Storing
// it as a cookie also means it rides the same --cookies file every other site's cookies use,
// so cookieArgs()/commonArgs() cover it automatically with no Twitch-specific args needed.
const TWITCH_AUTH_COOKIE_DOMAIN = '.twitch.tv';
const TWITCH_AUTH_COOKIE_NAME = 'auth-token';

function readCookieLines() {
  if (!fs.existsSync(COOKIES_FILE)) return [];
  return fs.readFileSync(COOKIES_FILE, 'utf8').split('\n');
}

// Netscape cookie file fields are tab-separated: domain, includeSubdomains, path, secure,
// expiry, name, value. Returns null for comments/blank lines/malformed rows. A "#HttpOnly_"
// domain prefix marks a real (HttpOnly) cookie, not a comment — most YouTube auth cookies
// are exported that way.
function parseCookieLine(line) {
  if (!line) return null;
  line = line.replace(/\r$/, '');
  if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length);
  else if (line.trim().startsWith('#')) return null;
  const parts = line.split('\t');
  if (parts.length < 7) return null;
  return { domain: parts[0], name: parts[5], value: parts.slice(6).join('\t') };
}

function isTwitchAuthCookieLine(line) {
  const c = parseCookieLine(line);
  return !!c && c.name === TWITCH_AUTH_COOKIE_NAME && /(^|\.)twitch\.tv$/i.test(c.domain.replace(/^\./, ''));
}

// Replaces (or removes, if token is falsy) the auth-token cookie line for twitch.tv in the
// shared cookies.txt, leaving every other cookie (YouTube, etc.) untouched. Deletes the file
// entirely if that leaves it with no real cookie rows, so the YouTube cookies status check
// (which just does fs.existsSync) doesn't report "configured" for an empty file.
function setTwitchAuthCookie(token) {
  const kept = readCookieLines().filter((line) => line.trim() !== '' && !isTwitchAuthCookieLine(line));
  const hasOtherCookies = kept.some((line) => parseCookieLine(line));

  if (token) {
    if (!kept.some((line) => line.startsWith('# Netscape'))) {
      kept.unshift('# Netscape HTTP Cookie File');
    }
    const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 5; // 5 years out
    kept.push([TWITCH_AUTH_COOKIE_DOMAIN, 'TRUE', '/', 'TRUE', String(expiry), TWITCH_AUTH_COOKIE_NAME, token].join('\t'));
    fs.writeFileSync(COOKIES_FILE, kept.join('\n') + '\n', { mode: 0o600 });
    fs.chmodSync(COOKIES_FILE, 0o600);
  } else if (hasOtherCookies) {
    fs.writeFileSync(COOKIES_FILE, kept.join('\n') + '\n', { mode: 0o600 });
    fs.chmodSync(COOKIES_FILE, 0o600);
  } else if (fs.existsSync(COOKIES_FILE)) {
    fs.unlinkSync(COOKIES_FILE);
  }
}

function hasTwitchAuthCookie() {
  return readCookieLines().some(isTwitchAuthCookieLine);
}

function getTwitchAuthTokenRaw() {
  for (const line of readCookieLines()) {
    if (isTwitchAuthCookieLine(line)) return parseCookieLine(line).value;
  }
  return '';
}

// The Settings page lets a user paste/upload a fresh cookies.txt (for YouTube, typically),
// which replaces the file outright. Without this, that upload would silently wipe out a
// separately-configured Twitch auth-token cookie merged into the same file. Re-merges it
// back in afterward so the two features don't clobber each other.
function writeCookiesFilePreservingTwitchAuth(content) {
  const existingToken = getTwitchAuthTokenRaw();
  fs.writeFileSync(COOKIES_FILE, content, { mode: 0o600 });
  fs.chmodSync(COOKIES_FILE, 0o600);
  if (existingToken) setTwitchAuthCookie(existingToken);
}

function getTwitchAuthTokenMasked() {
  for (const line of readCookieLines()) {
    const c = parseCookieLine(line);
    if (c && isTwitchAuthCookieLine(line)) {
      return c.value.length > 4 ? `••••${c.value.slice(-4)}` : '••••';
    }
  }
  return '';
}

// yt-dlp saves its cookie jar back to the --cookies file when it exits, and YouTube rotates
// session cookies (__Secure-*PSIDTS, SIDCC, ...) on nearly every response. With several
// yt-dlp processes sharing one cookies.txt (metadata probe + concurrent downloads + watch
// checks) each one writes back its own rotated copy, last writer wins, and the stored session
// ends up desynced/invalidated — YouTube then answers every request with "Sign in to confirm
// you're not a bot" even though cookies are configured. So the uploaded cookies.txt is treated
// as read-only: each process gets a private temp copy that it can rewrite freely and that is
// deleted when the process exits. The displayed command still shows the real cookies path.
// All copies live under one dedicated dir so anything a crash/SIGKILL left behind (the exit
// handlers never ran) can be swept at startup — see sweepPrivateCookieDirs below.
const PRIVATE_COOKIES_ROOT = path.join(os.tmpdir(), 'ytdlp-gui-cookies');

function removePrivateCookieDir(dir) {
  fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }, (err) => {
    if (err) console.error(`[ytdlp] Failed to remove private cookies copy ${dir}: ${err.message}`);
  });
}

// Runs once at module load, i.e. at server startup, before the queue resumes any job. Any
// yt-dlp process from a previous run is orphaned at that point (queue.init kills them by
// pid), so every leftover copy is stale and holds a live login session — remove them all.
function sweepPrivateCookieDirs() {
  let entries;
  try {
    entries = fs.readdirSync(PRIVATE_COOKIES_ROOT);
  } catch (_) {
    return; // nothing to sweep
  }
  for (const name of entries) {
    try {
      fs.rmSync(path.join(PRIVATE_COOKIES_ROOT, name), { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      console.error(`[ytdlp] Failed to remove stale private cookies copy ${name}: ${e.message}`);
    }
  }
}
sweepPrivateCookieDirs();

function withPrivateCookies(args) {
  const idx = args.indexOf('--cookies');
  if (idx === -1 || args[idx + 1] !== COOKIES_FILE || !fs.existsSync(COOKIES_FILE)) {
    return { args, cleanup: () => {} };
  }
  let tmpDir;
  try {
    fs.mkdirSync(PRIVATE_COOKIES_ROOT, { recursive: true, mode: 0o700 });
    tmpDir = fs.mkdtempSync(path.join(PRIVATE_COOKIES_ROOT, 'job-'));
    const tmpFile = path.join(tmpDir, 'cookies.txt');
    fs.copyFileSync(COOKIES_FILE, tmpFile);
    fs.chmodSync(tmpFile, 0o600);
    const copy = args.slice();
    copy[idx + 1] = tmpFile;
    let cleaned = false;
    return {
      args: copy,
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        removePrivateCookieDir(tmpDir);
      },
    };
  } catch (e) {
    console.error(`[ytdlp] Couldn't create private cookies copy, using shared file: ${e.message}`);
    if (tmpDir) removePrivateCookieDir(tmpDir);
    return { args, cleanup: () => {} };
  }
}

function spawnYtdlp(args, options) {
  const { args: spawnArgs, cleanup } = withPrivateCookies(args);
  let proc;
  try {
    proc = spawn(YTDLP_BIN, spawnArgs, options);
  } catch (e) {
    cleanup();
    throw e;
  }
  proc.once('close', cleanup);
  proc.once('error', cleanup);
  return proc;
}

// YouTube's anti-bot wall. Retrying the same request with the same cookies/IP won't help, so
// callers fail fast and show the user what to actually do about it.
const BOT_CHECK_RE = /Sign in to confirm you(?:'|’)re not a bot|confirm you(?:'|’)re not a bot/i;

function isBotCheckError(message) {
  return BOT_CHECK_RE.test(String(message || ''));
}

const BOT_CHECK_HINT = 'YouTube rejected the request with its bot check. Your cookies are likely expired or were '
  + 'rotated by YouTube: export a fresh cookies.txt from a private/incognito window (log in, open '
  + 'youtube.com/robots.txt, export, then close that window without browsing further) and re-upload it in '
  + 'Settings → Cookies. If it persists, this server\'s IP may be flagged by YouTube (common for VPN/datacenter IPs).';

function ffmpegArgs() {
  const dir = getFfmpegDir();
  return dir ? ['--ffmpeg-location', dir] : [];
}

// yt-dlp's pip package doesn't bundle the EJS challenge-solver script the way official
// executables do, so YouTube extraction silently falls back to images-only formats unless
// we explicitly allow it to fetch that script at runtime. --cache-dir persists it (and other
// yt-dlp caches) across container restarts instead of re-fetching every time.
function commonArgs() {
  return [
    '--remote-components', 'ejs:github',
    '--cache-dir', YTDLP_CACHE_DIR,
    ...cookieArgs(),
    ...ffmpegArgs(),
  ];
}

// Best-effort SSRF guard: yt-dlp's generic extractor will fetch essentially any URL, so a
// pasted URL targeting a loopback/private/link-local literal IP could probe the server's own
// internal network (other Docker services, cloud metadata endpoints, etc). This only checks
// literal IPs and scheme — it does NOT resolve hostnames, so a hostname that *resolves* to a
// private address (DNS rebinding) isn't caught. Set ALLOW_LOCAL_URLS=1 to disable entirely
// for setups that intentionally target internal mirrors/services.
function isPrivateOrLoopbackIp(host) {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = parseInt(v4[1], 10);
    const b = parseInt(v4[2], 10);
    if (a === 127 || a === 0 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true; // fc00::/7 (unique local)
  if (/^fe80:/i.test(host)) return true; // link-local
  return false;
}

function assertPublicUrl(url) {
  if (process.env.ALLOW_LOCAL_URLS === '1') return;
  if (typeof url === 'string' && /^ytsearch/i.test(url)) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || isPrivateOrLoopbackIp(host)) {
    throw new Error('URLs targeting local/private network addresses are not allowed');
  }
}

// Reddit's mobile app "Share" button produces short links like
// https://www.reddit.com/r/<sub>/s/<code>. yt-dlp's Reddit extractor only matches
// /comments/<id> URLs, so share links fall through to the generic extractor, which Reddit
// answers with "HTTP Error 403: Blocked". Reddit serves these as a plain redirect to the
// real post, so we follow it ourselves and hand yt-dlp the canonical /comments/ URL.
const REDDIT_SHARE_RE = /^https?:\/\/(?:(?:www|old|new|m)\.)?reddit\.com\/(?:r|u|user)\/[^/]+\/s\/[A-Za-z0-9]+\/?(?:[?#].*)?$/i;
const SHARE_RESOLVE_TIMEOUT_MS = 10 * 1000;
const SHARE_RESOLVE_MAX_HOPS = 3;
// Reddit blocks some user agents outright, so try a descriptive bot UA and a browser UA.
const SHARE_RESOLVE_USER_AGENTS = [
  'Mozilla/5.0 (compatible; yt-dlp-gui/1.0; +https://github.com/yt-dlp/yt-dlp)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
];

function isRedditShareUrl(url) {
  return typeof url === 'string' && REDDIT_SHARE_RE.test(url.trim());
}

// Strips tracking params (share_id, utm_*, ...) Reddit appends to the redirect target.
function cleanRedditPostUrl(location, base) {
  let target;
  try {
    target = new URL(location, base);
  } catch (_) {
    return null;
  }
  if (!/(^|\.)reddit\.com$/i.test(target.hostname) || !/\/comments\//i.test(target.pathname)) return null;
  target.search = '';
  target.hash = '';
  return target.toString();
}

// Returns the canonical URL for known short/share links, or the input unchanged. Never
// throws: if resolution fails we let yt-dlp try the original URL and report its own error.
async function resolveShareUrl(url) {
  if (!isRedditShareUrl(url)) return url;
  const shareUrl = url.trim();
  for (const userAgent of SHARE_RESOLVE_USER_AGENTS) {
    try {
      // Follow a short redirect chain by hand (e.g. reddit.com -> www.reddit.com -> post) so
      // every hop is checked against the Reddit host guard instead of trusting fetch's follow.
      let current = shareUrl;
      let status = null;
      for (let hop = 0; hop < SHARE_RESOLVE_MAX_HOPS; hop++) {
        const res = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'User-Agent': userAgent, Accept: 'text/html' },
          signal: AbortSignal.timeout(SHARE_RESOLVE_TIMEOUT_MS),
        });
        status = res.status;
        // Only the headers matter; release the connection instead of leaving the body unread.
        if (res.body) res.body.cancel().catch(() => {});
        const location = res.headers.get('location');
        if (!location) break;
        const resolved = cleanRedditPostUrl(location, current);
        if (resolved) {
          console.log(`[ytdlp] Resolved Reddit share link ${shareUrl} -> ${resolved}`);
          return resolved;
        }
        let next;
        try {
          next = new URL(location, current);
        } catch (_) {
          break;
        }
        if (!/(^|\.)reddit\.com$/i.test(next.hostname)) break;
        current = next.toString();
      }
      console.warn(`[ytdlp] Reddit share link ${shareUrl} did not redirect to a post (HTTP ${status})`);
    } catch (err) {
      console.warn(`[ytdlp] Failed to resolve Reddit share link ${shareUrl}: ${err.message}`);
    }
  }
  return url;
}

// Runs `yt-dlp -J <url>` to fetch metadata (title, id, extractor, thumbnail, formats)
// without downloading anything. Used for the format picker and for watch/history dedup.
// Metadata lookups should be fast; a hung one (stalled extractor, network partition) would
// otherwise block a queue slot indefinitely during the pre-download step, or block the
// watch scheduler's tick, forever.
const GETINFO_TIMEOUT_MS = parseInt(process.env.GETINFO_TIMEOUT_MS || String(2 * 60 * 1000), 10);

// Pass { resolveShare: false } when the caller already ran resolveShareUrl(), so a link that
// couldn't be resolved isn't retried (and doesn't pay the resolver timeouts) a second time.
async function getInfo(url, { resolveShare = true, ...options } = {}) {
  return getInfoResolved(resolveShare ? await resolveShareUrl(url) : url, options);
}

function getInfoResolved(url, { flatPlaylist = false, playlistEnd = null } = {}) {
  return new Promise((resolve, reject) => {
    try {
      assertPublicUrl(url);
    } catch (e) {
      return reject(e);
    }
    const args = ['-J', ...commonArgs()];
    if (flatPlaylist) args.push('--flat-playlist');
    if (playlistEnd) args.push('--playlist-end', String(playlistEnd));
    args.push(url);

    console.log(`[ytdlp:info] Fetching metadata for ${url}`);
    const proc = spawnYtdlp(args, { detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`[ytdlp:info] Metadata lookup timed out (${url}), killing`);
      killProcessTree(proc, 'SIGKILL');
    }, GETINFO_TIMEOUT_MS);

    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        return reject(new Error(`Metadata lookup timed out after ${Math.round(GETINFO_TIMEOUT_MS / 1000)}s`));
      }
      if (code !== 0) {
        const errMsg = stderr.trim() || `yt-dlp exited with code ${code}`;
        console.error(`[ytdlp:info] Metadata lookup failed (${url}): ${errMsg}`);
        return reject(new Error(errMsg));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('Failed to parse yt-dlp JSON output: ' + e.message));
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`[ytdlp:info] Spawn error (${url}): ${err.message}`);
      reject(err);
    });
  });
}

// Progress-template gives us a stable, parseable line for every progress tick instead of
// scraping the human-readable percentage string, which varies by yt-dlp version/locale.
const PROGRESS_TEMPLATE = 'YTDLP_PROGRESS %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s';

// User-facing quality caps ("4K", "1080p", ...) map to a max height. yt-dlp's `<=` selector
// plus the `/best[height<=N]` fallback means asking for 4K on a 1080p-only video just gets
// the best format at or below the cap instead of failing.
const QUALITY_HEIGHTS = { 2160: 2160, 1440: 1440, 1080: 1080, 720: 720, 480: 480, 360: 360 };

// Auth now flows entirely through the cookies.txt cookie (see setTwitchAuthCookie above) —
// client_id is the only real Twitch extractor-arg yt-dlp recognizes (verified: it's the only
// _configuration_arg() call in yt-dlp's twitch.py), so it's the only thing left to read here.
function getTwitchClientId() {
  try {
    const db = require('../db');
    const row = db.prepare("SELECT value FROM settings WHERE key = 'twitch_client_id'").get();
    return row ? row.value : null;
  } catch (_) {
    return null;
  }
}

function buildFormatSelector({ audioOnly, formatSelector, quality }) {
  if (audioOnly) return 'bestaudio/best/Audio_Only/audio_only';
  if (formatSelector) return formatSelector;
  if (!quality) return 'bestvideo*+bestaudio/best';
  const parsed = parseInt(quality, 10);
  if (!Number.isNaN(parsed) && QUALITY_HEIGHTS[parsed]) {
    const height = QUALITY_HEIGHTS[parsed];
    return `bestvideo*[height<=${height}]+bestaudio/best[height<=${height}]/best[height<=${height}]`;
  }
  return `${quality}/bestvideo*+bestaudio/best`;
}

// Command strings built here are logged to the console and persisted to the downloads
// table's command_args/log columns, which the API returns to any authenticated client —
// so secrets (Twitch OAuth token, client id) must never survive into the displayed string.
const SECRET_ARG_PATTERNS = [
  /^(Authorization:\s*OAuth\s+).+$/i,
  /(twitch:auth_token=)[^,]+/gi,
  /(twitch:client_id=)[^,]+/gi,
];

function redactSecretArg(arg) {
  return SECRET_ARG_PATTERNS.reduce((out, pattern) => out.replace(pattern, '$1***REDACTED***'), arg);
}

function formatCommand(bin, args) {
  return `${bin} ${args
    .map(redactSecretArg)
    .map((a) => (a.includes(' ') || a.includes('"') ? JSON.stringify(a) : a))
    .join(' ')}`;
}

// Detect whether a target URL or extractor belongs to YouTube.
function isYouTube(url, extractor = null) {
  if (extractor && typeof extractor === 'string') {
    return /^youtube/i.test(extractor);
  }
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/^ytsearch/i.test(raw)) return true;
  try {
    const looksLikeHostWithoutScheme = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw);
    const normalized = raw.startsWith('//')
      ? `https:${raw}`
      : (looksLikeHostWithoutScheme ? `https://${raw}` : raw);
    const parsed = new URL(normalized, 'https://example.invalid');
    const host = parsed.hostname.toLowerCase();
    return /(^|\.)youtube\.com$/i.test(host) || host === 'youtu.be' || /(^|\.)youtube-nocookie\.com$/i.test(host);
  } catch (_) {
    return false;
  }
}

// Accepts a comma-separated string or an array of SponsorBlock category names and
// normalizes it to the comma-separated form yt-dlp's --sponsorblock-* flags expect.
function normalizeCategories(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(',');
  return String(value).trim();
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Turns a --sub-langs pattern like "en.*" into the exact tracks the probe found. Passing the
// raw regex lets yt-dlp also match auto-*translated* caption tracks (e.g. "en-de"), which
// YouTube rate-limits (HTTP 429) — and one failed subtitle fetch fails the whole download.
// Manual tracks win; auto-captions are only used when no manual track matches, preferring
// the original-language caption over machine translations. Returns null to leave the
// pattern alone ("all", or a pattern that isn't a valid regex).
function pickSubtitleTracks(pattern, { manual = [], auto = [] }) {
  const parts = String(pattern).split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.includes('all')) return null;
  let regexes;
  try {
    regexes = parts.map((p) => new RegExp(`^(?:${p})$`));
  } catch (_) {
    return null;
  }
  const matches = (lang) => regexes.some((r) => r.test(lang));
  const manualHits = manual.filter(matches);
  if (manualHits.length) return { langs: manualHits, auto: false };
  const autoHits = auto.filter(matches);
  const originals = autoHits.filter((l) => !l.includes('-') || l.endsWith('-orig'));
  return { langs: originals.length ? originals : autoHits, auto: autoHits.length > 0 };
}

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav', 'alac', 'vorbis', 'aac'];

// The final file extension buildDownloadArgs will produce for these options.
function expectedOutputExt({ audioOnly, container }) {
  if (audioOnly) {
    const fmt = AUDIO_FORMATS.includes(container) ? container : 'mp3';
    return { alac: 'm4a', aac: 'm4a', vorbis: 'ogg' }[fmt] || fmt;
  }
  return container === 'mkv' || container === 'ts' ? container : 'mp4';
}

// Containers embedThumbnailFromUrl can add an attached picture to.
const THUMBNAIL_FALLBACK_EXTS = new Set(['mp4', 'm4a', 'mp3']);

function runFfmpegCollect(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegBin(), args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => resolve({ code, stderr }));
    proc.on('error', reject);
  });
}

// Embeds a thumbnail fetched from `thumbnailUrl` into an already-downloaded file as its
// cover art, mirroring the ffmpeg invocation yt-dlp's own EmbedThumbnail step uses. Used
// when yt-dlp can't embed the site's preferred thumbnail itself (see resolveDownloadOptions).
async function embedThumbnailFromUrl(filepath, thumbnailUrl) {
  const ext = path.extname(filepath).slice(1).toLowerCase();
  if (!THUMBNAIL_FALLBACK_EXTS.has(ext)) throw new Error(`can't embed a thumbnail into .${ext}`);
  assertPublicUrl(thumbnailUrl);

  const res = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching thumbnail`);
  const imageExt = /png/i.test(res.headers.get('content-type') || '') ? 'png' : 'jpg';
  const coverPath = `${filepath}.cover.${imageExt}`;
  const tempOut = `${filepath}.thumb-tmp.${ext}`;
  fs.writeFileSync(coverPath, Buffer.from(await res.arrayBuffer()));

  try {
    // The cover becomes the next video stream after the file's own (data streams dropped),
    // so its disposition index is the existing video stream count.
    const { stderr: probe } = await runFfmpegCollect(['-hide_banner', '-i', filepath]);
    const videoStreams = (probe.match(/Stream #0:\d+\S*: Video:/g) || []).length;
    const args = [
      '-y', '-i', filepath, '-i', coverPath,
      '-map', '0', '-dn', '-ignore_unknown', '-map', '1', '-c', 'copy',
      `-disposition:v:${videoStreams}`, 'attached_pic',
    ];
    if (ext === 'mp3') args.push('-id3v2_version', '3');
    args.push(tempOut);
    const { code, stderr } = await runFfmpegCollect(args);
    if (code !== 0) throw new Error(stderr.trim().split('\n').slice(-2).join(' ') || `ffmpeg exited with code ${code}`);
    fs.renameSync(tempOut, filepath);
  } finally {
    for (const p of [coverPath, tempOut]) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
  }
}

// Checks the requested options against what this link actually supports (see
// siteProfiles.getCapabilities) and drops anything that would make yt-dlp warn or run a
// post-processor with nothing to work on. `options.caps` comes from a real `-J` probe when
// the queue has one; without it, a URL/extractor-based guess is used and only site-level
// features (SponsorBlock, live-from-start) are enforced, since media facts are unknown.
// Returns the cleaned options plus a human-readable note for each change, for the job log.
function resolveDownloadOptions(url, options = {}) {
  const caps = options.caps || siteProfiles.capabilitiesFromUrl(url, options.extractor);
  const siteName = caps.site.name;
  const resolved = { ...options, caps };
  const adjustments = [];

  if (normalizeCategories(resolved.sponsorblockRemove) && !caps.sponsorblock) {
    resolved.sponsorblockRemove = '';
    adjustments.push(`Skipped SponsorBlock: it only covers YouTube (this link is ${siteName})`);
  }
  if (resolved.liveFromStart && !caps.liveFromStart) {
    resolved.liveFromStart = false;
    adjustments.push(`Skipped "record from broadcast start": yt-dlp doesn't support it for ${siteName}`);
  }
  if (!resolved.audioOnly) {
    if (resolved.subtitles && caps.hasSubtitles === false) {
      resolved.subtitles = false;
      adjustments.push('Skipped subtitles: this video has no subtitle tracks');
    } else if (resolved.subtitles && caps.subtitles) {
      const picked = pickSubtitleTracks(resolved.subLangs || 'en.*', caps.subtitles);
      if (picked && picked.langs.length === 0) {
        resolved.subtitles = false;
        const available = [...new Set([...caps.subtitles.manual, ...caps.subtitles.auto])];
        adjustments.push(`Skipped subtitles: none match "${resolved.subLangs}" (available: ${available.slice(0, 15).join(', ')})`);
      } else if (picked) {
        resolved.subLangs = picked.langs.map(escapeRegex).join(',');
        resolved.useAutoSubs = picked.auto;
      }
    }
    if (resolved.embedChapters && caps.chapters === false) {
      resolved.embedChapters = false;
      adjustments.push('Skipped chapter embedding: this video has no chapters');
    }
  }
  if (resolved.embedThumbnail && caps.thumbnail === false) {
    resolved.embedThumbnail = false;
    adjustments.push('Skipped thumbnail embedding: this video has no thumbnail');
  } else if (resolved.embedThumbnail && caps.thumbnailConvertible === false) {
    // yt-dlp would pick a thumbnail it can't convert (e.g. AVIF) and fail the whole job in
    // post-processing. MKV takes it as a plain attachment; other outputs get the site's
    // JPG/PNG thumbnail embedded by us after the download (embedThumbnailFromUrl).
    const outExt = expectedOutputExt(resolved);
    const fmt = String(caps.thumbnailFormat || 'unknown').toUpperCase();
    if (outExt !== 'mkv') {
      resolved.embedThumbnail = false;
      if (caps.thumbnailFallbackUrl && THUMBNAIL_FALLBACK_EXTS.has(outExt)) {
        resolved.thumbnailFallbackUrl = caps.thumbnailFallbackUrl;
        adjustments.push(`This site's preferred thumbnail is ${fmt}, which yt-dlp can't embed; embedding its JPG/PNG thumbnail after the download instead`);
      } else {
        adjustments.push(`Skipped thumbnail embedding: this site's thumbnail is ${fmt}, which yt-dlp can't embed into .${outExt}`);
      }
    }
  }

  return { options: resolved, adjustments, caps };
}

function buildDownloadArgs(url, rawOptions = {}) {
  const { options, caps } = resolveDownloadOptions(url, rawOptions);
  const {
    audioOnly = false,
    formatSelector = '',
    quality = '',
    container = 'mp4',
    subtitles = false,
    subLangs = 'en.*',
    embedThumbnail = false,
    embedMetadata = false,
    embedChapters = false,
    sponsorblockRemove = '',
    outputTemplate = null,
    audioQuality = null,
    postprocessorArgs = null,
  } = options;

  // Titles are capped in bytes: some sites use very long (often multi-byte) titles that push
  // the name past the 255-byte filesystem limit once yt-dlp's post-processing adds suffixes
  // like ".temp" / ".f137", which fails the ffmpeg step after the download already finished.
  const targetOutput = outputTemplate || `${DOWNLOAD_DIR}/%(uploader,extractor).80B/%(title).150B [%(id)s].%(ext)s`;

  const args = [
    '--newline',
    '--progress',
    ...commonArgs(),
    '--progress-template', 'download:YTDLP_PROGRESS %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '--progress-template', 'postprocess:YTDLP_POSTPROCESS %(progress._percent_str)s',
    '-o', targetOutput,
    '--print', 'after_move:FILEPATH %(filepath)s',
  ];

  if (audioOnly) {
    const audioFormat = AUDIO_FORMATS.includes(container) ? container : 'mp3';
    args.push('-x', '--audio-format', audioFormat, '-f', buildFormatSelector({ audioOnly }));
    if (audioQuality) {
      args.push('--audio-quality', String(audioQuality));
    }
  } else {
    args.push('-f', buildFormatSelector({ formatSelector, quality }));
    if (container === 'ts') {
      args.push('--merge-output-format', 'ts');
    } else {
      args.push('--merge-output-format', container === 'mkv' ? 'mkv' : 'mp4');
    }
  }

  if (subtitles && !audioOnly) {
    // --write-subs is required so yt-dlp actually fetches subtitle tracks to embed.
    // --write-auto-subs allows auto-generated captions if manual ones aren't present; only
    // requested when the probe (or, unprobed, the site profile) says the link has them.
    const subArgs = ['--write-subs'];
    if (caps.autoSubs && options.useAutoSubs !== false) {
      subArgs.push('--write-auto-subs');
    }
    // Subtitles in webvtt/ttml formats fail to embed into MP4 containers unless converted to srt.
    subArgs.push(
      '--sub-langs', subLangs || 'en.*',
      '--convert-subs', 'srt',
      '--embed-subs',
      '--compat-options', 'no-keep-subs',
    );
    args.push(...subArgs);
  }

  // Embed extras directly into the output file instead of leaving separate sidecar files.
  if (embedThumbnail) {
    args.push('--embed-thumbnail');
  }
  if (embedMetadata) {
    args.push('--embed-metadata');
  }
  if (embedChapters && !audioOnly) {
    args.push('--embed-chapters');
  }

  // SponsorBlock: cut the chosen segment categories out of the file automatically.
  // resolveDownloadOptions already cleared this for sites SponsorBlock doesn't cover.
  const sponsorblockRemoveCats = normalizeCategories(sponsorblockRemove);
  if (sponsorblockRemoveCats) {
    args.push('--sponsorblock-remove', sponsorblockRemoveCats);
  }

  // Twitch specific configuration
  const isTwitch = caps.site.id === 'twitch' || /twitch\.tv/i.test(url) || options.isTwitch;
  // options.isLive is only ever a real override when the caller actually set it — `false`
  // must mean "not live" (e.g. a clips.twitch.tv short link, which contains neither
  // "/videos/" nor "/clip/" so the URL heuristic alone would misdetect it as live).
  const isLive = options.isLive !== undefined
    ? options.isLive
    : isTwitch && !/(\/videos\/|\/clip\/)/i.test(url);

  if (isTwitch) {
    const clientId = options.twitchClientId || getTwitchClientId();
    if (clientId) {
      args.push('--extractor-args', `twitch:client_id=${clientId}`);
    }
  }

  if (isLive) {
    if (options.hlsUseMpegts !== false) {
      args.push('--hls-use-mpegts');
    }
    if (options.waitForLive) {
      const waitInterval = parseInt(options.waitInterval || '15', 10);
      args.push('--wait-for-video', String(waitInterval));
    }
    // Joining a broadcast that's already in progress normally starts recording from the
    // live edge (right now), losing everything broadcast before that point. A few extractors
    // can fetch the stream from its beginning instead; which ones is read from the installed
    // yt-dlp's --help (siteProfiles.refreshYtdlpFacts), and resolveDownloadOptions has
    // already cleared this for any other site.
    if (options.liveFromStart) {
      args.push('--live-from-start');
    }
  }

  if (options.downloadSections) {
    args.push('--download-sections', options.downloadSections.trim());
  }

  if (options.twitchChat) {
    args.push('--write-subs', '--sub-langs', 'rechat,all');
  }

  if (Array.isArray(postprocessorArgs)) {
    for (const ppa of postprocessorArgs) {
      if (ppa) args.push('--postprocessor-args', ppa);
    }
  } else if (typeof postprocessorArgs === 'string' && postprocessorArgs.trim()) {
    args.push('--postprocessor-args', postprocessorArgs.trim());
  }

  args.push(url);
  return args;
}

const activeProcesses = new Map();
// yt-dlp catches SIGINT itself (KeyboardInterrupt) and exits cleanly via sys.exit(1) rather
// than letting the OS terminate it — so Node's child_process 'close' event reports signal:
// null, code: 1 for the common "stop recording" case, indistinguishable from a real failure
// by signal/code alone. Tracking the jobId here lets download() recognize a user-requested
// stop regardless of how the process actually exits (clean self-exit, or SIGTERM/SIGKILL if
// it doesn't respond to SIGINT in time).
const userStoppedJobs = new Set();

// yt-dlp spawns ffmpeg (merge/postprocess) as its own child process. Signaling only the
// direct child (proc.kill()) leaves ffmpeg running as an orphan after "stop". Processes are
// spawned detached (see download() below) so they're their own process-group leader on
// POSIX, letting us signal the whole group via the negative pid; Windows has no such
// concept, so taskkill /T there kills the process and its children instead.
function killProcessTree(proc, signal) {
  if (!proc || !proc.pid || proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f']);
    } else {
      process.kill(-proc.pid, signal);
    }
  } catch (err) {
    try {
      proc.kill(signal);
    } catch (_) {}
  }
}

// Node's SIGINT emulation on Windows terminates a child abruptly. Give yt-dlp and FFmpeg
// a real console control event so their handlers can flush/finalize output. The download
// is started detached into its own console/process group for a targeted CTRL+BREAK.
function sendWindowsCtrlBreak(pid, onLog) {
  const csharp = 'using System; using System.Runtime.InteropServices; public static class Win32Console { [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole(); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint eventType, uint processGroupId); }';
  const script = [
    `Add-Type -TypeDefinition '${csharp}'`,
    '[Win32Console]::FreeConsole() | Out-Null',
    `if (-not [Win32Console]::AttachConsole(${pid})) { exit 2 }`,
    '[Win32Console]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null',
    `if (-not [Win32Console]::GenerateConsoleCtrlEvent(1, ${pid})) { exit 3 }`,
    'Start-Sleep -Milliseconds 500; [Win32Console]::FreeConsole() | Out-Null',
  ].join('; ');
  let helper;
  try {
    helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch (err) {
    onLog && onLog(`[warning] Could not send Windows console stop event: ${err.message}`);
    return false;
  }
  helper.once('error', (err) => onLog && onLog(`[warning] Could not send Windows console stop event: ${err.message}`));
  helper.once('close', (code) => {
    if (code !== 0) onLog && onLog(`[warning] Windows console stop event helper exited with code ${code}`);
  });
  return true;
}

function stopDownload(jobId) {
  const active = activeProcesses.get(jobId);
  if (!active) return false;
  const { proc, onProgress, onLog } = active;
  userStoppedJobs.add(jobId);
  console.log(`[ytdlp] Requesting graceful stop for job ${jobId}`);
  onProgress && onProgress({ stage: 'Finalizing recording…', percent: 99, speed: null, eta: null });
  try {
    // On POSIX, yt-dlp receives SIGINT and handles its FFmpeg child. On Windows, a real
    // CTRL+BREAK reaches the detached process group; ChildProcess.kill('SIGINT') is forceful.
    if (process.platform === 'win32') sendWindowsCtrlBreak(proc.pid, onLog);
    else process.kill(proc.pid, 'SIGINT');
  } catch (err) {
    console.error(`[ytdlp] Failed to send SIGINT to job ${jobId}: ${err.message}`);
    return false;
  }
  active.stopTimers = [setTimeout(() => {
    if (activeProcesses.has(jobId)) {
      console.log(`[ytdlp] Graceful stop still pending for job ${jobId}; terminating process group via SIGTERM`);
      killProcessTree(proc, 'SIGTERM');
    }
  }, 30 * 60 * 1000), setTimeout(() => {
    if (activeProcesses.has(jobId)) {
      console.log(`[ytdlp] Job ${jobId} still alive after SIGTERM, sending SIGKILL`);
      killProcessTree(proc, 'SIGKILL');
    }
  }, 35 * 60 * 1000)];
  return true;
}

function clearStopTimers(active) {
  for (const timer of active?.stopTimers || []) clearTimeout(timer);
  if (active) active.stopTimers = [];
}

// Idle-watchdog: if yt-dlp prints nothing at all for this long, assume it's hung (stuck
// network call, wedged extractor) and kill it rather than tying up a queue slot forever.
// Disabled for --wait-for-video jobs, which are *supposed* to sit idle while polling for a
// stream to go live. Live recordings get a longer watchdog because some sites can go quiet
// for extended stretches while the capture is still healthy.
const DOWNLOAD_IDLE_TIMEOUT_MS = parseInt(process.env.DOWNLOAD_IDLE_TIMEOUT_MS || String(15 * 60 * 1000), 10);
const PLAYLIST_DOWNLOAD_IDLE_TIMEOUT_MS = parseInt(process.env.PLAYLIST_DOWNLOAD_IDLE_TIMEOUT_MS || String(60 * 60 * 1000), 10);
const LIVE_DOWNLOAD_IDLE_TIMEOUT_MS = parseInt(process.env.LIVE_DOWNLOAD_IDLE_TIMEOUT_MS || String(60 * 60 * 1000), 10);

function isPlaylistUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  try {
    const looksLikeHostWithoutScheme = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw);
    const normalized = raw.startsWith('//')
      ? `https:${raw}`
      : (looksLikeHostWithoutScheme ? `https://${raw}` : raw);
    const parsed = new URL(normalized, 'https://example.invalid');
    const host = parsed.hostname.toLowerCase();
    const isYouTubeHost = /(^|\.)youtube\.com$/i.test(host) || host === 'youtu.be';
    if (/\/playlist(?:\/|$)/i.test(parsed.pathname) && isYouTubeHost) return true;
    if (parsed.searchParams.get('list') && isYouTubeHost) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function getDownloadIdleTimeoutMs(url, options = {}, timeouts = {}) {
  const {
    standard = DOWNLOAD_IDLE_TIMEOUT_MS,
    playlist = PLAYLIST_DOWNLOAD_IDLE_TIMEOUT_MS,
    live = LIVE_DOWNLOAD_IDLE_TIMEOUT_MS,
  } = timeouts;
  if (options.waitForLive) return null;
  if (options.isLive) return live;
  return isPlaylistUrl(url) ? playlist : standard;
}

// Downloads a single URL, streaming progress updates via onProgress({percent, speed, eta})
// and log messages via onLog(line).
// Resolves with { filepath, command } once yt-dlp exits successfully.
function download(url, options = {}, onProgress, onLog) {
  const args = buildDownloadArgs(url, options);
  const commandStr = formatCommand(YTDLP_BIN, args);
  const jobId = options.jobId ? `job:${options.jobId}` : 'download';
  const ffmpegDir = getFfmpegDir();
  const idleTimeoutMs = getDownloadIdleTimeoutMs(url, options);

  console.log(`[${jobId}] Starting download: ${url}`);
  console.log(`[${jobId}] Command: ${commandStr}`);
  if (ffmpegDir) {
    console.log(`[${jobId}] FFmpeg directory: ${ffmpegDir}`);
  }

  return new Promise((resolve, reject) => {
    try {
      assertPublicUrl(url);
    } catch (e) {
      return reject(e);
    }
    // Detached POSIX jobs lead their own process group. On Windows, detached gives yt-dlp
    // a private console/process group for the targeted CTRL+BREAK sent by stopDownload().
    let proc;
    try {
      proc = spawnYtdlp(args, { detached: true, windowsHide: process.platform === 'win32' });
    } catch (e) {
      return reject(e);
    }
    let stderr = '';
    let filepath = null;
    let timedOut = false;

    if (options.jobId) {
      activeProcesses.set(options.jobId, { proc, onProgress, onLog, stopTimers: [] });
    }
    if (typeof options.onSpawn === 'function' && proc.pid) {
      options.onSpawn(proc.pid);
    }

    let idleTimer = null;
    function resetIdleTimer() {
      if (idleTimeoutMs == null) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // Once the user asks to stop a live recording, post-processing may legitimately be
        // quiet for a long time (especially for a large capture). Keep waiting instead of
        // treating the lack of output as a hung download; the separate stop fallback is the
        // last resort for a process that never exits.
        if (options.jobId && userStoppedJobs.has(options.jobId)) {
          resetIdleTimer();
          return;
        }
        timedOut = true;
        const msg = `No output for ${Math.round(idleTimeoutMs / 60000)} min — terminating as hung`;
        console.error(`[${jobId}] ${msg}`);
        onLog && onLog(`[error] ${msg}`);
        killProcessTree(proc, 'SIGKILL');
      }, idleTimeoutMs);
    }
    resetIdleTimer();

    let stdoutRemainder = '';
    let stderrRemainder = '';
    const isMultiFormat = !options.audioOnly && (!options.formatSelector || options.formatSelector.includes('+'));
    let currentPass = 1;
    let highestPassPercent = 0;
    // Previously assigned without a declaration, which made these accidental globals shared
    // across every concurrent download() call (a race under MAX_CONCURRENT_DOWNLOADS > 1) and
    // risked a ReferenceError if a "[download] Destination:" line arrived before any
    // "Downloading N format(s):" line had ever been seen process-wide.
    let totalFormats = 1;
    let formatIndex = 0;
    let currentStage = null;
    let postprocessSample = null;

    function estimatePostprocessEta(percent) {
      const now = Date.now();
      const previous = postprocessSample;
      postprocessSample = { percent, at: now };
      if (!previous || percent <= previous.percent || now <= previous.at) return null;
      const percentPerSecond = (percent - previous.percent) / ((now - previous.at) / 1000);
      if (!Number.isFinite(percentPerSecond) || percentPerSecond <= 0) return null;
      const seconds = Math.ceil((100 - percent) / percentPerSecond);
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.ceil(seconds / 60);
      if (minutes < 60) return `${minutes}m`;
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    }

    function reportProgress(rawPercent, speed, eta, explicitStage, globalPercent = false) {
      if (Number.isNaN(rawPercent)) return;

      if (rawPercent < 25 && highestPassPercent > 70) {
        currentPass++;
        highestPassPercent = 0;
      }
      if (rawPercent > highestPassPercent) {
        highestPassPercent = rawPercent;
      }

      let effectivePercent = rawPercent;
      let stage = explicitStage;

      if (globalPercent) {
        // Explicit merger/postprocessor ticks are already on the queue-wide scale.
        effectivePercent = rawPercent;
        stage = explicitStage || 'Post-processing recording…';
      } else if (isMultiFormat) {
        if (currentPass <= 1) {
          // Video format pass: 0% -> 85%
          effectivePercent = Math.min(85, rawPercent * 0.85);
          stage = stage || (rawPercent >= 99 ? 'Processing video stream…' : 'Downloading video…');
        } else if (currentPass === 2) {
          // Audio format pass: 85% -> 98%
          effectivePercent = Math.min(98, 85 + (rawPercent * 0.13));
          stage = stage || (rawPercent >= 99 ? 'Merging streams…' : 'Downloading audio…');
        } else {
          effectivePercent = Math.min(99, 98 + (rawPercent * 0.01));
          stage = stage || 'Post-processing…';
        }
      } else {
        stage = stage || (options.audioOnly ? 'Downloading audio…' : 'Downloading…');
      }

      // A final download tick can race with the user's stop request. Keep every connected
      // client in the finalization UI until yt-dlp reports an actual post-processing stage.
      if (options.jobId && userStoppedJobs.has(options.jobId) && (!explicitStage || /^Downloading/i.test(explicitStage))) {
        effectivePercent = Math.max(effectivePercent, 99);
        stage = 'Finalizing recording…';
      }

      effectivePercent = Math.round(effectivePercent * 10) / 10;
      onProgress && onProgress({
        percent: effectivePercent,
        speed: speed && speed.trim() ? speed.trim() : null,
        eta: eta && eta.trim() ? eta.trim() : null,
        stage: stage || 'Downloading…',
      });
    }

    function processLines(lines, isStderr = false) {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('YTDLP_PROGRESS')) {
          const rest = trimmed.replace('YTDLP_PROGRESS', '').trim();
          const [percentStr, speed, eta] = rest.split('|');
          const percent = parseFloat(percentStr.replace('%', '').trim());
          if (!Number.isNaN(percent)) {
            reportProgress(percent, speed, eta);
          }
          continue;
        }

        if (trimmed.startsWith('YTDLP_POSTPROCESS')) {
          const rest = trimmed.replace('YTDLP_POSTPROCESS', '').trim();
          const percent = parseFloat(rest.replace('%', '').trim());
          if (!Number.isNaN(percent)) {
            const eta = estimatePostprocessEta(percent);
            reportProgress(Math.min(99, 90 + percent * 0.09), null, eta, 'Post-processing recording…', true);
          }
          continue;
        }

        // Detect number of formats to download, e.g. "Downloading 1 format(s): 395+251"
        const formatMatch = trimmed.match(/Downloading \d+ format\(s\):\s*([^\s]+)/i);
        if (formatMatch && formatMatch[1]) {
          const formats = formatMatch[1].split('+');
          totalFormats = formats.length;
          formatIndex = 0;
          currentStage = totalFormats > 1 ? 'Downloading video…' : 'Downloading…';
        }

        if (trimmed.startsWith('FILEPATH ')) {
          filepath = trimmed.replace('FILEPATH ', '').trim();
          console.log(`[${jobId}] Destination file: ${filepath}`);
          onLog && onLog(`[destination] ${filepath}`);
          continue;
        }

        if (trimmed.includes('[download] Destination: ')) {
          formatIndex++;
          const dest = trimmed.split('[download] Destination: ')[1]?.trim();
          if (dest) filepath = dest.replace(/\.part$/, '');
          if (totalFormats > 1) {
            currentStage = formatIndex <= 1 ? 'Downloading video…' : 'Downloading audio…';
          }
        }

        if (trimmed.includes('[Merger] Merging formats')) {
          currentStage = 'Merging formats…';
          reportProgress(99, null, null, 'Merging formats…', true);
        } else if (trimmed.includes('[ExtractAudio]')) {
          currentStage = 'Extracting audio…';
          reportProgress(99, null, null, 'Extracting audio…', true);
        } else if (
          trimmed.includes('[SponsorBlock]') &&
          !trimmed.includes('not supported') &&
          !trimmed.includes('unavailable') &&
          !trimmed.includes('SponsorBlock is not')
        ) {
          currentStage = 'Applying SponsorBlock…';
          reportProgress(99, null, null, 'Applying SponsorBlock…', true);
        }

        // Fallback for standard yt-dlp progress lines (e.g. from external downloaders/HLS/fragments)
        const stdProgressMatch = trimmed.match(/\[download\]\s+([0-9.]+)%\s+of\s+~?\s*([^\s]+)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([^\s]+))?/i);
        if (stdProgressMatch) {
          const percent = parseFloat(stdProgressMatch[1]);
          const speed = stdProgressMatch[3] || null;
          const eta = stdProgressMatch[4] || null;
          if (!Number.isNaN(percent)) {
            reportProgress(percent, speed, eta);
          }
        }

        if (isStderr) {
          stderr += trimmed + '\n';
          console.error(`[${jobId}:err] ${trimmed}`);
        } else {
          console.log(`[${jobId}] ${trimmed}`);
        }

        onLog && onLog(trimmed);
      }
    }

    function handleChunk(chunk, isStderr = false) {
      resetIdleTimer();
      const raw = (isStderr ? stderrRemainder : stdoutRemainder) + chunk.toString();
      const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');
      if (isStderr) {
        stderrRemainder = lines.pop() || '';
      } else {
        stdoutRemainder = lines.pop() || '';
      }
      processLines(lines, isStderr);
    }

    proc.stdout.on('data', (chunk) => handleChunk(chunk, false));
    proc.stderr.on('data', (chunk) => handleChunk(chunk, true));

    proc.on('close', (code, signal) => {
      if (stdoutRemainder.trim()) processLines([stdoutRemainder], false);
      if (stderrRemainder.trim()) processLines([stderrRemainder], true);
      if (idleTimer) clearTimeout(idleTimer);
      const wasStoppedByUser = !!options.jobId && userStoppedJobs.has(options.jobId);
      if (options.jobId) {
        clearStopTimers(activeProcesses.get(options.jobId));
        activeProcesses.delete(options.jobId);
        userStoppedJobs.delete(options.jobId);
      }
      if (timedOut) {
        return reject(new Error(`Download stalled: no output for ${Math.round(idleTimeoutMs / 60000)} minutes`));
      }
      // Covers both the common case (yt-dlp catches SIGINT itself and exits with a non-zero
      // code, so signal is null here) and the escalated-kill case (SIGTERM/SIGKILL actually
      // terminates it, so Node reports the real signal).
      const stoppedByUser = wasStoppedByUser || signal === 'SIGINT' || signal === 'SIGTERM' || signal === 'SIGKILL';
      if (code !== 0 && !stoppedByUser) {
        const errMsg = stderr.trim() || `yt-dlp exited with code ${code}`;
        console.error(`[${jobId}] Failed with exit code ${code}: ${errMsg}`);
        onLog && onLog(`[failed] Exit code ${code}: ${errMsg}`);
        return reject(new Error(errMsg));
      }
      if (stoppedByUser) {
        console.log(`[${jobId}] Recording stopped by user -> ${filepath || 'saved stream'}`);
        onLog && onLog(`[stopped] Recording stopped by user -> ${filepath || 'saved stream'}`);
      } else {
        console.log(`[${jobId}] Completed successfully -> ${filepath || 'unknown destination'}`);
        onLog && onLog(`[completed] Successfully saved: ${filepath || ''}`);
      }
      resolve({ filepath, command: commandStr, stoppedByUser });
    });

    proc.on('error', (err) => {
      if (idleTimer) clearTimeout(idleTimer);
      if (options.jobId) {
        clearStopTimers(activeProcesses.get(options.jobId));
        activeProcesses.delete(options.jobId);
        userStoppedJobs.delete(options.jobId);
      }
      console.error(`[${jobId}] Process spawn error: ${err.message}`);
      onLog && onLog(`[error] Process spawn error: ${err.message}`);
      reject(err);
    });
  });
}

// Runs `cmd args` and resolves with stdout, or null if the binary is missing/errors —
// used for version reporting where an optional tool (e.g. deno in local dev) may be absent.
function runCommand(cmd, args) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.on('close', (code) => resolve(code === 0 ? stdout : null));
    proc.on('error', () => resolve(null));
  });
}

function firstLine(output) {
  return output ? output.split('\n')[0].trim() : null;
}

async function getVersions() {
  const ffmpegBin = getFfmpegBin();
  const denoBin = getDenoBin();
  const [ytdlpOut, ffmpegOut, denoOut] = await Promise.all([
    runCommand(YTDLP_BIN, ['--version']),
    runCommand(ffmpegBin, ['-version']),
    runCommand(denoBin, ['--version']),
  ]);
  return {
    ytdlp: firstLine(ytdlpOut),
    ffmpeg: firstLine(ffmpegOut),
    deno: firstLine(denoOut),
    node: process.version,
  };
}

// Upgrades yt-dlp in place via pip. yt-dlp publishes its nightly/master builds to PyPI as
// pre-releases, so `--pre` is all that's needed to switch channels (see yt-dlp's own README
// "Update" section) — no separate index or package name required.
let isUpdatingYtdlp = false;

function updateYtdlp(channel) {
  if (isUpdatingYtdlp) {
    return Promise.reject(new Error('yt-dlp update is already in progress'));
  }
  const args = ['install', '--no-cache-dir', '--break-system-packages', '-U'];
  if (channel === 'nightly') args.push('--pre');
  args.push('yt-dlp[default,curl-cffi]');

  isUpdatingYtdlp = true;
  return new Promise((resolve, reject) => {
    const proc = spawn('pip3', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      isUpdatingYtdlp = false;
      if (code !== 0) return reject(new Error(stderr || `pip3 exited with code ${code}`));
      // A new yt-dlp can change which sites support features like --live-from-start.
      siteProfiles.refreshYtdlpFacts();
      resolve(stdout);
    });
    proc.on('error', (err) => {
      isUpdatingYtdlp = false;
      reject(err);
    });
  });
}

function getFfmpegAssetInfo() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux') {
    if (arch === 'x64') {
      return { filename: 'ffmpeg-master-latest-linux64-gpl.tar.xz' };
    }
    if (arch === 'arm64') {
      return { filename: 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz' };
    }
  } else if (platform === 'win32') {
    if (arch === 'x64') {
      return { filename: 'ffmpeg-master-latest-win64-gpl.zip' };
    }
    if (arch === 'arm64') {
      return { filename: 'ffmpeg-master-latest-winarm64-gpl.zip' };
    }
    if (arch === 'ia32') {
      return { filename: 'ffmpeg-master-latest-win32-gpl.zip' };
    }
  }

  throw new Error(`yt-dlp FFmpeg builds are not available for platform '${platform}' (${arch}).`);
}

function extractArchive(archivePath, outDir) {
  return new Promise((resolve, reject) => {
    if (archivePath.endsWith('.zip')) {
      if (process.platform === 'win32') {
        const psProc = spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${outDir}" -Force`,
        ]);
        let psStderr = '';
        psProc.stderr.on('data', (d) => (psStderr += d));
        psProc.on('close', (psCode) => {
          if (psCode === 0) return resolve();
          const tarProc = spawn('tar', ['-xf', archivePath, '-C', outDir]);
          tarProc.on('close', (tCode) => (tCode === 0 ? resolve() : reject(new Error(`Extraction failed: ${psStderr || `code ${psCode}`}`))));
          tarProc.on('error', () => reject(new Error(`Extraction failed: ${psStderr}`)));
        });
        psProc.on('error', () => {
          const tarProc = spawn('tar', ['-xf', archivePath, '-C', outDir]);
          tarProc.on('close', (tCode) => (tCode === 0 ? resolve() : reject(new Error(`Extraction failed for ${archivePath}`))));
          tarProc.on('error', (err) => reject(err));
        });
        return;
      }
      // Linux/macOS: try unzip first (standard for .zip), fallback to tar
      const unzipProc = spawn('unzip', ['-o', '-q', archivePath, '-d', outDir]);
      let unzipStderr = '';
      unzipProc.stderr.on('data', (d) => (unzipStderr += d));
      unzipProc.on('close', (code) => {
        if (code === 0) return resolve();
        const tarProc = spawn('tar', ['-xf', archivePath, '-C', outDir]);
        tarProc.on('close', (tCode) => (tCode === 0 ? resolve() : reject(new Error(unzipStderr || `unzip exited with code ${code}`))));
        tarProc.on('error', () => reject(new Error(`unzip failed with code ${code}: ${unzipStderr}`)));
      });
      unzipProc.on('error', () => {
        const tarProc = spawn('tar', ['-xf', archivePath, '-C', outDir]);
        tarProc.on('close', (tCode) => (tCode === 0 ? resolve() : reject(new Error(`Extraction failed for ${archivePath}`))));
        tarProc.on('error', (err) => reject(err));
      });
      return;
    }

    const tarProc = spawn('tar', ['-xf', archivePath, '-C', outDir]);
    let stderr = '';
    tarProc.stderr.on('data', (d) => (stderr += d));
    tarProc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `tar exited with code ${code}`));
    });
    tarProc.on('error', (err) => reject(err));
  });
}

function findBinary(dir, targetName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(fullPath, targetName);
      if (found) return found;
    } else if (entry.isFile() && entry.name.toLowerCase() === targetName.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

function installBinary(srcPath, destDir, binName) {
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, binName);
  const tempDest = path.join(destDir, `${binName}.tmp-${Date.now()}`);

  fs.copyFileSync(srcPath, tempDest);
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(tempDest, 0o755);
    } catch {}
  }

  try {
    fs.renameSync(tempDest, destPath);
  } catch (err) {
    if (process.platform === 'win32') {
      try {
        fs.unlinkSync(destPath);
        fs.renameSync(tempDest, destPath);
      } catch {
        fs.copyFileSync(tempDest, destPath);
        try { fs.unlinkSync(tempDest); } catch {}
      }
    } else {
      throw err;
    }
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(destPath, 0o755);
    } catch {}
  }
}

let isUpdatingFfmpeg = false;

function ffmpegDownloadUrl() {
  const { filename } = getFfmpegAssetInfo();
  return `https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/${filename}`;
}

function ffmpegResponseIdentity(res) {
  const etag = res.headers.get('etag');
  if (etag) return `etag:${etag}`;
  const modified = res.headers.get('last-modified');
  const length = res.headers.get('content-length');
  if (modified || length) return `metadata:${modified || ''}:${length || ''}`;
  try {
    const finalUrl = new URL(res.url);
    return `url:${finalUrl.origin}${finalUrl.pathname}`;
  } catch (_) {
    return `url:${res.url}`;
  }
}

async function getLatestFfmpegBuildIdentity() {
  const res = await fetch(ffmpegDownloadUrl(), {
    method: 'HEAD',
    headers: { 'User-Agent': 'yt-dlp-gui' },
  });
  if (!res.ok) {
    throw new Error(`Failed to check FFmpeg build (${res.status} ${res.statusText})`);
  }
  return ffmpegResponseIdentity(res);
}

function readInstalledFfmpegBuildIdentity() {
  try {
    return fs.readFileSync(FFMPEG_BUILD_MARKER, 'utf8').trim();
  } catch (_) {
    return '';
  }
}

function writeInstalledFfmpegBuildIdentity(identity) {
  if (!identity) return;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tempPath = `${FFMPEG_BUILD_MARKER}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${identity}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, FFMPEG_BUILD_MARKER);
}

async function updateFfmpeg(knownIdentity = null) {
  if (isUpdatingFfmpeg) {
    throw new Error('FFmpeg update is already in progress');
  }

  const { filename } = getFfmpegAssetInfo();
  const downloadUrl = ffmpegDownloadUrl();

  isUpdatingFfmpeg = true;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-ffmpeg-'));
  const archivePath = path.join(tempDir, filename);
  const extractDir = path.join(tempDir, 'extracted');

  try {
    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'yt-dlp-gui' },
    });
    if (!res.ok) {
      throw new Error(`Failed to download FFmpeg build (${res.status} ${res.statusText})`);
    }
    const downloadedIdentity = knownIdentity || ffmpegResponseIdentity(res);

    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(archivePath));

    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir);

    const binExt = process.platform === 'win32' ? '.exe' : '';
    const ffmpegTarget = `ffmpeg${binExt}`;
    const ffprobeTarget = `ffprobe${binExt}`;

    const ffmpegSrc = findBinary(extractDir, ffmpegTarget);
    const ffprobeSrc = findBinary(extractDir, ffprobeTarget);

    if (!ffmpegSrc) {
      throw new Error(`Extracted archive did not contain ${ffmpegTarget}`);
    }

    // Always install to persistent CUSTOM_BIN_DIR (/config/bin)
    installBinary(ffmpegSrc, CUSTOM_BIN_DIR, ffmpegTarget);
    if (ffprobeSrc) {
      installBinary(ffprobeSrc, CUSTOM_BIN_DIR, ffprobeTarget);
    }

    // Also update /usr/local/bin if running on Linux with write permissions (e.g. Docker)
    if (process.platform === 'linux') {
      try {
        fs.accessSync('/usr/local/bin', fs.constants.W_OK);
        installBinary(ffmpegSrc, '/usr/local/bin', ffmpegTarget);
        if (ffprobeSrc) {
          installBinary(ffprobeSrc, '/usr/local/bin', ffprobeTarget);
        }
      } catch {
        // Not writable, persistent custom bin dir in /config/bin is sufficient
      }
    }

    // Ensure CUSTOM_BIN_DIR is prepended to process.env.PATH
    const paths = (process.env.PATH || '').split(path.delimiter);
    if (!paths.includes(CUSTOM_BIN_DIR)) {
      process.env.PATH = `${CUSTOM_BIN_DIR}${path.delimiter}${process.env.PATH}`;
    }

    writeInstalledFfmpegBuildIdentity(downloadedIdentity);
    return { updated: true, ...(await getVersions()) };
  } finally {
    isUpdatingFfmpeg = false;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function updateFfmpegIfAvailable() {
  const latestIdentity = await getLatestFfmpegBuildIdentity();
  if (latestIdentity === readInstalledFfmpegBuildIdentity()) {
    return { updated: false, ...(await getVersions()) };
  }
  return updateFfmpeg(latestIdentity);
}

function getDenoAssetInfo() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux') {
    if (arch === 'x64') return { filename: 'deno-x86_64-unknown-linux-gnu.zip' };
    if (arch === 'arm64') return { filename: 'deno-aarch64-unknown-linux-gnu.zip' };
  } else if (platform === 'win32') {
    if (arch === 'x64') return { filename: 'deno-x86_64-pc-windows-msvc.zip' };
    if (arch === 'arm64') return { filename: 'deno-aarch64-pc-windows-msvc.zip' };
  } else if (platform === 'darwin') {
    if (arch === 'x64') return { filename: 'deno-x86_64-apple-darwin.zip' };
    if (arch === 'arm64') return { filename: 'deno-aarch64-apple-darwin.zip' };
  }

  throw new Error(`Deno builds are not available for platform '${platform}' (${arch}).`);
}

function denoDownloadUrl() {
  const { filename } = getDenoAssetInfo();
  return `https://github.com/denoland/deno/releases/latest/download/${filename}`;
}

let isUpdatingDeno = false;

async function getLatestDenoBuildIdentity() {
  const res = await fetch(denoDownloadUrl(), {
    method: 'HEAD',
    headers: { 'User-Agent': 'yt-dlp-gui' },
  });
  if (!res.ok) {
    throw new Error(`Failed to check Deno build (${res.status} ${res.statusText})`);
  }
  return ffmpegResponseIdentity(res);
}

function readInstalledDenoBuildIdentity() {
  try {
    return fs.readFileSync(DENO_BUILD_MARKER, 'utf8').trim();
  } catch (_) {
    return '';
  }
}

function writeInstalledDenoBuildIdentity(identity) {
  if (!identity) return;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tempPath = `${DENO_BUILD_MARKER}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${identity}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, DENO_BUILD_MARKER);
}

async function updateDeno(knownIdentity = null) {
  if (isUpdatingDeno) {
    throw new Error('Deno update is already in progress');
  }

  const { filename } = getDenoAssetInfo();
  const downloadUrl = denoDownloadUrl();

  isUpdatingDeno = true;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-deno-'));
  const archivePath = path.join(tempDir, filename);
  const extractDir = path.join(tempDir, 'extracted');

  try {
    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'yt-dlp-gui' },
    });
    if (!res.ok) {
      throw new Error(`Failed to download Deno build (${res.status} ${res.statusText})`);
    }
    const downloadedIdentity = knownIdentity || ffmpegResponseIdentity(res);

    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(archivePath));

    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir);

    const binExt = process.platform === 'win32' ? '.exe' : '';
    const denoTarget = `deno${binExt}`;

    const denoSrc = findBinary(extractDir, denoTarget);
    if (!denoSrc) {
      throw new Error(`Extracted archive did not contain ${denoTarget}`);
    }

    // Always install to persistent CUSTOM_BIN_DIR (/config/bin)
    installBinary(denoSrc, CUSTOM_BIN_DIR, denoTarget);

    // Also update /usr/local/bin if running on Linux with write permissions (e.g. Docker)
    if (process.platform === 'linux') {
      try {
        fs.accessSync('/usr/local/bin', fs.constants.W_OK);
        installBinary(denoSrc, '/usr/local/bin', denoTarget);
      } catch {
        // Not writable, persistent custom bin dir in /config/bin is sufficient
      }
    }

    // Ensure CUSTOM_BIN_DIR is prepended to process.env.PATH
    const paths = (process.env.PATH || '').split(path.delimiter);
    if (!paths.includes(CUSTOM_BIN_DIR)) {
      process.env.PATH = `${CUSTOM_BIN_DIR}${path.delimiter}${process.env.PATH}`;
    }

    writeInstalledDenoBuildIdentity(downloadedIdentity);
    return { updated: true, ...(await getVersions()) };
  } finally {
    isUpdatingDeno = false;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function updateDenoIfAvailable() {
  const latestIdentity = await getLatestDenoBuildIdentity();
  const installedMarker = readInstalledDenoBuildIdentity();
  if (latestIdentity && latestIdentity === installedMarker) {
    return { updated: false, ...(await getVersions()) };
  }

  // If no marker stored yet, check if currently installed deno matches the latest tag
  if (!installedMarker) {
    const currentVersion = firstLine(await runCommand(getDenoBin(), ['--version']));
    const versionMatch = latestIdentity && latestIdentity.match(/\/download\/v([0-9.]+)\//);
    if (versionMatch && currentVersion && currentVersion.includes(versionMatch[1])) {
      writeInstalledDenoBuildIdentity(latestIdentity);
      return { updated: false, ...(await getVersions()) };
    }
  }

  return updateDeno(latestIdentity);
}

async function searchYouTube(query, limit = 1) {
  const cleanLimit = Math.max(1, Math.min(10, parseInt(limit, 10) || 1));
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];
  const searchUrl = `ytsearch${cleanLimit}:${cleanQuery}`;
  const info = await getInfo(searchUrl, { flatPlaylist: true });
  const entries = [];
  if (info && Array.isArray(info.entries)) {
    for (const e of info.entries) {
      if (e && (e.id || e.url)) {
        entries.push({
          id: e.id,
          url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
          title: e.title,
          duration: typeof e.duration === 'number' ? e.duration : null,
          uploader: e.uploader || e.channel || null,
          thumbnail: e.thumbnails?.[0]?.url || e.thumbnail || null,
        });
      }
    }
  }
  return entries;
}

module.exports = {
  getInfo,
  resolveShareUrl,
  isRedditShareUrl,
  searchYouTube,
  download,
  buildDownloadArgs,
  resolveDownloadOptions,
  embedThumbnailFromUrl,
  formatCommand,
  getVersions,
  updateYtdlp,
  updateFfmpeg,
  updateFfmpegIfAvailable,
  getFfmpegDir,
  getFfmpegBin,
  updateDeno,
  updateDenoIfAvailable,
  getDenoBin,
  DOWNLOAD_DIR,
  COOKIES_FILE,
  stopDownload,
  assertPublicUrl,
  setTwitchAuthCookie,
  hasTwitchAuthCookie,
  getTwitchAuthTokenMasked,
  writeCookiesFilePreservingTwitchAuth,
  isPlaylistUrl,
  getDownloadIdleTimeoutMs,
  isYouTube,
  isBotCheckError,
  BOT_CHECK_HINT,
  withPrivateCookies,
  sweepPrivateCookieDirs,
  PRIVATE_COOKIES_ROOT,
};
