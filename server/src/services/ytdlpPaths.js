// Where yt-dlp, its tools, downloads and config live, and which binaries to run.
const fs = require('fs');
const path = require('path');

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.resolve(__dirname, '..', '..', '..', 'downloads');
// Optional separate mounts for video and music. Unset, videos go straight into DOWNLOAD_DIR
// and music into DOWNLOAD_DIR/Music, as before. Folders saved in Settings take precedence.
const VIDEO_DIR = process.env.VIDEO_DIR || DOWNLOAD_DIR;
const MUSIC_DIR = process.env.MUSIC_DIR || '';
const CONFIG_DIR = process.env.CONFIG_DIR || path.resolve(__dirname, '..', '..', '..', 'config');
const COOKIES_FILE = path.join(CONFIG_DIR, 'cookies.txt');
const CRAWLER_COOKIES_FILE = path.join(CONFIG_DIR, 'crawler_cookies.txt');
const YTDLP_CACHE_DIR = path.join(CONFIG_DIR, 'yt-dlp-cache');
const CUSTOM_BIN_DIR = path.join(CONFIG_DIR, 'bin');
const FFMPEG_BUILD_MARKER = path.join(CONFIG_DIR, 'ffmpeg-build-id');

// Ensure custom/persisted bin dir is in process.env.PATH if it exists
if (fs.existsSync(CUSTOM_BIN_DIR)) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  if (!paths.includes(CUSTOM_BIN_DIR)) {
    process.env.PATH = `${CUSTOM_BIN_DIR}${path.delimiter}${process.env.PATH}`;
  }
}

// Absolute folder for music saved under `folder` (from Settings, a Watch or a request).
// Blank, or "Music" (the old built-in default, which older versions saved automatically),
// means the default: MUSIC_DIR when set, else DOWNLOAD_DIR/Music. Other relative folders
// sit under DOWNLOAD_DIR.
function resolveMusicDir(folder) {
  const value = folder ? String(folder).trim() : '';
  if (!value || value === 'Music') return MUSIC_DIR || path.join(DOWNLOAD_DIR, 'Music');
  return path.isAbsolute(value) ? value : path.join(DOWNLOAD_DIR, value);
}

// QuickJS-ng's CLI binary, `qjs`: the copy installed by the in-app updater if there is one,
// else whatever is on PATH (the image's baseline in /usr/local/bin).
function getQuickjsBin() {
  const binName = process.platform === 'win32' ? 'qjs.exe' : 'qjs';
  if (fs.existsSync(path.join(CUSTOM_BIN_DIR, binName))) {
    return path.join(CUSTOM_BIN_DIR, binName);
  }
  return 'qjs';
}

// First executable named `name` in CUSTOM_BIN_DIR or on PATH, or null.
function findOnPath(name) {
  const binName = process.platform === 'win32' ? `${name}.exe` : name;
  const dirs = [CUSTOM_BIN_DIR, ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, binName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* not here */ }
  }
  return null;
}

// JS runtimes yt-dlp may use to solve YouTube's JS challenges, as yt-dlp names them.
// JS_RUNTIMES (comma-separated, e.g. "quickjs" or "node,quickjs") limits the set; by default
// every one that's present is enabled and yt-dlp picks its preferred (deno > node > quickjs).
// Node is always present — it's what runs this app — and is far faster than QuickJS.
const KNOWN_JS_RUNTIMES = ['deno', 'node', 'quickjs'];

function getJsRuntimes() {
  const wanted = String(process.env.JS_RUNTIMES || KNOWN_JS_RUNTIMES.join(','))
    .split(',').map((s) => s.trim().toLowerCase()).filter((s) => KNOWN_JS_RUNTIMES.includes(s));
  const runtimes = [];
  for (const name of wanted) {
    if (name === 'node') {
      runtimes.push({ name, path: process.execPath });
    } else if (name === 'deno') {
      const deno = findOnPath('deno');
      if (deno) runtimes.push({ name, path: deno });
    } else if (name === 'quickjs') {
      const qjs = getQuickjsBin();
      const resolved = path.isAbsolute(qjs) ? qjs : findOnPath(qjs);
      if (resolved) runtimes.push({ name, path: resolved });
    }
  }
  // Nothing usable found: still hand yt-dlp QuickJS by name so its own lookup can try.
  return runtimes.length ? runtimes : [{ name: 'quickjs', path: null }];
}

// yt-dlp only enables Deno by default, so --no-js-runtimes clears that and the runtimes
// found above are enabled explicitly, each with its absolute path.
function jsRuntimeArgs() {
  const args = ['--no-js-runtimes'];
  for (const { name, path: bin } of getJsRuntimes()) {
    args.push('--js-runtimes', bin ? `${name}:${bin}` : name);
  }
  return args;
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

module.exports = {
  YTDLP_BIN, DOWNLOAD_DIR, VIDEO_DIR, MUSIC_DIR, CONFIG_DIR, COOKIES_FILE, CRAWLER_COOKIES_FILE, YTDLP_CACHE_DIR, CUSTOM_BIN_DIR,
  FFMPEG_BUILD_MARKER, resolveMusicDir, getQuickjsBin, getFfmpegDir, getFfmpegBin,
  findOnPath, getJsRuntimes, jsRuntimeArgs,
};
