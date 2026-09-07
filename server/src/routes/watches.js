const express = require('express');
const db = require('../db');
const scheduler = require('../services/scheduler');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM watches ORDER BY created_at DESC').all());
});

router.post('/', (req, res) => {
  const { url, name, formatSelector, audioOnly } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  const result = db.prepare(`
    INSERT INTO watches (url, name, format_selector, audio_only) VALUES (?, ?, ?, ?)
  `).run(url, name || null, formatSelector || null, audioOnly ? 1 : 0);

  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(result.lastInsertRowid);

  // Run an initial check immediately to seed known video IDs (won't auto-download on first pass).
  scheduler.checkWatch(watch).catch((e) => console.error('Initial watch check failed:', e.message));

  res.json(watch);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM watches WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM watch_seen_ids WHERE watch_id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/check', async (req, res) => {
  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
  if (!watch) return res.status(404).json({ error: 'Watch not found' });
  const newCount = await scheduler.checkWatch(watch);
  res.json({ newCount });
});

module.exports = router;
