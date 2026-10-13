const express = require('express');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../auth');
const ytdlp = require('../services/ytdlp');
const queue = require('../services/queue');
const outputTemplate = require('../services/outputTemplate');
const { COOKIES_FILE } = ytdlp;

const router = express.Router();
router.use(requireAuth);

const ALLOWED_SETTINGS_KEYS = new Set([
  'ytdlpChannel',
  'nfo_enabled',
  'music_folder',
  'music_format',
  'music_quality',
  'music_save_cover',
  'output_template',
  'video_folder',
  'default_live_chunk_mins',
  'max_concurrent_downloads',
]);

function saveSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

router.get('/cookies', (req, res) => {
  res.json({ configured: fs.existsSync(COOKIES_FILE) });
});

// Accepts pasted cookies.txt (Netscape format) content, e.g. exported via a
// "Get cookies.txt" browser extension — for YouTube or any other site, including Twitch.
// Stored with owner-only permissions since it's effectively a live, unauthenticated login
// session for whoever holds it.
router.put('/cookies', (req, res) => {
  const { content } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'cookies.txt content is required' });
  }
  // Uses the preserving variant so this doesn't silently wipe a Twitch auth-token cookie
  // set separately via the Twitch Settings tab (which merges into this same file).
  ytdlp.writeCookiesFilePreservingTwitchAuth(content);
  res.json({ ok: true });
});

// Clears the whole cookies.txt, including any merged-in Twitch auth-token cookie — this is
// an explicit "remove everything" action, unlike the PUT above.
router.delete('/cookies', (req, res) => {
  if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
  res.json({ ok: true });
});

router.get('/ytdlp/version', async (req, res) => {
  try {
    res.json(await ytdlp.getVersions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upgrades yt-dlp via pip. `channel` picks stable (latest release) or nightly (pre-release
// master builds); see ytdlp.updateYtdlp for how that maps to the pip invocation.
router.post('/ytdlp/update', async (req, res) => {
  const channel = req.body && req.body.channel === 'nightly' ? 'nightly' : 'stable';
  if (queue.getActiveCount && queue.getActiveCount() > 0) {
    return res.status(409).json({ error: 'Cannot update yt-dlp while downloads are active. Please wait for them to complete.' });
  }
  try {
    // The update action is authoritative too. This closes the race where the user changes
    // the select and immediately clicks Update before the separate settings PUT completes.
    saveSetting('ytdlpChannel', channel);
    await ytdlp.updateYtdlp(channel);
    res.json({ ok: true, ...(await ytdlp.getVersions()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ffmpeg/update', async (req, res) => {
  if (queue.getActiveCount && queue.getActiveCount() > 0) {
    return res.status(409).json({ error: 'Cannot update FFmpeg while downloads are active. Please wait for them to complete.' });
  }
  try {
    const versions = await ytdlp.updateFfmpeg();
    res.json({ ok: true, ...versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/deno/update', async (req, res) => {
  if (queue.getActiveCount && queue.getActiveCount() > 0) {
    return res.status(409).json({ error: 'Cannot update Deno while downloads are active. Please wait for them to complete.' });
  }
  try {
    const versions = await ytdlp.updateDeno();
    res.json({ ok: true, ...versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The effective global filename template plus the built-in presets the Settings page offers.
router.get('/output-template', (req, res) => {
  res.json({
    template: outputTemplate.getGlobalTemplate(),
    defaultTemplate: outputTemplate.DEFAULT_TEMPLATE,
    presets: outputTemplate.PRESETS,
    // The folder saved in Settings (blank = use the default) and where videos actually go.
    videoFolder: outputTemplate.getVideoFolderSetting(),
    videoDir: outputTemplate.getVideoDir(),
    defaultVideoDir: ytdlp.VIDEO_DIR,
  });
});

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${[...ALLOWED_SETTINGS_KEYS].map(() => '?').join(', ')})`)
    .all(...ALLOWED_SETTINGS_KEYS);
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  settings.ytdlpChannel = settings.ytdlpChannel === 'nightly' ? 'nightly' : 'stable';
  settings.default_live_chunk_mins = parseInt(settings.default_live_chunk_mins || '0', 10);
  // The effective value, which falls back to the MAX_CONCURRENT_DOWNLOADS env var.
  settings.max_concurrent_downloads = queue.getMaxConcurrent();
  res.json(settings);
});

router.put('/', (req, res) => {
  const entries = Object.entries(req.body || {});
  const unknown = entries.filter(([key]) => !ALLOWED_SETTINGS_KEYS.has(key)).map(([key]) => key);
  if (unknown.length > 0) {
    return res.status(400).json({ error: `Unknown setting(s): ${unknown.join(', ')}` });
  }
  const invalidChannel = entries.some(([key, value]) => key === 'ytdlpChannel' && value !== 'stable' && value !== 'nightly');
  if (invalidChannel) {
    return res.status(400).json({ error: 'ytdlpChannel must be stable or nightly' });
  }
  // A blank template is stored as-is and means "use the built-in default".
  const template = entries.find(([key]) => key === 'output_template');
  if (template && String(template[1] || '').trim()) {
    const templateError = outputTemplate.validateTemplate(String(template[1]));
    if (templateError) return res.status(400).json({ error: templateError });
  }

  const videoFolder = entries.find(([key]) => key === 'video_folder');
  if (videoFolder) {
    // Blank (or null) is stored as '' and means "use the default video folder".
    videoFolder[1] = videoFolder[1] == null ? '' : String(videoFolder[1]).trim();
    const folderError = outputTemplate.validateVideoFolder(videoFolder[1]);
    if (folderError) return res.status(400).json({ error: folderError });
  }

  const concurrency = entries.find(([key]) => key === 'max_concurrent_downloads');
  if (concurrency) {
    const n = Number(concurrency[1]);
    if (!Number.isInteger(n) || n < 1 || n > queue.MAX_CONCURRENT_LIMIT) {
      return res.status(400).json({ error: `max_concurrent_downloads must be a whole number from 1 to ${queue.MAX_CONCURRENT_LIMIT}` });
    }
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const tx = db.transaction((rows) => {
    for (const [key, value] of rows) upsert.run(key, String(value));
  });
  tx(entries);
  // A higher limit can start queued downloads right away.
  if (concurrency) queue.processNext();
  res.json({ ok: true });
});

module.exports = router;
