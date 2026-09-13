const path = require('path');
const cron = require('node-cron');
const db = require('../db');
const jellyfin = require('./jellyfin');

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== undefined ? row.value : fallback;
}

function isTruthy(value) {
  return value === '1' || value === 1 || value === true;
}

// Shares its connection settings (URL/API key/user) with the auto-delete "watched in
// Jellyfin" feature — it's the same Jellyfin server either way. Unlike that feature, a
// specific user is required here: a Jellyfin playlist is always owned by one user.
function getSyncConfig() {
  return {
    enabled: isTruthy(getSetting('jellyfin_sync_enabled', '0')),
    url: getSetting('jellyfin_url', ''),
    apiKey: getSetting('jellyfin_api_key', ''),
    userId: getSetting('jellyfin_user_id', ''),
  };
}

function playlistNameForWatch(watch) {
  return watch.name || watch.channel_name || `Watch #${watch.id}`;
}

// Builds/updates a Jellyfin playlist named after the watch, containing every video the watch
// has downloaded that Jellyfin's library has already scanned (matched by filename, same
// approach the cleanup "watched in Jellyfin" check uses, since the download folder and
// Jellyfin's library mount may differ). Safe to call repeatedly — only items missing from the
// playlist are added, and the resolved playlist ID is cached on the watch so a rename inside
// this app doesn't create a second playlist next time.
async function syncWatch(watchId, { config } = {}) {
  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(watchId);
  if (!watch) throw new Error('Watch not found');

  const cfg = config || getSyncConfig();
  if (!cfg.url || !cfg.apiKey || !cfg.userId) {
    throw new Error('Jellyfin URL, API key, and user are all required for playlist sync');
  }

  const playlistName = playlistNameForWatch(watch);
  const downloads = db.prepare(
    "SELECT * FROM downloads WHERE watch_id = ? AND status = 'completed' AND filepath IS NOT NULL"
  ).all(watchId);

  if (downloads.length === 0) {
    return { watchId, playlistName, added: 0, alreadyPresent: 0, missingFromLibrary: 0 };
  }

  const userId = await jellyfin.resolveUserId(cfg.url, cfg.apiKey, cfg.userId);
  const basenameMap = await jellyfin.getLibraryItemsByBasename(cfg.url, cfg.apiKey, userId);

  const itemIds = [];
  let missingFromLibrary = 0;
  for (const d of downloads) {
    const itemId = basenameMap.get(path.basename(d.filepath));
    if (itemId) itemIds.push(itemId);
    else missingFromLibrary++;
  }

  if (itemIds.length === 0) {
    return { watchId, playlistName, added: 0, alreadyPresent: 0, missingFromLibrary };
  }

  let playlistId = watch.jellyfin_playlist_id || null;
  let existingIds = null;

  if (playlistId) {
    existingIds = await jellyfin.getPlaylistItemIds(cfg.url, cfg.apiKey, userId, playlistId);
    if (existingIds === null) playlistId = null; // deleted on the Jellyfin side — recreate below
  }

  if (!playlistId) {
    const found = await jellyfin.findPlaylistByName(cfg.url, cfg.apiKey, userId, playlistName);
    if (found) {
      playlistId = found.Id;
      existingIds = await jellyfin.getPlaylistItemIds(cfg.url, cfg.apiKey, userId, playlistId);
    }
  }

  let added = 0;
  let alreadyPresent = 0;

  if (!playlistId) {
    playlistId = await jellyfin.createPlaylist(cfg.url, cfg.apiKey, userId, playlistName, itemIds);
    added = itemIds.length;
  } else {
    const existing = existingIds || new Set();
    const toAdd = itemIds.filter((id) => !existing.has(id));
    alreadyPresent = itemIds.length - toAdd.length;
    if (toAdd.length > 0) {
      await jellyfin.addPlaylistItems(cfg.url, cfg.apiKey, userId, playlistId, toAdd);
      added = toAdd.length;
    }
  }

  db.prepare('UPDATE watches SET jellyfin_playlist_id = ? WHERE id = ?').run(playlistId, watchId);

  return { watchId, playlistId, playlistName, added, alreadyPresent, missingFromLibrary };
}

async function syncAllWatches() {
  const cfg = getSyncConfig();
  if (!cfg.enabled) return { skipped: true, reason: 'disabled', results: [] };
  if (!cfg.url || !cfg.apiKey || !cfg.userId) return { skipped: true, reason: 'not configured', results: [] };

  const watches = db.prepare(
    "SELECT id FROM watches WHERE id IN (SELECT DISTINCT watch_id FROM downloads WHERE watch_id IS NOT NULL AND status = 'completed')"
  ).all();

  const results = [];
  for (const w of watches) {
    try {
      results.push(await syncWatch(w.id, { config: cfg }));
    } catch (err) {
      console.error(`[jellyfin-sync] Failed to sync watch #${w.id}: ${err.message}`);
      results.push({ watchId: w.id, error: err.message });
    }
  }
  return { skipped: false, results };
}

function start() {
  // A newly downloaded video is also synced right after it finishes (see queue.js), but
  // Jellyfin may not have scanned it into its library yet at that moment — this periodic
  // pass catches those up once the library scan finds them.
  cron.schedule('*/15 * * * *', () => {
    syncAllWatches().catch((e) => console.error('[jellyfin-sync] Run failed:', e.message));
  });
}

module.exports = { getSyncConfig, syncWatch, syncAllWatches, start };
