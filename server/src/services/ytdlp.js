const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/downloads';
const CONFIG_DIR = process.env.CONFIG_DIR || '/config';
const COOKIES_FILE = path.join(CONFIG_DIR, 'cookies.txt');
const YTDLP_CACHE_DIR = path.join(CONFIG_DIR, 'yt-dlp-cache');

// If a cookies.txt (Netscape format) has been saved via Settings, pass it to yt-dlp so
// age-restricted/members-only/private videos work. Absent by default.
function cookieArgs() {
  return fs.existsSync(COOKIES_FILE) ? ['--cookies', COOKIES_FILE] : [];
}

// yt-dlp's pip package doesn't bundle the EJS challenge-solver script the way official
// executables do, so YouTube extraction silently falls back to images-only formats unless
// we explicitly allow it to fetch that script at runtime. --cache-dir persists it (and other
// yt-dlp caches) across container restarts instead of re-fetching every time.
function commonArgs() {
  return ['--remote-components', 'ejs:github', '--cache-dir', YTDLP_CACHE_DIR, ...cookieArgs()];
}

// Runs `yt-dlp -J <url>` to fetch metadata (title, id, extractor, thumbnail, formats)
// without downloading anything. Used for the format picker and for watch/history dedup.
function getInfo(url, { flatPlaylist = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-J', '--no-warnings', ...commonArgs()];
    if (flatPlaylist) args.push('--flat-playlist');
    args.push(url);

    const proc = spawn(YTDLP_BIN, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('Failed to parse yt-dlp JSON output: ' + e.message));
      }
    });
    proc.on('error', reject);
  });
}

// Progress-template gives us a stable, parseable line for every progress tick instead of
// scraping the human-readable percentage string, which varies by yt-dlp version/locale.
const PROGRESS_TEMPLATE = 'YTDLP_PROGRESS %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s';

// User-facing quality caps ("4K", "1080p", ...) map to a max height. yt-dlp's `<=` selector
// plus the `/best[height<=N]` fallback means asking for 4K on a 1080p-only video just gets
// the best format at or below the cap instead of failing.
const QUALITY_HEIGHTS = { 2160: 2160, 1440: 1440, 1080: 1080, 720: 720, 480: 480, 360: 360 };

function buildFormatSelector({ audioOnly, formatSelector, quality }) {
  if (audioOnly) return 'bestaudio/best';
  if (formatSelector) return formatSelector;
  const height = quality ? QUALITY_HEIGHTS[parseInt(quality, 10)] : null;
  if (height) {
    return `bestvideo*[height<=${height}]+bestaudio/best[height<=${height}]/best[height<=${height}]`;
  }
  return 'bestvideo*+bestaudio/best';
}

// Downloads a single URL, streaming progress updates via onProgress({percent, speed, eta}).
// Resolves with { filepath } once yt-dlp exits successfully.
function download(url, options, onProgress) {
  const {
    audioOnly = false,
    formatSelector = '',
    quality = '',
    container = 'mp4',
    subtitles = false,
    subLangs = 'en.*',
  } = options;

  return new Promise((resolve, reject) => {
    const args = [
      '--newline',
      '--no-warnings',
      ...commonArgs(),
      '--progress-template', PROGRESS_TEMPLATE,
      '-o', `${DOWNLOAD_DIR}/%(uploader,extractor)s/%(title)s [%(id)s].%(ext)s`,
      '--print', 'after_move:FILEPATH %(filepath)s',
    ];

    if (audioOnly) {
      args.push('-x', '--audio-format', 'mp3', '-f', buildFormatSelector({ audioOnly }));
    } else {
      args.push('-f', buildFormatSelector({ formatSelector, quality }));
      args.push('--merge-output-format', container === 'mkv' ? 'mkv' : 'mp4');
    }

    if (subtitles) {
      args.push('--write-subs', '--write-auto-subs', '--sub-langs', subLangs || 'en.*', '--embed-subs');
    }

    args.push(url);

    const proc = spawn(YTDLP_BIN, args);
    let stderr = '';
    let filepath = null;

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('YTDLP_PROGRESS')) {
          const rest = line.replace('YTDLP_PROGRESS', '').trim();
          const [percentStr, speed, eta] = rest.split('|');
          const percent = parseFloat(percentStr.replace('%', '').trim());
          if (!Number.isNaN(percent)) {
            onProgress({ percent, speed: speed && speed.trim(), eta: eta && eta.trim() });
          }
        } else if (line.startsWith('FILEPATH ')) {
          filepath = line.replace('FILEPATH ', '').trim();
        }
      }
    });

    proc.stderr.on('data', (d) => (stderr += d));

    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      resolve({ filepath });
    });
    proc.on('error', reject);
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
  const [ytdlpOut, ffmpegOut, denoOut] = await Promise.all([
    runCommand(YTDLP_BIN, ['--version']),
    runCommand('ffmpeg', ['-version']),
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
  args.push('yt-dlp');

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

module.exports = { getInfo, download, getVersions, updateYtdlp, COOKIES_FILE };
