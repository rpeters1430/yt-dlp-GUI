const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const notify = require('../services/notify');

const router = express.Router();
router.use(requireAuth);

function toResponse() {
  const config = notify.getConfig();
  return {
    ...config,
    formats: notify.FORMATS,
    eventLabels: Object.fromEntries(Object.entries(notify.EVENTS).map(([name, def]) => [name, def.label])),
  };
}

router.get('/settings', (req, res) => {
  res.json(toResponse());
});

router.put('/settings', (req, res) => {
  const { enabled, url, format, watchOnly, events } = req.body || {};
  const updates = [];

  if (url !== undefined) {
    const trimmed = String(url || '').trim();
    if (trimmed) {
      const urlError = notify.validateUrl(trimmed);
      if (urlError) return res.status(400).json({ error: urlError });
    }
    updates.push(['notify_url', trimmed]);
  }
  if (format !== undefined) {
    if (!notify.FORMATS.includes(format)) return res.status(400).json({ error: `format must be one of: ${notify.FORMATS.join(', ')}` });
    updates.push(['notify_format', format]);
  }
  if (enabled !== undefined) updates.push(['notify_enabled', enabled ? '1' : '0']);
  if (watchOnly !== undefined) updates.push(['notify_watch_only', watchOnly ? '1' : '0']);
  if (events && typeof events === 'object') {
    for (const [name, on] of Object.entries(events)) {
      const def = notify.EVENTS[name];
      if (!def) return res.status(400).json({ error: `Unknown event: ${name}` });
      updates.push([def.setting, on ? '1' : '0']);
    }
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  db.transaction((rows) => {
    for (const [key, value] of rows) upsert.run(key, value);
  })(updates);

  res.json(toResponse());
});

// Sends a test message with the saved settings, or with the unsaved url/format from the
// form when given, so the user can check a webhook before saving it.
router.post('/test', async (req, res) => {
  const { url, format } = req.body || {};
  const overrides = {};
  if (url) overrides.url = String(url).trim();
  if (format) overrides.format = format;
  try {
    await notify.sendTest(overrides);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
