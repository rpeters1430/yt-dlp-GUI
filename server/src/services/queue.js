const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const db = require('../db');
const ytdlp = require('./ytdlp');
const siteProfiles = require('./siteProfiles');
const nfo = require('./nfo');
const jellyfinSync = require('./jellyfinSync');
const plexSync = require('./plexSync');
const outputTemplate = require('./outputTemplate');
const notify = require('./notify');
const liveSplitter = require('./liveSplitter');

// The channel's own page, for its name, description, avatar and banner (TV-layout show
// artwork). One entry per tab is enough; only the channel-level fields are used.
function fetchChannelListing(channelUrl) {
  return ytdlp.getInfo(channelUrl, { flatPlaylist: true, playlistStart: 1, playlistEnd: 1 });
}

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

function getJob(id) {
  return db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);
}

// Job lists and socket updates skip each row's yt-dlp log and command line: across a long
// history those add up to megabytes, and a progress tick fires several times a second.
// getJobLog fetches them for a single job when its log panel is opened.
const LIST_EXCLUDED_COLUMNS = new Set(['log', 'command_args']);
let listColumnsSql = null;

function listColumns() {
  if (!listColumnsSql) {
    listColumnsSql = db.prepare('PRAGMA table_info(downloads)').all()
      .map((c) => c.name)
      .filter((name) => !LIST_EXCLUDED_COLUMNS.has(name))
      .map((name) => `"${name}"`)
      .join(', ');
  }
  return listColumnsSql;
}

function getJobSummary(id) {
  return db.prepare(`SELECT ${listColumns()} FROM downloads WHERE id = ?`).get(id);
}

const ACTIVE_STATUSES_SQL = "('queued', 'downloading')";
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 1000;

function clampLimit(limit, fallback) {
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIST_LIMIT);
}

// Every queued/downloading job plus the newest `limit` finished ones, newest first. The full
// history can run to thousands of rows, and this list goes to every client on connect.
function listJobs({ limit, activeOnly = false } = {}) {
  const cols = listColumns();
  const active = db.prepare(`SELECT ${cols} FROM downloads WHERE status IN ${ACTIVE_STATUSES_SQL}`).all();
  if (activeOnly) return active.sort(byNewest);
  const finished = db.prepare(`
    SELECT ${cols} FROM downloads WHERE status NOT IN ${ACTIVE_STATUSES_SQL}
    ORDER BY created_at DESC, rowid DESC LIMIT ?
  `).all(clampLimit(limit, DEFAULT_LIST_LIMIT));
  return active.concat(finished).sort(byNewest);
}

function byNewest(a, b) {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

// Paged, filtered view of the whole history for the History page.
function searchJobs({ status, q, limit, offset } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') {
    where.push('status = ?');
    params.push(String(status));
  }
  const term = String(q || '').trim().toLowerCase();
  if (term) {
    // instr() rather than LIKE, so a search for "%" or "_" is taken literally.
    where.push("(instr(lower(coalesce(title, url, '')), ?) > 0 OR instr(lower(coalesce(extractor, '')), ?) > 0)");
    params.push(term, term);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageSize = clampLimit(limit, 50);
  const skip = Math.max(0, parseInt(offset, 10) || 0);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM downloads ${whereSql}`).get(...params).c;
  const jobs = db.prepare(`
    SELECT ${listColumns()} FROM downloads ${whereSql}
    ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, skip);
  return { jobs, total };
}

// Count of jobs per status across the whole history, for the dashboard's stat cards.
function getStatusCounts() {
  const counts = { queued: 0, downloading: 0, completed: 0, failed: 0 };
  for (const row of db.prepare('SELECT status, COUNT(*) AS c FROM downloads GROUP BY status').all()) {
    counts[row.status] = row.c;
  }
  return counts;
}

function emitCounts() {
  if (io) io.emit('jobs:counts', getStatusCounts());
}

// `extra` carries log/command_args on the updates that changed them; clients keep the
// last copy they got, so every other update can leave them out.
function emit(job, extra) {
  // A job removed from the list mid-run has no row left to report.
  if (io && job) io.emit('job:update', extra ? { ...job, ...extra } : job);
}

function getJobLog(id) {
  return db.prepare('SELECT log, command_args FROM downloads WHERE id = ?').get(id);
}

