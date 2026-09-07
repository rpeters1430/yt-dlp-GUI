const cron = require('node-cron');
const db = require('../db');
const ytdlp = require('./ytdlp');
const queue = require('./queue');

let io = null;
let running = false;

function init(socketIo) {
  io = socketIo;
}

function emitWatchUpdate(watchId) {
  if (!io) return;
  try {
    const watch = db.prepare(`
      SELECT w.*,
        (SELECT COUNT(*) FROM watch_seen_ids WHERE watch_id = w.id) AS seen_count,
        (SELECT COUNT(*) FROM downloads WHERE watch_id = w.id) AS download_count
      FROM watches w WHERE w.id = ?
    `).get(watchId);
    if (watch) io.emit('watch:update', watch);
  } catch (_) {}
}

function extractThumbnail(info) {
  if (info.thumbnails && Array.isArray(info.thumbnails)) {
    const avatar = info.thumbnails.find((t) => t.id && (t.id.includes('avatar') || t.id.includes('channel')));
    if (avatar && avatar.url) return avatar.url;
    const withUrl = info.thumbnails.filter((t) => t.url);
    if (withUrl.length > 0) return withUrl[withUrl.length - 1].url;
  }
  return info.thumbnail || null;
}

function extractVideoEntries(info) {
  const list = [];
  function walk(node) {
    if (!node) return;
    if (node.entries && Array.isArray(node.entries)) {
      for (const item of node.entries) {
        walk(item);
      }
    } else if (node.id && (node.url || node.webpage_url || node._type === 'url' || node.title)) {
      list.push(node);
    }
  }
  walk(info);
  return list;
}

function matchesWatchFilter(entry, watch) {
  const title = (entry.title || '').trim();

  // Match title filter (must contain)
  if (watch.match_title && watch.match_title.trim()) {
    const pattern = watch.match_title.trim();
    try {
      const re = new RegExp(pattern, 'i');
      if (!re.test(title)) return false;
    } catch (_) {
      if (!title.toLowerCase().includes(pattern.toLowerCase())) return false;
    }
  }

  // Reject title filter (must NOT contain)
  if (watch.reject_title && watch.reject_title.trim()) {
    const pattern = watch.reject_title.trim();
    try {
      const re = new RegExp(pattern, 'i');
      if (re.test(title)) return false;
    } catch (_) {
      if (title.toLowerCase().includes(pattern.toLowerCase())) return false;
    }
  }

  // Duration filters
  const duration = typeof entry.duration === 'number' ? entry.duration : null;
  if (duration !== null) {
    if (watch.min_duration && duration < watch.min_duration) return false;
    if (watch.max_duration && duration > watch.max_duration) return false;
  }

  return true;
}

