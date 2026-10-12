const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const siteProfiles = require('./siteProfiles');
const { DEFAULT_TEMPLATE: DEFAULT_OUTPUT_TEMPLATE } = require('./outputTemplate');

const {
  YTDLP_BIN, DOWNLOAD_DIR, VIDEO_DIR, MUSIC_DIR, COOKIES_FILE, YTDLP_CACHE_DIR, getDenoBin, getFfmpegDir, getFfmpegBin,
} = require('./ytdlpPaths');
const {
  cookieArgs, setTwitchAuthCookie, hasTwitchAuthCookie, getTwitchAuthTokenMasked,
  writeCookiesFilePreservingTwitchAuth, withPrivateCookies, sweepPrivateCookieDirs, PRIVATE_COOKIES_ROOT,
} = require('./ytdlpCookies');
const {
  getVersions, updateYtdlp, updateFfmpeg, updateFfmpegIfAvailable, updateDeno, updateDenoIfAvailable,
} = require('./ytdlpTools');

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

// yt-dlp aborts the whole download when one subtitle track can't be fetched — most often
// YouTube answering the caption request with HTTP 429. Callers retry without subtitles so
// the video itself still downloads.
const SUBTITLE_DOWNLOAD_ERROR_RE = /Unable to download (?:video )?subtitles/i;

function isSubtitleDownloadError(message) {
  return SUBTITLE_DOWNLOAD_ERROR_RE.test(String(message || ''));
}

