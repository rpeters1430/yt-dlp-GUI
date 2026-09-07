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

// Runs `yt-dlp -J <url>` to fetch metadata (title, id, extractor, thumbnail, formats)
// without downloading anything. Used for the format picker and for watch/history dedup.
function getInfo(url, { flatPlaylist = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-J', ...commonArgs()];
    if (flatPlaylist) args.push('--flat-playlist');
    args.push(url);

    console.log(`[ytdlp:info] Fetching metadata for ${url}`);
    const proc = spawn(YTDLP_BIN, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
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

function buildFormatSelector({ audioOnly, formatSelector, quality }) {
  if (audioOnly) return 'bestaudio/best';
  if (formatSelector) return formatSelector;
  const height = quality ? QUALITY_HEIGHTS[parseInt(quality, 10)] : null;
  if (height) {
    return `bestvideo*[height<=${height}]+bestaudio/best[height<=${height}]/best[height<=${height}]`;
  }
  return 'bestvideo*+bestaudio/best';
}

function formatCommand(bin, args) {
  return `${bin} ${args.map((a) => (a.includes(' ') || a.includes('"') ? JSON.stringify(a) : a)).join(' ')}`;
}

function buildDownloadArgs(url, options = {}) {
  const {
    audioOnly = false,
    formatSelector = '',
    quality = '',
    container = 'mp4',
    subtitles = false,
    subLangs = 'en.*',
  } = options;

  const args = [
    '--newline',
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
  return args;
}

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
    const proc = spawn(YTDLP_BIN, args);
    let stderr = '';
    let filepath = null;

    function handleChunk(chunk, isStderr = false) {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('YTDLP_PROGRESS')) {
          const rest = trimmed.replace('YTDLP_PROGRESS', '').trim();
          const [percentStr, speed, eta] = rest.split('|');
          const percent = parseFloat(percentStr.replace('%', '').trim());
          if (!Number.isNaN(percent)) {
            onProgress && onProgress({ percent, speed: speed && speed.trim(), eta: eta && eta.trim() });
          }
          continue;
        }

        if (trimmed.startsWith('FILEPATH ')) {
          filepath = trimmed.replace('FILEPATH ', '').trim();
          console.log(`[${jobId}] Destination file: ${filepath}`);
          onLog && onLog(`[destination] ${filepath}`);
          continue;
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

    proc.stdout.on('data', (chunk) => handleChunk(chunk, false));
    proc.stderr.on('data', (chunk) => handleChunk(chunk, true));

    proc.on('close', (code) => {
      if (code !== 0) {
        const errMsg = stderr.trim() || `yt-dlp exited with code ${code}`;
        console.error(`[${jobId}] Failed with exit code ${code}: ${errMsg}`);
        onLog && onLog(`[failed] Exit code ${code}: ${errMsg}`);
        return reject(new Error(errMsg));
      }
      console.log(`[${jobId}] Completed successfully -> ${filepath || 'unknown destination'}`);
      onLog && onLog(`[completed] Successfully saved: ${filepath || ''}`);
      resolve({ filepath, command: commandStr });
    });

    proc.on('error', (err) => {
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
};
