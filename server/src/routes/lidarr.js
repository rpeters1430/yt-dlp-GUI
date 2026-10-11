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

qbitRouter.post('/auth/login', (req, res) => {
  res.set('Set-Cookie', 'SID=ytdlp-lidarr-session; HttpOnly; Path=/');
  res.status(200).send('Ok.');
});

qbitRouter.post('/auth/logout', (req, res) => {
  res.status(200).send('Ok.');
});

qbitRouter.get('/app/version', (req, res) => {
  res.status(200).send('v4.6.0');
});

qbitRouter.get('/app/webapiVersion', (req, res) => {
  res.status(200).send('2.9.3');
});

qbitRouter.get('/app/preferences', (req, res) => {
  const config = lidarr.getLidarrConfig();
  res.json({
    save_path: config.musicFolder || 'Music',
    temp_path: config.musicFolder || 'Music',
  });
});

qbitRouter.get('/torrents/info', (req, res) => {
  const { category, hashes, filter } = req.query;
  const torrents = lidarr.getQbitTorrents({ category, hashes, filter });
  res.json(torrents);
});

qbitRouter.post('/torrents/add', async (req, res) => {
  const rawUrls = req.body?.urls || req.query?.urls;
  const category = req.body?.category || req.query?.category || 'music';
  const savepath = req.body?.savepath || req.query?.savepath || null;

  if (!rawUrls) {
    return res.status(200).send('Ok.');
  }

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

  res.status(200).send('Ok.');
});

qbitRouter.post('/torrents/delete', (req, res) => {
  const hashes = req.body?.hashes || req.query?.hashes;
  lidarr.deleteQbitTorrents(hashes);
  res.status(200).send('Ok.');
});

qbitRouter.post('/torrents/pause', (req, res) => {
  res.status(200).send('Ok.');
});

qbitRouter.post('/torrents/resume', (req, res) => {
  res.status(200).send('Ok.');
});

qbitRouter.get('/torrents/properties', (req, res) => {
  const config = lidarr.getLidarrConfig();
  res.json({
    save_path: config.musicFolder || 'Music',
    total_size: 50 * 1024 * 1024,
    pieces_num: 200,
    piece_size: 262144,
  });
});

qbitRouter.get('/torrents/files', (req, res) => {
  res.json([]);
});

// Mount qBittorrent endpoints at /qbit/api/v2 and /api/v2
router.use('/qbit/api/v2', qbitRouter);
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
          complete_dir: config.musicFolder || 'Music',
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

module.exports = router;
