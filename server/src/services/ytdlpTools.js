// Version reporting and in-place installs/updates of yt-dlp, FFmpeg and QuickJS-ng.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const siteProfiles = require('./siteProfiles');
const {
  YTDLP_BIN, CONFIG_DIR, CUSTOM_BIN_DIR, FFMPEG_BUILD_MARKER, getQuickjsBin, getFfmpegBin, findOnPath, jsRuntimeArgs,
} = require('./ytdlpPaths');

// Runs `cmd args` and resolves with stdout, or null if the binary is missing/errors —
// used for version reporting where an optional tool (e.g. qjs in local dev) may be absent.
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

// Asks yt-dlp itself which JS runtimes it can use with the flags the app passes, from the
// "[debug] JS runtimes: ..." line `-v` prints before it complains there's no URL. Returns
// e.g. "deno-2.9.7, node-24.22.0, quickjs-ng-0.17.0", "none", or null if yt-dlp didn't say.
function detectJsRuntimes() {
  return new Promise((resolve) => {
    let output = '';
    let proc;
    try {
      proc = spawn(YTDLP_BIN, ['-v', '--ignore-config', ...jsRuntimeArgs()]);
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => proc.kill('SIGKILL'), 30000);
    proc.stdout.on('data', (d) => (output += d));
    proc.stderr.on('data', (d) => (output += d));
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      const match = output.match(/\[debug\] JS runtimes:\s*(.+)/);
      resolve(match ? match[1].trim() : null);
    });
  });
}

async function getVersions() {
  const ffmpegBin = getFfmpegBin();
  const denoBin = findOnPath('deno');
  const [ytdlpOut, ffmpegOut, quickjsOut, denoOut, jsRuntimes] = await Promise.all([
    runCommand(YTDLP_BIN, ['--version']),
    runCommand(ffmpegBin, ['-version']),
    runCommand(getQuickjsBin(), ['--version']),
    denoBin ? runCommand(denoBin, ['--version']) : Promise.resolve(null),
    detectJsRuntimes(),
  ]);
  return {
    ytdlp: firstLine(ytdlpOut),
    ffmpeg: firstLine(ffmpegOut),
    quickjs: firstLine(quickjsOut),
    deno: firstLine(denoOut),
    node: process.version,
    jsRuntimes,
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
  // When running as a non-root user (e.g. PUID/PGID in Docker), install into PYTHONUSERBASE
  // (/config/python) so updates succeed without root privileges and persist across recreates.
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    args.push('--user');
  }
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

function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

// Parses standard `sha256sum` / `checksums.sha256` output (`<64-hex>  <filename>`) and
// returns the lowercase 64-character hex digest for `assetFilename`, or null if not listed.
function parseSha256ForAsset(checksumsText, assetFilename) {
  if (!checksumsText || !assetFilename) return null;
  const target = path.basename(assetFilename).trim();
  const lines = String(checksumsText).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) continue;
    const candidateName = path.basename(match[2].trim());
    if (candidateName === target) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

// Verifies that a downloaded standalone executable has a valid platform binary header
// (ELF on Linux, PE/MZ on Windows, Mach-O on macOS) and is non-empty before chmod/executing.
function verifyExecutableHeader(filePath, platform = process.platform) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 64) {
    throw new Error('Downloaded binary is empty or truncated');
  }
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(4);
  try {
    fs.readSync(fd, buf, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (platform === 'linux') {
    if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
      throw new Error('Downloaded binary is not a valid Linux ELF executable');
    }
  } else if (platform === 'win32') {
    if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
      throw new Error('Downloaded binary is not a valid Windows PE executable');
    }
  } else if (platform === 'darwin') {
    const magic = buf.readUInt32BE(0);
    const validMachO = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]);
    if (!validMachO.has(magic)) {
      throw new Error('Downloaded binary is not a valid macOS Mach-O executable');
    }
  }
  return true;
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

const FFMPEG_CHECKSUMS_URL = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/checksums.sha256';

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

async function verifyFfmpegArchiveChecksum(archivePath, filename) {
  const checksumRes = await fetch(FFMPEG_CHECKSUMS_URL, {
    headers: { 'User-Agent': 'yt-dlp-gui' },
  });
  if (!checksumRes.ok) {
    throw new Error(`Failed to download FFmpeg checksums.sha256 (${checksumRes.status} ${checksumRes.statusText})`);
  }
  const checksumsText = await checksumRes.text();
  const expectedHash = parseSha256ForAsset(checksumsText, filename);
  if (!expectedHash) {
    throw new Error(`Could not find SHA-256 entry for ${filename} in checksums.sha256`);
  }
  const actualHash = await computeFileSha256(archivePath);
  if (actualHash !== expectedHash) {
    throw new Error(`FFmpeg SHA-256 mismatch for ${filename}: expected ${expectedHash}, got ${actualHash}`);
  }
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

    await verifyFfmpegArchiveChecksum(archivePath, filename);

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

// QuickJS-ng publishes standalone (statically linked on Linux) `qjs` binaries per platform
// as plain release assets, so updating is a download-and-replace with no archive to unpack.
function getQuickjsAssetName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux') {
    if (arch === 'x64') return 'qjs-linux-x86_64';
    if (arch === 'arm64') return 'qjs-linux-aarch64';
  } else if (platform === 'win32') {
    if (arch === 'x64') return 'qjs-windows-x86_64.exe';
  } else if (platform === 'darwin') {
    if (arch === 'x64') return 'qjs-darwin-x86_64';
    if (arch === 'arm64') return 'qjs-darwin-arm64';
  }

  throw new Error(`QuickJS-ng builds are not available for platform '${platform}' (${arch}).`);
}

