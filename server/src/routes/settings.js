const express = require('express');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../auth');
const ytdlp = require('../services/ytdlp');
const queue = require('../services/queue');
const outputTemplate = require('../services/outputTemplate');
const solverrProxy = require('../services/solverrProxy');
const { SITE_COOKIES, writeSiteCookies, clearSiteCookies, siteCookiesStatus } = require('../services/ytdlpCookies');
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
  'download_limit_rate',
  'download_sleep_interval',
  'impersonate_target',
  'solverr_proxy_mode',
  'solverr_proxy_url',
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

// Reddit and Twitter/X cookies live in their own files (see SITE_COOKIES) so uploading one
// never replaces the shared cookies.txt above.
function siteParam(req, res) {
  const { site } = req.params;
  if (!Object.prototype.hasOwnProperty.call(SITE_COOKIES, site)) {
    res.status(404).json({ error: `Unknown cookie site: ${site}` });
    return null;
  }
  return site;
}

router.get('/cookies/sites', (req, res) => {
  res.json(Object.fromEntries(Object.entries(SITE_COOKIES).map(([site, spec]) => [
    site, { label: spec.label, domains: spec.domains, ...siteCookiesStatus(site) },
  ])));
});

router.put('/cookies/sites/:site', (req, res) => {
  const site = siteParam(req, res);
  if (!site) return;
  const { content } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'cookies.txt content is required' });
  }
  try {
    res.json({ ok: true, ...writeSiteCookies(site, content) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/cookies/sites/:site', (req, res) => {
  const site = siteParam(req, res);
  if (!site) return;
  clearSiteCookies(site);
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

router.post('/quickjs/update', async (req, res) => {
  if (queue.getActiveCount && queue.getActiveCount() > 0) {
    return res.status(409).json({ error: 'Cannot update QuickJS while downloads are active. Please wait for them to complete.' });
  }
  try {
    const versions = await ytdlp.updateQuickjs();
    res.json({ ok: true, ...versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Installs Deno if it's missing, otherwise replaces it with the latest release.
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
  settings.download_limit_rate = settings.download_limit_rate || '';
  settings.download_sleep_interval = parseInt(settings.download_sleep_interval || '0', 10) || 0;
  settings.impersonate_target = settings.impersonate_target || '';
  settings.solverr_proxy_mode = solverrProxy.MODES.has(settings.solverr_proxy_mode) ? settings.solverr_proxy_mode : 'auto';
  // The password never leaves the server; PUT accepts the mask back and keeps the stored one.
  settings.solverr_proxy_url = solverrProxy.maskProxyUrl(settings.solverr_proxy_url || '');
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
  const impersonate = entries.find(([key]) => key === 'impersonate_target');
  if (impersonate) {
    const val = String(impersonate[1] || '').trim().toLowerCase();
    const allowed = new Set(['', 'chrome', 'safari', 'firefox', 'edge', 'tor']);
    if (!allowed.has(val)) {
      return res.status(400).json({ error: 'impersonate_target must be chrome, safari, firefox, edge, tor, or empty' });
    }
    impersonate[1] = val;
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

  const limitRate = entries.find(([key]) => key === 'download_limit_rate');
  if (limitRate) {
    limitRate[1] = String(limitRate[1] || '').trim();
    if (limitRate[1] && !/^\d+(?:\.\d+)?[KMGkmg]?$/.test(limitRate[1])) {
      return res.status(400).json({ error: 'download_limit_rate must be a valid rate like 5M, 10M, or 500K' });
    }
  }

  const sleepInterval = entries.find(([key]) => key === 'download_sleep_interval');
  if (sleepInterval) {
    const s = Number(sleepInterval[1]);
    if (!Number.isInteger(s) || s < 0 || s > 60) {
      return res.status(400).json({ error: 'download_sleep_interval must be a whole number from 0 to 60 seconds' });
    }
  }

  const proxyMode = entries.find(([key]) => key === 'solverr_proxy_mode');
  if (proxyMode && !solverrProxy.MODES.has(proxyMode[1])) {
    return res.status(400).json({ error: 'solverr_proxy_mode must be auto or off' });
  }

  // Blank means "use the SOLVERR_PROXY_URL env var" (or no proxy if that's unset too).
  const proxyUrl = entries.find(([key]) => key === 'solverr_proxy_url');
  if (proxyUrl) {
    proxyUrl[1] = proxyUrl[1] == null ? '' : String(proxyUrl[1]).trim();
    if (proxyUrl[1]) {
      const stored = db.prepare("SELECT value FROM settings WHERE key = 'solverr_proxy_url'").get();
      proxyUrl[1] = solverrProxy.unmaskProxyUrl(proxyUrl[1], stored && stored.value);
      const proxyError = solverrProxy.validateProxyUrl(proxyUrl[1]);
      if (proxyError) return res.status(400).json({ error: proxyError });
    }
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
  if (proxyMode || proxyUrl) solverrProxy.check();
  res.json({ ok: true });
});

router.get('/solverr-proxy', (req, res) => {
  res.json(solverrProxy.getStatus());
});

// Re-probes the proxy now instead of waiting for the next periodic check.
router.post('/solverr-proxy/check', async (req, res) => {
  res.json(await solverrProxy.check());
});

module.exports = router;