async function checkWatch(watch, { manual = false, forceDownloadCount = 0 } = {}) {
  // If watch is disabled and this wasn't a manual trigger, skip it
  if (!watch.enabled && !manual) return 0;

  try {
    console.log(`[watch] Checking watch #${watch.id} "${watch.name || 'unnamed'}" (${watch.url})`);

    // Signal UI that checking has started
    db.prepare("UPDATE watches SET last_status = 'checking' WHERE id = ?").run(watch.id);
    emitWatchUpdate(watch.id);

    const scanLimit = Math.max(10, Math.min(100, watch.max_scan_entries || 30));
    const info = await ytdlp.getInfo(watch.url, { flatPlaylist: true, playlistEnd: scanLimit });
    const entries = extractVideoEntries(info);

    const channelName = info.uploader || info.channel || null;
    const thumbnail = extractThumbnail(info);

    const seenRows = db.prepare('SELECT video_id FROM watch_seen_ids WHERE watch_id = ?').all(watch.id);
    const seen = new Set(seenRows.map((r) => r.video_id));

    const insertSeen = db.prepare(
      'INSERT OR IGNORE INTO watch_seen_ids (watch_id, video_id, title) VALUES (?, ?, ?)'
    );

    let newCount = 0;
    let enqueuedCount = 0;
    const downloadLimit = forceDownloadCount > 0 ? forceDownloadCount : (watch.download_limit || 5);

    for (const entry of entries) {
      const id = entry.id;
      if (!id) continue;
      if (seen.has(id)) continue;

      const title = entry.title || null;
      seen.add(id);
      insertSeen.run(watch.id, id, title);
      newCount++;

      // Check filters
      const passesFilter = matchesWatchFilter(entry, watch);
      if (!passesFilter) {
        console.log(`[watch] #${watch.id} Video "${title || id}" excluded by filters`);
        continue;
      }

      // Download eligibility:
      // Either this is not the first check (watch.last_checked_at is set),
      // or forceDownloadCount was explicitly requested (backfill option)
      const shouldDownload = !!watch.last_checked_at || forceDownloadCount > 0;
      if (shouldDownload && enqueuedCount < downloadLimit) {
        const entryUrl = entry.url || entry.webpage_url || `https://www.youtube.com/watch?v=${id}`;
        console.log(`[watch] #${watch.id} Enqueueing new video "${title || id}"`);

        const sponsorblockCategories = watch.sponsorblock
          ? (watch.sponsorblock_categories ? watch.sponsorblock_categories.split(',').map((s) => s.trim()).filter(Boolean) : ['sponsor'])
          : [];

        queue.enqueue(entryUrl, {
          formatSelector: watch.format_selector,
          audioOnly: !!watch.audio_only,
          quality: watch.quality || null,
          container: watch.container || 'mp4',
          subtitles: !!watch.subtitles,
          subLangs: watch.sub_langs || 'en.*',
          watchId: watch.id,
          optionsJson: {
            embedThumbnail: !!watch.embed_thumbnail,
            embedMetadata: !!watch.embed_metadata,
            embedChapters: !!watch.embed_chapters,
            sponsorblockCategories,
          },
        });
        enqueuedCount++;
      }
    }

    db.prepare(`
      UPDATE watches
      SET last_checked_at = datetime('now'),
          last_status = 'ok',
          last_error = NULL,
          last_new_count = ?,
          thumbnail = COALESCE(thumbnail, ?),
          channel_name = COALESCE(channel_name, ?)
      WHERE id = ?
    `).run(newCount, thumbnail, channelName, watch.id);

    console.log(`[watch] #${watch.id} Check finished: ${entries.length} scanned, ${newCount} new recorded, ${enqueuedCount} enqueued`);
    emitWatchUpdate(watch.id);
    return newCount;
  } catch (err) {
    console.error(`[watch:error] Check failed for #${watch.id} (${watch.url}):`, err.message);
    db.prepare(`
      UPDATE watches
      SET last_status = 'error', last_error = ?
      WHERE id = ?
    `).run(err.message, watch.id);
    emitWatchUpdate(watch.id);
    return 0;
  }
}

async function checkAllWatches({ force = false } = {}) {
  if (running) {
    console.log('[scheduler] Previous watch check still in progress, skipping');
    return;
  }
  running = true;
  try {
    const watches = db.prepare('SELECT * FROM watches WHERE enabled = 1').all();
    const now = Date.now();

    for (const watch of watches) {
      if (!force && watch.last_checked_at) {
        const lastCheckedMs = new Date(watch.last_checked_at + 'Z').getTime();
        const intervalMs = (watch.check_interval_mins || 30) * 60 * 1000;
        if (now - lastCheckedMs < intervalMs) {
          continue; // Not due yet
        }
      }
      await checkWatch(watch, { manual: force });
    }
  } finally {
    running = false;
  }
}

function start() {
  // Tick every 5 minutes to evaluate watches whose check_interval_mins has elapsed
  cron.schedule('*/5 * * * *', () => {
    checkAllWatches({ force: false }).catch((e) => console.error('[scheduler] Run failed:', e.message));
  });
}

module.exports = { init, start, checkAllWatches, checkWatch };
