const express = require('express');
const linkGrabber = require('../services/linkGrabber');
const crawls = require('../services/linkGrabberCrawls');
const watches = require('../services/linkGrabberWatches');
const linkCheck = require('../services/linkCheck');
const { getSetting, saveSetting, sendLinks } = require('../services/linkGrabberSend');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// As many as one crawl can list, so a full selection always goes out in one request.
const MAX_SEND = linkGrabber.MAX_LINKS;

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
    jdUrl: getSetting('jdUrl'),
    aria2Url: getSetting('aria2Url'),
    aria2Dir: getSetting('aria2Dir'),
    hasAria2Secret: Boolean(getSetting('aria2Secret')),
    userAgent: getSetting('userAgent'),
    solverUrl: getSetting('solverUrl') || process.env.SOLVERR_URL || process.env.SOLVER_URL || process.env.FLARESOLVERR_URL || '',
  });
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  for (const field of ['jdUrl', 'aria2Url', 'solverUrl']) {
    if (body[field] !== undefined) {
      const value = String(body[field] || '').trim();
      if (value && !validHttpUrl(value)) return res.status(400).json({ error: `${field} must be an http(s) URL` });
      body[field] = value;
    }
  }
  if (body.userAgent !== undefined) {
    const value = String(body.userAgent || '').trim();
    // It goes out as a header line, so no control characters.
    const hasControlChars = [...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
    if (value.length > 500 || hasControlChars) return res.status(400).json({ error: 'userAgent must be a single line of at most 500 characters' });
    body.userAgent = value;
  }
  for (const field of ['jdUrl', 'aria2Url', 'aria2Dir', 'userAgent', 'solverUrl']) {
    if (body[field] !== undefined) saveSetting(field, String(body[field] || '').trim());
  }
  // Blank leaves the stored secret alone; clearAria2Secret removes it.
  if (body.clearAria2Secret) saveSetting('aria2Secret', '');
  else if (body.aria2Secret) saveSetting('aria2Secret', String(body.aria2Secret));
  res.json({ ok: true });
});

