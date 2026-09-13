const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
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
    url: cfg.url,
    userId: cfg.userId,
    apiKeyConfigured: !!cfg.apiKey,
  });
});

router.put('/settings', (req, res) => {
  const { syncEnabled, url, userId, apiKey } = req.body || {};

  if (syncEnabled !== undefined) setSetting('jellyfin_sync_enabled', syncEnabled ? '1' : '0');
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
    url: cfg.url,
    userId: cfg.userId,
    apiKeyConfigured: !!cfg.apiKey,
  });
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
