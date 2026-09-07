const express = require('express');
const queue = require('../services/queue');
const ytdlp = require('../services/ytdlp');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Fetch metadata/formats for a URL before download, so the UI can show a picker.
router.post('/info', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const info = await ytdlp.getInfo(url);
    const formats = (info.formats || []).map((f) => ({
      format_id: f.format_id,
      ext: f.ext,
      resolution: f.resolution || (f.height ? `${f.height}p` : null),
      note: f.format_note,
      filesize: f.filesize || f.filesize_approx || null,
      vcodec: f.vcodec,
      acodec: f.acodec,
    }));
    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      extractor: info.extractor,
      duration: info.duration,
      formats,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Accepts either a single URL or newline-separated multiple URLs.
router.post('/', (req, res) => {
  const { urls, url, formatSelector, audioOnly, subtitles } = req.body || {};
  const list = urls ? urls : url ? [url] : [];
  const cleaned = list.map((u) => String(u).trim()).filter(Boolean);

  if (cleaned.length === 0) return res.status(400).json({ error: 'At least one URL is required' });

  const ids = cleaned.map((u) => queue.enqueue(u, { formatSelector, audioOnly, subtitles }));
  res.json({ ids });
});

router.get('/', (req, res) => {
  res.json(queue.listJobs());
});

router.delete('/:id', (req, res) => {
  queue.removeJob(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
