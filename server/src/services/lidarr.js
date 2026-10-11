const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const music = require('./music');
const ytdlp = require('./ytdlp');

// Bencoding for BitTorrent .torrent files
function bencode(val) {
  if (typeof val === 'number') {
    return Buffer.from(`i${Math.floor(val)}e`, 'ascii');
  }
  if (typeof val === 'string') {
    const buf = Buffer.from(val, 'utf8');
    return Buffer.concat([Buffer.from(`${buf.length}:`, 'ascii'), buf]);
  }
  if (Buffer.isBuffer(val)) {
    return Buffer.concat([Buffer.from(`${val.length}:`, 'ascii'), val]);
  }
  if (Array.isArray(val)) {
    const chunks = [Buffer.from('l', 'ascii')];
    for (const item of val) chunks.push(bencode(item));
    chunks.push(Buffer.from('e', 'ascii'));
    return Buffer.concat(chunks);
  }
  if (typeof val === 'object' && val !== null) {
    const keys = Object.keys(val).sort();
    const chunks = [Buffer.from('d', 'ascii')];
    for (const key of keys) {
      chunks.push(bencode(key));
      chunks.push(bencode(val[key]));
    }
    chunks.push(Buffer.from('e', 'ascii'));
    return Buffer.concat(chunks);
  }
  return Buffer.from('0:', 'ascii');
}

function escapeXml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function getDeterministicHash(type, id) {
  return crypto.createHash('sha1').update(`lidarr:${type}:${id}`).digest('hex');
}

function generateTorrentBuffer({ type, id, artist, album, title, sizeBytes, announceUrl }) {
  const name = title || (artist && album ? `${artist} - ${album}` : `Music-${id}`);
  const length = Number(sizeBytes) > 0 ? Number(sizeBytes) : 50 * 1024 * 1024;
  const pieceLength = 262144;
  const numPieces = Math.ceil(length / pieceLength);
  
  // Create deterministic piece hashes
  const piecesBuf = Buffer.alloc(numPieces * 20);
  for (let i = 0; i < numPieces; i++) {
    const pieceHash = crypto.createHash('sha1').update(`${type}:${id}:piece:${i}`).digest();
    pieceHash.copy(piecesBuf, i * 20);
  }

  const infoDict = {
    length,
    name,
    'piece length': pieceLength,
    pieces: piecesBuf,
    source: 'yt-dlp',
  };

  const torrentDict = {
    announce: announceUrl || 'http://localhost/announce',
    'created by': 'yt-dlp-gui',
    'creation date': Math.floor(Date.now() / 1000),
    info: infoDict,
  };

  return bencode(torrentDict);
}

function getLidarrConfig() {
  const keys = [
    'lidarr_enabled',
    'lidarr_url',
    'lidarr_api_key',
    'lidarr_torznab_api_key',
    'lidarr_auto_notify',
    'lidarr_music_folder',
    'lidarr_category',
    'lidarr_format',
    'lidarr_quality',
  ];
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys);
  const map = {};
  for (const r of rows) map[r.key] = r.value;

  let torznabApiKey = map.lidarr_torznab_api_key;
  if (!torznabApiKey) {
    torznabApiKey = crypto.randomBytes(16).toString('hex');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lidarr_torznab_api_key', ?)").run(torznabApiKey);
  }

  return {
    enabled: map.lidarr_enabled === '1',
    url: map.lidarr_url || 'http://localhost:8686',
    apiKey: map.lidarr_api_key || '',
    torznabApiKey,
    autoNotify: map.lidarr_auto_notify !== '0',
    musicFolder: map.lidarr_music_folder || 'Music',
    category: map.lidarr_category || 'music',
    format: map.lidarr_format || 'mp3',
    quality: map.lidarr_quality || '320k',
  };
}

function updateLidarrConfig(updates = {}) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  if (updates.enabled !== undefined) upsert.run('lidarr_enabled', updates.enabled ? '1' : '0');
  if (updates.url !== undefined) upsert.run('lidarr_url', String(updates.url).trim().replace(/\/+$/, ''));
  if (updates.apiKey !== undefined) upsert.run('lidarr_api_key', String(updates.apiKey).trim());
  if (updates.torznabApiKey !== undefined) upsert.run('lidarr_torznab_api_key', String(updates.torznabApiKey).trim());
  if (updates.autoNotify !== undefined) upsert.run('lidarr_auto_notify', updates.autoNotify ? '1' : '0');
  if (updates.musicFolder !== undefined) upsert.run('lidarr_music_folder', String(updates.musicFolder).trim() || 'Music');
  if (updates.category !== undefined) upsert.run('lidarr_category', String(updates.category).trim() || 'music');
  if (updates.format !== undefined) upsert.run('lidarr_format', String(updates.format).trim() || 'mp3');
  if (updates.quality !== undefined) upsert.run('lidarr_quality', String(updates.quality).trim() || '320k');

  return getLidarrConfig();
}

