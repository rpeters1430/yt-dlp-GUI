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
async function handleTorznabRequest(req, res) {
  const t = (req.query.t || '').toLowerCase();
  const apikey = req.query.apikey;

  // Validate API key if configured
  if (apikey && !lidarr.validateTorznabApiKey(apikey)) {
    res.set('Content-Type', 'application/xml');
    return res.status(403).send(`<?xml version="1.0" encoding="UTF-8"?>
<error code="100" description="Invalid API Key"/>`);
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
  const { type = 'album', id, artist, album } = req.query;
  if (!id) {
    return res.status(400).send('Missing release ID');
  }

  try {
    const torrentBuf = lidarr.generateTorrentBuffer({
      type,
      id,
      artist,
      album,
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

qbitRouter.post('/auth/login', (req, res) => {
  res.set('Set-Cookie', 'SID=ytdlp-lidarr-session; HttpOnly; Path=/');
  res.type('text/plain').status(200).send('Ok.');
});

qbitRouter.post('/auth/logout', (req, res) => {
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

        if (id) {
          await lidarr.handleDownloadAdd({
            type,
            id,
            artist,
            album,
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
  const config = lidarr.getLidarrConfig();
  res.json({
    save_path: lidarr.normalizeMusicFolder(config.musicFolder).replace(/\\/g, '/'),
    total_size: 50 * 1024 * 1024,
    pieces_num: 200,
    piece_size: 262144,
  });
});

qbitRouter.get('/torrents/files', (req, res) => {
  res.json([]);
});

// Self-nest to support double prefix if client sends /api/v2/api/v2
qbitRouter.use('/api/v2', qbitRouter);

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
  const apikey = req.query.apikey || req.body?.apikey;

  if (apikey && !lidarr.validateTorznabApiKey(apikey)) {
    return res.status(403).json({ error: 'Invalid API Key' });
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

        if (id) {
          const task = await lidarr.handleDownloadAdd({
            type,
            id,
            artist,
            album,
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

