const express = require('express');
const db = require('../db');
const scheduler = require('../services/scheduler');
const ytdlp = require('../services/ytdlp');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const FORMAT_SELECTOR_RE = /^[\w+\-/*.,:()!<>=\s]{0,200}$/;

// List all watches with metrics
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM watch_seen_ids WHERE watch_id = w.id) AS seen_count,
      (SELECT COUNT(*) FROM downloads WHERE watch_id = w.id) AS download_count
    FROM watches w
    ORDER BY w.created_at DESC
  `).all();
  res.json(rows);
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

// Check all watches now
router.post('/check-all', async (req, res) => {
  scheduler.checkAllWatches({ force: true }).catch((e) => console.error('Manual check-all failed:', e.message));
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

  const interval = parseInt(checkIntervalMins, 10) || 30;
  const dlLimit = parseInt(downloadLimit, 10) || 5;
  const scanDepth = parseInt(maxScanEntries, 10) || 30;
  const minDur = minDuration ? parseInt(minDuration, 10) : null;
  const maxDur = maxDuration ? parseInt(maxDuration, 10) : null;
  const sponsorCats = Array.isArray(sponsorblockCategories)
    ? sponsorblockCategories.join(',')
    : (sponsorblockCategories || null);

  const result = db.prepare(`
    INSERT INTO watches (
      url, name, format_selector, audio_only, check_interval_mins,
      quality, container, subtitles, sub_langs, embed_thumbnail,
      embed_metadata, embed_chapters, sponsorblock, sponsorblock_categories,
      match_title, reject_title, min_duration, max_duration,
      download_limit, max_scan_entries, thumbnail, channel_name, cleanup_exempt, enabled
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, 1
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
    matchTitle || null,
    rejectTitle || null,
    minDur,
    maxDur,
    dlLimit,
    scanDepth,
    thumbnail || null,
    channelName || null,
    cleanupExempt ? 1 : 0
  );

  const watch = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM watch_seen_ids WHERE watch_id = w.id) AS seen_count,
      (SELECT COUNT(*) FROM downloads WHERE watch_id = w.id) AS download_count
    FROM watches w WHERE w.id = ?
  `).get(result.lastInsertRowid);

  const initialBackfill = parseInt(backfillCount, 10) || 0;
  scheduler.checkWatch(watch, { manual: true, forceDownloadCount: initialBackfill })
    .catch((e) => console.error('Initial watch check failed:', e.message));

  res.json(watch);
});

// Update an existing watch
router.put('/:id', (req, res) => {
  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
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
  } = req.body || {};

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

  db.prepare(`
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
      cleanup_exempt = ?
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
    matchTitle !== undefined ? (matchTitle || null) : watch.match_title,
    rejectTitle !== undefined ? (rejectTitle || null) : watch.reject_title,
    minDur,
    maxDur,
    dlLimit,
    scanDepth,
    isEnabled,
    isCleanupExempt,
    watch.id
  );

  const updated = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM watch_seen_ids WHERE watch_id = w.id) AS seen_count,
      (SELECT COUNT(*) FROM downloads WHERE watch_id = w.id) AS download_count
    FROM watches w WHERE w.id = ?
  `).get(watch.id);

  res.json(updated);
});

// Toggle enabled status
router.patch('/:id/toggle', (req, res) => {
  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
  if (!watch) return res.status(404).json({ error: 'Watch not found' });

  const nextEnabled = watch.enabled ? 0 : 1;
  db.prepare('UPDATE watches SET enabled = ? WHERE id = ?').run(nextEnabled, watch.id);

  const updated = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM watch_seen_ids WHERE watch_id = w.id) AS seen_count,
      (SELECT COUNT(*) FROM downloads WHERE watch_id = w.id) AS download_count
    FROM watches w WHERE w.id = ?
  `).get(watch.id);

  res.json(updated);
});

// Toggle whether this watch's downloads are exempt from the nightly auto-delete job
router.patch('/:id/toggle-cleanup-exempt', (req, res) => {
  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
  if (!watch) return res.status(404).json({ error: 'Watch not found' });

  const nextExempt = watch.cleanup_exempt ? 0 : 1;
  db.prepare('UPDATE watches SET cleanup_exempt = ? WHERE id = ?').run(nextExempt, watch.id);

  const updated = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM watch_seen_ids WHERE watch_id = w.id) AS seen_count,
      (SELECT COUNT(*) FROM downloads WHERE watch_id = w.id) AS download_count
    FROM watches w WHERE w.id = ?
  `).get(watch.id);

  res.json(updated);
});

// Trigger check now
router.post('/:id/check', async (req, res) => {
  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
  if (!watch) return res.status(404).json({ error: 'Watch not found' });
  const newCount = await scheduler.checkWatch(watch, { manual: true });
  res.json({ newCount });
});

// Get downloads triggered by this watch
router.get('/:id/downloads', (req, res) => {
  const downloads = db.prepare('SELECT * FROM downloads WHERE watch_id = ? ORDER BY created_at DESC LIMIT 100').all(req.params.id);
  res.json(downloads);
});

// Reset seen video IDs for this watch
router.post('/:id/reset-seen', (req, res) => {
  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
  if (!watch) return res.status(404).json({ error: 'Watch not found' });
  db.prepare('DELETE FROM watch_seen_ids WHERE watch_id = ?').run(watch.id);
  db.prepare("UPDATE watches SET last_checked_at = NULL, last_new_count = 0, last_status = 'ok', last_error = NULL WHERE id = ?").run(watch.id);

  const updated = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM watch_seen_ids WHERE watch_id = w.id) AS seen_count,
      (SELECT COUNT(*) FROM downloads WHERE watch_id = w.id) AS download_count
    FROM watches w WHERE w.id = ?
  `).get(watch.id);

  res.json(updated);
});

// Delete watch
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM watches WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Watch not found' });
  db.prepare('DELETE FROM watch_seen_ids WHERE watch_id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
