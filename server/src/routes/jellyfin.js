const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const jellyfin = require('../services/jellyfin');
const jellyfinSync = require('../services/jellyfinSync');

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
    res.json({ success: true, message: 'Jellyfin library refresh scan initiated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checks if a given music artist/album already exists in Jellyfin
router.get('/music-check', async (req, res) => {
  const { artist, album } = req.query || {};
  const cfg = jellyfinSync.getSyncConfig();
  if (!cfg.url || !cfg.apiKey) {
    return res.json({ configured: false, inLibrary: false, tracks: [] });
  }
  try {
    const result = await jellyfin.checkMusicAlbum(cfg.url, cfg.apiKey, cfg.userId, { artist, album });
    res.json({ configured: true, ...result });
  } catch (err) {
    res.json({ configured: true, inLibrary: false, error: err.message, tracks: [] });
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
