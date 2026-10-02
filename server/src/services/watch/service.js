const path = require('path');
const { evaluateEntry, watchConfigError } = require('./filters');
const { scanToBoundary, HARD_SCAN_LIMIT } = require('./discovery');

function extractThumbnail(info) {
  if (info.thumbnails && Array.isArray(info.thumbnails)) {
    const avatar = info.thumbnails.find((t) => t.id && (t.id.includes('avatar') || t.id.includes('channel')));
    if (avatar && avatar.url) return avatar.url;
    const withUrl = info.thumbnails.filter((t) => t.url);
    if (withUrl.length > 0) return withUrl[withUrl.length - 1].url;
  }
  return info.thumbnail || null;
}

// Queue options for a download triggered by this watch.
function buildDownloadOptions(watch, downloadDir) {
  const sponsorblockCategories = watch.sponsorblock
    ? (watch.sponsorblock_categories ? watch.sponsorblock_categories.split(',').map((s) => s.trim()).filter(Boolean) : ['sponsor'])
    : [];

  let outputTemplate = null;
  let audioQuality = null;
  if (watch.is_music) {
    const musicFolder = watch.music_folder || 'Music';
    const resolvedMusicDir = path.isAbsolute(musicFolder) ? musicFolder : path.join(downloadDir || '', musicFolder);
    // No album/playlist tag (a single, not part of a release) leaves this segment empty;
    // yt-dlp collapses the resulting "//" so the file lands directly in the artist
    // folder instead of a redundant subfolder that just repeats the artist's name.
    outputTemplate = `${resolvedMusicDir}/%(artist,uploader)s/%(album,playlist_title|)s/%(playlist_index&{:02d} - |)s%(title)s.%(ext)s`;
    audioQuality = watch.audio_quality || '320k';
  }

  return {
    formatSelector: watch.format_selector,
    audioOnly: !!watch.audio_only || !!watch.is_music,
    quality: watch.quality || null,
    container: watch.container || (watch.is_music ? 'mp3' : 'mp4'),
    subtitles: !!watch.subtitles,
    subLangs: watch.sub_langs || 'en.*',
    watchId: watch.id,
    optionsJson: {
      embedThumbnail: !!watch.embed_thumbnail || !!watch.is_music,
      embedMetadata: !!watch.embed_metadata || !!watch.is_music,
      embedChapters: !!watch.embed_chapters,
      sponsorblockRemove: sponsorblockCategories,
      outputTemplate,
      audioQuality,
      isMusicDownload: !!watch.is_music,
    },
  };
}

function itemEntry(item) {
  return { title: item.title, duration: item.duration };
}

