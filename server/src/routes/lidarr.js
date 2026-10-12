const crypto = require('crypto');
const express = require('express');
const lidarr = require('../services/lidarr');
const music = require('../services/music');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(express.urlencoded({ extended: true }));

// Helper to determine the host URL from request
function getHostUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
  return `${protocol}://${host}`;
}

// -------------------------------------------------------------
// Torznab / Newznab Indexer API
// Accessible at /api/lidarr/torznab, /api/lidarr (when t= is passed), /api/torznab
// -------------------------------------------------------------
// The indexer, .torrent download and SABnzbd endpoints are called by Lidarr, not a logged-in
// browser, so they authenticate with the Torznab API key shown on the Music → Lidarr tab.
function getApiKey(req) {
  return req.query.apikey || req.body?.apikey || req.get('X-Api-Key') || '';
}

async function handleTorznabRequest(req, res) {
  const t = (req.query.t || '').toLowerCase();
  const apikey = getApiKey(req);

  if (!lidarr.validateTorznabApiKey(apikey)) {
    res.set('Content-Type', 'application/xml');
    return res.status(401).send(`<?xml version="1.0" encoding="UTF-8"?>
<error code="100" description="Invalid or missing API Key"/>`);
  }

  if (t === 'caps') {
    res.set('Content-Type', 'application/xml');
    return res.send(lidarr.getCapsXml());
  }

  if (t === 'music' || t === 'search') {
    try {
      const xml = await lidarr.searchTorznab({
        query: req.query.q,
        artist: req.query.artist,
        album: req.query.album,
        track: req.query.track,
        year: req.query.year,
        limit: req.query.limit,
        hostUrl: getHostUrl(req),
        apiKey: apikey,
      });
      res.set('Content-Type', 'application/xml');
      return res.send(xml);
    } catch (err) {
      console.error('[lidarr:torznab] Search failed:', err.message);
      res.set('Content-Type', 'application/xml');
      return res.status(500).send(`<?xml version="1.0" encoding="UTF-8"?>
<error code="900" description="${lidarr.escapeXml(err.message)}"/>`);
    }
  }

  // Default: return capabilities if no specific function was provided
  res.set('Content-Type', 'application/xml');
  return res.send(lidarr.getCapsXml());
}

router.get('/torznab', handleTorznabRequest);

// -------------------------------------------------------------
// Torrent File Download Endpoint
// Called by Lidarr when downloading the .torrent file
// -------------------------------------------------------------
router.get('/download', (req, res) => {
  if (!lidarr.validateTorznabApiKey(getApiKey(req))) {
    return res.status(401).send('Invalid or missing API Key');
  }
  const { type = 'album', id, artist, album, track } = req.query;
  if (!id) {
    return res.status(400).send('Missing release ID');
  }

  try {
    const torrentBuf = lidarr.generateTorrentBuffer({
      type,
      id,
      artist,
      album,
      track,
      announceUrl: `${getHostUrl(req)}/announce`,
    });

    const safeName = music.sanitizeFilename(`${artist || 'Music'} - ${album || id}`);
    res.set('Content-Type', 'application/x-bittorrent');
    res.set('Content-Disposition', `attachment; filename="${safeName}.torrent"`);
    res.send(torrentBuf);
  } catch (err) {
    console.error('[lidarr:download] Error generating torrent file:', err.message);
    res.status(500).send(`Failed to generate torrent: ${err.message}`);
  }
});

// -------------------------------------------------------------
// qBittorrent Mock Web API
// Endpoints matching qBittorrent v2 Web API (/api/v2/...)
// -------------------------------------------------------------
const qbitRouter = express.Router();
qbitRouter.use(express.urlencoded({ extended: true }));

