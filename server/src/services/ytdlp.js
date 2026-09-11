const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '..', '..', 'downloads');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
const COOKIES_FILE = path.join(CONFIG_DIR, 'cookies.txt');
const YTDLP_CACHE_DIR = path.join(CONFIG_DIR, 'yt-dlp-cache');
const CUSTOM_BIN_DIR = path.join(CONFIG_DIR, 'bin');

// Ensure custom/persisted bin dir is in process.env.PATH if it exists
if (fs.existsSync(CUSTOM_BIN_DIR)) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  if (!paths.includes(CUSTOM_BIN_DIR)) {
    process.env.PATH = `${CUSTOM_BIN_DIR}${path.delimiter}${process.env.PATH}`;
  }
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
// expiry, name, value. Returns null for comments/blank lines/malformed rows.
function parseCookieLine(line) {
  if (!line || line.trim().startsWith('#')) return null;
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

// Runs `yt-dlp -J <url>` to fetch metadata (title, id, extractor, thumbnail, formats)
// without downloading anything. Used for the format picker and for watch/history dedup.
// Metadata lookups should be fast; a hung one (stalled extractor, network partition) would
// otherwise block a queue slot indefinitely during the pre-download step, or block the
// watch scheduler's tick, forever.
const GETINFO_TIMEOUT_MS = parseInt(process.env.GETINFO_TIMEOUT_MS || String(2 * 60 * 1000), 10);

function getInfo(url, { flatPlaylist = false, playlistEnd = null } = {}) {
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
    const proc = spawn(YTDLP_BIN, args, { detached: process.platform !== 'win32' });
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

// Accepts a comma-separated string or an array of SponsorBlock category names and
// normalizes it to the comma-separated form yt-dlp's --sponsorblock-* flags expect.
function normalizeCategories(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(',');
  return String(value).trim();
}

function buildDownloadArgs(url, options = {}) {
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
  } = options;

  const args = [
    '--newline',
    '--progress',
    ...commonArgs(),
    '--progress-template', 'download:YTDLP_PROGRESS %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '--progress-template', 'postprocess:YTDLP_POSTPROCESS %(progress._percent_str)s',
    '-o', `${DOWNLOAD_DIR}/%(uploader,extractor)s/%(title)s [%(id)s].%(ext)s`,
    '--print', 'after_move:FILEPATH %(filepath)s',
  ];

  if (audioOnly) {
    // The Watch modal (and any future caller) offers mp3/m4a/opus/flac as the audio
    // container, but this previously always hardcoded mp3 — silently ignoring the choice.
    const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac'];
    const audioFormat = AUDIO_FORMATS.includes(container) ? container : 'mp3';
    args.push('-x', '--audio-format', audioFormat, '-f', buildFormatSelector({ audioOnly }));
  } else {
    args.push('-f', buildFormatSelector({ formatSelector, quality }));
    if (container === 'ts') {
      args.push('--merge-output-format', 'ts');
    } else {
      args.push('--merge-output-format', container === 'mkv' ? 'mkv' : 'mp4');
    }
  }

  if (subtitles) {
    // --write-subs is required so yt-dlp actually fetches the subtitle tracks to embed, but by
    // default yt-dlp keeps that downloaded .srt/.vtt alongside the video once --write-subs is
    // set (see FFmpegEmbedSubtitlePP's `already_have_subtitle` in yt-dlp's source). We only want
    // them embedded, not left as separate sidecar files, so force cleanup of the temp files.
    args.push(
      '--write-subs', '--write-auto-subs', '--sub-langs', subLangs || 'en.*', '--embed-subs',
      '--compat-options', 'no-keep-subs',
    );
  }

  // Embed extras directly into the output file instead of leaving separate sidecar files.
  if (embedThumbnail) {
    args.push('--embed-thumbnail');
  }
  if (embedMetadata) {
    args.push('--embed-metadata');
  }
  if (embedChapters) {
    args.push('--embed-chapters');
  }

  // SponsorBlock: cut the chosen segment categories out of the file automatically.
  const sponsorblockRemoveCats = normalizeCategories(sponsorblockRemove);
  if (sponsorblockRemoveCats) {
    args.push('--sponsorblock-remove', sponsorblockRemoveCats);
  }

  // Twitch specific configuration
  const isTwitch = /twitch\.tv/i.test(url) || options.isTwitch;
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
  }

  if (options.downloadSections) {
    args.push('--download-sections', options.downloadSections.trim());
  }

  if (options.twitchChat) {
    args.push('--write-subs', '--sub-langs', 'rechat,all');
  }

  args.push(url);
  return args;
}

