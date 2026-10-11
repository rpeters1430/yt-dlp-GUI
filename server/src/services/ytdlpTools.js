// Version reporting and in-place installs/updates of yt-dlp, FFmpeg and Deno.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const siteProfiles = require('./siteProfiles');
const {
  YTDLP_BIN, CONFIG_DIR, CUSTOM_BIN_DIR, FFMPEG_BUILD_MARKER, DENO_BUILD_MARKER, getDenoBin, getFfmpegBin,
} = require('./ytdlpPaths');

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

module.exports = {
  runCommand, firstLine, getVersions, updateYtdlp, updateFfmpeg, updateFfmpegIfAvailable, updateDeno, updateDenoIfAvailable,
};