router.post('/test-solver', async (req, res) => {
  const rawUrl = (req.body?.solverUrl || getSetting('solverUrl') || process.env.SOLVERR_URL || process.env.SOLVER_URL || process.env.FLARESOLVERR_URL || '').trim();
  if (!rawUrl) return res.status(400).json({ ok: false, message: 'Solver URL is not configured' });
  try {
    const result = await linkGrabber.testSolverConnection(rawUrl);
    res.json(result);
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// Tests only the saved address. Taking a URL from the request would let any signed-in
// client probe arbitrary hosts on the server's network and read back the result.
router.post('/test-jd', async (req, res) => {
  const jdUrl = getSetting('jdUrl').trim();
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

// Links handed off outside the server (copied to the clipboard) are marked seen the same way
// sent ones are.
router.post('/history', (req, res) => {
  const { urls, threadTitle, threadUrl } = req.body || {};
  const list = linkGrabber.cleanUrls(urls).slice(0, MAX_SEND);
  const recorded = linkGrabber.recordCrawledLinks(
    list,
    typeof threadTitle === 'string' ? threadTitle.slice(0, 200) : '',
    typeof threadUrl === 'string' ? threadUrl.slice(0, 2000) : '',
  );
  res.json({ recorded });
});

router.delete('/history', (req, res) => {
  try {
    res.json(linkGrabber.clearHistory());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cookies', (req, res) => {
  res.json(linkGrabber.getCrawlerCookiesStatus());
});

router.put('/cookies', (req, res) => {
  try {
    const { content } = req.body || {};
    res.json(linkGrabber.saveCrawlerCookies(content));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/cookies', (req, res) => {
  try {
    res.json(linkGrabber.deleteCrawlerCookies());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- crawls ------------------------------------------------------------------------------

// Starts a crawl in the background and answers with its id at once. Progress arrives over
// Socket.IO (linkgrabber:progress, then linkgrabber:crawl when it ends); GET /crawls/:id has
// the result.
router.post('/crawl', (req, res) => {
  const {
    url, mode, maxPages, startPage, endPage, lastN, skipQuotes, skipBots, decodeBase64, ignoreHistory, cookies, useSavedCookies, userAgent, solverUrl,
  } = req.body || {};
  if (!url || typeof url !== 'string' || !validHttpUrl(url.trim())) return res.status(400).json({ error: 'A valid http(s) url is required' });
  if (cookies !== undefined && typeof cookies !== 'string') return res.status(400).json({ error: 'cookies must be cookies.txt text' });

  const { id } = crawls.startCrawl({
    url: url.trim(),
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
    userAgent: typeof userAgent === 'string' ? userAgent.trim() : undefined,
    solverUrl: typeof solverUrl === 'string' ? solverUrl.trim() : undefined,
  });
  res.status(202).json({ id });
});

router.get('/crawls', (req, res) => {
  res.json(crawls.listCrawls());
});

router.get('/crawls/:id', (req, res) => {
  const crawl = crawls.getCrawl(req.params.id);
  if (!crawl) return res.status(404).json({ error: 'Crawl not found' });
  res.json(crawl);
});

router.post('/crawls/:id/cancel', (req, res) => {
  res.json({ cancelled: crawls.cancelCrawl(req.params.id) });
});

router.delete('/crawls/:id', (req, res) => {
  if (!crawls.deleteCrawl(req.params.id)) return res.status(409).json({ error: 'Crawl not found or still running' });
  res.json({ ok: true });
});

// --- sending and checking ----------------------------------------------------------------

// With a crawlId the package name, pages and passwords come from the stored crawl and only the
// chosen urls are needed; without one, the caller supplies them.
router.post('/send', async (req, res) => {
  const { crawlId, ...body } = req.body || {};
  let crawl = null;
  if (crawlId) {
    crawl = crawls.getStoredResult(String(crawlId));
    if (!crawl) return res.status(404).json({ error: 'Crawl not found (it may have been cleared); crawl again' });
  }
  try {
    res.json(await sendLinks({ ...body, crawl }));
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/check', async (req, res) => {
  const { urls, crawlId } = req.body || {};
  const list = linkGrabber.cleanUrls(urls);
  if (list.length === 0) return res.status(400).json({ error: 'At least one URL is required' });
  if (list.length > linkCheck.MAX_CHECK) return res.status(400).json({ error: `Check at most ${linkCheck.MAX_CHECK} links at a time` });
  const results = await linkCheck.checkLinks(list);
  if (crawlId) crawls.saveCheckResults(String(crawlId), results);
  res.json({ results });
});

// --- thread watches ----------------------------------------------------------------------

function watchError(res, err) {
  if (err instanceof watches.WatchInputError) return res.status(400).json({ error: err.message });
  return res.status(500).json({ error: err.message });
}

router.get('/watches', (req, res) => {
  res.json(watches.listWatches());
});

router.post('/watches', (req, res) => {
  try {
    res.status(201).json(watches.createWatch(req.body));
  } catch (err) {
    watchError(res, err);
  }
});

router.put('/watches/:id', (req, res) => {
  try {
    const watch = watches.updateWatch(Number(req.params.id), req.body);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });
    res.json(watch);
  } catch (err) {
    watchError(res, err);
  }
});

router.delete('/watches/:id', (req, res) => {
  if (!watches.deleteWatch(Number(req.params.id))) return res.status(404).json({ error: 'Watch not found' });
  res.json({ ok: true });
});

// Runs in the background; the outcome arrives as linkgrabber:watch over Socket.IO.
router.post('/watches/:id/check', (req, res) => {
  const watch = watches.getWatch(Number(req.params.id));
  if (!watch) return res.status(404).json({ error: 'Watch not found' });
  if (watch.checking) return res.status(409).json({ error: 'This watch is already being checked' });
  watches.checkWatch(watch.id).catch((err) => console.error(`[linkgrabber] watch #${watch.id} check failed: ${err.message}`));
  res.status(202).json({ ok: true });
});

module.exports = router;