async function parseMultipartForm(req) {
  const ctype = req.headers['content-type'] || '';
  if (!ctype.toLowerCase().includes('multipart/form-data')) {
    return { fields: req.body || {}, files: [] };
  }

  const boundaryMatch = ctype.match(/boundary=(?:["']([^"']+)["']|([^;\s]+))/);
  if (!boundaryMatch) {
    return { fields: req.body || {}, files: [] };
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const boundaryBuf = Buffer.from(`--${boundary}`);

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const bodyBuf = Buffer.concat(chunks);
  const fields = {};
  const files = [];

  let start = 0;
  while (start < bodyBuf.length) {
    const bIdx = bodyBuf.indexOf(boundaryBuf, start);
    if (bIdx === -1) break;

    const afterBoundary = bIdx + boundaryBuf.length;
    // Check if end delimiter "--"
    if (bodyBuf[afterBoundary] === 0x2d && bodyBuf[afterBoundary + 1] === 0x2d) {
      break;
    }

    const headerStart = bodyBuf.indexOf(Buffer.from('\r\n'), afterBoundary);
    if (headerStart === -1) break;
    const headerEnd = bodyBuf.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;

    const headerStr = bodyBuf.toString('utf8', headerStart + 2, headerEnd);
    const contentStart = headerEnd + 4;
    const nextBIdx = bodyBuf.indexOf(boundaryBuf, contentStart);
    if (nextBIdx === -1) break;
    const contentEnd = nextBIdx - 2; // strip trailing \r\n
    const contentBuf = bodyBuf.subarray(contentStart, Math.max(contentStart, contentEnd));

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);

    if (nameMatch) {
      const fieldName = nameMatch[1];
      if (filenameMatch) {
        files.push({
          fieldName,
          filename: filenameMatch[1],
          buffer: contentBuf,
        });
      } else {
        fields[fieldName] = contentBuf.toString('utf8').trim();
      }
    }

    start = nextBIdx;
  }

  return { fields, files };
}

// qBittorrent-style auth: /auth/login takes the Torznab API key as the password and hands
// out an SID cookie. Sessions live in memory; after a restart Lidarr gets a 403 and simply
// logs in again, which is how it treats a real qBittorrent restart too.
const MAX_QBIT_SESSIONS = 100;
const qbitSessions = new Set();

function getQbitSid(req) {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)SID=([^;]+)/);
  return match ? match[1] : null;
}

// Self-nest to support double prefix if client sends /api/v2/api/v2. Must come before the
// auth check below so /api/v2/auth/login still reaches the login route.
qbitRouter.use('/api/v2', qbitRouter);

