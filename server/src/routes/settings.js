const express = require('express');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../auth');
const { COOKIES_FILE } = require('../services/ytdlp');

const router = express.Router();
router.use(requireAuth);

router.get('/cookies', (req, res) => {
  res.json({ configured: fs.existsSync(COOKIES_FILE) });
});

// Accepts pasted cookies.txt (Netscape format) content, e.g. exported via a
// "Get cookies.txt" browser extension. Stored with owner-only permissions since
// it's effectively a live, unauthenticated login session for whoever holds it.
router.put('/cookies', (req, res) => {
  const { content } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'cookies.txt content is required' });
  }
  fs.writeFileSync(COOKIES_FILE, content, { mode: 0o600 });
  fs.chmodSync(COOKIES_FILE, 0o600);
  res.json({ ok: true });
});

router.delete('/cookies', (req, res) => {
  if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

router.put('/', (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) upsert.run(key, String(value));
  });
  tx(Object.entries(req.body || {}));
  res.json({ ok: true });
});

module.exports = router;