function createWatchService({ repository, ytdlp, queue, notify = null, emitWatchUpdate = () => {} }) {
  const running = new Map(); // watchId -> { runId, promise }

  function log(watch, runId, message) {
    console.log(`[watch] #${watch.id} run ${runId}: ${message}`);
  }

  // Creates and links download jobs for these items in one transaction, then starts them.
  function queueItems(watch, items, runId) {
    const options = buildDownloadOptions(watch, ytdlp.DOWNLOAD_DIR);
    const created = repository.transaction(() => items.map((item) => {
      const url = item.url || `https://www.youtube.com/watch?v=${item.video_id}`;
      const { id } = queue.createQueuedJob(url, { ...options, watchItemId: item.id });
      repository.linkQueuedJob(item.id, id);
      return { item, downloadId: id };
    }))();
    for (const { item, downloadId } of created) {
      log(watch, runId, `item ${item.id} (${item.video_id}) ${item.download_status} -> queued as job ${downloadId}`);
    }
    if (created.length) queue.startQueuedJobs(created.map((c) => c.downloadId));
    return created;
  }

  async function runCheck(watch, runId, { backfillCount, trigger }) {
    try {
      log(watch, runId, `checking ${watch.url} (${trigger})`);
      repository.updateWatchStatus(watch.id, { last_status: 'checking' });
      emitWatchUpdate(watch.id);

      const configError = watchConfigError(watch);
      if (configError) throw new Error(`Filter configuration error: ${configError}`);

      const initial = !watch.last_checked_at;
      const pageSize = Math.max(10, Math.min(100, watch.max_scan_entries || 30));
      const known = repository.knownIds(watch.id);
      const hardLimit = initial ? Math.min(HARD_SCAN_LIMIT, Math.max(pageSize, backfillCount)) : HARD_SCAN_LIMIT;
      const scan = await scanToBoundary({ getInfo: ytdlp.getInfo, url: watch.url, knownIds: known, pageSize, hardLimit });

      const counts = { baseline: 0, new: 0, backfill: 0, matched: 0, excluded: 0 };
      let backfillLeft = initial ? backfillCount : 0;
      const items = scan.entries.map((entry) => {
        if (known.has(entry.id)) return { entry };
        const { eligible, reason } = evaluateEntry(entry, watch);
        let discoveryType;
        if (!initial) discoveryType = 'new';
        else if (eligible && backfillLeft > 0) { discoveryType = 'backfill'; backfillLeft--; }
        else discoveryType = 'baseline';
        counts[discoveryType]++;
        if (discoveryType !== 'baseline') counts[eligible ? 'matched' : 'excluded']++;
        return { entry, discoveryType, filterStatus: eligible ? 'eligible' : 'excluded', filterReason: reason };
      });

      repository.transaction(() => {
        repository.reconcileOrphans(watch.id);
        repository.upsertItems(watch.id, items);
        repository.reevaluateItems(watch.id, (item) => evaluateEntry(itemEntry(item), watch));
      })();

      const budget = initial ? backfillCount : (watch.download_limit || 5);
      const candidates = repository.queueCandidates(watch.id, repository.now(), budget);
      const queued = queueItems(watch, candidates, runId);

      const agg = repository.aggregateWatch(watch.id);
      const partial = !initial && scan.saturated;
      const run = repository.finishRun(runId, {
        status: partial ? 'partial' : 'completed',
        scanned_count: scan.entries.length,
        baseline_count: counts.baseline,
        new_count: counts.new,
        backfill_count: counts.backfill,
        matched_count: counts.matched,
        excluded_count: counts.excluded,
        queued_count: queued.length,
        pending_count: agg.pending_count,
        failed_count: agg.failed_count,
        scan_boundary_reached: scan.boundaryReached,
      });

      const latest = repository.getWatch(watch.id) || watch;
      repository.updateWatchStatus(watch.id, {
        last_checked_at: repository.nowSql(),
        last_status: 'ok',
        last_error: partial ? 'Scan limit reached before known content' : null,
        last_new_count: counts.new,
        thumbnail: latest.thumbnail || extractThumbnail(scan.info),
        channel_name: latest.channel_name || scan.info.uploader || scan.info.channel || null,
      });

      log(watch, runId, `${run.status}: ${scan.entries.length} scanned, ${counts.baseline} baseline, ${counts.new} new, `
        + `${counts.backfill} backfill, ${counts.matched} matched, ${counts.excluded} excluded, `
        + `${queued.length} queued, ${agg.pending_count} pending`);
      emitWatchUpdate(watch.id);
      if (queued.length && notify) notify.watchNewVideos(watch, queued.map(({ item }) => item.title || item.video_id));

      return {
        runId,
        alreadyRunning: false,
        status: run.status,
        scannedCount: scan.entries.length,
        baselineCount: counts.baseline,
        newCount: counts.new,
        backfillCount: counts.backfill,
        matchedCount: counts.matched,
        excludedCount: counts.excluded,
        queuedCount: queued.length,
        pendingCount: agg.pending_count,
        boundaryReached: scan.boundaryReached,
      };
    } catch (err) {
      console.error(`[watch:error] #${watch.id} run ${runId} failed (${watch.url}): ${err.message}`);
      repository.finishRun(runId, { status: 'failed', error: err.message });
      repository.updateWatchStatus(watch.id, { last_status: 'error', last_error: err.message });
      emitWatchUpdate(watch.id);
      // Only on the transition into failing, so a channel that stays broken doesn't ping
      // every check interval. `watch` is the row as it was before this check started.
      if (notify && watch.last_status !== 'error') notify.watchError(watch, err.message);
      err.runId = runId;
      throw err;
    }
  }

  // Overlapping checks of one watch (scheduled tick + "Check now", double clicks) share the
  // run already in progress instead of discovering and queueing the same videos twice.
  function checkWatch(watch, { manual = false, backfillCount = 0, trigger } = {}) {
    if (!watch.enabled && !manual) return Promise.resolve({ skipped: true, alreadyRunning: false, runId: null });
    const current = running.get(watch.id);
    if (current) {
      return Promise.resolve({ runId: current.runId, alreadyRunning: true });
    }
    const resolvedTrigger = trigger || (!watch.last_checked_at ? 'initial' : (manual ? 'manual' : 'scheduled'));
    const runId = repository.createRun(watch.id, resolvedTrigger);
    const promise = runCheck(watch, runId, { backfillCount: Math.max(0, parseInt(backfillCount, 10) || 0), trigger: resolvedTrigger })
      .finally(() => running.delete(watch.id));
    running.set(watch.id, { runId, promise });
    return promise;
  }

  // Starts a check without waiting for it; returns the run it started or joined.
  function startCheck(watch, options = {}) {
    const current = running.get(watch.id);
    if (current) return { runId: current.runId, alreadyRunning: true };
    const promise = checkWatch(watch, options);
    promise.catch(() => {}); // already logged and recorded on the run
    const started = running.get(watch.id);
    return { runId: started ? started.runId : null, alreadyRunning: false };
  }

  // Manual retry: queue a failed item now, regardless of its automatic retry schedule.
  function retryItem(watch, itemId) {
    const item = repository.getItem(itemId, watch.id);
    if (!item) return { error: 'Item not found', status: 404 };
    if (item.download_status !== 'failed') return { error: 'Only failed items can be retried', status: 409 };
    repository.resetForManualRetry(item.id);
    const [created] = queueItems(watch, [repository.getItem(item.id)], 'manual-retry');
    emitWatchUpdate(watch.id);
    return { item: repository.getItem(item.id), downloadId: created.downloadId };
  }

  return {
    checkWatch,
    startCheck,
    retryItem,
    isRunning: (watchId) => running.has(watchId),
  };
}

module.exports = { createWatchService, buildDownloadOptions, extractThumbnail };