const QUICKJS_RELEASES_URL = 'https://github.com/quickjs-ng/quickjs/releases';

let isUpdatingQuickjs = false;

// `qjs --version` prints just the version (e.g. "0.17.0"); null when qjs is missing.
async function getInstalledQuickjsVersion() {
  return firstLine(await runCommand(getQuickjsBin(), ['--version']));
}

// GitHub redirects /releases/latest to /releases/tag/vX.Y.Z, which names the latest version
// without needing the (rate-limited) REST API.
async function getLatestQuickjsVersion() {
  const res = await fetch(`${QUICKJS_RELEASES_URL}/latest`, {
    method: 'HEAD',
    headers: { 'User-Agent': 'yt-dlp-gui' },
  });
  if (!res.ok) {
    throw new Error(`Failed to check QuickJS-ng release (${res.status} ${res.statusText})`);
  }
  const match = res.url.match(/\/releases\/tag\/v?([^/?#]+)$/);
  if (!match) {
    throw new Error(`Could not determine the latest QuickJS-ng version from ${res.url}`);
  }
  return match[1];
}

async function updateQuickjs(knownVersion = null) {
  if (isUpdatingQuickjs) {
    throw new Error('QuickJS update is already in progress');
  }

  isUpdatingQuickjs = true;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-quickjs-'));

  try {
    const version = knownVersion || await getLatestQuickjsVersion();
    const assetName = getQuickjsAssetName();
    const downloadUrl = `${QUICKJS_RELEASES_URL}/download/v${version}/${assetName}`;
    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'yt-dlp-gui' },
    });
    if (!res.ok) {
      throw new Error(`Failed to download QuickJS-ng build (${res.status} ${res.statusText})`);
    }

    const binExt = process.platform === 'win32' ? '.exe' : '';
    const qjsTarget = `qjs${binExt}`;
    const qjsSrc = path.join(tempDir, qjsTarget);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(qjsSrc));

    // Verify executable magic bytes (ELF/PE/Mach-O) and optional published checksum file
    // before marking the downloaded binary executable or invoking it.
    verifyExecutableHeader(qjsSrc);
    try {
      const shaRes = await fetch(`${downloadUrl}.sha256`, {
        headers: { 'User-Agent': 'yt-dlp-gui' },
      });
      if (shaRes.ok) {
        const shaText = (await shaRes.text()).trim();
        const expected = parseSha256ForAsset(shaText, assetName) || (shaText.match(/^([a-fA-F0-9]{64})\b/)?.[1]?.toLowerCase() ?? null);
        if (expected) {
          const actual = await computeFileSha256(qjsSrc);
          if (actual !== expected) {
            throw new Error(`QuickJS-ng SHA-256 mismatch for ${assetName}: expected ${expected}, got ${actual}`);
          }
        }
      }
    } catch (shaErr) {
      if (/SHA-256 mismatch/i.test(shaErr.message)) throw shaErr;
    }

    if (process.platform !== 'win32') fs.chmodSync(qjsSrc, 0o755);

    // Make sure the download actually runs here before it replaces a working copy.
    const downloadedVersion = firstLine(await runCommand(qjsSrc, ['--version']));
    if (!downloadedVersion) {
      throw new Error(`Downloaded QuickJS-ng build (${assetName}) did not run on this system`);
    }

    // Always install to persistent CUSTOM_BIN_DIR (/config/bin)
    installBinary(qjsSrc, CUSTOM_BIN_DIR, qjsTarget);

    // Also update /usr/local/bin if running on Linux with write permissions (e.g. Docker)
    if (process.platform === 'linux') {
      try {
        fs.accessSync('/usr/local/bin', fs.constants.W_OK);
        installBinary(qjsSrc, '/usr/local/bin', qjsTarget);
      } catch {
        // Not writable, persistent custom bin dir in /config/bin is sufficient
      }
    }

    // Ensure CUSTOM_BIN_DIR is prepended to process.env.PATH
    const paths = (process.env.PATH || '').split(path.delimiter);
    if (!paths.includes(CUSTOM_BIN_DIR)) {
      process.env.PATH = `${CUSTOM_BIN_DIR}${path.delimiter}${process.env.PATH}`;
    }

    return { updated: true, ...(await getVersions()) };
  } finally {
    isUpdatingQuickjs = false;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function updateQuickjsIfAvailable() {
  const latestVersion = await getLatestQuickjsVersion();
  if (latestVersion === await getInstalledQuickjsVersion()) {
    return { updated: false, ...(await getVersions()) };
  }
  return updateQuickjs(latestVersion);
}

module.exports = {
  detectJsRuntimes,
  runCommand,
  firstLine,
  getVersions,
  updateYtdlp,
  updateFfmpeg,
  updateFfmpegIfAvailable,
  updateQuickjs,
  updateQuickjsIfAvailable,
  computeFileSha256,
  parseSha256ForAsset,
  verifyExecutableHeader,
};
