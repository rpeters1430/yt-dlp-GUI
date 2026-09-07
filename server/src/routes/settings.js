const express = require('express');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../auth');
const ytdlp = require('../services/ytdlp');
const queue = require('../services/queue');
const { COOKIES_FILE } = ytdlp;

const router = express.Router();
router.use(requireAuth);

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
  try {
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

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// The only setting this route is actually meant to expose (see client Settings.jsx) — an
// allow-list keeps it from becoming an arbitrary authenticated-write-to-any-key endpoint,
// since the settings table also stores the Twitch client id and the session-signing secret
// under keys of its own.
const ALLOWED_SETTINGS_KEYS = new Set(['ytdlpChannel']);

router.put('/', (req, res) => {
  const entries = Object.entries(req.body || {});
  const unknown = entries.filter(([key]) => !ALLOWED_SETTINGS_KEYS.has(key)).map(([key]) => key);
  if (unknown.length > 0) {
    return res.status(400).json({ error: `Unknown setting(s): ${unknown.join(', ')}` });
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const tx = db.transaction((rows) => {
    for (const [key, value] of rows) upsert.run(key, String(value));
  });
  tx(entries);
  res.json({ ok: true });
});

module.exports = router;