// Pasted links often lack a scheme ("www.tiktok.com/@user/live", "youtu.be/abc"). yt-dlp
// treats those as search terms or local paths, so give anything that looks like a host an
// https:// prefix. Everything else (including ytsearch: queries) passes through untouched.
function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (raw.startsWith('//')) return `https:${raw}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:[/?#]|$)/i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}

// yt-dlp's UserNotLive error ("The channel is not currently live") — raised by extractors
// for a channel's live page (TikTok, Twitch, Kick, ...) while nobody is broadcasting. With
// --wait-for-video, yt-dlp keeps polling that page and starts recording once they go live.
const NOT_LIVE_RE = /The channel is not currently live/i;

function isNotLiveError(message) {
  return NOT_LIVE_RE.test(String(message || ''));
}

// "ERROR: [tiktok:live] cinnanako: The channel is not currently live" → the extractor and
// channel id, so an offline channel can still be shown by name.
function parseNotLiveError(message) {
  const m = String(message || '').match(/\[([^\]]+)\]\s*([^:\s]+):\s*The channel is not currently live/i);
  return m ? { extractor: m[1], channel: m[2] } : { extractor: null, channel: null };
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
  } catch (err) {
    throw new Error('Invalid URL', { cause: err });
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
const SHARE_RESOLVE_TIMEOUT_MS = 8 * 1000;
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

// Share links are resolved once on Analyze and again on enqueue; remember the answer so the
// second pass (and re-analyzing the same link) doesn't pay Reddit's round-trips again.
const SHARE_RESOLVE_CACHE_TTL_MS = 60 * 60 * 1000;
const SHARE_RESOLVE_CACHE_MAX = 200;
const shareResolveCache = new Map();

// Follows one share link's redirect chain with a single user agent. Resolves to the clean
// post URL, or rejects when that user agent didn't lead to a post.
async function resolveShareUrlWithAgent(shareUrl, userAgent) {
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
    if (resolved) return resolved;
    let next;
    try {
      next = new URL(location, current);
    } catch (_) {
      break;
    }
    if (!/(^|\.)reddit\.com$/i.test(next.hostname)) break;
    current = next.toString();
  }
  throw new Error(`did not redirect to a post (HTTP ${status})`);
}

// Returns the canonical URL for known short/share links, or the input unchanged. Never
// throws: if resolution fails we let yt-dlp try the original URL and report its own error.
async function resolveShareUrl(url) {
  if (!isRedditShareUrl(url)) return url;
  const shareUrl = url.trim();
  const cached = shareResolveCache.get(shareUrl);
  if (cached && cached.expires > Date.now()) return cached.resolved;
  // Try every user agent at once and take the first that works, so a blocked or slow agent
  // doesn't add its full timeout in front of the one Reddit actually answers.
  try {
    const resolved = await Promise.any(
      SHARE_RESOLVE_USER_AGENTS.map((userAgent) => resolveShareUrlWithAgent(shareUrl, userAgent))
    );
    console.log(`[ytdlp] Resolved Reddit share link ${shareUrl} -> ${resolved}`);
    if (shareResolveCache.size >= SHARE_RESOLVE_CACHE_MAX) {
      shareResolveCache.delete(shareResolveCache.keys().next().value);
    }
    shareResolveCache.set(shareUrl, { resolved, expires: Date.now() + SHARE_RESOLVE_CACHE_TTL_MS });
    return resolved;
  } catch (err) {
    const reasons = (err.errors || [err]).map((e) => e.message).join('; ');
    console.warn(`[ytdlp] Failed to resolve Reddit share link ${shareUrl}: ${reasons}`);
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
// Pass { reuseRecent: true } to accept a result probed for the same URL in the last few
// minutes (see rememberInfo) instead of running yt-dlp again.
async function getInfo(url, { resolveShare = true, reuseRecent = false, ...options } = {}) {
  const resolved = resolveShare ? await resolveShareUrl(url) : url;
  const cacheable = !options.playlistEnd && !options.playlistStart;
  if (reuseRecent && cacheable) {
    const recent = recallInfo(resolved);
    if (recent) {
      console.log(`[ytdlp:info] Reusing metadata fetched moments ago for ${resolved}`);
      return recent;
    }
  }
  const info = await getInfoResolved(resolved, options);
  if (cacheable) rememberInfo(resolved, info);
  return info;
}

// Analyze probes a link with `yt-dlp -J`, then the queue probes it again right before the
// download starts. Each probe is a full extraction (several seconds on YouTube once the JS
// challenge runs, several round-trips on Reddit), so keep recent single-video results and
// let the queue reuse them when a job is enqueued straight from the Analyze dialog.
const RECENT_INFO_TTL_MS = 10 * 60 * 1000;
const RECENT_INFO_MAX = 25;
const recentInfo = new Map();

function rememberInfo(url, info) {
  if (!info || typeof info !== 'object') return;
  // Flat playlist results are incomplete, and live/upcoming status goes stale quickly.
  if (info._type === 'playlist' || Array.isArray(info.entries)) return;
  if (!Array.isArray(info.formats) || info.formats.length === 0) return;
  if (info.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(info.live_status)) return;
  recentInfo.delete(url);
  if (recentInfo.size >= RECENT_INFO_MAX) recentInfo.delete(recentInfo.keys().next().value);
  recentInfo.set(url, { info, expires: Date.now() + RECENT_INFO_TTL_MS });
}

function recallInfo(url) {
  const entry = recentInfo.get(url);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    recentInfo.delete(url);
    return null;
  }
  return entry.info;
}

function clearRecentCaches() {
  recentInfo.clear();
  shareResolveCache.clear();
}

function getInfoResolved(url, { flatPlaylist = false, playlistStart = null, playlistEnd = null } = {}) {
  return new Promise((resolve, reject) => {
    try {
      assertPublicUrl(url);
    } catch (e) {
      return reject(e);
    }
    // A scheduled (not yet live) broadcast has no formats, which yt-dlp otherwise treats as
    // an error ("This live event will begin in …") — so the link could never be probed and
    // offered as "wait for it to start". Callers check for empty formats themselves.
    const args = ['-J', '--ignore-no-formats-error', ...commonArgs()];
    if (flatPlaylist) args.push('--flat-playlist');
    if (playlistStart && playlistStart > 0) args.push('--playlist-start', String(playlistStart));
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
const PROGRESS_TEMPLATE = 'download:YTDLP_PROGRESS %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s';

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

// Native-copy audio quality values: "0" (best VBR) or empty means "keep the source as-is".
function isNativeAudioQuality(audioQuality) {
  return audioQuality == null || String(audioQuality).trim() === '' || String(audioQuality).trim() === '0';
}

// yt-dlp's ExtractAudio only skips re-encoding when the downloaded stream's codec already
// matches --audio-format, and plain "bestaudio" on YouTube is almost always Opus. So for
// Opus (and for M4A at native quality) prefer a source stream in that codec — otherwise an
// M4A download is a lossy Opus->AAC transcode even though YouTube serves AAC directly.
function buildAudioFormatSelector({ container, audioQuality }) {
  if (container === 'opus') return 'bestaudio[acodec^=opus]/bestaudio/best/Audio_Only/audio_only';
  if (container === 'm4a' && isNativeAudioQuality(audioQuality)) return 'bestaudio[ext=m4a]/bestaudio/best/Audio_Only/audio_only';
  return 'bestaudio/best/Audio_Only/audio_only';
}

// Plain "bestaudio" on YouTube is Opus, and Opus muxed into MP4 is poorly supported: many
// players (QuickTime, Windows' built-in player, TVs, Plex/Jellyfin direct play) ignore its
// pre-skip/edit list and play the audio out of sync with the video. For MP4 output, try an
// AAC (m4a) stream first and only fall back to any audio when the site has none.
function buildVideoFormatSelector(videoFilter, container) {
  const video = `bestvideo*${videoFilter}`;
  const pair = container === 'mp4'
    ? `${video}+bestaudio[ext=m4a]/${video}+bestaudio`
    : `${video}+bestaudio`;
  return `${pair}/best${videoFilter}`;
}

function buildFormatSelector({ audioOnly, formatSelector, quality, container, audioQuality }) {
  if (audioOnly) return buildAudioFormatSelector({ container, audioQuality });
  if (formatSelector) return formatSelector;
  if (!quality) return buildVideoFormatSelector('', container);
  const parsed = parseInt(quality, 10);
  if (!Number.isNaN(parsed) && QUALITY_HEIGHTS[parsed]) {
    return buildVideoFormatSelector(`[height<=${QUALITY_HEIGHTS[parsed]}]`, container);
  }
  return `${quality}/${buildVideoFormatSelector('', container)}`;
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
  let originals = autoHits.filter((l) => !l.includes('-') || l.endsWith('-orig'));
  // YouTube lists both "en-orig" (the original ASR captions) and "en" (the same captions,
  // served through its translation endpoint) — fetching both doubles the requests that
  // trigger 429s for no extra content, so keep just the -orig track.
  originals = originals.filter((l) => !originals.includes(`${l}-orig`));
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

  // Queued jobs always pass a template (see outputTemplate.resolveTemplate); this fallback
  // only covers direct callers, and uses the same byte-capped default.
  const targetOutput = outputTemplate || `${VIDEO_DIR}/${DEFAULT_OUTPUT_TEMPLATE}`;

  const args = [
    '--newline',
    '--progress',
    ...commonArgs(),
    '--progress-template', PROGRESS_TEMPLATE,
    '--progress-template', 'postprocess:YTDLP_POSTPROCESS %(progress._percent_str)s',
    '-o', targetOutput,
    '--print', 'after_move:FILEPATH %(filepath)s',
    // The planned output path, printed before downloading starts. --print implies --quiet, so
    // there are no "[download] Destination:" lines; without this a recording the user stops
    // (or one killed mid-post-processing) never reports where it was saved, and post-steps
    // like live chunk splitting are silently skipped.
    '--print', 'before_dl:DESTFILE %(filename)s',
    // --print implies --quiet, and in quiet mode yt-dlp starts its ffmpeg downloader (live
    // HLS/FLV captures, --download-sections, ...) with "-loglevel quiet", so a failure surfaces
    // only as "ffmpeg exited with code N" with no reason. Raising ffmpeg back to "error" keeps
    // its progress stats silent but lets the real cause (HTTP 403/404, bad input, ...) reach
    // the job log. Deliberately unconditional: a live URL isn't always flagged isLive up front,
    // and the flag has no effect on downloads yt-dlp doesn't hand to ffmpeg.
    '--downloader-args', 'ffmpeg_i:-loglevel error',
  ];

  if (audioOnly) {
    const audioFormat = AUDIO_FORMATS.includes(container) ? container : 'mp3';
    args.push('-x', '--audio-format', audioFormat, '-f', buildFormatSelector({ audioOnly, container: audioFormat, audioQuality }));
    if (audioQuality) {
      args.push('--audio-quality', String(audioQuality));
    }
  } else {
    args.push('-f', buildFormatSelector({ formatSelector, quality, container }));
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

  // SponsorBlock removal and --download-sections cut the file with a stream copy, which can
  // only start video on a keyframe while audio is cut exactly — so every cut leaves the audio
  // ahead of the video. Re-encoding just around the cut points keeps the two in sync.
  if (sponsorblockRemoveCats || (options.downloadSections && options.downloadSections.trim())) {
    args.push('--force-keyframes-at-cuts');
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
  if (active.streamEnded) {
    // Nothing is left to record, and interrupting yt-dlp now would abort the merge or
    // SponsorBlock pass and lose the file. Let it finish; the busy check below still
    // terminates it if it has actually hung.
    onLog && onLog('Stream already ended — letting yt-dlp finish saving the recording instead of interrupting it');
    active.stopTimers = [setTimeout(() => escalateStop(jobId, active, Date.now()), BUSY_SAMPLE_WINDOW_MS)];
    return true;
  }
  try {
    // On POSIX, yt-dlp receives SIGINT and handles its FFmpeg child. On Windows, a real
    // CTRL+BREAK reaches the detached process group; ChildProcess.kill('SIGINT') is forceful.
    if (process.platform === 'win32') sendWindowsCtrlBreak(proc.pid, onLog);
    else process.kill(proc.pid, 'SIGINT');
  } catch (err) {
    console.error(`[ytdlp] Failed to send SIGINT to job ${jobId}: ${err.message}`);
    return false;
  }
  const stopRequestedAt = Date.now();
  active.stopTimers = [setTimeout(() => escalateStop(jobId, active, stopRequestedAt), STOP_GRACE_MS)];
  return true;
}

// Terminates a job that hasn't exited after a stop request, unless it is still busy.
// Merging and SponsorBlock-cutting a multi-hour capture (a full re-encode with
// --force-keyframes-at-cuts) can take hours, and killing it throws away the finished file,
// so keep waiting while the process group is using CPU, up to STOP_MAX_WAIT_MS.
function escalateStop(jobId, active, stopRequestedAt, cpuBaseline = null, busyNoted = false) {
  if (activeProcesses.get(jobId) !== active) return;
  const { proc, onLog } = active;
  const cpu = readProcessGroupCpuTicks(proc.pid);
  const waitedMs = Date.now() - stopRequestedAt;
  if (cpu == null && waitedMs < STOP_GRACE_MS) {
    // No /proc (Windows): can't tell busy from hung, so fall back to the plain grace period.
    active.stopTimers.push(setTimeout(() => escalateStop(jobId, active, stopRequestedAt), STOP_GRACE_MS - waitedMs));
    return;
  }
  if (cpu != null && waitedMs < STOP_MAX_WAIT_MS) {
    if (cpuBaseline == null || isBusyCpuDelta(cpu - cpuBaseline.ticks, Date.now() - cpuBaseline.at)) {
      if (cpuBaseline != null && !busyNoted) {
        busyNoted = true;
        onLog && onLog('Still finalizing the recording (yt-dlp/FFmpeg busy) — waiting for it to finish');
      }
      const baseline = { ticks: cpu, at: Date.now() };
      active.stopTimers.push(setTimeout(
        () => escalateStop(jobId, active, stopRequestedAt, baseline, busyNoted),
        BUSY_SAMPLE_WINDOW_MS,
      ));
      return;
    }
  }
  console.log(`[ytdlp] Graceful stop still pending for job ${jobId}; terminating process group via SIGTERM`);
  killProcessTree(proc, 'SIGTERM');
  active.stopTimers.push(setTimeout(() => {
    if (activeProcesses.get(jobId) === active) {
      console.log(`[ytdlp] Job ${jobId} still alive after SIGTERM, sending SIGKILL`);
      killProcessTree(proc, 'SIGKILL');
    }
  }, 5 * 60 * 1000));
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
// Silence isn't always a hang: `--print` implies --quiet, so FFmpeg merging/SponsorBlock
// cutting of a multi-hour capture prints nothing for a long time. When the watchdog fires,
// the job's process group is given a short sampling window and spared if it's still using
// CPU (a wedged network read uses essentially none), up to this hard cap of total silence.
const DOWNLOAD_MAX_QUIET_MS = parseInt(process.env.DOWNLOAD_MAX_QUIET_MS || String(4 * 60 * 60 * 1000), 10);
const BUSY_SAMPLE_WINDOW_MS = 60 * 1000;
// Average CPU share (of one core) the process group must use over a sampling window to
// count as working. Linux reports CPU time in USER_HZ ticks, which is 100/s in practice.
const BUSY_MIN_CPU_SHARE = 0.005;
const CLOCK_TICKS_PER_SEC = 100;
const STREAM_ENDED_STAGE = 'Stream ended — finishing & saving…';
// After a stop request, how long yt-dlp gets to finalize before the process group is
// terminated, and the hard cap on waiting while it is still visibly busy post-processing.
const STOP_GRACE_MS = 30 * 60 * 1000;
const STOP_MAX_WAIT_MS = parseInt(process.env.STOP_MAX_WAIT_MS || String(4 * 60 * 60 * 1000), 10);

// Total CPU ticks (including reaped children) used by every process in a process group,
// or null where /proc isn't available (non-Linux) so callers fall back to plain idle kills.
function readProcessGroupCpuTicks(pgid, procRoot = '/proc') {
  let entries;
  try {
    entries = fs.readdirSync(procRoot);
  } catch (_) {
    return null;
  }
  let total = 0;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try {
      stat = fs.readFileSync(path.join(procRoot, entry, 'stat'), 'utf8');
    } catch (_) {
      continue; // exited between readdir and read
    }
    // The command name (field 2) can contain spaces/parens, so parse from the last ')'.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (parseInt(fields[2], 10) !== pgid) continue;
    // utime, stime, cutime, cstime
    for (const i of [11, 12, 13, 14]) total += parseInt(fields[i], 10) || 0;
  }
  return total;
}

function isBusyCpuDelta(deltaTicks, windowMs) {
  return deltaTicks >= (windowMs / 1000) * CLOCK_TICKS_PER_SEC * BUSY_MIN_CPU_SHARE;
}

// yt-dlp's stderr for a flaky live capture can repeat the same line hundreds of times; keep
// each distinct line once (first-seen order) with a repeat count so errors stay readable.
function summarizeErrorOutput(text) {
  const counts = new Map();
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed) counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
  }
  return [...counts].map(([line, n]) => (n > 1 ? `${line} (×${n})` : line)).join('\n');
}

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
  // Null while a --wait-for-video job waits for its broadcast; switched to the live watchdog
  // once the stream starts and progress arrives (see processLines).
  let idleTimeoutMs = getDownloadIdleTimeoutMs(url, options);

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
    // Only set by the after_move print, i.e. once yt-dlp has fully finished and moved the file.
    let finalFilepath = null;
    let timedOut = false;
    let stalledQuietMs = 0;

    if (options.jobId) {
      activeProcesses.set(options.jobId, { proc, onProgress, onLog, stopTimers: [] });
    }
    if (typeof options.onSpawn === 'function' && proc.pid) {
      options.onSpawn(proc.pid);
    }

    let idleTimer = null;
    let lastOutputAt = Date.now();
    // CPU sample taken when the current silent stretch was last checked; null until the
    // watchdog first fires, then used to tell a busy-but-quiet process from a hung one.
    let cpuBaseline = null;
    let quietWorkNoted = false;
    function armIdleTimer(delayMs) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(onIdle, delayMs);
    }
    function onIdle() {
      // Once the user asks to stop a live recording, post-processing may legitimately be
      // quiet for a long time (especially for a large capture). Keep waiting instead of
      // treating the lack of output as a hung download; the separate stop fallback is the
      // last resort for a process that never exits.
      if (options.jobId && userStoppedJobs.has(options.jobId)) {
        armIdleTimer(idleTimeoutMs);
        return;
      }
      const quietMs = Date.now() - lastOutputAt;
      const cpu = readProcessGroupCpuTicks(proc.pid);
      if (cpu != null && quietMs < DOWNLOAD_MAX_QUIET_MS) {
        if (cpuBaseline == null) {
          cpuBaseline = { ticks: cpu, at: Date.now() };
          armIdleTimer(BUSY_SAMPLE_WINDOW_MS);
          return;
        }
        const windowMs = Date.now() - cpuBaseline.at;
        if (isBusyCpuDelta(cpu - cpuBaseline.ticks, windowMs)) {
          if (!quietWorkNoted) {
            quietWorkNoted = true;
            onLog && onLog(`No output for ${Math.round(quietMs / 60000)} min, but yt-dlp/FFmpeg is still working (likely post-processing) — waiting`);
          }
          cpuBaseline = { ticks: cpu, at: Date.now() };
          armIdleTimer(Math.min(idleTimeoutMs, DOWNLOAD_MAX_QUIET_MS - quietMs));
          return;
        }
      }
      timedOut = true;
      stalledQuietMs = quietMs;
      const msg = `No output for ${Math.round(quietMs / 60000)} min — terminating as hung`;
      console.error(`[${jobId}] ${msg}`);
      onLog && onLog(`[error] ${msg}`);
      killProcessTree(proc, 'SIGKILL');
    }
    function resetIdleTimer() {
      if (idleTimeoutMs == null) return;
      lastOutputAt = Date.now();
      cpuBaseline = null;
      quietWorkNoted = false;
      armIdleTimer(idleTimeoutMs);
    }
    resetIdleTimer();

    let stdoutRemainder = '';
    let stderrRemainder = '';
    const isMultiFormat = !options.audioOnly && (!options.formatSelector || options.formatSelector.includes('+'));
    let currentPass = 1;
    let highestPassPercent = 0;
    let postprocessSample = null;
    let streamEnded = false;

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
      } else if (streamEnded && (!explicitStage || /^Downloading/i.test(explicitStage))) {
        stage = STREAM_ENDED_STAGE;
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
        // Multi-threaded fragment downloads (e.g. YouTube --live-from-start fetching video
        // and audio concurrently) prefix each progress line with its thread number: "1: ".
        const trimmed = line.trim().replace(/^\d+:\s*(?=YTDLP_)/, '');
        if (!trimmed) continue;

        if (trimmed.startsWith('YTDLP_PROGRESS')) {
          if (idleTimeoutMs == null && options.waitForLive) {
            idleTimeoutMs = LIVE_DOWNLOAD_IDLE_TIMEOUT_MS;
            onLog && onLog('Broadcast is live — recording started');
            resetIdleTimer();
          }
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

        if (trimmed.startsWith('FILEPATH ')) {
          filepath = trimmed.replace('FILEPATH ', '').trim();
          finalFilepath = filepath;
          console.log(`[${jobId}] Destination file: ${filepath}`);
          onLog && onLog(`[destination] ${filepath}`);
          continue;
        }

        // With --live-from-start, yt-dlp keeps going after the broadcast ends: it finishes
        // the remaining fragments, merges, and runs SponsorBlock, mostly without output. Say
        // so, otherwise the job looks like it's still recording a stream that's over.
        if (!streamEnded && /no longer live\. Giving up/i.test(trimmed)) {
          streamEnded = true;
          const active = options.jobId && activeProcesses.get(options.jobId);
          if (active) active.streamEnded = true;
          onLog && onLog('The live stream has ended. yt-dlp is finishing the download, then merging and post-processing — this can take a long time for a long stream; no need to stop it.');
          reportProgress(99, null, null, STREAM_ENDED_STAGE, true);
        }

        if (trimmed.startsWith('DESTFILE ')) {
          filepath = trimmed.slice('DESTFILE '.length).trim();
          continue;
        }

        if (trimmed.includes('[download] Destination: ')) {
          const dest = trimmed.split('[download] Destination: ')[1]?.trim();
          if (dest) filepath = dest.replace(/\.part$/, '');
        }

        if (trimmed.includes('[Merger] Merging formats')) {
          reportProgress(99, null, null, 'Merging formats…', true);
        } else if (trimmed.includes('[ExtractAudio]')) {
          reportProgress(99, null, null, 'Extracting audio…', true);
        } else if (
          trimmed.includes('[SponsorBlock]') &&
          !trimmed.includes('not supported') &&
          !trimmed.includes('unavailable') &&
          !trimmed.includes('SponsorBlock is not')
        ) {
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
        return reject(new Error(`Download stalled: no output for ${Math.round(stalledQuietMs / 60000)} minutes`));
      }
      // Covers both the common case (yt-dlp catches SIGINT itself and exits with a non-zero
      // code, so signal is null here) and the escalated-kill case (SIGTERM/SIGKILL actually
      // terminates it, so Node reports the real signal).
      const stoppedByUser = wasStoppedByUser || signal === 'SIGINT' || signal === 'SIGTERM' || signal === 'SIGKILL';
      const errSummary = summarizeErrorOutput(stderr);
      // yt-dlp exits non-zero if *any* error was reported, including ones it recovered from
      // (e.g. a live capture skipping fragments that returned no data). If it still got as
      // far as moving the finished file into place, keep the file rather than failing the job.
      const completedWithErrors = code !== 0 && !stoppedByUser
        && !!finalFilepath && fs.existsSync(finalFilepath);
      if (code !== 0 && !stoppedByUser && !completedWithErrors) {
        const errMsg = errSummary || `yt-dlp exited with code ${code}`;
        console.error(`[${jobId}] Failed with exit code ${code}: ${errMsg}`);
        onLog && onLog(`[failed] Exit code ${code}: ${errMsg}`);
        return reject(new Error(errMsg));
      }
      if (completedWithErrors) {
        console.warn(`[${jobId}] Exit code ${code} but output was saved -> ${finalFilepath}`);
        onLog && onLog(`[warning] yt-dlp exited with code ${code} but saved the file; it may have gaps:\n${errSummary}`);
      }
      if (stoppedByUser && !finalFilepath && filepath && !fs.existsSync(filepath)) {
        onLog && onLog(`[warning] Stopped before yt-dlp finished writing ${filepath}; any partial files were left next to it`);
        filepath = null;
      }
      if (stoppedByUser) {
        console.log(`[${jobId}] Recording stopped by user -> ${filepath || 'saved stream'}`);
        onLog && onLog(`[stopped] Recording stopped by user -> ${filepath || 'saved stream'}`);
      } else {
        console.log(`[${jobId}] Completed successfully -> ${filepath || 'unknown destination'}`);
        onLog && onLog(`[completed] Successfully saved: ${filepath || ''}`);
      }
      resolve({ filepath, command: commandStr, stoppedByUser, completedWithErrors });
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
  clearRecentCaches,
  resolveShareUrl,
  isRedditShareUrl,
  searchYouTube,
  download,
  buildDownloadArgs,
  buildFormatSelector,
  resolveDownloadOptions,
  expectedOutputExt,
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
  VIDEO_DIR,
  MUSIC_DIR,
  COOKIES_FILE,
  stopDownload,
  assertPublicUrl,
  setTwitchAuthCookie,
  hasTwitchAuthCookie,
  getTwitchAuthTokenMasked,
  writeCookiesFilePreservingTwitchAuth,
  isPlaylistUrl,
  getDownloadIdleTimeoutMs,
  readProcessGroupCpuTicks,
  isBusyCpuDelta,
  summarizeErrorOutput,
  isYouTube,
  isBotCheckError,
  isSubtitleDownloadError,
  BOT_CHECK_HINT,
  normalizeUrl,
  isNotLiveError,
  parseNotLiveError,
  withPrivateCookies,
  sweepPrivateCookieDirs,
  PRIVATE_COOKIES_ROOT,
};
