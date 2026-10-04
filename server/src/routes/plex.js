const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const plex = require('../services/plex');
const plexSync = require('../services/plexSync');

const router = express.Router();
router.use(requireAuth);

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

// Never returns the raw token — only whether one is saved — same as the Jellyfin API key.
function publicSettings() {
  const cfg = plexSync.getPlexConfig();
  return {
    url: cfg.url,
    sectionIds: cfg.sectionIds,
    syncEnabled: cfg.syncEnabled,
    autoScanEnabled: cfg.autoScanEnabled,
    cleanupEnabled: cfg.cleanupEnabled,
    tokenConfigured: !!cfg.token,
  };
}

router.get('/settings', (req, res) => {
  res.json(publicSettings());
});

router.put('/settings', (req, res) => {
  const { url, token, sectionIds, syncEnabled, autoScanEnabled, cleanupEnabled } = req.body || {};

  for (const [name, value] of Object.entries({ url, token, sectionIds })) {
    if (value !== undefined && typeof value !== 'string') {
      return res.status(400).json({ error: `${name} must be a string` });
    }
  }
  if (url !== undefined) setSetting('plex_url', url.trim());
  if (token !== undefined) setSetting('plex_token', token.trim());
  if (sectionIds !== undefined) setSetting('plex_section_ids', sectionIds.trim());
  if (syncEnabled !== undefined) setSetting('plex_sync_enabled', syncEnabled ? '1' : '0');
  if (autoScanEnabled !== undefined) setSetting('plex_auto_scan_enabled', autoScanEnabled ? '1' : '0');
  if (cleanupEnabled !== undefined) setSetting('cleanup_plex_enabled', cleanupEnabled ? '1' : '0');

  res.json(publicSettings());
});

// Accepts unsaved url/token from the form so the connection can be checked before saving.
router.post('/test', async (req, res) => {
  const cfg = plexSync.getPlexConfig();
  const url = (req.body && req.body.url) || cfg.url;
  const token = (req.body && req.body.token) || cfg.token;
  try {
    const info = await plex.testConnection(url, token);
    const sections = await plex.getSections(url, token);
    res.json({ success: true, ...info, sections });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  const cfg = plexSync.getPlexConfig();
  if (!plexSync.isConfigured(cfg)) {
    return res.status(400).json({ error: 'Plex URL and token are required' });
  }
  try {
    let count = await plex.refreshSections(cfg.url, cfg.token, { sectionIds: cfg.sectionIds });
    if (!cfg.sectionIds) count += await plex.refreshSections(cfg.url, cfg.token, { includeAudio: true });
    res.json({ success: true, message: `Plex refresh started for ${count} librar${count === 1 ? 'y' : 'ies'}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual "sync now" runs even when auto-sync is off, as long as Plex is configured.
router.post('/sync', async (req, res) => {
  try {
    res.json(await plexSync.syncAllWatches({ force: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
