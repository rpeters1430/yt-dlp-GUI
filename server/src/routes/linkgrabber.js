const express = require('express');
const db = require('../db');
const queue = require('../services/queue');
const ytdlp = require('../services/ytdlp');
const linkGrabber = require('../services/linkGrabber');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const MAX_SEND = 500;
const KEYS = {
  jdUrl: 'linkgrabber_jd_url',
  aria2Url: 'linkgrabber_aria2_url',
  aria2Secret: 'linkgrabber_aria2_secret',
  aria2Dir: 'linkgrabber_aria2_dir',
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

function saveSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function validHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// The aria2 secret is write-only: the client only learns whether one is set.
router.get('/settings', (req, res) => {
  res.json({
    jdUrl: getSetting(KEYS.jdUrl),
    aria2Url: getSetting(KEYS.aria2Url),
    aria2Dir: getSetting(KEYS.aria2Dir),
    hasAria2Secret: Boolean(getSetting(KEYS.aria2Secret)),
  });
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  for (const field of ['jdUrl', 'aria2Url']) {
    if (body[field] !== undefined) {
      const value = String(body[field] || '').trim();
      if (value && !validHttpUrl(value)) return res.status(400).json({ error: `${field} must be an http(s) URL` });
      body[field] = value;
    }
  }
  for (const field of ['jdUrl', 'aria2Url', 'aria2Dir']) {
    if (body[field] !== undefined) saveSetting(KEYS[field], String(body[field] || '').trim());
  }
  // Blank leaves the stored secret alone; clearAria2Secret removes it.
  if (body.clearAria2Secret) saveSetting(KEYS.aria2Secret, '');
  else if (body.aria2Secret) saveSetting(KEYS.aria2Secret, String(body.aria2Secret));
  res.json({ ok: true });
});

// Tests only the saved address. Taking a URL from the request would let any signed-in
// client probe arbitrary hosts on the server's network and read back the result.
router.post('/test-jd', async (req, res) => {
  const jdUrl = getSetting(KEYS.jdUrl).trim();
  if (!jdUrl) return res.status(400).json({ ok: false, message: 'JDownloader URL is not configured' });
  try {
    const result = await linkGrabber.testJDownloaderConnection(jdUrl);
    res.json(result);
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

router.get('/history/stats', (req, res) => {
  res.json(linkGrabber.getHistoryStats());
});

router.delete('/history', (req, res) => {
  try {
    res.json(linkGrabber.clearHistory());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/crawl', async (req, res) => {
  const {
    url,
    mode,
    maxPages,
    startPage,
    endPage,
    lastN,
    skipQuotes,
    skipBots,
    decodeBase64,
    ignoreHistory,
    cookies,
    useSavedCookies,
  } = req.body || {};

  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
  if (cookies !== undefined && typeof cookies !== 'string') return res.status(400).json({ error: 'cookies must be cookies.txt text' });

  try {
    res.json(await linkGrabber.crawl({
      url,
      mode,
      maxPages,
      startPage,
      endPage,
      lastN,
      skipQuotes: skipQuotes !== false,
      skipBots: skipBots !== false,
      decodeBase64: decodeBase64 !== false,
      ignoreHistory: !!ignoreHistory,
      cookiesText: cookies || '',
      useSavedCookies: !!useSavedCookies,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/send', async (req, res) => {
  const { target, urls, packageName, passwords, packagePerPage, urlMetadata, threadUrl } = req.body || {};
  const list = linkGrabber.cleanUrls(urls);
  if (list.length === 0) return res.status(400).json({ error: 'At least one URL is required' });
  if (list.length > MAX_SEND) return res.status(400).json({ error: `Too many URLs in one request (max ${MAX_SEND})` });

  try {
    if (target === 'queue') {
      const ids = [];
      const failed = [];
      for (const u of list) {
        try {
          await ytdlp.assertPublicUrlResolved(u);
          ids.push(queue.enqueue(u, {}));
        } catch (err) {
          failed.push(`${u}: ${err.message}`);
        }
      }
      return res.json({ sent: ids.length, ids, failed });
    }
    if (target === 'jdownloader') {
      const result = await linkGrabber.sendToJDownloader(list, {
        baseUrl: getSetting(KEYS.jdUrl),
        packageName: typeof packageName === 'string' ? packageName.slice(0, 200) : '',
        passwords,
        packagePerPage: !!packagePerPage,
        urlMetadata: Array.isArray(urlMetadata) ? urlMetadata : [],
        threadUrl: typeof threadUrl === 'string' ? threadUrl.slice(0, 2000) : '',
      });
      return res.json({ ...result, failed: [] });
    }
    if (target === 'aria2') {
      const result = await linkGrabber.sendToAria2(list, {
        rpcUrl: getSetting(KEYS.aria2Url),
        secret: getSetting(KEYS.aria2Secret),
        dir: getSetting(KEYS.aria2Dir),
      });
      return res.json(result);
    }
    return res.status(400).json({ error: 'target must be queue, jdownloader or aria2' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
