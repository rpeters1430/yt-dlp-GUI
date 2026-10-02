const express = require('express');
const db = require('../db');
const defaultYtdlp = require('../services/ytdlp');
const jellyfinSync = require('../services/jellyfinSync');
const outputTemplate = require('../services/outputTemplate');
const { requireAuth } = require('../auth');
const { validateWatchFilters, evaluateEntry } = require('../services/watch/filters');
const { normalizeEntries } = require('../services/watch/discovery');
const { ITEM_STATUS_FILTERS } = require('../services/watch/repository');

const FORMAT_SELECTOR_RE = /^[\w+\-/*.,:()!<>=\s]{0,200}$/;

function parseLimit(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

// Blank filter fields are stored as NULL; patterns are kept exactly as typed otherwise.
function normalizePattern(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// A blank per-Watch filename template means "use the global one from Settings".
function normalizeTemplate(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function outputTemplateError(value) {
  const normalized = normalizeTemplate(value);
  return normalized ? outputTemplate.validateTemplate(normalized) : null;
}

// `database` and `requireAuthMiddleware` are injectable so tests can mount the router without a session.
function createWatchesRouter({
  repository, watchService, checkAllWatches, database = db, ytdlp = defaultYtdlp, requireAuthMiddleware = requireAuth,
}) {
  const router = express.Router();
  router.use(requireAuthMiddleware);

  // List all watches with metrics
  router.get('/', (req, res) => {
    res.json(repository.listWatches());
  });

  // Inspect a playlist or channel URL to extract title, avatar, description, and recent video preview
  router.post('/inspect', async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'A valid http(s) url is required' });
    }
    try {
      ytdlp.assertPublicUrl(url);
      const info = await ytdlp.getInfo(url, { flatPlaylist: true, playlistEnd: 6 });

      let thumbnail = null;
      if (info.thumbnails && Array.isArray(info.thumbnails)) {
        const avatar = info.thumbnails.find((t) => t.id && (t.id.includes('avatar') || t.id.includes('channel')));
        thumbnail = avatar?.url || info.thumbnails[info.thumbnails.length - 1]?.url;
      }
      thumbnail = thumbnail || info.thumbnail || null;

      const channelName = info.uploader || info.channel || null;
      const title = info.title || null;
      const description = info.description ? info.description.slice(0, 240) : null;

      const entries = [];
      function walk(node) {
        if (!node) return;
        if (node.entries && Array.isArray(node.entries)) {
          for (const item of node.entries) walk(item);
        } else if (node.id && (node.url || node.webpage_url || node._type === 'url' || node.title)) {
          entries.push({
            id: node.id,
            title: node.title,
            duration: node.duration,
            thumbnail: node.thumbnails?.[0]?.url || node.thumbnail || null,
            url: node.url || node.webpage_url || `https://www.youtube.com/watch?v=${node.id}`,
          });
        }
      }
      walk(info);

      res.json({
        title,
        channelName,
        thumbnail,
        description,
        isPlaylist: !!info.entries || info._type === 'playlist',
        entryCount: info.playlist_count || entries.length,
        recentVideos: entries.slice(0, 6),
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Shows which recent videos the given filters would admit, without saving anything.
  router.post('/preview-filter', async (req, res) => {
    const { url, matchTitle, rejectTitle, minDuration, maxDuration } = req.body || {};
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'A valid http(s) url is required' });
    }
    const filters = { matchTitle: normalizePattern(matchTitle), rejectTitle: normalizePattern(rejectTitle) };
    const filterErrors = validateWatchFilters(filters);
    if (filterErrors.length) return res.status(400).json({ error: filterErrors[0], errors: filterErrors });
    const watch = {
      match_title: filters.matchTitle,
      reject_title: filters.rejectTitle,
      min_duration: minDuration ? parseInt(minDuration, 10) || null : null,
      max_duration: maxDuration ? parseInt(maxDuration, 10) || null : null,
    };
    try {
      ytdlp.assertPublicUrl(url);
      const info = await ytdlp.getInfo(url, { flatPlaylist: true, playlistEnd: 20 });
      const rows = normalizeEntries(info).slice(0, 20).map((entry) => ({
        id: entry.id,
        title: entry.title,
        duration: entry.duration,
        ...evaluateEntry(entry, watch),
      }));
      res.json({ entries: rows });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Check all watches now
  router.post('/check-all', async (req, res) => {
    checkAllWatches({ force: true }).catch((e) => console.error('Manual check-all failed:', e.message));
    res.json({ message: 'Triggered check on all active watches' });
  });

  // Create a new watch
  router.post('/', (req, res) => {
    const {
      url,
      name,
      formatSelector,
      audioOnly,
      checkIntervalMins,
      quality,
      container,
      subtitles,
      subLangs,
      embedThumbnail,
      embedMetadata,
      embedChapters,
      sponsorblock,
      sponsorblockCategories,
      matchTitle,
      rejectTitle,
      minDuration,
      maxDuration,
      downloadLimit,
      maxScanEntries,
      thumbnail,
      channelName,
      backfillCount,
      cleanupExempt,
      outputTemplate,
    } = req.body || {};

    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'A valid http(s) url is required' });
    }
    try {
      ytdlp.assertPublicUrl(url);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (formatSelector && (typeof formatSelector !== 'string' || !FORMAT_SELECTOR_RE.test(formatSelector))) {
      return res.status(400).json({ error: 'Invalid format selector' });
    }

    const templateError = outputTemplateError(outputTemplate);
    if (templateError) return res.status(400).json({ error: templateError });
    const filterErrors = validateWatchFilters({ matchTitle: normalizePattern(matchTitle), rejectTitle: normalizePattern(rejectTitle) });
    if (filterErrors.length) return res.status(400).json({ error: filterErrors[0], errors: filterErrors });

    const interval = parseInt(checkIntervalMins, 10) || 30;
    const dlLimit = parseInt(downloadLimit, 10) || 5;
    const scanDepth = parseInt(maxScanEntries, 10) || 30;
    const minDur = minDuration ? parseInt(minDuration, 10) : null;
    const maxDur = maxDuration ? parseInt(maxDuration, 10) : null;
    const sponsorCats = Array.isArray(sponsorblockCategories)
      ? sponsorblockCategories.join(',')
      : (sponsorblockCategories || null);

    const result = database.prepare(`
      INSERT INTO watches (
        url, name, format_selector, audio_only, check_interval_mins,
        quality, container, subtitles, sub_langs, embed_thumbnail,
        embed_metadata, embed_chapters, sponsorblock, sponsorblock_categories,
        match_title, reject_title, min_duration, max_duration,
        download_limit, max_scan_entries, thumbnail, channel_name, cleanup_exempt, output_template, enabled
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, 1
      )
    `).run(
      url,
      name || null,
      formatSelector || null,
      audioOnly ? 1 : 0,
      interval,
      quality || null,
      container || 'mp4',
      subtitles ? 1 : 0,
      subLangs || 'en.*',
      embedThumbnail ? 1 : 0,
      embedMetadata ? 1 : 0,
      embedChapters ? 1 : 0,
      sponsorblock ? 1 : 0,
      sponsorCats,
      normalizePattern(matchTitle),
      normalizePattern(rejectTitle),
      minDur,
      maxDur,
      dlLimit,
      scanDepth,
      thumbnail || null,
      channelName || null,
      cleanupExempt ? 1 : 0,
      normalizeTemplate(outputTemplate)
    );

    const watch = repository.getWatch(Number(result.lastInsertRowid));

    const initialBackfill = Math.max(0, parseInt(backfillCount, 10) || 0);
    const { runId } = watchService.startCheck(watch, { manual: true, backfillCount: initialBackfill, trigger: 'initial' });

    res.json({ ...(repository.getWatch(watch.id) || watch), initial_run_id: runId });
  });

  // Update an existing watch
  router.put('/:id', (req, res) => {
    const watch = database.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });

    const {
      name,
      formatSelector,
      audioOnly,
      checkIntervalMins,
      quality,
      container,
      subtitles,
      subLangs,
      embedThumbnail,
      embedMetadata,
      embedChapters,
      sponsorblock,
      sponsorblockCategories,
      matchTitle,
      rejectTitle,
      minDuration,
      maxDuration,
      downloadLimit,
      maxScanEntries,
      enabled,
      cleanupExempt,
      outputTemplate,
    } = req.body || {};

    const templateError = outputTemplateError(outputTemplate);
    if (templateError) return res.status(400).json({ error: templateError });
    const filterErrors = validateWatchFilters({
      matchTitle: matchTitle !== undefined ? normalizePattern(matchTitle) : null,
      rejectTitle: rejectTitle !== undefined ? normalizePattern(rejectTitle) : null,
    });
    if (filterErrors.length) return res.status(400).json({ error: filterErrors[0], errors: filterErrors });

    if (formatSelector && (typeof formatSelector !== 'string' || !FORMAT_SELECTOR_RE.test(formatSelector))) {
      return res.status(400).json({ error: 'Invalid format selector' });
    }

    const interval = checkIntervalMins !== undefined ? parseInt(checkIntervalMins, 10) : watch.check_interval_mins;
    const dlLimit = downloadLimit !== undefined ? parseInt(downloadLimit, 10) : watch.download_limit;
    const scanDepth = maxScanEntries !== undefined ? parseInt(maxScanEntries, 10) : watch.max_scan_entries;
    const minDur = minDuration !== undefined ? (minDuration ? parseInt(minDuration, 10) : null) : watch.min_duration;
    const maxDur = maxDuration !== undefined ? (maxDuration ? parseInt(maxDuration, 10) : null) : watch.max_duration;
    const isEnabled = enabled !== undefined ? (enabled ? 1 : 0) : watch.enabled;
    const isAudio = audioOnly !== undefined ? (audioOnly ? 1 : 0) : watch.audio_only;
    const isSubs = subtitles !== undefined ? (subtitles ? 1 : 0) : watch.subtitles;
    const isEmbedThumb = embedThumbnail !== undefined ? (embedThumbnail ? 1 : 0) : watch.embed_thumbnail;
    const isEmbedMeta = embedMetadata !== undefined ? (embedMetadata ? 1 : 0) : watch.embed_metadata;
    const isEmbedChap = embedChapters !== undefined ? (embedChapters ? 1 : 0) : watch.embed_chapters;
    const isSponsor = sponsorblock !== undefined ? (sponsorblock ? 1 : 0) : watch.sponsorblock;
    const sponsorCats = sponsorblockCategories !== undefined
      ? (Array.isArray(sponsorblockCategories) ? sponsorblockCategories.join(',') : (sponsorblockCategories || null))
      : watch.sponsorblock_categories;
    const isCleanupExempt = cleanupExempt !== undefined ? (cleanupExempt ? 1 : 0) : watch.cleanup_exempt;

    database.prepare(`
      UPDATE watches SET
        name = ?,
        format_selector = ?,
        audio_only = ?,
        check_interval_mins = ?,
        quality = ?,
        container = ?,
        subtitles = ?,
        sub_langs = ?,
        embed_thumbnail = ?,
        embed_metadata = ?,
        embed_chapters = ?,
        sponsorblock = ?,
        sponsorblock_categories = ?,
        match_title = ?,
        reject_title = ?,
        min_duration = ?,
        max_duration = ?,
        download_limit = ?,
        max_scan_entries = ?,
        enabled = ?,
        cleanup_exempt = ?,
        output_template = ?
      WHERE id = ?
    `).run(
      name !== undefined ? (name || null) : watch.name,
      formatSelector !== undefined ? (formatSelector || null) : watch.format_selector,
      isAudio,
      interval,
      quality !== undefined ? (quality || null) : watch.quality,
      container !== undefined ? (container || 'mp4') : watch.container,
      isSubs,
      subLangs !== undefined ? (subLangs || 'en.*') : watch.sub_langs,
      isEmbedThumb,
      isEmbedMeta,
      isEmbedChap,
      isSponsor,
      sponsorCats,
      matchTitle !== undefined ? normalizePattern(matchTitle) : watch.match_title,
      rejectTitle !== undefined ? normalizePattern(rejectTitle) : watch.reject_title,
      minDur,
      maxDur,
      dlLimit,
      scanDepth,
      isEnabled,
      isCleanupExempt,
      outputTemplate !== undefined ? normalizeTemplate(outputTemplate) : watch.output_template,
      watch.id
    );

    const updated = repository.getWatch(Number(watch.id));

    res.json(updated);
  });

  // Toggle enabled status
  router.patch('/:id/toggle', (req, res) => {
    const watch = database.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });

    const nextEnabled = watch.enabled ? 0 : 1;
    database.prepare('UPDATE watches SET enabled = ? WHERE id = ?').run(nextEnabled, watch.id);

    const updated = repository.getWatch(Number(watch.id));

    res.json(updated);
  });

  // Toggle whether this watch's downloads are exempt from the nightly auto-delete job
  router.patch('/:id/toggle-cleanup-exempt', (req, res) => {
    const watch = database.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });

    const nextExempt = watch.cleanup_exempt ? 0 : 1;
    database.prepare('UPDATE watches SET cleanup_exempt = ? WHERE id = ?').run(nextExempt, watch.id);

    const updated = repository.getWatch(Number(watch.id));

    res.json(updated);
  });

  // Trigger check now
  router.post('/:id/check', async (req, res) => {
    const watch = database.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });
    try {
      const result = await watchService.checkWatch(watch, { manual: true });
      res.json(result);
    } catch (err) {
      // The failure is recorded on the run and shown on the watch card.
      res.json({ runId: err.runId || null, alreadyRunning: false, status: 'failed', error: err.message });
    }
  });

  // Build/update the Jellyfin playlist for this watch's downloaded videos right now, instead
  // of waiting for the periodic sync. Works regardless of the "auto-sync" toggle, as long as a
  // Jellyfin URL/API key/user are configured — same as the "Sync now" button on Settings.
  router.post('/:id/sync-jellyfin', async (req, res) => {
    const watch = database.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });
    try {
      const result = await jellyfinSync.syncWatch(watch.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get downloads triggered by this watch
  router.get('/:id/downloads', (req, res) => {
    const downloads = database.prepare('SELECT * FROM downloads WHERE watch_id = ? ORDER BY created_at DESC LIMIT 100').all(req.params.id);
    res.json(downloads);
  });

  // Reset history: forget everything except completed downloads and rebaseline on the next
  // check. Completed items stay so files already downloaded aren't fetched again.
  router.post('/:id/reset-seen', (req, res) => {
    const watch = database.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });
    if (watchService.isRunning(watch.id)) return res.status(409).json({ error: 'This watch is being checked right now; try again in a moment' });
    repository.resetHistory(watch.id);
    res.json(repository.getWatch(watch.id));
  });

  // Recent check runs for this watch
  router.get('/:id/runs', (req, res) => {
    const watch = database.prepare('SELECT id FROM watches WHERE id = ?').get(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });
    res.json(repository.listRuns(watch.id, { limit: parseLimit(req.query.limit, 20, 100) || 20 }));
  });

  // Discovered items for this watch, filterable by state
  router.get('/:id/items', (req, res) => {
    const watch = database.prepare('SELECT id FROM watches WHERE id = ?').get(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    if (status !== 'all' && !ITEM_STATUS_FILTERS[status]) return res.status(400).json({ error: 'Unknown status filter' });
    res.json(repository.listItems(watch.id, {
      status,
      limit: parseLimit(req.query.limit, 100, 100) || 100,
      offset: parseLimit(req.query.offset, 0, Number.MAX_SAFE_INTEGER),
    }));
  });

  // Retry a failed item now
  router.post('/:id/items/:itemId/retry', (req, res) => {
    const watch = database.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });
    const result = watchService.retryItem(watch, Number(req.params.itemId));
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  });

  // Delete watch
  router.delete('/:id', (req, res) => {
    const watchId = Number(req.params.id);
    if (watchService.isRunning(watchId)) return res.status(409).json({ error: 'This watch is being checked right now; try again in a moment' });
    if (!repository.deleteWatch(watchId)) return res.status(404).json({ error: 'Watch not found' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createWatchesRouter };
