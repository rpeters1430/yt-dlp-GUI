const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const ytdlp = require('./ytdlp');
const nfo = require('./nfo');

function isNfoEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'nfo_enabled'").get();
  return !row || row.value !== '0'; // opt-out, defaults to enabled
}

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '2', 10);

let io = null;
let activeCount = 0;

function init(socketIo) {
  io = socketIo;
  // A row still marked "downloading" at boot means the server (not necessarily the whole
  // container) restarted mid-job — the yt-dlp/ffmpeg process from that run may still be
  // alive and orphaned (reparented, no longer tracked by anything). Best-effort kill it by
  // its persisted pid before resuming the row as queued, so it doesn't keep writing to the
  // same output file a fresh attempt is about to start writing to.
  const stale = db.prepare("SELECT id, pid FROM downloads WHERE status = 'downloading'").all();
  for (const row of stale) {
    if (!row.pid) continue;
    try {
      // Negative pid targets the process group; these are spawned detached (see ytdlp.js)
      // so this also reaches any ffmpeg child. Falls back to a direct kill if that fails
      // (e.g. Windows, or the process already exited).
      process.kill(process.platform === 'win32' ? row.pid : -row.pid, 'SIGKILL');
    } catch (_) {}
  }
  db.prepare("UPDATE downloads SET status = 'queued', pid = NULL WHERE status = 'downloading'").run();
  processNext();
}

function emit(job) {
  if (io) io.emit('job:update', job);
}

function getJob(id) {
  return db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);
}

function listJobs() {
  return db.prepare('SELECT * FROM downloads ORDER BY created_at DESC').all();
}