const activeProcesses = new Map();

// yt-dlp spawns ffmpeg (merge/postprocess) as its own child process. Signaling only the
// direct child (proc.kill()) leaves ffmpeg running as an orphan after "stop". Processes are
// spawned detached (see download() below) so they're their own process-group leader on
// POSIX, letting us signal the whole group via the negative pid; Windows has no such
// concept, so taskkill /T there kills the process and its children instead.
function killProcessTree(proc, signal) {
  if (!proc || proc.killed || !proc.pid) return;
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

function stopDownload(jobId) {
  const proc = activeProcesses.get(jobId);
  if (!proc) return false;
  console.log(`[ytdlp] Gracefully stopping download for job ${jobId} via SIGINT`);
  try {
    killProcessTree(proc, 'SIGINT');
  } catch (err) {
    console.error(`[ytdlp] Failed to send SIGINT to job ${jobId}: ${err.message}`);
    return false;
  }
  setTimeout(() => {
    if (activeProcesses.has(jobId)) {
      console.log(`[ytdlp] Force terminating lingering job ${jobId} via SIGTERM`);
      killProcessTree(proc, 'SIGTERM');
    }
  }, 8000);
  setTimeout(() => {
    if (activeProcesses.has(jobId)) {
      console.log(`[ytdlp] Job ${jobId} still alive after SIGTERM, sending SIGKILL`);
      killProcessTree(proc, 'SIGKILL');
    }
  }, 16000);
  return true;
}

// Idle-watchdog: if yt-dlp prints nothing at all for this long, assume it's hung (stuck
// network call, wedged extractor) and kill it rather than tying up a queue slot forever.
// Disabled for --wait-for-video jobs, which are *supposed* to sit idle while polling for a
// stream to go live.
const DOWNLOAD_IDLE_TIMEOUT_MS = parseInt(process.env.DOWNLOAD_IDLE_TIMEOUT_MS || String(15 * 60 * 1000), 10);

// Downloads a single URL, streaming progress updates via onProgress({percent, speed, eta})
// and log messages via onLog(line).
// Resolves with { filepath, command } once yt-dlp exits successfully.
function download(url, options = {}, onProgress, onLog) {
  const args = buildDownloadArgs(url, options);
  const commandStr = formatCommand(YTDLP_BIN, args);
  const jobId = options.jobId ? `job:${options.jobId}` : 'download';
  const ffmpegDir = getFfmpegDir();

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
    // detached: true makes the child (and any grandchild ffmpeg it spawns) the leader of
    // its own process group on POSIX, so killProcessTree() can signal -pid to reach both.
    const proc = spawn(YTDLP_BIN, args, { detached: process.platform !== 'win32' });
    let stderr = '';
    let filepath = null;
    let timedOut = false;

    if (options.jobId) {
      activeProcesses.set(options.jobId, proc);
    }
    if (typeof options.onSpawn === 'function' && proc.pid) {
      options.onSpawn(proc.pid);
    }

    let idleTimer = null;
    function resetIdleTimer() {
      if (options.waitForLive) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        const msg = `No output for ${Math.round(DOWNLOAD_IDLE_TIMEOUT_MS / 60000)} min — terminating as hung`;
        console.error(`[${jobId}] ${msg}`);
        onLog && onLog(`[error] ${msg}`);
        killProcessTree(proc, 'SIGKILL');
      }, DOWNLOAD_IDLE_TIMEOUT_MS);
    }
    resetIdleTimer();

    let stdoutRemainder = '';
    let stderrRemainder = '';
    const isMultiFormat = !options.audioOnly && (!options.formatSelector || options.formatSelector.includes('+'));
    let currentPass = 1;
    let highestPassPercent = 0;

    function reportProgress(rawPercent, speed, eta, explicitStage) {
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

      if (isMultiFormat) {
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
            reportProgress(Math.min(99, 90 + percent * 0.09), null, null, 'Post-processing…');
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
          reportProgress(99, null, null, 'Merging formats…');
        } else if (trimmed.includes('[ExtractAudio]')) {
          currentStage = 'Extracting audio…';
          reportProgress(99, null, null, 'Extracting audio…');
        } else if (trimmed.includes('[SponsorBlock]')) {
          currentStage = 'Applying SponsorBlock…';
          reportProgress(99, null, null, 'Applying SponsorBlock…');
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
      if (options.jobId) {
        activeProcesses.delete(options.jobId);
      }
      if (timedOut) {
        return reject(new Error(`Download stalled: no output for ${Math.round(DOWNLOAD_IDLE_TIMEOUT_MS / 60000)} minutes`));
      }
      const stoppedByUser = signal === 'SIGINT' || signal === 'SIGTERM';
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
        activeProcesses.delete(options.jobId);
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
  const [ytdlpOut, ffmpegOut, denoOut] = await Promise.all([
    runCommand(YTDLP_BIN, ['--version']),
    runCommand(ffmpegBin, ['-version']),
    runCommand('deno', ['--version']),
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
function updateYtdlp(channel) {
  const args = ['install', '--no-cache-dir', '--break-system-packages', '-U'];
  if (channel === 'nightly') args.push('--pre');
  args.push('yt-dlp[default,curl-cffi]');

  return new Promise((resolve, reject) => {
    const proc = spawn('pip3', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `pip3 exited with code ${code}`));
      resolve(stdout);
    });
    proc.on('error', reject);
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
    const tarProc = spawn('tar', ['-xf', archivePath, '-C', outDir]);
    let stderr = '';
    tarProc.stderr.on('data', (d) => (stderr += d));
    tarProc.on('close', (code) => {
      if (code === 0) return resolve();
      // On Windows, fallback to PowerShell Expand-Archive if tar failed on a zip
      if (process.platform === 'win32' && archivePath.endsWith('.zip')) {
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
          reject(new Error(`Extraction failed: ${stderr || psStderr || `code ${psCode}`}`));
        });
        psProc.on('error', () => reject(new Error(`Extraction failed: ${stderr}`)));
      } else {
        reject(new Error(stderr || `tar exited with code ${code}`));
      }
    });
    tarProc.on('error', (err) => {
      if (process.platform === 'win32' && archivePath.endsWith('.zip')) {
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
          reject(new Error(`Extraction failed: ${err.message}; ${psStderr}`));
        });
        psProc.on('error', () => reject(err));
      } else {
        reject(err);
      }
    });
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

async function updateFfmpeg() {
  if (isUpdatingFfmpeg) {
    throw new Error('FFmpeg update is already in progress');
  }

  const { filename } = getFfmpegAssetInfo();
  const downloadUrl = `https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/${filename}`;

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

    return await getVersions();
  } finally {
    isUpdatingFfmpeg = false;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = {
  getInfo,
  download,
  buildDownloadArgs,
  formatCommand,
  getVersions,
  updateYtdlp,
  updateFfmpeg,
  getFfmpegDir,
  getFfmpegBin,
  COOKIES_FILE,
  stopDownload,
  assertPublicUrl,
  setTwitchAuthCookie,
  hasTwitchAuthCookie,
  getTwitchAuthTokenMasked,
  writeCookiesFilePreservingTwitchAuth,
};