// Inserts a queued job without announcing or starting it, so a caller can create it inside
// its own transaction (e.g. linking it to a watch item) and start it only after commit.
function createQueuedJob(url, options = {}) {
  const id = uuidv4();
  const isLive = options.isLive ? 1 : 0;
  const optionsJson = options.optionsJson
    ? (typeof options.optionsJson === 'string' ? options.optionsJson : JSON.stringify(options.optionsJson))
    : null;

  let liveChunkMins = parseInt(options.liveChunkMins, 10) || 0;
  if (!liveChunkMins && optionsJson) {
    try {
      const p = JSON.parse(optionsJson);
      if (p.splitLiveChunks && p.liveChunkDuration) {
        liveChunkMins = parseInt(p.liveChunkDuration, 10) || 0;
      }
    } catch (_) {}
  }

  db.prepare(`
    INSERT INTO downloads (id, url, status, format_selector, audio_only, subtitles, quality, container, sub_langs, watch_id, watch_item_id, is_live, live_chunk_mins, options_json, command_args, log)
    VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
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
    options.watchItemId || null,
    isLive,
    liveChunkMins,
    optionsJson
  );
  return { id, job: getJob(id) };
}

function startQueuedJobs(ids) {
  for (const id of ids) {
    const job = getJobSummary(id);
    if (!job) continue;
    console.log(`[queue] [job:${id}] Enqueued download for: ${job.url}`);
    emit(job);
  }
  if (ids.length) emitCounts();
  processNext();
}

function enqueue(url, options = {}) {
  const { id } = createQueuedJob(url, options);
  startQueuedJobs([id]);
  return id;
}

// Set by index.js: mirrors a watch-linked job's status changes onto its watch item.
let onWatchItemStatus = null;
function setWatchItemListener(fn) {
  onWatchItemStatus = fn;
}

function notifyWatchItem(job) {
  if (!onWatchItemStatus || !job || !job.watch_item_id) return;
  try {
    onWatchItemStatus(job.watch_item_id, job.status, { downloadId: job.id, error: job.error });
  } catch (e) {
    console.error(`[queue] [job:${job.id}] Watch item ${job.watch_item_id} sync failed: ${e.message}`);
  }
}

function updateJob(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE downloads SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
  const job = getJobSummary(id);
  const extra = {};
  for (const k of LIST_EXCLUDED_COLUMNS) if (k in fields) extra[k] = fields[k];
  emit(job, Object.keys(extra).length ? extra : null);
  if (fields.status) {
    notifyWatchItem(job);
    emitCounts();
  }
}

// waitForLive lives in options_json; CASE keeps json_extract from ever seeing invalid JSON.
const WAIT_FOR_LIVE_SQL = "(CASE WHEN json_valid(options_json) THEN json_extract(options_json, '$.waitForLive') END) = 1";

// runJob marks the row 'downloading' synchronously before its first await, so a job can't be
// picked up twice by overlapping processNext() calls.
function startJob(job, usesSlot) {
  if (usesSlot) activeCount++;
  runJob(job).finally(() => {
    if (usesSlot) activeCount--;
    processNext();
  });
}

function processNext() {
  // A job waiting for a scheduled broadcast can sit idle for hours or days, and must be
  // running when the stream starts — so it never waits for (or holds) a download slot.
  const waiting = db.prepare(`SELECT * FROM downloads WHERE status = 'queued' AND ${WAIT_FOR_LIVE_SQL}`).all();
  for (const job of waiting) startJob(job, false);

  // Only read as many queued rows as there are free slots; a big playlist backfill can
  // leave thousands queued, and this runs every time a download finishes.
  const free = MAX_CONCURRENT - activeCount;
  if (free <= 0) return;
  const next = db.prepare(`
    SELECT * FROM downloads WHERE status = 'queued' AND NOT coalesce(${WAIT_FOR_LIVE_SQL}, 0)
    ORDER BY created_at ASC, rowid ASC LIMIT ?
  `).all(free);
  for (const job of next) startJob(job, true);
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
  // Music downloads carry their own library layout; everything else follows the Watch's
  // filename template, else the global one from Settings.
  if (!downloadOptions.outputTemplate) {
    const watch = job.watch_id ? db.prepare('SELECT output_template FROM watches WHERE id = ?').get(job.watch_id) : null;
    downloadOptions.outputTemplate = outputTemplate.resolveTemplate({ watchTemplate: watch && watch.output_template });
  }

  const ffmpegDir = ytdlp.getFfmpegDir();

  appendLog(`Download job started`);
  appendLog(`URL: ${job.url}`);
  if (ffmpegDir) {
    appendLog(`FFmpeg path: ${ffmpegDir}`);
  }

  console.log(`[queue] [job:${job.id}] Starting download: ${job.url}`);

  updateJob(job.id, {
    status: 'downloading',
    percent: 0,
    stage: 'Starting…',
    log: logLines.join('\n'),
  });

  try {
    let title = null, thumbnail = null, extractor = null, videoId = null;
    let nfoInfo = null;
    // What this specific link supports (site features + what the probe found). Stays null
    // if the probe fails, in which case resolveDownloadOptions falls back to a URL guess.
    let caps = null;
    try {
      appendLog(`Resolving metadata...`);
      updateJob(job.id, { stage: 'Fetching metadata…', log: logLines.join('\n') });
      // Reuses the Analyze dialog's probe when the job was enqueued right after it.
      const info = await ytdlp.getInfo(job.url, { reuseRecent: true });
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
        channelUrl: info.channel_url || null,
        channelId: info.channel_id || null,
      };
      caps = siteProfiles.getCapabilities(info, job.url);
      appendLog(`Metadata: "${title || 'Unknown'}" (${extractor || 'extractor'}) [ID: ${videoId || 'unknown'}]`);
      appendLog(`Site profile: ${caps.site.name}${caps.site.id === 'generic' ? ' (generic rules)' : ''}`);
      for (const warning of caps.warnings) appendLog(`WARNING: ${warning}`);
      updateJob(job.id, { title, thumbnail, extractor, video_id: videoId, stage: 'Ready to download', log: logLines.join('\n') });
    } catch (e) {
      // The download would hit the exact same wall with the same cookies/IP, so don't spend
      // another round-trip (and another flagged request) on it.
      if (ytdlp.isBotCheckError(e.message)) {
        appendLog(`Metadata lookup failed: ${e.message}`);
        throw e;
      }
      if (ytdlp.isNotLiveError(e.message) && downloadOptions.waitForLive) {
        appendLog('Channel is offline right now (proceeding to wait for it to go live)');
      } else {
        appendLog(`Metadata lookup note: ${e.message} (proceeding to download)`);
      }
    }

    // Removed from the list while the metadata lookup ran: don't start a download for it.
    if (!getJob(job.id)) {
      console.log(`[queue] [job:${job.id}] Removed before download started; skipping`);
      return;
    }

    const { options: resolvedOptions, adjustments } = ytdlp.resolveDownloadOptions(job.url, {
      ...downloadOptions,
      extractor: extractor || job.extractor,
      ...(caps ? { caps } : {}),
    });
    for (const note of adjustments) appendLog(note);

    const commandStr = ytdlp.formatCommand(process.env.YTDLP_BIN || 'yt-dlp', ytdlp.buildDownloadArgs(job.url, resolvedOptions));
    appendLog(`Command: ${commandStr}`);
    console.log(`[queue] [job:${job.id}] Command: ${commandStr}`);
    updateJob(job.id, { command_args: commandStr, log: logLines.join('\n') });
    if (resolvedOptions.waitForLive) {
      appendLog(`Waiting for the broadcast to go live (checking every ${resolvedOptions.waitInterval || 15}s); recording starts automatically and finishes when the stream ends`);
      updateJob(job.id, { stage: 'Waiting for stream to go live…', log: logLines.join('\n') });
    }

    let lastLogSave = Date.now();
    let lastProgressSave = 0;
    let lastPercent = -1;

    const runDownload = (opts) => ytdlp.download(
      job.url,
      { ...opts, onSpawn: (pid) => updateJob(job.id, { pid }) },
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

    let result;
    try {
      result = await runDownload(resolvedOptions);
    } catch (e) {
      // A subtitle track that can't be fetched (usually YouTube rate-limiting caption
      // requests with HTTP 429) fails the whole yt-dlp run before the video is downloaded.
      // Losing the subtitles beats losing the video, so try once more without them.
      if (!resolvedOptions.subtitles || !ytdlp.isSubtitleDownloadError(e.message) || !getJob(job.id)) throw e;
      resolvedOptions.subtitles = false;
      appendLog(`WARNING: Subtitle download failed (${e.message.replace(/^ERROR:\s*/, '')}); retrying without subtitles`);
      const retryCommand = ytdlp.formatCommand(process.env.YTDLP_BIN || 'yt-dlp', ytdlp.buildDownloadArgs(job.url, resolvedOptions));
      appendLog(`Command: ${retryCommand}`);
      updateJob(job.id, { command_args: retryCommand, stage: 'Retrying without subtitles…', percent: 0, log: logLines.join('\n') });
      lastPercent = -1;
      result = await runDownload(resolvedOptions);
    }

    // Removed from the list mid-download (DELETE stops the process): there's no row left to
    // complete, tag, notify about or sync, so don't treat it as a finished download.
    if (!getJob(job.id)) {
      console.log(`[queue] [job:${job.id}] Removed during download; skipping post-processing`);
      return;
    }

    if (resolvedOptions.thumbnailFallbackUrl && result.filepath) {
      try {
        updateJob(job.id, { stage: 'Embedding thumbnail…' });
        await ytdlp.embedThumbnailFromUrl(result.filepath, resolvedOptions.thumbnailFallbackUrl);
        appendLog('Embedded fallback thumbnail');
      } catch (e) {
        appendLog(`WARNING: Couldn't embed fallback thumbnail (video kept): ${e.message}`);
      }
    }

    if (result.filepath && extraOptions.musicMetadata) {
      try {
        updateJob(job.id, { stage: 'Tagging…' });
        const music = require('./music');
        const tagged = await music.tagMusicFile(result.filepath, extraOptions.musicMetadata);
        if (tagged.tagged) appendLog(`Tagged music file${tagged.artwork ? ' and embedded album art' : ''}`);
      } catch (e) {
        appendLog(`WARNING: Couldn't write music tags/artwork (audio kept): ${e.message}`);
      }
    }

    // Removed while the thumbnail embed or tagging above ran.
    if (!getJob(job.id)) {
      console.log(`[queue] [job:${job.id}] Removed during post-processing; skipping completion`);
      return;
    }

    let splitResult = null;
    const splitLiveChunks = !!(resolvedOptions.splitLiveChunks ?? extraOptions.splitLiveChunks);
    const liveChunkDuration = parseInt(resolvedOptions.liveChunkDuration ?? extraOptions.liveChunkDuration ?? job.live_chunk_mins, 10) || 0;

    if (splitLiveChunks && liveChunkDuration > 0 && result.filepath && fs.existsSync(result.filepath)) {
      try {
        const chunkLabel = liveChunkDuration >= 60 ? `${liveChunkDuration / 60}h` : `${liveChunkDuration}m`;
        updateJob(job.id, { stage: `Splitting recording into ${chunkLabel} chunks…`, log: logLines.join('\n') });
        appendLog(`[split] Splitting live stream recording into ${liveChunkDuration}-minute chunks…`);
        splitResult = await liveSplitter.splitRecording(result.filepath, liveChunkDuration, (line) => {
          appendLog(`[split] ${line}`);
        });
        if (splitResult.split && splitResult.files?.length > 1) {
          result.filepath = splitResult.files[0];
          result.splitParts = splitResult.files;
          updateJob(job.id, {
            filepath: splitResult.files[0],
            split_parts: JSON.stringify(splitResult.files),
            log: logLines.join('\n'),
          });
          appendLog(`[split] Live stream recording successfully split into ${splitResult.files.length} chunks`);
        }
      } catch (e) {
        appendLog(`[split] WARNING: Chunk splitting failed (${e.message}) — kept original single file`);
        console.error(`[queue] [job:${job.id}] Failed to split live recording: ${e.message}`);
      }
    } else if (splitLiveChunks && liveChunkDuration > 0) {
      appendLog(`[split] WARNING: Skipped chunk splitting — the finished recording file wasn't found${result.filepath ? ` (${result.filepath})` : ''}`);
    }

    const completionMsg = result.splitParts && result.splitParts.length > 1
      ? `Live stream recording completed (split into ${result.splitParts.length} chunks) -> ${result.filepath}`
      : result.stoppedByUser
        ? `Live stream recording stopped by user -> ${result.filepath || 'saved stream'}`
        : result.completedWithErrors
          ? `Download completed with errors (file saved, may have gaps) -> ${result.filepath}`
          : `Download completed successfully -> ${result.filepath || 'unknown destination'}`;

    appendLog(completionMsg);
    console.log(`[queue] [job:${job.id}] ${completionMsg}`);
    updateJob(job.id, {
      status: 'completed',
      percent: 100,
      stage: result.splitParts && result.splitParts.length > 1 ? `Split into ${result.splitParts.length} chunks` : 'Completed',
      filepath: result.filepath || null,
      split_parts: result.splitParts ? JSON.stringify(result.splitParts) : null,
      pid: null,
      log: logLines.join('\n'),
    });
    notify.downloadCompleted(getJob(job.id), result);

    // Music tracks get their own metadata/artwork handling below; the generic .nfo/poster
    // sidecar uses a Kodi <movie> schema and the raw YouTube thumbnail, which is meaningless
    // (and visually wrong) clutter next to a song file.
    if (nfoInfo && result.filepath && isNfoEnabled() && !extraOptions.isMusicDownload) {
      const filesToTag = (result.splitParts && result.splitParts.length > 1) ? result.splitParts : [result.filepath];
      for (let i = 0; i < filesToTag.length; i++) {
        const targetPath = filesToTag[i];
        const partInfo = filesToTag.length > 1 ? { ...nfoInfo, title: `${nfoInfo.title} (Part ${i + 1})` } : nfoInfo;
        nfo.writeSidecarFiles(targetPath, partInfo, { fetchChannelInfo: fetchChannelListing })
          .catch((e) => console.error(`[queue] [job:${job.id}] Failed to write .nfo/poster for ${targetPath}: ${e.message}`));
      }
    }

    // Trigger debounced Jellyfin library scan so newly downloaded media shows up automatically
    try {
      const syncConfig = jellyfinSync.getSyncConfig();
      if (syncConfig.url && syncConfig.apiKey) {
        jellyfinSync.scheduleLibraryScan();
      }
    } catch (e) {
      console.error(`[queue] [job:${job.id}] Jellyfin library scan schedule failed: ${e.message}`);
    }

    // Best-effort: Jellyfin may not have scanned this file into its library yet, in which
    // case this is a no-op and the periodic sync job (jellyfinSync.start) picks it up later.
    if (job.watch_id) {
      const syncConfig = jellyfinSync.getSyncConfig();
      if (syncConfig.enabled) {
        jellyfinSync.syncWatch(job.watch_id, { config: syncConfig })
          .catch((e) => console.error(`[queue] [job:${job.id}] Jellyfin playlist sync failed: ${e.message}`));
      }
    }

    // Same two steps for Plex: a debounced library refresh, then a best-effort playlist sync
    // that the periodic job (plexSync.start) catches up on once Plex has scanned the file.
    try {
      const plexConfig = plexSync.getPlexConfig();
      if (plexSync.isConfigured(plexConfig)) {
        plexSync.scheduleLibraryScan();
        if (job.watch_id && plexConfig.syncEnabled) {
          plexSync.syncWatch(job.watch_id, { config: plexConfig })
            .catch((e) => console.error(`[queue] [job:${job.id}] Plex playlist sync failed: ${e.message}`));
        }
      }
    } catch (e) {
      console.error(`[queue] [job:${job.id}] Plex scan/sync schedule failed: ${e.message}`);
    }

    // Trigger Lidarr auto-import scan for completed music downloads
    if (extraOptions.isMusicDownload && result.filepath) {
      try {
        const lidarr = require('./lidarr');
        lidarr.notifyDownloadComplete(job, result, extraOptions);
      } catch (e) {
        console.error(`[queue] [job:${job.id}] Lidarr notification failed: ${e.message}`);
      }
    }
  } catch (err) {
    if (!getJob(job.id)) {
      console.log(`[queue] [job:${job.id}] Removed during download (${err.message})`);
      return;
    }
    const errorMsg = ytdlp.isBotCheckError(err.message)
      ? `${ytdlp.BOT_CHECK_HINT}\n\n${err.message}`
      : err.message;
    appendLog(`ERROR: ${errorMsg}`);
    console.error(`[queue] [job:${job.id}] Failed: ${err.message}`);
    updateJob(job.id, {
      status: 'failed',
      error: errorMsg,
      stage: 'Failed',
      pid: null,
      log: logLines.join('\n'),
    });
    notify.downloadFailed(getJob(job.id), err.message);
  }
}

// Broadcasts a job row (and the status counts) after another module changed it directly.
function announceJob(id) {
  emit(getJobSummary(id));
  emitCounts();
}

function stopJob(id) {
  const stopped = ytdlp.stopDownload(id);
  // The job stays in 'downloading' status until yt-dlp actually exits (SIGINT is graceful and
  // can take a few seconds, longer still if escalation to SIGTERM/SIGKILL is needed) — without
  // this, the UI has no way to tell finalization is in progress versus still recording normally.
  if (stopped) {
    updateJob(id, { stage: 'Finalizing recording…', eta: null, speed: null });
  }
  return stopped;
}

function removeJob(id) {
  const job = getJobSummary(id);
  ytdlp.stopDownload(id);
  db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
  if (!job) return false;
  notifyWatchItem({ ...job, status: 'removed' });
  if (io) io.emit('job:removed', { id });
  emitCounts();
  return true;
}

function getActiveCount() {
  return activeCount;
}

module.exports = {
  init, enqueue, createQueuedJob, startQueuedJobs, setWatchItemListener, listJobs, searchJobs, getStatusCounts,
  getJobLog, getJob, getJobSummary, announceJob, stopJob, removeJob, getActiveCount,
};