function enqueue(url, options = {}) {
  const id = uuidv4();
  console.log(`[queue] [job:${id}] Enqueued download for: ${url}`);
  const isLive = options.isLive ? 1 : 0;
  const optionsJson = options.optionsJson
    ? (typeof options.optionsJson === 'string' ? options.optionsJson : JSON.stringify(options.optionsJson))
    : null;

  db.prepare(`
    INSERT INTO downloads (id, url, status, format_selector, audio_only, subtitles, quality, container, sub_langs, watch_id, is_live, options_json, command_args, log)
    VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(
    id,
    url,
    options.formatSelector || null,
    options.audioOnly ? 1 : 0,
    options.subtitles ? 1 : 0,
    options.quality || null,
    options.container || 'mp4',
    options.subLangs || null,
    options.watchId || null,
    isLive,
    optionsJson
  );
  emit(getJob(id));
  processNext();
  return id;
}

function updateJob(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE downloads SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
  emit(getJob(id));
}

async function processNext() {
  if (activeCount >= MAX_CONCURRENT) return;
  const next = db.prepare("SELECT * FROM downloads WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get();
  if (!next) return;

  activeCount++;
  runJob(next).finally(() => {
    activeCount--;
    processNext();
  });

  // Allow more concurrent slots to pick up work immediately.
  if (activeCount < MAX_CONCURRENT) processNext();
}

async function runJob(job) {
  const logLines = [];
  function appendLog(line) {
    const timestamp = new Date().toISOString().substring(11, 19);
    logLines.push(`[${timestamp}] ${line}`);
    if (logLines.length > 500) logLines.shift();
  }

  let extraOptions = {};
  if (job.options_json) {
    try {
      extraOptions = JSON.parse(job.options_json);
    } catch (_) {}
  }

  const downloadOptions = {
    audioOnly: !!job.audio_only,
    formatSelector: job.format_selector,
    quality: job.quality,
    container: job.container,
    subtitles: !!job.subtitles,
    subLangs: job.sub_langs,
    isLive: !!job.is_live,
    jobId: job.id,
    ...extraOptions,
  };

  const commandArgs = ytdlp.buildDownloadArgs(job.url, downloadOptions);
  const commandStr = ytdlp.formatCommand(process.env.YTDLP_BIN || 'yt-dlp', commandArgs);
  const ffmpegDir = ytdlp.getFfmpegDir();

  appendLog(`Download job started`);
  appendLog(`URL: ${job.url}`);
  appendLog(`Command: ${commandStr}`);
  if (ffmpegDir) {
    appendLog(`FFmpeg path: ${ffmpegDir}`);
  }

  console.log(`[queue] [job:${job.id}] Starting download: ${job.url}`);
  console.log(`[queue] [job:${job.id}] Command: ${commandStr}`);

  updateJob(job.id, {
    status: 'downloading',
    percent: 0,
    stage: 'Starting…',
    command_args: commandStr,
    log: logLines.join('\n'),
  });

  try {
    let title = null, thumbnail = null, extractor = null, videoId = null;
    let nfoInfo = null;
    try {
      appendLog(`Resolving metadata...`);
      updateJob(job.id, { stage: 'Fetching metadata…', log: logLines.join('\n') });
      const info = await ytdlp.getInfo(job.url);
      title = info.title || null;
      thumbnail = info.thumbnail || null;
      extractor = info.extractor || null;
      videoId = info.id || null;
      nfoInfo = {
        title,
        description: info.description || '',
        uploader: info.uploader || info.channel || null,
        uploadDate: info.upload_date || null,
        duration: info.duration || null,
        tags: info.tags || info.categories || [],
        thumbnailUrl: thumbnail,
        videoId,
        sourceUrl: info.webpage_url || job.url,
      };
      appendLog(`Metadata: "${title || 'Unknown'}" (${extractor || 'extractor'}) [ID: ${videoId || 'unknown'}]`);
      updateJob(job.id, { title, thumbnail, extractor, video_id: videoId, stage: 'Ready to download', log: logLines.join('\n') });
    } catch (e) {
      appendLog(`Metadata lookup note: ${e.message} (proceeding to download)`);
    }

    let lastLogSave = Date.now();
    let lastProgressSave = 0;
    let lastPercent = -1;

    const result = await ytdlp.download(
      job.url,
      { ...downloadOptions, onSpawn: (pid) => updateJob(job.id, { pid }) },
      (progress) => {
        const now = Date.now();
        const percentChanged = Math.abs((progress.percent || 0) - lastPercent) >= 1;
        if (now - lastProgressSave >= 200 || percentChanged || (progress.percent || 0) >= 100) {
          lastProgressSave = now;
          lastPercent = progress.percent || 0;
          const updatePayload = {
            percent: progress.percent,
            speed: progress.speed || null,
            eta: progress.eta || null,
            stage: progress.stage || 'Downloading…',
          };
          // Throttle log updates during progress stream to at most once every second
          if (now - lastLogSave > 1000) {
            updatePayload.log = logLines.join('\n');
            lastLogSave = now;
          }
          updateJob(job.id, updatePayload);
        }
      },
      (logLine) => {
        appendLog(logLine);
      }
    );

    const completionMsg = result.stoppedByUser
      ? `Live stream recording stopped by user -> ${result.filepath || 'saved stream'}`
      : `Download completed successfully -> ${result.filepath || 'unknown destination'}`;

    appendLog(completionMsg);
    console.log(`[queue] [job:${job.id}] ${completionMsg}`);
    updateJob(job.id, {
      status: 'completed',
      percent: 100,
      stage: 'Completed',
      filepath: result.filepath || null,
      pid: null,
      log: logLines.join('\n'),
    });

    if (nfoInfo && result.filepath && isNfoEnabled()) {
      nfo.writeSidecarFiles(result.filepath, nfoInfo)
        .catch((e) => console.error(`[queue] [job:${job.id}] Failed to write .nfo/poster: ${e.message}`));
    }
  } catch (err) {
    appendLog(`ERROR: ${err.message}`);
    console.error(`[queue] [job:${job.id}] Failed: ${err.message}`);
    updateJob(job.id, {
      status: 'failed',
      error: err.message,
      stage: 'Failed',
      pid: null,
      log: logLines.join('\n'),
    });
  }
}

function stopJob(id) {
  return ytdlp.stopDownload(id);
}

function removeJob(id) {
  ytdlp.stopDownload(id);
  db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
}

function getActiveCount() {
  return activeCount;
}

module.exports = { init, enqueue, listJobs, getJob, stopJob, removeJob, getActiveCount };