function validateTorznabApiKey(providedKey) {
  const config = getLidarrConfig();
  if (!providedKey) return false;
  return providedKey === config.torznabApiKey || (config.apiKey && providedKey === config.apiKey);
}

function getCapsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server version="1.0" title="yt-dlp-music" strapline="yt-dlp Music Torznab Indexer for Lidarr"/>
  <limits max="100" default="50"/>
  <registration available="no" open="no"/>
  <searching>
    <search available="yes" supportedParams="q"/>
    <music-search available="yes" supportedParams="q,artist,album,track,year"/>
  </searching>
  <categories>
    <category id="3000" name="Audio">
      <subcat id="3010" name="Audio/MP3"/>
      <subcat id="3020" name="Audio/Lossless"/>
      <subcat id="3030" name="Audio/Other"/>
      <subcat id="3040" name="Audio/Lossless"/>
    </category>
  </categories>
</caps>`;
}

async function searchTorznab({ query = '', artist = '', album = '', track = '', year = '', limit = 50, hostUrl = '' }) {
  const items = [];
  const cleanArtist = String(artist || '').trim();
  const cleanAlbum = String(album || '').trim();
  const cleanTrack = String(track || '').trim();
  const cleanQuery = String(query || '').trim();

  const effectiveLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 30));

  if (cleanAlbum || (cleanArtist && !cleanTrack)) {
    const q = cleanAlbum ? (cleanArtist ? `${cleanArtist} ${cleanAlbum}` : cleanAlbum) : cleanArtist;
    try {
      const searchRes = await music.searchAlbums(q, effectiveLimit);
      const albums = searchRes.results || [];
      for (const alb of albums) {
        items.push({
          type: 'album',
          id: alb.id,
          name: alb.name,
          artist: alb.artist,
          album: alb.name,
          releaseYear: alb.releaseYear || year || null,
          releaseDate: alb.releaseDate || new Date().toISOString(),
          trackCount: alb.trackCount || 10,
          genre: alb.genre || 'Music',
        });
      }
    } catch (err) {
      console.error('[lidarr:torznab] Album search error:', err.message);
    }
  } else if (cleanTrack) {
    const q = cleanArtist ? `${cleanArtist} ${cleanTrack}` : cleanTrack;
    try {
      const tracks = await music.searchTracks(q, effectiveLimit);
      for (const t of tracks) {
        items.push({
          type: 'track',
          id: t.collectionId ? `${t.collectionId}-${t.trackNumber}` : `tr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: t.title,
          artist: t.artist,
          album: t.album || 'Single',
          releaseYear: t.releaseYear || year || null,
          releaseDate: t.releaseDate || new Date().toISOString(),
          trackCount: 1,
          genre: t.genre || 'Music',
        });
      }
    } catch (err) {
      console.error('[lidarr:torznab] Track search error:', err.message);
    }
  } else if (cleanQuery) {
    try {
      const [albumRes, trackRes] = await Promise.all([
        music.searchAlbums(cleanQuery, Math.floor(effectiveLimit / 2)).catch(() => ({ results: [] })),
        music.searchTracks(cleanQuery, Math.floor(effectiveLimit / 2)).catch(() => []),
      ]);

      for (const alb of albumRes.results || []) {
        items.push({
          type: 'album',
          id: alb.id,
          name: alb.name,
          artist: alb.artist,
          album: alb.name,
          releaseYear: alb.releaseYear || null,
          releaseDate: alb.releaseDate || new Date().toISOString(),
          trackCount: alb.trackCount || 10,
          genre: alb.genre || 'Music',
        });
      }

      for (const t of trackRes || []) {
        items.push({
          type: 'track',
          id: t.collectionId ? `${t.collectionId}-${t.trackNumber}` : `tr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: t.title,
          artist: t.artist,
          album: t.album || 'Single',
          releaseYear: t.releaseYear || null,
          releaseDate: t.releaseDate || new Date().toISOString(),
          trackCount: 1,
          genre: t.genre || 'Music',
        });
      }
    } catch (err) {
      console.error('[lidarr:torznab] Query search error:', err.message);
    }
  }

  const itemsXml = items.map((item) => {
    const tracksEst = item.trackCount || 10;
    const estSizeBytes = tracksEst * 9 * 1024 * 1024; // ~9MB per 320k track
    const yearStr = item.releaseYear ? ` (${item.releaseYear})` : '';
    const releaseTitle = item.type === 'album'
      ? `${item.artist} - ${item.album}${yearStr} [MP3 320k] [WEB]`
      : `${item.artist} - ${item.name}${yearStr} [MP3 320k] [WEB]`;

    const downloadUrl = `${hostUrl}/api/lidarr/download?type=${item.type}&id=${encodeURIComponent(item.id)}&artist=${encodeURIComponent(item.artist)}&album=${encodeURIComponent(item.album || item.name)}`;
    const guid = `ytdlp-music-${item.type}-${item.id}`;
    const pubDate = new Date(item.releaseDate || Date.now()).toUTCString();

    return `    <item>
      <title>${escapeXml(releaseTitle)}</title>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
      <link>${escapeXml(downloadUrl)}</link>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${escapeXml(downloadUrl)}" length="${estSizeBytes}" type="application/x-bittorrent"/>
      <torznab:attr name="category" value="3000"/>
      <torznab:attr name="category" value="3010"/>
      <torznab:attr name="artist" value="${escapeXml(item.artist)}"/>
      <torznab:attr name="album" value="${escapeXml(item.album || item.name)}"/>
      ${item.releaseYear ? `<torznab:attr name="year" value="${item.releaseYear}"/>` : ''}
      <torznab:attr name="seeders" value="50"/>
      <torznab:attr name="peers" value="10"/>
      <torznab:attr name="size" value="${estSizeBytes}"/>
      <torznab:attr name="downloadvolumefactor" value="0"/>
      <torznab:attr name="uploadvolumefactor" value="1"/>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>yt-dlp Music</title>
    <description>yt-dlp Music Torznab Indexer Feed for Lidarr</description>
    <link>${escapeXml(hostUrl)}</link>
${itemsXml}
  </channel>
</rss>`;
}

async function handleDownloadAdd({ type = 'album', id, artist, album, category = 'music', savePath = null }) {
  const config = getLidarrConfig();
  const musicSettings = music.getMusicSettings();
  const targetFormat = config.format || musicSettings.musicFormat || 'mp3';
  const targetQuality = config.quality || musicSettings.musicQuality || '320k';
  const targetFolder = config.musicFolder || musicSettings.musicFolder || 'Music';

  const baseFolder = String(savePath || targetFolder).trim();
  const resolvedBaseDir = path.isAbsolute(baseFolder)
    ? baseFolder
    : path.join(ytdlp.DOWNLOAD_DIR, baseFolder);

  const hash = getDeterministicHash(type, id);

  const existing = db.prepare('SELECT * FROM lidarr_tasks WHERE hash = ?').get(hash);
  if (existing) {
    return { ok: true, hash, existing: true };
  }

  let albumDetails = null;
  let tracksToDownload = [];
  let title = `${artist || 'Unknown'} - ${album || id}`;
  let contentPath = resolvedBaseDir;

  if (type === 'album') {
    try {
      albumDetails = await music.getAlbumDetails(id);
      if (albumDetails && albumDetails.tracks && albumDetails.tracks.length > 0) {
        title = `${albumDetails.album.artist} - ${albumDetails.album.name}`;
        const artistDir = music.sanitizeFilename(albumDetails.album.artist || 'Unknown Artist');
        const albumDir = music.sanitizeFilename(albumDetails.album.name || 'Album');
        contentPath = path.join(resolvedBaseDir, artistDir, albumDir);

        tracksToDownload = albumDetails.tracks.map((t) => ({
          ...t,
          album: albumDetails.album.name,
          artist: t.artist || albumDetails.album.artist,
          albumArtist: albumDetails.album.artist,
          year: albumDetails.album.releaseYear,
          genre: albumDetails.album.genre,
          artwork: albumDetails.album.artwork,
          totalTracks: albumDetails.tracks.length,
        }));
      }
    } catch (err) {
      console.error(`[lidarr] Failed to fetch album details for id ${id}:`, err.message);
    }
  }

  // Fallback if details could not be retrieved
  if (tracksToDownload.length === 0) {
    tracksToDownload.push({
      title: album || title,
      artist: artist || 'Unknown Artist',
      album: album || 'Unknown Album',
      trackNumber: 1,
      totalTracks: 1,
    });
    contentPath = path.join(resolvedBaseDir, music.sanitizeFilename(artist || 'Unknown Artist'));
  }

  const estSizeBytes = tracksToDownload.length * 9 * 1024 * 1024;

  db.prepare(`
    INSERT INTO lidarr_tasks (
      hash, title, artist, album, type, external_id, total_tracks,
      job_ids, status, save_path, content_path, category, size_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'downloading', ?, ?, ?, ?)
  `).run(
    hash,
    title,
    artist || albumDetails?.album?.artist || null,
    album || albumDetails?.album?.name || null,
    type,
    String(id),
    tracksToDownload.length,
    JSON.stringify([]),
    resolvedBaseDir,
    contentPath,
    category || 'music',
    estSizeBytes
  );

  // Enqueue downloads asynchronously
  (async () => {
    const jobIds = [];
    for (const tr of tracksToDownload) {
      try {
        const job = await music.enqueueMusicDownload({
          track: tr,
          audioFormat: targetFormat,
          audioQuality: targetQuality,
          musicFolder: targetFolder,
          saveCover: true,
        });
        if (job && job.jobId) {
          jobIds.push(job.jobId);
        }
      } catch (err) {
        console.error(`[lidarr] Failed to enqueue track "${tr.title}":`, err.message);
      }
    }

    db.prepare('UPDATE lidarr_tasks SET job_ids = ?, updated_at = datetime(\'now\') WHERE hash = ?')
      .run(JSON.stringify(jobIds), hash);
  })().catch((err) => {
    console.error(`[lidarr] Error processing download batch for ${hash}:`, err.message);
  });

  return { ok: true, hash, title, contentPath };
}

function getQbitTorrents({ category, hashes } = {}) {
  const config = getLidarrConfig();
  let tasks = db.prepare('SELECT * FROM lidarr_tasks ORDER BY created_at DESC').all();

  if (category && category !== 'all') {
    tasks = tasks.filter((t) => !t.category || t.category === category);
  }

  if (hashes) {
    const hashSet = new Set(String(hashes).toLowerCase().split('|'));
    tasks = tasks.filter((t) => hashSet.has(t.hash.toLowerCase()));
  }

  const result = [];
  for (const task of tasks) {
    let jobIds = [];
    try {
      jobIds = JSON.parse(task.job_ids || '[]');
    } catch (_) {}

    let totalPercent = 0;
    let completedCount = 0;
    let failedCount = 0;
    let downloadingCount = 0;

    if (jobIds.length > 0) {
      const placeholders = jobIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT status, percent FROM downloads WHERE id IN (${placeholders})`).all(...jobIds);
      for (const r of rows) {
        totalPercent += r.percent || 0;
        if (r.status === 'completed') completedCount++;
        else if (r.status === 'failed') failedCount++;
        else if (r.status === 'downloading') downloadingCount++;
      }
    }

    const totalExpected = Math.max(task.total_tracks || 1, jobIds.length || 1);
    let progress = totalExpected > 0 ? (totalPercent / (totalExpected * 100)) : 0;
    if (completedCount >= totalExpected && totalExpected > 0) {
      progress = 1.0;
    }

    let state = 'downloading';
    if (progress >= 1.0 || completedCount >= totalExpected) {
      state = 'uploading'; // qBittorrent completion state that triggers Lidarr import
      if (task.status !== 'completed' && task.status !== 'imported') {
        db.prepare("UPDATE lidarr_tasks SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(task.id);
        if (config.autoNotify && config.url && config.apiKey) {
          triggerDownloadedAlbumsScan(task.content_path).catch((err) => {
            console.error(`[lidarr] Auto-notify scan error for ${task.content_path}:`, err.message);
          });
        }
      }
    } else if (failedCount === totalExpected && totalExpected > 0) {
      state = 'error';
    } else if (downloadingCount > 0) {
      state = 'downloading';
    } else {
      state = 'queuedDL';
    }

    const size = task.size_bytes || 50 * 1024 * 1024;
    const amountLeft = Math.max(0, Math.round(size * (1 - progress)));
    const addedOn = Math.floor(new Date(task.created_at).getTime() / 1000);
    const completionOn = state === 'uploading' ? Math.floor(new Date(task.updated_at).getTime() / 1000) : -1;

    result.push({
      hash: task.hash,
      name: task.title,
      size,
      total_size: size,
      progress: Math.min(1.0, Math.max(0, progress)),
      dlspeed: state === 'downloading' ? 1048576 : 0,
      upspeed: 0,
      priority: 0,
      num_seeds: 50,
      num_leechs: 10,
      num_incomplete: 0,
      ratio: 1.0,
      eta: state === 'downloading' ? 30 : 0,
      state,
      seq_dl: true,
      f_l_piece_prio: false,
      category: task.category || 'music',
      super_seeding: false,
      force_start: false,
      save_path: task.save_path,
      content_path: task.content_path,
      added_on: addedOn,
      completion_on: completionOn,
      amount_left: amountLeft,
    });
  }

  return result;
}

function deleteQbitTorrents(hashes) {
  if (!hashes) return;
  const list = String(hashes).split('|');
  const placeholders = list.map(() => '?').join(',');
  db.prepare(`DELETE FROM lidarr_tasks WHERE hash IN (${placeholders})`).run(...list);
}

function getSabQueue() {
  const torrents = getQbitTorrents();
  const active = torrents.filter((t) => t.state !== 'uploading' && t.state !== 'completed');
  
  const slots = active.map((t, idx) => ({
    nzo_id: t.hash,
    filename: t.name,
    size: `${(t.size / (1024 * 1024)).toFixed(1)} MB`,
    sizeleft: `${(t.amount_left / (1024 * 1024)).toFixed(1)} MB`,
    percentage: Math.round(t.progress * 100),
    status: t.state === 'downloading' ? 'Downloading' : 'Queued',
    index: idx,
    cat: t.category,
    timeleft: '00:00:30',
    speed: '1.2 M',
  }));

  return {
    queue: {
      status: active.length > 0 ? 'Downloading' : 'Idle',
      speed: active.length > 0 ? '1200' : '0',
      size: '0',
      sizeleft: '0',
      slots,
    },
  };
}

function getSabHistory() {
  const torrents = getQbitTorrents();
  const finished = torrents.filter((t) => t.state === 'uploading');

  const slots = finished.map((t) => ({
    nzo_id: t.hash,
    name: t.name,
    status: 'COMPLETED',
    storage: t.content_path,
    category: t.category,
    bytes: t.size,
    fail_message: '',
  }));

  return {
    history: {
      slots,
    },
  };
}

// Lidarr REST API Client Functions
async function testConnection(rawUrl, rawApiKey) {
  const config = getLidarrConfig();
  const targetUrl = (rawUrl || config.url || '').trim().replace(/\/+$/, '');
  const targetKey = (rawApiKey !== undefined ? rawApiKey : config.apiKey || '').trim();

  if (!targetUrl) throw new Error('Lidarr URL is required');
  if (!targetKey) throw new Error('Lidarr API Key is required');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${targetUrl}/api/v1/system/status`, {
      headers: {
        'X-Api-Key': targetKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return {
      ok: true,
      appName: data.appName || 'Lidarr',
      version: data.version || 'Unknown',
      branch: data.branch || 'main',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function triggerDownloadedAlbumsScan(albumPath) {
  const config = getLidarrConfig();
  if (!config.enabled || !config.url || !config.apiKey) return { skipped: true };

  const targetUrl = config.url.trim().replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${targetUrl}/api/v1/command`, {
      method: 'POST',
      headers: {
        'X-Api-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'DownloadedAlbumsScan',
        path: albumPath,
        importMode: 'Move',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getWantedMissing({ page = 1, pageSize = 30 } = {}) {
  const config = getLidarrConfig();
  if (!config.url || !config.apiKey) throw new Error('Lidarr is not configured');

  const targetUrl = config.url.trim().replace(/\/+$/, '');
  const url = `${targetUrl}/api/v1/wanted/missing?page=${page}&pageSize=${pageSize}&sortKey=airDateUtc&sortDirection=descending`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      headers: { 'X-Api-Key': config.apiKey, Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getArtists() {
  const config = getLidarrConfig();
  if (!config.url || !config.apiKey) throw new Error('Lidarr is not configured');

  const targetUrl = config.url.trim().replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${targetUrl}/api/v1/artist`, {
      headers: { 'X-Api-Key': config.apiKey, Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function notifyDownloadComplete(job, result) {
  const config = getLidarrConfig();
  if (!config.enabled || !config.autoNotify || !config.url || !config.apiKey) return;

  try {
    const filepath = result?.filepath;
    if (filepath) {
      const albumDir = path.dirname(filepath);
      await triggerDownloadedAlbumsScan(albumDir);
      console.log(`[lidarr] Triggered DownloadedAlbumsScan for completed music folder: ${albumDir}`);
    }
  } catch (err) {
    console.error(`[lidarr] Failed to notify Lidarr of completed download: ${err.message}`);
  }
}

module.exports = {
  bencode,
  escapeXml,
  getDeterministicHash,
  generateTorrentBuffer,
  getLidarrConfig,
  updateLidarrConfig,
  validateTorznabApiKey,
  getCapsXml,
  searchTorznab,
  handleDownloadAdd,
  getQbitTorrents,
  deleteQbitTorrents,
  getSabQueue,
  getSabHistory,
  testConnection,
  triggerDownloadedAlbumsScan,
  getWantedMissing,
  getArtists,
  notifyDownloadComplete,
};
