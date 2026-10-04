const path = require('path');
const cron = require('node-cron');
const db = require('../db');
const plex = require('./plex');

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== undefined ? row.value : fallback;
}

function isTruthy(value) {
  return value === '1' || value === 1 || value === true;
}

// Plex's equivalent of the Jellyfin settings. The token belongs to one Plex account, so
// playlists are created for, and "watched" is judged by, that account only.
function getPlexConfig() {
  return {
    url: getSetting('plex_url', ''),
    token: getSetting('plex_token', ''),
    sectionIds: getSetting('plex_section_ids', ''),
    syncEnabled: isTruthy(getSetting('plex_sync_enabled', '0')),
    autoScanEnabled: isTruthy(getSetting('plex_auto_scan_enabled', '1')),
    cleanupEnabled: isTruthy(getSetting('cleanup_plex_enabled', '0')),
  };
}

function isConfigured(cfg) {
  return !!(cfg.url && cfg.token);
}

function playlistNameForWatch(watch) {
  return watch.name || watch.channel_name || `Watch #${watch.id}`;
}

// Mirrors jellyfinSync.syncWatch: builds/updates a Plex playlist named after the watch with
// every downloaded file Plex has already scanned (matched by filename). Safe to call
// repeatedly — only missing items are added, and the playlist ID is cached on the watch so a
// rename inside this app doesn't create a second playlist.
async function syncWatch(watchId, { config } = {}) {
  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(watchId);
  if (!watch) throw new Error('Watch not found');

  const cfg = config || getPlexConfig();
  if (!isConfigured(cfg)) throw new Error('Plex URL and token are required for playlist sync');

  const playlistName = playlistNameForWatch(watch);
  const downloads = db.prepare(
    "SELECT * FROM downloads WHERE watch_id = ? AND status = 'completed' AND filepath IS NOT NULL"
  ).all(watchId);

  if (downloads.length === 0) {
    return { watchId, playlistName, added: 0, alreadyPresent: 0, missingFromLibrary: 0 };
  }

  const isMusic = !!watch.is_music;
  const { byBasename } = await plex.getLibraryIndex(cfg.url, cfg.token, { sectionIds: cfg.sectionIds, includeAudio: isMusic });
  const itemKeys = [];
  let missingFromLibrary = 0;
  for (const d of downloads) {
    const key = byBasename.get(path.basename(d.filepath));
    if (key) itemKeys.push(key);
    else missingFromLibrary++;
  }

  if (itemKeys.length === 0) {
    return { watchId, playlistName, added: 0, alreadyPresent: 0, missingFromLibrary };
  }

  const { machineIdentifier } = await plex.getIdentity(cfg.url, cfg.token);

  let playlistId = watch.plex_playlist_id || null;
  let existing = null;
  if (playlistId) {
    existing = await plex.getPlaylistItemKeys(cfg.url, cfg.token, playlistId);
    if (existing === null) playlistId = null; // deleted on the Plex side — recreate below
  }
  if (!playlistId) {
    playlistId = await plex.findPlaylistByName(cfg.url, cfg.token, playlistName, { isMusic });
    if (playlistId) existing = await plex.getPlaylistItemKeys(cfg.url, cfg.token, playlistId);
  }

  let added = 0;
  let alreadyPresent = 0;
  if (!playlistId) {
    playlistId = await plex.createPlaylist(cfg.url, cfg.token, machineIdentifier, playlistName, itemKeys, { isMusic });
    added = itemKeys.length;
  } else {
    const have = existing || new Set();
    const toAdd = itemKeys.filter((k) => !have.has(k));
    alreadyPresent = itemKeys.length - toAdd.length;
    if (toAdd.length > 0) {
      await plex.addPlaylistItems(cfg.url, cfg.token, machineIdentifier, playlistId, toAdd);
      added = toAdd.length;
    }
  }

  db.prepare('UPDATE watches SET plex_playlist_id = ? WHERE id = ?').run(playlistId, watchId);

  return { watchId, playlistId, playlistName, added, alreadyPresent, missingFromLibrary };
}

async function syncAllWatches({ force = false } = {}) {
  const cfg = getPlexConfig();
  if (!force && !cfg.syncEnabled) return { skipped: true, reason: 'disabled', results: [] };
  if (!isConfigured(cfg)) return { skipped: true, reason: 'not configured', results: [] };

  const watches = db.prepare(
    "SELECT id FROM watches WHERE id IN (SELECT DISTINCT watch_id FROM downloads WHERE watch_id IS NOT NULL AND status = 'completed')"
  ).all();

  const results = [];
  for (const w of watches) {
    try {
      results.push(await syncWatch(w.id, { config: cfg }));
    } catch (err) {
      console.error(`[plex-sync] Failed to sync watch #${w.id}: ${err.message}`);
      results.push({ watchId: w.id, error: err.message });
    }
  }
  return { skipped: false, results };
}

let scanTimeout = null;

// Debounced like the Jellyfin scan, so a batch of downloads finishing together causes one
// refresh. Refreshes whole libraries rather than a single folder, since the path this app
// writes to is usually not the path Plex sees inside its own container.
function scheduleLibraryScan(delayMs = 6000) {
  const cfg = getPlexConfig();
  if (!cfg.autoScanEnabled || !isConfigured(cfg)) return;

  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(async () => {
    scanTimeout = null;
    try {
      // Music and video libraries both get a refresh; a download may be either.
      const opts = { sectionIds: cfg.sectionIds };
      let count = await plex.refreshSections(cfg.url, cfg.token, opts);
      if (!cfg.sectionIds) count += await plex.refreshSections(cfg.url, cfg.token, { includeAudio: true });
      console.log(`[plex] Triggered refresh of ${count} Plex librar${count === 1 ? 'y' : 'ies'}`);
    } catch (err) {
      console.error(`[plex] Automated library refresh failed: ${err.message}`);
    }
  }, delayMs);
}

function start() {
  // Same catch-up pass as Jellyfin: a file synced right after download may not be scanned yet.
  cron.schedule('*/15 * * * *', () => {
    syncAllWatches().catch((e) => console.error('[plex-sync] Run failed:', e.message));
  });
}

module.exports = { getPlexConfig, isConfigured, syncWatch, syncAllWatches, scheduleLibraryScan, start };
