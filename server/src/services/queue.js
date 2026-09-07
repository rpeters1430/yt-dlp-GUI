const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const ytdlp = require('./ytdlp');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '2', 10);

let io = null;
let activeCount = 0;

function init(socketIo) {
  io = socketIo;
  // Resume anything left "downloading" from a previous run as queued, then kick the queue.
  db.prepare("UPDATE downloads SET status = 'queued' WHERE status = 'downloading'").run();
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
  db.prepare(`
    INSERT INTO downloads (id, url, status, format_selector, audio_only, subtitles, quality, container, sub_langs, watch_id, command_args, log)
    VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(
    id,
    url,
    options.formatSelector || null,
    options.audioOnly ? 1 : 0,
    options.subtitles ? 1 : 0,
    options.quality || null,
    options.container || 'mp4',
    options.subLangs || null,
    options.watchId || null
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

  const downloadOptions = {
    audioOnly: !!job.audio_only,
    formatSelector: job.format_selector,
    quality: job.quality,
    container: job.container,
    subtitles: !!job.subtitles,
    subLangs: job.sub_langs,
    jobId: job.id,
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
    command_args: commandStr,
    log: logLines.join('\n'),
  });

  try {
    let title = null, thumbnail = null, extractor = null, videoId = null;
    try {
      appendLog(`Resolving metadata...`);
      const info = await ytdlp.getInfo(job.url);
      title = info.title || null;
      thumbnail = info.thumbnail || null;
      extractor = info.extractor || null;
      videoId = info.id || null;
      appendLog(`Metadata: "${title || 'Unknown'}" (${extractor || 'extractor'}) [ID: ${videoId || 'unknown'}]`);
      updateJob(job.id, { title, thumbnail, extractor, video_id: videoId, log: logLines.join('\n') });
    } catch (e) {
      appendLog(`Metadata lookup note: ${e.message} (proceeding to download)`);
    }

    let lastLogSave = Date.now();

    const result = await ytdlp.download(
      job.url,
      downloadOptions,
      (progress) => {
        const updatePayload = {
          percent: progress.percent,
          speed: progress.speed || null,
          eta: progress.eta || null,
        };
        // Throttle log updates during progress stream to at most once every second
        if (Date.now() - lastLogSave > 1000) {
          updatePayload.log = logLines.join('\n');
          lastLogSave = Date.now();
        }
        updateJob(job.id, updatePayload);
      },
      (logLine) => {
        appendLog(logLine);
      }
    );

    appendLog(`Download completed successfully -> ${result.filepath || 'unknown destination'}`);
    console.log(`[queue] [job:${job.id}] Completed successfully: ${result.filepath || 'unknown'}`);
    updateJob(job.id, {
      status: 'completed',
      percent: 100,
      filepath: result.filepath || null,
      log: logLines.join('\n'),
    });
  } catch (err) {
    appendLog(`ERROR: ${err.message}`);
    console.error(`[queue] [job:${job.id}] Failed: ${err.message}`);
    updateJob(job.id, {
      status: 'failed',
      error: err.message,
      log: logLines.join('\n'),
    });
  }
}

function removeJob(id) {
  db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
}

function getActiveCount() {
  return activeCount;
}

module.exports = { init, enqueue, listJobs, getJob, removeJob, getActiveCount };
