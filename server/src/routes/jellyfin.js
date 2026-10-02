const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const jellyfin = require('../services/jellyfin');
const jellyfinSync = require('../services/jellyfinSync');
const jellyfinMusic = require('../services/jellyfinMusic');

const router = express.Router();
router.use(requireAuth);

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

// Shares jellyfin_url/jellyfin_api_key/jellyfin_user_id with /api/cleanup — same Jellyfin
// server either way — so this never returns the raw API key either, same as that route.
router.get('/settings', (req, res) => {
  const cfg = jellyfinSync.getSyncConfig();
  res.json({
    syncEnabled: cfg.enabled,
    autoScanEnabled: cfg.autoScanEnabled,
    url: cfg.url,
    userId: cfg.userId,
    apiKeyConfigured: !!cfg.apiKey,
  });
});

router.put('/settings', (req, res) => {
  const { syncEnabled, autoScanEnabled, url, userId, apiKey } = req.body || {};

  if (syncEnabled !== undefined) setSetting('jellyfin_sync_enabled', syncEnabled ? '1' : '0');
  if (autoScanEnabled !== undefined) setSetting('jellyfin_auto_scan_enabled', autoScanEnabled ? '1' : '0');
  if (url !== undefined) {
    if (typeof url !== 'string') return res.status(400).json({ error: 'url must be a string' });
    setSetting('jellyfin_url', url.trim());
  }
  if (userId !== undefined) {
    if (typeof userId !== 'string') return res.status(400).json({ error: 'userId must be a string' });
    setSetting('jellyfin_user_id', userId.trim());
  }
  if (apiKey !== undefined) {
    if (typeof apiKey !== 'string') return res.status(400).json({ error: 'apiKey must be a string' });
    setSetting('jellyfin_api_key', apiKey.trim());
  }

  const cfg = jellyfinSync.getSyncConfig();
  res.json({
    syncEnabled: cfg.enabled,
    autoScanEnabled: cfg.autoScanEnabled,
    url: cfg.url,
    userId: cfg.userId,
    apiKeyConfigured: !!cfg.apiKey,
  });
});

router.get('/status', (req, res) => {
  const cfg = jellyfinSync.getSyncConfig();
  res.json({
    configured: !!(cfg.url && cfg.apiKey),
    url: cfg.url,
    userId: cfg.userId,
    autoScanEnabled: cfg.autoScanEnabled,
    syncEnabled: cfg.enabled,
  });
});

// Triggers an immediate Jellyfin library refresh scan
router.post('/refresh', async (req, res) => {
  const cfg = jellyfinSync.getSyncConfig();
  if (!cfg.url || !cfg.apiKey) {
    return res.status(400).json({ error: 'Jellyfin URL and API key are required' });
  }
  try {
    await jellyfin.refreshLibrary(cfg.url, cfg.apiKey);
    jellyfinMusic.invalidate();
    res.json({ success: true, message: 'Jellyfin library refresh scan initiated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checks if a given music artist/album already exists in Jellyfin, and which of its songs.
// Pass `tracks` (JSON array of titles) to get a per-title answer for an album's tracklist.
router.get('/music-check', async (req, res) => {
  const { artist, album } = req.query || {};
  const cfg = jellyfinSync.getSyncConfig();
  if (!cfg.url || !cfg.apiKey) {
    return res.json({ configured: false, inLibrary: false, tracks: [] });
  }
  try {
    const index = await jellyfinMusic.getIndex(cfg);
    const match = jellyfinMusic.matchAlbum(index, { artist, album });
    res.json({
      configured: true,
      inLibrary: !!match.album || match.tracks.length > 0,
      albumId: match.album ? match.album.id : null,
      albumName: match.album ? match.album.name : (match.tracks[0] ? match.tracks[0].album : null),
      trackCount: match.tracks.length,
      tracks: match.tracks.map((t) => ({ id: t.id, name: t.name, trackNumber: t.trackNumber, discNumber: t.discNumber })),
    });
  } catch (err) {
    res.json({ configured: true, inLibrary: false, error: err.message, tracks: [] });
  }
});

// Batch lookup for search results: which releases and songs are already in Jellyfin.
//   body: { albums: [{ id, artist, name, trackCount }], tracks: [{ key, artist, title }] }
//   returns: { configured, albums: { [id]: { status, ownedTracks, totalTracks } }, tracks: { [key]: bool } }
router.post('/music-library', async (req, res) => {
  const { albums = [], tracks = [] } = req.body || {};
  if (!Array.isArray(albums) || !Array.isArray(tracks)) {
    return res.status(400).json({ error: 'albums and tracks must be arrays' });
  }
  const cfg = jellyfinSync.getSyncConfig();
  if (!cfg.url || !cfg.apiKey) {
    return res.json({ configured: false, albums: {}, tracks: {} });
  }
  try {
    const index = await jellyfinMusic.getIndex(cfg);
    const albumResults = {};
    for (const a of albums.slice(0, 500)) {
      if (!a || a.id === undefined || a.id === null) continue;
      albumResults[a.id] = jellyfinMusic.albumStatus(index, a);
    }
    const trackResults = {};
    for (const t of tracks.slice(0, 500)) {
      if (!t || t.key === undefined || t.key === null) continue;
      trackResults[t.key] = !!jellyfinMusic.matchTrack(index, t);
    }
    res.json({ configured: true, albums: albumResults, tracks: trackResults });
  } catch (err) {
    res.json({ configured: true, error: err.message, albums: {}, tracks: {} });
  }
});

// Manually syncs every watch's playlist immediately, instead of waiting for the periodic
// job. Still requires syncEnabled + a full connection — same guard as the periodic run.
router.post('/sync', async (req, res) => {
  try {
    const result = await jellyfinSync.syncAllWatches();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
