const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ytdlp = require('./ytdlp');

function getFfprobeBin() {
  const dir = ytdlp.getFfmpegDir();
  if (dir) {
    const binName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const fullPath = path.join(dir, binName);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return 'ffprobe';
}

function getFfmpegBin() {
  const dir = ytdlp.getFfmpegDir();
  if (dir) {
    const binName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const fullPath = path.join(dir, binName);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return 'ffmpeg';
}

function formatDuration(sec) {
  if (!sec || Number.isNaN(sec)) return '0s';
  const total = Math.round(sec);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function probeDuration(filepath) {
  return new Promise((resolve) => {
    // 1. Try ffprobe first
    const probeProc = spawn(getFfprobeBin(), [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filepath,
    ]);

    let stdout = '';
    probeProc.stdout.on('data', (d) => { stdout += d; });
    probeProc.on('close', (code) => {
      const dur = parseFloat(stdout.trim());
      if (code === 0 && !Number.isNaN(dur) && dur > 0) {
        return resolve(dur);
      }

      // 2. Fallback to ffmpeg -hide_banner -i
      const ffmpegProc = spawn(getFfmpegBin(), ['-hide_banner', '-i', filepath]);
      let stderr = '';
      ffmpegProc.stderr.on('data', (d) => { stderr += d; });
      ffmpegProc.on('close', () => {
        const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (match) {
          const h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const s = parseFloat(match[3]);
          const totalSec = h * 3600 + m * 60 + s;
          if (totalSec > 0) return resolve(totalSec);
        }
        resolve(null);
      });
      ffmpegProc.on('error', () => resolve(null));
    });
    probeProc.on('error', () => {
      // Fallback to ffmpeg on ffprobe spawn error
      const ffmpegProc = spawn(getFfmpegBin(), ['-hide_banner', '-i', filepath]);
      let stderr = '';
      ffmpegProc.stderr.on('data', (d) => { stderr += d; });
      ffmpegProc.on('close', () => {
        const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (match) {
          const h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const s = parseFloat(match[3]);
          const totalSec = h * 3600 + m * 60 + s;
          if (totalSec > 0) return resolve(totalSec);
        }
        resolve(null);
      });
      ffmpegProc.on('error', () => resolve(null));
    });
  });
}

/**
 * Splits a live recording into chunk files of specified minutes using lossless ffmpeg stream copy.
 *
 * @param {string} filepath Absolute path to input recording file
 * @param {number} chunkDurationMins Chunk size in minutes (e.g. 15, 30, 60)
 * @param {Function} [onLog] Logging callback
 * @returns {Promise<{ split: boolean, files: string[], duration: number|null, reason?: string, error?: string }>}
 */
async function splitRecording(filepath, chunkDurationMins, onLog = () => {}) {
  if (!filepath || !fs.existsSync(filepath)) {
    throw new Error(`File does not exist: ${filepath}`);
  }

  const mins = parseFloat(chunkDurationMins);
  if (!mins || mins <= 0) {
    return { split: false, files: [filepath], duration: null, reason: 'invalid_duration' };
  }

  const chunkSeconds = mins * 60;
  const duration = await probeDuration(filepath);

  if (duration != null && duration <= chunkSeconds) {
    onLog(`Recording duration (${formatDuration(duration)}) is within the ${mins}-minute chunk limit — kept as a single file.`);
    return { split: false, files: [filepath], duration, reason: 'within_limit' };
  }

  const dir = path.dirname(filepath);
  const ext = path.extname(filepath);
  const base = path.basename(filepath, ext);
  const expectedParts = duration ? Math.ceil(duration / chunkSeconds) : 2;
  const padFormat = expectedParts > 99 ? '%03d' : '%02d';
  const pattern = path.join(dir, `${base}.part${padFormat}${ext}`);

  onLog(`Splitting recording${duration ? ` (${formatDuration(duration)})` : ''} into ${mins}-minute chunks with lossless stream copy…`);

  const args = [
    '-hide_banner',
    '-y',
    '-i', filepath,
    '-c', 'copy',
    '-map', '0',
    '-f', 'segment',
    '-segment_time', String(chunkSeconds),
    '-segment_start_number', '1',
    '-reset_timestamps', '1',
    pattern,
  ];

  const exitCode = await new Promise((resolve) => {
    const proc = spawn(getFfmpegBin(), args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code !== 0) {
        onLog(`[warning] FFmpeg segmenting warning: ${stderr.trim().split('\n').slice(-2).join(' ')}`);
      }
      resolve(code);
    });
    proc.on('error', (err) => {
      onLog(`[error] FFmpeg spawn error: ${err.message}`);
      resolve(-1);
    });
  });

  if (exitCode !== 0) {
    onLog(`[warning] Failed to split recording with FFmpeg (code ${exitCode}). Retaining original single file.`);
    return { split: false, files: [filepath], duration, error: `FFmpeg exited with code ${exitCode}` };
  }

  // Find generated part files
  const partRegex = new RegExp(`^${escapeRegex(base)}\\.part(\\d+)${escapeRegex(ext)}$`, 'i');
  let partFiles = [];
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const match = entry.match(partRegex);
      if (match) {
        const full = path.join(dir, entry);
        try {
          const st = fs.statSync(full);
          if (st.size > 0) {
            partFiles.push({ path: full, num: parseInt(match[1], 10), name: entry, size: st.size });
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    onLog(`[error] Could not read output directory: ${err.message}`);
  }

  partFiles.sort((a, b) => a.num - b.num);

  if (partFiles.length <= 1) {
    onLog(`[warning] Segmentation resulted in only ${partFiles.length} chunk. Keeping original file.`);
    // Cleanup any stray single part file
    for (const p of partFiles) {
      if (p.path !== filepath) {
        try { fs.unlinkSync(p.path); } catch (_) {}
      }
    }
    return { split: false, files: [filepath], duration, reason: 'single_or_empty_part' };
  }

  // Remove original single unsplit file now that all chunks are created and verified
  try {
    fs.unlinkSync(filepath);
    onLog(`Removed original un-chunked file: ${path.basename(filepath)}`);
  } catch (err) {
    onLog(`[warning] Could not remove original file: ${err.message}`);
  }

  const resultPaths = partFiles.map((p) => p.path);
  onLog(`Successfully split recording into ${resultPaths.length} chunks (${mins}m each):`);
  for (let i = 0; i < partFiles.length; i++) {
    onLog(`  Part ${i + 1}: ${partFiles[i].name} (${formatBytes(partFiles[i].size)})`);
  }

  return {
    split: true,
    files: resultPaths,
    duration,
    count: resultPaths.length,
    chunkDurationMins: mins,
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

module.exports = {
  probeDuration,
  splitRecording,
  formatDuration,
  getFfmpegBin,
  getFfprobeBin,
};
