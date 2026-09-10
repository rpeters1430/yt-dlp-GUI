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
  };
}

// Only watch-triggered downloads are eligible — a video someone deliberately queued by hand
// wasn't "subscribed" to and shouldn't disappear on its own.
function getCleanupCandidates() {
  return db.prepare(`
    SELECT * FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND watch_id IS NOT NULL
  `).all();
}

function emitJobUpdate(id) {
  if (!io) return;
  const job = db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);
  if (job) io.emit('job:update', job);
}

function deleteDownloadFile(download, reason) {
  try {
    if (fs.existsSync(download.filepath)) {
      fs.unlinkSync(download.filepath);
    }
  } catch (err) {
    console.error(`[cleanup] Failed to delete file for download ${download.id} (${download.filepath}): ${err.message}`);
    return false;
  }
  console.log(`[cleanup] Deleted "${download.title || download.filepath}" (${reason})`);
  db.prepare("UPDATE downloads SET status = 'deleted', filepath = NULL WHERE id = ?").run(download.id);
  emitJobUpdate(download.id);
  return true;
}

async function runCleanup() {
  const config = getCleanupConfig();
  if (!config.ageEnabled && !config.jellyfinEnabled) {
    console.log('[cleanup] Auto-delete is disabled, skipping run');
    return { deleted: 0, checked: 0 };
  }

  const candidates = getCleanupCandidates();
  console.log(`[cleanup] Nightly run starting: ${candidates.length} watch-downloaded video(s) to evaluate`);

  let playedBasenames = null;
  if (config.jellyfinEnabled && config.jellyfinUrl && config.jellyfinApiKey) {
    try {
      playedBasenames = await jellyfin.getPlayedBasenames(config.jellyfinUrl, config.jellyfinApiKey, config.jellyfinUserId || null);
      console.log(`[cleanup] Jellyfin reports ${playedBasenames.size} played file(s)`);
    } catch (err) {
      console.error(`[cleanup] Skipping Jellyfin-based deletion this run: ${err.message}`);
    }
  }

  const now = Date.now();
  let deleted = 0;

  for (const download of candidates) {
    let reason = null;

    if (config.ageEnabled) {
      const createdMs = new Date(download.created_at + 'Z').getTime();
      const ageDays = (now - createdMs) / (1000 * 60 * 60 * 24);
      if (ageDays >= config.ageDays) reason = `older than ${config.ageDays}d`;
    }

    if (!reason && playedBasenames) {
      const basename = path.basename(download.filepath);
      if (playedBasenames.has(basename)) reason = 'watched in Jellyfin';
    }

    if (reason && deleteDownloadFile(download, reason)) {
      deleted++;
    }
  }

  console.log(`[cleanup] Nightly run finished: ${deleted} file(s) deleted`);
  return { deleted, checked: candidates.length };
}

function start() {
  // Runs once a night; both the age-based and Jellyfin-watched rules are evaluated on every
  // tick, independently of each other, so either or both can delete a given video.
  cron.schedule('0 3 * * *', () => {
    runCleanup().catch((e) => console.error('[cleanup] Run failed:', e.message));
  });
}

module.exports = { init, start, runCleanup, getCleanupConfig };
