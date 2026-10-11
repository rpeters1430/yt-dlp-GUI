// Where yt-dlp, its tools, downloads and config live, and which binaries to run.
const fs = require('fs');
const path = require('path');

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

module.exports = {
  YTDLP_BIN, DOWNLOAD_DIR, CONFIG_DIR, COOKIES_FILE, YTDLP_CACHE_DIR, CUSTOM_BIN_DIR,
  FFMPEG_BUILD_MARKER, DENO_BUILD_MARKER, getDenoBin, getFfmpegDir, getFfmpegBin,
};
