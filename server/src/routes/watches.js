const express = require('express');
const db = require('../db');
const scheduler = require('../services/scheduler');
const ytdlp = require('../services/ytdlp');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// yt-dlp's -f selector syntax (heights, codecs, +, /, [filters], etc.) — a stored watch
// replays this on every scheduled check, so it's worth constraining to the syntax's
// actual character set rather than accepting arbitrary strings indefinitely.
const FORMAT_SELECTOR_RE = /^[\w+\-/*.,:()!<>=\s]{0,200}$/;

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM watches ORDER BY created_at DESC').all());
});

router.post('/', (req, res) => {
  const { url, name, formatSelector, audioOnly } = req.body || {};
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid http(s) url is required' });
  }
  try {
    ytdlp.assertPublicUrl(url);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (formatSelector && (typeof formatSelector !== 'string' || !FORMAT_SELECTOR_RE.test(formatSelector))) {
    return res.status(400).json({ error: 'Invalid format selector' });
  }

  const result = db.prepare(`
    INSERT INTO watches (url, name, format_selector, audio_only) VALUES (?, ?, ?, ?)
  `).run(url, name || null, formatSelector || null, audioOnly ? 1 : 0);

  const watch = db.prepare('SELECT * FROM watches WHERE id = ?').get(result.lastInsertRowid);

  // Run an initial check immediately to seed known video IDs (won't auto-download on first pass).
  scheduler.checkWatch(watch).catch((e) => console.error('Initial watch check failed:', e.message));

  res.json(watch);
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM watches WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Watch not found' });
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