qbitRouter.post('/auth/login', (req, res) => {
  const password = req.body?.password || req.query?.password || '';
  if (!lidarr.validateTorznabApiKey(password)) {
    // Real qBittorrent answers a bad login with 200 "Fails.", which Lidarr reports as an auth error.
    return res.type('text/plain').status(200).send('Fails.');
  }
  const sid = crypto.randomBytes(24).toString('hex');
  qbitSessions.add(sid);
  if (qbitSessions.size > MAX_QBIT_SESSIONS) {
    qbitSessions.delete(qbitSessions.values().next().value);
  }
  res.set('Set-Cookie', `SID=${sid}; HttpOnly; Path=/`);
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.use((req, res, next) => {
  const sid = getQbitSid(req);
  if (sid && qbitSessions.has(sid)) return next();
  res.type('text/plain').status(403).send('Forbidden');
});

qbitRouter.post('/auth/logout', (req, res) => {
  qbitSessions.delete(getQbitSid(req));
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.get('/app/version', (req, res) => {
  res.type('text/plain').status(200).send('v4.6.0');
});

qbitRouter.get('/app/webapiVersion', (req, res) => {
  res.type('text/plain').status(200).send('2.9.3');
});

qbitRouter.get('/app/buildInfo', (req, res) => {
  res.json({
    qt: '6.5.0',
    libtorrent: '2.0.8',
    boost: '1.82.0',
    openssl: '3.0.8',
    bitness: 64,
  });
});

qbitRouter.get('/app/preferences', (req, res) => {
  const config = lidarr.getLidarrConfig();
  const savePath = lidarr.normalizeMusicFolder(config.musicFolder).replace(/\\/g, '/');
  res.json({
    save_path: savePath,
    temp_path: savePath,
    queueing_enabled: true,
    max_ratio_enabled: false,
    max_seeding_time_enabled: false,
    dht: true,
  });
});

qbitRouter.get('/app/defaultSavePath', (req, res) => {
  const config = lidarr.getLidarrConfig();
  res.type('text/plain').status(200).send(lidarr.normalizeMusicFolder(config.musicFolder).replace(/\\/g, '/'));
});

qbitRouter.get('/torrents/categories', (req, res) => {
  res.json(lidarr.getQbitCategories());
});

qbitRouter.post('/torrents/createCategory', (req, res) => {
  const category = req.body?.category || req.query?.category;
  const savePath = req.body?.savePath || req.query?.savePath || '';
  if (category) {
    lidarr.addQbitCategory(category, savePath);
  }
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/torrents/editCategory', (req, res) => {
  const category = req.body?.category || req.query?.category;
  const savePath = req.body?.savePath || req.query?.savePath || '';
  if (category) {
    lidarr.addQbitCategory(category, savePath);
  }
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/torrents/removeCategories', (req, res) => {
  const categories = req.body?.categories || req.query?.categories;
  if (categories) {
    lidarr.removeQbitCategories(categories);
  }
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/torrents/setCategory', (req, res) => {
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/torrents/setShareLimits', (req, res) => {
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/torrents/topPrio', (req, res) => {
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/torrents/setForceStart', (req, res) => {
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.get('/sync/maindata', (req, res) => {
  res.json({
    rid: 1,
    full_update: true,
    torrents: {},
    categories: lidarr.getQbitCategories(),
    server_state: {
      connection_status: 'connected',
      dlspeed: 0,
      upspeed: 0,
    },
  });
});

qbitRouter.get('/torrents/info', (req, res) => {
  const { category, hashes, filter } = req.query;
  const torrents = lidarr.getQbitTorrents({ category, hashes, filter });
  res.json(torrents);
});

qbitRouter.post('/torrents/add', async (req, res) => {
  let fields = req.body || {};
  let files = [];

  if (req.headers['content-type']?.toLowerCase().includes('multipart/form-data')) {
    try {
      const parsed = await parseMultipartForm(req);
      fields = { ...fields, ...parsed.fields };
      files = parsed.files;
    } catch (err) {
      console.error('[lidarr:qbit] Error parsing multipart upload:', err.message);
    }
  }

  const rawUrls = fields.urls || req.query?.urls;
  const category = fields.category || req.query?.category || 'music';
  const savepath = fields.savepath || req.query?.savepath || null;

  // 1. Process files (if Lidarr uploaded .torrent files)
  for (const file of files) {
    try {
      const torrentInfo = lidarr.parseTorrentBuffer(file.buffer);
      if (torrentInfo && torrentInfo.id) {
        await lidarr.handleDownloadAdd({
          type: torrentInfo.type || 'album',
          id: torrentInfo.id,
          artist: torrentInfo.artist,
          album: torrentInfo.album,
          track: torrentInfo.track || null,
          // Must match the infohash Lidarr computed from this file, or it can't link the download.
          hash: torrentInfo.infoHash,
          category,
          savePath: savepath,
        });
      }
    } catch (err) {
      console.error('[lidarr:qbit] Failed to process uploaded torrent file:', file.filename, err.message);
    }
  }

  // 2. Process URLs (if magnet link or URL was passed)
  if (rawUrls) {
    const urls = String(rawUrls).split(/[\r\n]+/).map((u) => u.trim()).filter(Boolean);
    for (const urlStr of urls) {
      try {
        const parsedUrl = new URL(urlStr, getHostUrl(req));
        const type = parsedUrl.searchParams.get('type') || 'album';
        const id = parsedUrl.searchParams.get('id');
        const artist = parsedUrl.searchParams.get('artist');
        const album = parsedUrl.searchParams.get('album');
        const track = parsedUrl.searchParams.get('track');

        if (id) {
          await lidarr.handleDownloadAdd({
            type,
            id,
            artist,
            album,
            track,
            category,
            savePath: savepath,
          });
        }
      } catch (err) {
        console.error('[lidarr:qbit] Failed to process torrent add url:', urlStr, err.message);
      }
    }
  }

  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/torrents/delete', (req, res) => {
  const hashes = req.body?.hashes || req.query?.hashes;
  lidarr.deleteQbitTorrents(hashes);
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/torrents/pause', (req, res) => {
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/torrents/resume', (req, res) => {
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.get('/torrents/properties', (req, res) => {
  const props = lidarr.getQbitTorrentProperties(req.query.hash);
  if (!props) return res.type('text/plain').status(404).send('Not Found');
  res.json(props);
});

qbitRouter.get('/torrents/files', (req, res) => {
  const files = lidarr.getQbitTorrentFiles(req.query.hash);
  if (!files) return res.type('text/plain').status(404).send('Not Found');
  res.json(files);
});


// Mount qBittorrent endpoints at /qbit/api/v2, /qbit, and /api/v2
router.use('/qbit/api/v2', qbitRouter);
router.use('/qbit', qbitRouter);
router.use('/api/v2', qbitRouter);

// -------------------------------------------------------------
// SABnzbd Mock API
// Endpoints matching SABnzbd (/api?mode=...)
// -------------------------------------------------------------
async function handleSabRequest(req, res) {
  const mode = (req.query.mode || req.body?.mode || '').toLowerCase();

  if (!lidarr.validateTorznabApiKey(getApiKey(req))) {
    // SABnzbd's own wording, which Lidarr recognises as an authentication failure.
    return res.status(200).json({ status: false, error: 'API Key Incorrect' });
  }

  if (mode === 'version') {
    return res.json({ version: '4.3.0' });
  }

  if (mode === 'get_config') {
    const config = lidarr.getLidarrConfig();
    return res.json({
      config: {
        misc: {
          complete_dir: lidarr.normalizeMusicFolder(config.musicFolder).replace(/\\/g, '/'),
        },
      },
    });
  }

  if (mode === 'queue') {
    const name = (req.query.name || req.body?.name || '').toLowerCase();
    if (name === 'delete') {
      const val = req.query.value || req.body?.value;
      lidarr.deleteQbitTorrents(val);
      return res.json({ status: true });
    }
    return res.json(lidarr.getSabQueue());
  }

  if (mode === 'history') {
    return res.json(lidarr.getSabHistory());
  }

  if (mode === 'addurl') {
    const urlStr = req.query.name || req.body?.name;
    const cat = req.query.cat || req.body?.cat || 'music';
    try {
      if (urlStr) {
        const parsedUrl = new URL(urlStr, getHostUrl(req));
        const type = parsedUrl.searchParams.get('type') || 'album';
        const id = parsedUrl.searchParams.get('id');
        const artist = parsedUrl.searchParams.get('artist');
        const album = parsedUrl.searchParams.get('album');
        const track = parsedUrl.searchParams.get('track');

        if (id) {
          const task = await lidarr.handleDownloadAdd({
            type,
            id,
            artist,
            album,
            track,
            category: cat,
          });
          return res.json({ status: true, nzo_ids: [task.hash] });
        }
      }
    } catch (err) {
      console.error('[lidarr:sab] Addurl error:', err.message);
    }
    return res.json({ status: true, nzo_ids: [] });
  }

  // Default fallback for unrecognized SAB mode
  res.json({ status: true });
}

router.get('/sab/api', handleSabRequest);
router.post('/sab/api', handleSabRequest);
router.get('/sab', handleSabRequest);
router.post('/sab', handleSabRequest);

// Handle direct /api/lidarr?t=... or mode=... calls
router.use((req, res, next) => {
  if (req.query.t) {
    return handleTorznabRequest(req, res);
  }
  if (req.query.mode || req.body?.mode) {
    return handleSabRequest(req, res);
  }
  next();
});

// -------------------------------------------------------------
// App GUI & Admin Endpoints (requires user session)
// -------------------------------------------------------------
router.get('/settings', requireAuth, (req, res) => {
  res.json(lidarr.getLidarrConfig());
});

router.put('/settings', requireAuth, (req, res) => {
  const updated = lidarr.updateLidarrConfig(req.body || {});
  res.json(updated);
});

router.post('/test', requireAuth, async (req, res) => {
  const { url, apiKey } = req.body || {};
  try {
    const result = await lidarr.testConnection(url, apiKey);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/status', requireAuth, (req, res) => {
  const tasks = lidarr.getQbitTorrents();
  const config = lidarr.getLidarrConfig();
  res.json({
    config,
    activeTasks: tasks.filter((t) => t.state !== 'uploading'),
    completedTasks: tasks.filter((t) => t.state === 'uploading'),
    totalTasks: tasks.length,
  });
});

router.get('/wanted', requireAuth, async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const pageSize = parseInt(req.query.pageSize || '30', 10);
  try {
    const data = await lidarr.getWantedMissing({ page, pageSize });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/artists', requireAuth, async (req, res) => {
  try {
    const data = await lidarr.getArtists();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scan', requireAuth, async (req, res) => {
  const { path: targetPath } = req.body || {};
  if (!targetPath) {
    return res.status(400).json({ error: 'Path is required' });
  }
  try {
    const result = await lidarr.triggerDownloadedAlbumsScan(targetPath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/download-wanted', requireAuth, async (req, res) => {
  const { artist, album } = req.body || {};
  if (!artist && !album) {
    return res.status(400).json({ error: 'Artist and album are required' });
  }

  try {
    const q = `${artist || ''} ${album || ''}`.trim();
    const searchRes = await music.searchAlbums(q, 5);
    const albums = searchRes.results || [];
    if (albums.length === 0) {
      return res.status(404).json({ error: `No albums found matching "${q}"` });
    }

    const matched = albums[0];
    const task = await lidarr.handleDownloadAdd({
      type: 'album',
      id: matched.id,
      artist: matched.artist,
      album: matched.name,
    });

    res.json({ ok: true, matched, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.qbitRouter = qbitRouter;
module.exports = router;

