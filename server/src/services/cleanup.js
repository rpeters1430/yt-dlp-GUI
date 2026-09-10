const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const db = require('../db');
const jellyfin = require('./jellyfin');

let io = null;

function init(socketIo) {
  io = socketIo;
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== undefined ? row.value : fallback;
}

function isTruthy(value) {
  return value === '1' || value === 1 || value === true;
}

function getCleanupConfig() {
  return {
    ageEnabled: isTruthy(getSetting('cleanup_age_enabled', '0')),
    ageDays: parseInt(getSetting('cleanup_age_days', '30'), 10) || 30,
    jellyfinEnabled: isTruthy(getSetting('cleanup_jellyfin_enabled', '0')),
    jellyfinUrl: getSetting('jellyfin_url', ''),
    jellyfinApiKey: getSetting('jellyfin_api_key', ''),
    jellyfinUserId: getSetting('jellyfin_user_id', ''),
    keepRecentPerWatch: parseInt(getSetting('cleanup_keep_recent', '0'), 10) || 0,
  };
}

// Only watch-triggered downloads are eligible — a video someone deliberately queued by hand
// wasn't "subscribed" to and shouldn't disappear on its own. LEFT JOIN (not INNER) so a
// download whose watch was since deleted stays a candidate instead of silently becoming
// permanently un-cleanable — it just reads as "not exempt" with no watch name to show.
function getCleanupCandidates() {
  return db.prepare(`
    SELECT d.*, w.cleanup_exempt AS watch_cleanup_exempt, w.name AS watch_name, w.channel_name AS watch_channel_name
    FROM downloads d
    LEFT JOIN watches w ON w.id = d.watch_id
    WHERE d.status = 'completed' AND d.filepath IS NOT NULL AND d.watch_id IS NOT NULL
  `).all();
}

function summarize(download, extra) {
  return {
    id: download.id,
    title: download.title || download.url,
    filepath: download.filepath,
    createdAt: download.created_at,
    watchId: download.watch_id,
    watchName: download.watch_name || download.watch_channel_name || null,
    ...extra,
  };
}

// Shared by the nightly run and the Settings-page dry-run preview, so "what would happen" and
// "what actually happened" can never drift apart. Evaluates the age/Jellyfin-watched rules,
// then applies the three protection layers (per-video, per-watch exempt, keep-newest-N) before
// deciding what's actually deletable.
async function computeCleanupPlan() {
  const config = getCleanupConfig();
  const candidates = getCleanupCandidates();

  let playedBasenames = null;
  let jellyfinError = null;
  if (config.jellyfinEnabled && config.jellyfinUrl && config.jellyfinApiKey) {
    try {
      playedBasenames = await jellyfin.getPlayedBasenames(config.jellyfinUrl, config.jellyfinApiKey, config.jellyfinUserId || null);
    } catch (err) {
      jellyfinError = err.message;
      console.error(`[cleanup] Skipping Jellyfin-based deletion this run: ${err.message}`);
    }
  }

  // "Keep newest N per watch" only matters among videos that would otherwise be deleted —
  // grouping by watch and ranking by created_at lets that guard apply per-source rather than
  // treating the whole library as one pool.
  const byWatch = new Map();
  for (const d of candidates) {
    if (!byWatch.has(d.watch_id)) byWatch.set(d.watch_id, []);
    byWatch.get(d.watch_id).push(d);
  }
  const keptByRecency = new Set();
  if (config.keepRecentPerWatch > 0) {
    for (const list of byWatch.values()) {
      const sorted = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      for (const d of sorted.slice(0, config.keepRecentPerWatch)) {
        keptByRecency.add(d.id);
      }
    }
  }

  const now = Date.now();
  const toDelete = [];
  const toKeep = [];

  for (const d of candidates) {
    const reasons = [];

    if (config.ageEnabled) {
      const ageDays = (now - new Date(d.created_at + 'Z').getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays >= config.ageDays) reasons.push(`older than ${config.ageDays}d`);
    }
    if (playedBasenames) {
      const basename = path.basename(d.filepath);
      if (playedBasenames.has(basename)) reasons.push('watched in Jellyfin');
    }

    if (reasons.length === 0) continue; // doesn't match any rule — not relevant to the plan

    let protectedReason = null;
    if (isTruthy(d.protected)) protectedReason = 'video marked protected';
    else if (isTruthy(d.watch_cleanup_exempt)) protectedReason = 'watch excluded from auto-delete';
    else if (keptByRecency.has(d.id)) protectedReason = `newest ${config.keepRecentPerWatch} for this watch`;

    if (protectedReason) {
      toKeep.push(summarize(d, { matchedReasons: reasons, protectedReason }));
    } else {
      toDelete.push(summarize(d, { matchedReasons: reasons }));
    }
  }

  return { toDelete, toKeep, checked: candidates.length, config, jellyfinError };
}

function emitJobUpdate(id) {
  if (!io) return;
  const job = db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);
  if (job) io.emit('job:update', job);
}

function deleteDownloadFile(id, filepath, title, reason) {
  try {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  } catch (err) {
    console.error(`[cleanup] Failed to delete file for download ${id} (${filepath}): ${err.message}`);
    return false;
  }
  console.log(`[cleanup] Deleted "${title || filepath}" (${reason})`);
  db.prepare("UPDATE downloads SET status = 'deleted', filepath = NULL WHERE id = ?").run(id);
  emitJobUpdate(id);
  return true;
}

async function runCleanup() {
  const config = getCleanupConfig();
  if (!config.ageEnabled && !config.jellyfinEnabled) {
    console.log('[cleanup] Auto-delete is disabled, skipping run');
    return { deleted: 0, checked: 0, kept: 0 };
  }

  const plan = await computeCleanupPlan();
  console.log(`[cleanup] Nightly run starting: ${plan.toDelete.length} to delete, ${plan.toKeep.length} protected, ${plan.checked} evaluated`);

  let deleted = 0;
  for (const item of plan.toDelete) {
    if (deleteDownloadFile(item.id, item.filepath, item.title, item.matchedReasons.join(', '))) {
      deleted++;
    }
  }

  console.log(`[cleanup] Nightly run finished: ${deleted} file(s) deleted`);
  return { deleted, checked: plan.checked, kept: plan.toKeep.length };
}

function start() {
  // Runs once a night; both the age-based and Jellyfin-watched rules are evaluated on every
  // tick, independently of each other, so either or both can delete a given video.
  cron.schedule('0 3 * * *', () => {
    runCleanup().catch((e) => console.error('[cleanup] Run failed:', e.message));
  });
}

module.exports = { init, start, runCleanup, computeCleanupPlan, getCleanupConfig };
