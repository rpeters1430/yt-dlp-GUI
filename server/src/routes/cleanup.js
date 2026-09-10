const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const jellyfin = require('../services/jellyfin');
const cleanup = require('../services/cleanup');

const router = express.Router();
router.use(requireAuth);

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

// Never returns the raw API key — only whether one is saved — same pattern as the Twitch
// auth-token setting.
router.get('/settings', (req, res) => {
  const config = cleanup.getCleanupConfig();
  res.json({
    ageEnabled: config.ageEnabled,
    ageDays: config.ageDays,
    jellyfinEnabled: config.jellyfinEnabled,
    jellyfinUrl: config.jellyfinUrl,
    jellyfinUserId: config.jellyfinUserId,
    jellyfinApiKeyConfigured: !!config.jellyfinApiKey,
    keepRecentPerWatch: config.keepRecentPerWatch,
  });
});

// jellyfinApiKey is only written when present in the body at all, so leaving it blank on
// subsequent saves doesn't wipe out a previously configured key.
router.put('/settings', (req, res) => {
  const { ageEnabled, ageDays, jellyfinEnabled, jellyfinUrl, jellyfinUserId, jellyfinApiKey, keepRecentPerWatch } = req.body || {};

  if (ageEnabled !== undefined) setSetting('cleanup_age_enabled', ageEnabled ? '1' : '0');
  if (ageDays !== undefined) {
    const days = parseInt(ageDays, 10);
    if (!Number.isFinite(days) || days < 1) {
      return res.status(400).json({ error: 'ageDays must be a positive number' });
    }
    setSetting('cleanup_age_days', days);
  }
  if (jellyfinEnabled !== undefined) setSetting('cleanup_jellyfin_enabled', jellyfinEnabled ? '1' : '0');
  if (jellyfinUrl !== undefined) {
    if (typeof jellyfinUrl !== 'string') return res.status(400).json({ error: 'jellyfinUrl must be a string' });
    setSetting('jellyfin_url', jellyfinUrl.trim());
  }
  if (jellyfinUserId !== undefined) {
    if (typeof jellyfinUserId !== 'string') return res.status(400).json({ error: 'jellyfinUserId must be a string' });
    setSetting('jellyfin_user_id', jellyfinUserId.trim());
  }
  if (jellyfinApiKey !== undefined) {
    if (typeof jellyfinApiKey !== 'string') return res.status(400).json({ error: 'jellyfinApiKey must be a string' });
    setSetting('jellyfin_api_key', jellyfinApiKey.trim());
  }
  if (keepRecentPerWatch !== undefined) {
    const keep = parseInt(keepRecentPerWatch, 10);
    if (!Number.isFinite(keep) || keep < 0) {
      return res.status(400).json({ error: 'keepRecentPerWatch must be zero or a positive number' });
    }
    setSetting('cleanup_keep_recent', keep);
  }

  const config = cleanup.getCleanupConfig();
  res.json({
    ageEnabled: config.ageEnabled,
    ageDays: config.ageDays,
    jellyfinEnabled: config.jellyfinEnabled,
    jellyfinUrl: config.jellyfinUrl,
    jellyfinUserId: config.jellyfinUserId,
    jellyfinApiKeyConfigured: !!config.jellyfinApiKey,
    keepRecentPerWatch: config.keepRecentPerWatch,
  });
});

// Tests against the saved settings unless url/apiKey are passed in explicitly, so the
// Settings page can test before saving.
router.post('/test-jellyfin', async (req, res) => {
  const config = cleanup.getCleanupConfig();
  const url = (req.body && req.body.url) || config.jellyfinUrl;
  const apiKey = (req.body && req.body.apiKey) || config.jellyfinApiKey;
  try {
    const result = await jellyfin.testConnection(url, apiKey);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Dry-run: shows exactly what the nightly job would delete and what it would protect,
// without touching any file. Always safe to call.
router.post('/preview', async (req, res) => {
  try {
    const plan = await cleanup.computeCleanupPlan();
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually triggers a cleanup pass immediately, instead of waiting for the nightly cron.
router.post('/run', async (req, res) => {
  try {
    const result = await cleanup.runCleanup();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
