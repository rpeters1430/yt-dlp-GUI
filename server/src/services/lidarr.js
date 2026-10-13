const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const music = require('./music');
const ytdlp = require('./ytdlp');
const { resolveMusicDir } = require('./ytdlpPaths');

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

function bdecode(buf) {
  let pos = 0;

  function parseNext() {
    if (pos >= buf.length) return null;
    const byte = buf[pos];

    if (byte === 0x69) { // 'i'
      pos++;
      const end = buf.indexOf(0x65, pos); // 'e'
      if (end === -1) throw new Error('Unterminated integer');
      const val = parseInt(buf.toString('ascii', pos, end), 10);
      pos = end + 1;
      return val;
    }

    if (byte === 0x6c) { // 'l'
      pos++;
      const list = [];
      while (pos < buf.length && buf[pos] !== 0x65) {
        list.push(parseNext());
      }
      pos++; // skip 'e'
      return list;
    }

    if (byte === 0x64) { // 'd'
      pos++;
      const dict = {};
      while (pos < buf.length && buf[pos] !== 0x65) {
        const key = parseNext();
        const keyStr = Buffer.isBuffer(key) ? key.toString('utf8') : String(key);
        dict[keyStr] = parseNext();
      }
      pos++; // skip 'e'
      return dict;
    }

    if (byte >= 0x30 && byte <= 0x39) { // '0' - '9'
      const colon = buf.indexOf(0x3a, pos); // ':'
      if (colon === -1) throw new Error('Invalid bencoded string length');
      const len = parseInt(buf.toString('ascii', pos, colon), 10);
      const start = colon + 1;
      const end = start + len;
      if (end > buf.length) throw new Error('Unexpected EOF reading string');
      const slice = buf.subarray(start, end);
      pos = end;
      return slice;
    }

    throw new Error(`Unexpected character at ${pos}: ${String.fromCharCode(byte)}`);
  }

  return parseNext();
}

// BitTorrent infohash: SHA-1 of the raw bencoded `info` dict. Lidarr computes this from the
// .torrent file it grabbed and stores it as the download ID in its history, then matches the
// hashes qBittorrent reports against it. If our hash differs, Lidarr can't link the download to
// the release it grabbed and falls back to parsing the name ("Artist name mismatch").
function getInfoHash(buf) {
  if (!Buffer.isBuffer(buf) || buf[0] !== 0x64) return null;
  let pos = 0;

  function readStringEnd() {
    const colon = buf.indexOf(0x3a, pos);
    if (colon === -1) throw new Error('Invalid bencoded string length');
    const end = colon + 1 + parseInt(buf.toString('ascii', pos, colon), 10);
    if (end > buf.length) throw new Error('Unexpected EOF reading string');
    return { start: colon + 1, end };
  }

  function skip() {
    const byte = buf[pos];
    if (byte === 0x69) { // 'i'
      const end = buf.indexOf(0x65, pos);
      if (end === -1) throw new Error('Unterminated integer');
      pos = end + 1;
    } else if (byte === 0x6c || byte === 0x64) { // 'l' / 'd'
      pos++;
      while (pos < buf.length && buf[pos] !== 0x65) skip();
      if (pos >= buf.length) throw new Error('Unterminated list/dict');
      pos++;
    } else if (byte >= 0x30 && byte <= 0x39) {
      pos = readStringEnd().end;
    } else {
      throw new Error(`Unexpected character at ${pos}`);
    }
  }

  try {
    pos = 1;
    while (pos < buf.length && buf[pos] !== 0x65) {
      const key = readStringEnd();
      const keyStr = buf.toString('utf8', key.start, key.end);
      pos = key.end;
      const valueStart = pos;
      skip();
      if (keyStr === 'info') {
        return crypto.createHash('sha1').update(buf.subarray(valueStart, pos)).digest('hex');
      }
    }
  } catch (err) {
    console.error('[lidarr:torrent] Error computing infohash:', err.message);
  }
  return null;
}

// The hash Lidarr will expect for a release served by our /download endpoint. Used when Lidarr
// hands us the URL instead of uploading the .torrent file, so both paths agree on the hash.
function computeReleaseHash({ type = 'album', id, artist, album, track }) {
  return getInfoHash(generateTorrentBuffer({ type, id, artist, album, track }))
    || getDeterministicHash(type, id);
}

function parseTorrentBuffer(buf) {
  try {
    const decoded = bdecode(buf);
    if (!decoded || !decoded.info) return null;
    const info = decoded.info;
    const getString = (val) => (Buffer.isBuffer(val) ? val.toString('utf8') : String(val || ''));
    return {
      name: getString(info.name),
      id: getString(info.ytdlp_id),
      type: getString(info.ytdlp_type) || 'album',
      artist: getString(info.ytdlp_artist),
      album: getString(info.ytdlp_album),
      track: getString(info.ytdlp_track),
      infoHash: getInfoHash(buf),
    };
  } catch (err) {
    console.error('[lidarr:torrent] Error decoding torrent buffer:', err.message);
    return null;
  }
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

function generateTorrentBuffer({ type, id, artist, album, track, title, sizeBytes, announceUrl }) {
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
    ytdlp_album: album || '',
    ytdlp_artist: artist || '',
    ytdlp_id: String(id),
    ytdlp_type: type || 'album',
  };
  // Only present for single-track releases so album infohashes stay unchanged.
  if (track) infoDict.ytdlp_track = String(track);

  const torrentDict = {
    announce: announceUrl || 'http://localhost/announce',
    'created by': 'yt-dlp-gui',
    'creation date': Math.floor(Date.now() / 1000),
    info: infoDict,
  };

  return bencode(torrentDict);
}

function normalizeMusicFolder(folder) {
  const downloadDir = (process.env.DOWNLOAD_DIR || ytdlp.DOWNLOAD_DIR || '/downloads').replace(/\\/g, '/');
  const basePrefix = downloadDir.startsWith('/') ? downloadDir : '/downloads';

  if (!folder || folder === 'Music') {
    return `${basePrefix.replace(/\/+$/, '')}/Music`;
  }

  const str = String(folder).trim().replace(/\\/g, '/');
  if (str.startsWith('/')) {
    return str;
  }

  const clean = str.replace(/^[a-zA-Z]:[/\\]*/, '').replace(/^\/+/, '');
  return `${basePrefix.replace(/\/+$/, '')}/${clean || 'Music'}`;
}

const LOSSLESS_FORMATS = new Set(['flac', 'alac', 'wav']);
const DEFAULT_KBPS = { mp3: 320, m4a: 256, aac: 256, opus: 160, vorbis: 192, flac: 900, alac: 900, wav: 1411 };
// Deliberately short: Lidarr rejects a release bigger than its quality's max bitrate times the
// album's real duration (MP3-320 allows only 350 kbps), and has no minimum size by default, so
// the estimate must not overshoot for albums of short tracks. The real size replaces it once
// the download finishes.
const AVG_TRACK_SECONDS = 120;

// Describes what we'll actually produce, so Lidarr's quality parser and size checks see the
// configured format instead of a hardcoded "MP3 320k".
function describeReleaseFormat(format, quality) {
  const fmt = String(format || 'mp3').toLowerCase();
  const lossless = LOSSLESS_FORMATS.has(fmt);
  const match = String(quality || '').match(/^(\d+)k$/i);
  const kbps = !lossless && match ? parseInt(match[1], 10) : (DEFAULT_KBPS[fmt] || 256);
  const names = { mp3: 'MP3', m4a: 'AAC', aac: 'AAC', opus: 'Opus', vorbis: 'OGG Vorbis', flac: 'FLAC', alac: 'ALAC', wav: 'WAV' };
  const name = names[fmt] || fmt.toUpperCase();
  return {
    label: lossless || !match ? name : `${name} ${kbps}`,
    category: lossless ? 3040 : 3010,
    bytesPerTrack: Math.round((kbps * 1000 / 8) * AVG_TRACK_SECONDS),
  };
}

function estimateReleaseSize(trackCount, format, quality) {
  return Math.max(1, trackCount || 1) * describeReleaseFormat(format, quality).bytesPerTrack;
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
    musicFolder: normalizeMusicFolder(map.lidarr_music_folder),
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
  if (updates.musicFolder !== undefined) upsert.run('lidarr_music_folder', normalizeMusicFolder(updates.musicFolder));
  if (updates.category !== undefined) upsert.run('lidarr_category', String(updates.category).trim() || 'music');
  if (updates.format !== undefined) upsert.run('lidarr_format', String(updates.format).trim() || 'mp3');
  if (updates.quality !== undefined) upsert.run('lidarr_quality', String(updates.quality).trim() || '320k');

  return getLidarrConfig();
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function validateTorznabApiKey(providedKey) {
  if (!providedKey) return false;
  const config = getLidarrConfig();
  return safeEqual(providedKey, config.torznabApiKey) || (!!config.apiKey && safeEqual(providedKey, config.apiKey));
}

function getCapsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server version="1.0" title="yt-dlp-music" strapline="yt-dlp Music Torznab Indexer for Lidarr"/>
  <limits max="50" default="50"/>
  <registration available="no" open="no"/>
  <searching>
    <search available="yes" supportedParams="q" searchEngine="raw"/>
    <audio-search available="yes" supportedParams="q,artist,album,track" searchEngine="raw"/>
  </searching>
  <categories>
    <category id="3000" name="Audio">
      <subcat id="3010" name="Audio/MP3"/>
      <subcat id="3040" name="Audio/Lossless"/>
    </category>
  </categories>
</caps>`;
}

function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// iTunes adds release-type and edition labels; Lidarr asks for the plain title.
function albumTitleMatches(name, wanted) {
  const target = normalizeTitle(wanted);
  if (!target) return false;
  const base = String(name || '')
    .replace(/\s+-\s+(single|ep)$/i, '')
    .replace(/\s*[[(](?:\d{4}\s+)?(?:(?:deluxe|special|expanded|anniversary)\s+edition|remaster(?:ed)?(?:\s+(?:edition|version))?)[)\]]\s*$/i, '');
  return normalizeTitle(name) === target || normalizeTitle(base) === target;
}

// Lidarr's monitored catalog supplies compilations absent from the iTunes storefront.
// Keep this source in the release ID so downloading uses the same track list as the grab.
async function fetchLidarrResource(resource) {
  const config = getLidarrConfig();
  if (!config.url || !config.apiKey) throw new Error('Lidarr is not configured');
  const res = await fetch(`${config.url.replace(/\/+$/, '')}/api/v1/${resource}`, {
    headers: { 'X-Api-Key': config.apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function searchLidarrAlbums({ artist, album, query }) {
  if (!getLidarrConfig().apiKey) return [];
  const artists = await fetchLidarrResource('artist');
  const matches = artists.filter((a) => artist
    ? normalizeTitle(a.artistName) === normalizeTitle(artist)
    : normalizeTitle(query).startsWith(normalizeTitle(a.artistName)));
  const catalogs = await Promise.all(matches.map(async (a) => {
    const albums = await fetchLidarrResource(`album?artistId=${a.id}`);
    return albums.filter((b) => album ? albumTitleMatches(b.title, album)
      : normalizeTitle(query) === normalizeTitle(`${a.artistName} ${b.title}`))
      .map((b) => ({
        id: `lidarr-${b.id}`, name: b.title, artist: a.artistName,
        releaseYear: b.releaseDate?.slice(0, 4), releaseDate: b.releaseDate,
        trackCount: b.releases?.find((r) => r.monitored)?.trackCount || 10,
      }));
  }));
  return catalogs.flat();
}

async function getLidarrAlbumDetails(id) {
  if (!/^lidarr-\d+$/.test(String(id))) throw new Error('Invalid Lidarr album ID');
  const albumId = String(id).slice(7);
  const record = await fetchLidarrResource(`album/${albumId}`);
  const release = record.releases?.find((r) => r.monitored);
  if (!release) throw new Error('Album has no monitored release');
  // TrackResource has no albumReleaseId; request the selected release explicitly.
  const [artist, allTracks] = await Promise.all([
    fetchLidarrResource(`artist/${record.artistId}`),
    fetchLidarrResource(`track?albumReleaseId=${release.id}`),
  ]);
  const selected = allTracks.sort((a, b) => (a.mediumNumber || 1) - (b.mediumNumber || 1)
      || Number(a.absoluteTrackNumber || a.trackNumber) - Number(b.absoluteTrackNumber || b.trackNumber));
  if (!selected.length || (release.trackCount && selected.length !== release.trackCount)) {
    throw new Error('Album track list incomplete');
  }
  const album = {
    name: record.title, artist: artist.artistName,
    releaseYear: record.releaseDate?.slice(0, 4), releaseDate: record.releaseDate,
    genre: record.genres?.[0] || artist.genres?.[0],
    artwork: record.images?.find((i) => i.coverType === 'cover')?.remoteUrl || null,
    trackCount: selected.length,
  };
  const totalDiscs = Math.max(...selected.map((t) => t.mediumNumber || 1));
  return { album, tracks: selected.map((t) => ({
    title: t.title, artist: artist.artistName, albumArtist: artist.artistName,
    album: album.name, trackNumber: Number(t.trackNumber) || t.absoluteTrackNumber,
    discNumber: t.mediumNumber || 1, totalDiscs, totalTracks: selected.length,
    duration: t.duration ? Math.round(t.duration / 1000) : null,
  })) };
}

async function searchTorznab({ query = '', artist = '', album = '', track = '', year = '', limit = 50, offset = 0, categories = '', hostUrl = '', apiKey = '' }) {
  const config = getLidarrConfig();
  const releaseFormat = describeReleaseFormat(config.format, config.quality);
  // Lidarr fetches the .torrent from the link as-is, so it has to carry the key itself.
  const keyParam = apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : '';
  const items = [];
  const cleanArtist = String(artist || '').trim();
  const cleanAlbum = String(album || '').trim();
  const cleanTrack = String(track || '').trim();
  const cleanQuery = String(query || '').trim();

  // Build the same candidate set on every page; limit only controls slicing.
  const effectiveLimit = 50;
  const allowedCategories = !categories || String(categories).split(',').some((c) =>
    Number(c) === 3000 || Number(c) === releaseFormat.category);

  if (!allowedCategories) {
    // Requested categories do not contain our configured audio format.
  } else if (cleanAlbum || (cleanArtist && !cleanTrack)) {
    const q = cleanAlbum ? (cleanArtist ? `${cleanArtist} ${cleanAlbum}` : cleanAlbum) : cleanArtist;
    try {
      // iTunes keyword search ranks by popularity and often omits the wanted album entirely
      // ("Incubus 8" never returns "8"), so the artist's own catalog is the primary source and
      // the keyword results only fill in whatever the catalog lookup doesn't cover.
      const [artistRes, albumRes] = await Promise.all([
        cleanArtist ? music.searchAlbums(cleanArtist, effectiveLimit) : null,
        cleanAlbum ? music.searchAlbums(q, effectiveLimit, { includeArtist: false }) : null,
      ]);
      let catalog = artistRes?.matchedArtist?.all || [];
      if (cleanAlbum) catalog = catalog.filter((alb) => albumTitleMatches(alb.name, cleanAlbum));
      const seenIds = new Set();
      let albums = [...catalog, ...((albumRes || artistRes)?.results || [])].filter((alb) => {
        if (seenIds.has(String(alb.id))) return false;
        seenIds.add(String(alb.id));
        return true;
      });
      // Never expose a title-track single, live edition or unrelated keyword result
      // as the requested album, even when the external catalog misses the full release.
      if (cleanAlbum) {
        albums = albums.filter((alb) => albumTitleMatches(alb.name, cleanAlbum)
          && (!cleanArtist || normalizeTitle(alb.artist) === normalizeTitle(cleanArtist))
          && Number(alb.trackCount) > 1);
        if (!albums.length) {
          albums = await searchLidarrAlbums({ artist: cleanArtist, album: cleanAlbum });
        }
      }
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
      const albumRes = await music.searchAlbums(cleanQuery, effectiveLimit);
      // q-only searches are also used for album grabs. Returning songs here allows
      // Lidarr to accept a title track from an entirely different album.
      let albums = [...(albumRes.matchedArtist?.all || []), ...(albumRes.results || [])];
      const seen = new Set();
      albums = albums.filter((alb) => {
        if (seen.has(String(alb.id)) || Number(alb.trackCount) <= 1) return false;
        seen.add(String(alb.id));
        const q = normalizeTitle(cleanQuery);
        const a = normalizeTitle(alb.artist);
        return q === a || albumTitleMatches(alb.name, cleanQuery)
          || (a && q.startsWith(a) && albumTitleMatches(alb.name, q.slice(a.length)));
      });
      if (!albums.length) albums = await searchLidarrAlbums({ query: cleanQuery });
      for (const alb of albums) {
        items.push({
          type: 'album', id: alb.id, name: alb.name, artist: alb.artist, album: alb.name,
          releaseYear: alb.releaseYear || null,
          releaseDate: alb.releaseDate || new Date().toISOString(),
          trackCount: alb.trackCount || 10, genre: alb.genre || 'Music',
        });
      }
    } catch (err) {
      console.error('[lidarr:torznab] Query search error:', err.message);
    }
  } else {
    // When no specific search terms are provided (such as Lidarr's Test Indexer probe or RSS sync),
    // return sample music releases so Lidarr's category validation test passes with 100% success.
    try {
      const topAlbums = await music.searchAlbums('Hits', Math.min(20, effectiveLimit));
      for (const alb of topAlbums.results || []) {
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
    } catch (err) {
      console.error('[lidarr:torznab] Sample search error:', err.message);
    }
  }

  // A full catalog can exceed one page; honour offset so Lidarr's paging terminates.
  const pageSize = Math.min(50, Math.max(1, parseInt(limit, 10) || 50));
  const pageStart = Math.max(0, parseInt(offset, 10) || 0);
  const pageItems = items.slice(pageStart, pageStart + pageSize);

  const itemsXml = pageItems.map((item) => {
    const estSizeBytes = estimateReleaseSize(item.trackCount, config.format, config.quality);
    const yearStr = item.releaseYear ? ` (${item.releaseYear})` : '';
    const releaseTitle = item.type === 'album'
      ? `${item.artist} - ${item.album}${yearStr} [${releaseFormat.label}] [WEB]`
      : `${item.artist} - ${item.name}${yearStr} [${releaseFormat.label}] [WEB]`;

    const trackParam = item.type === 'track' ? `&track=${encodeURIComponent(item.name)}` : '';
    const downloadUrl = `${hostUrl}/api/lidarr/download?type=${item.type}&id=${encodeURIComponent(item.id)}&artist=${encodeURIComponent(item.artist)}&album=${encodeURIComponent(item.album || item.name)}${trackParam}${keyParam}`;
    const guid = `ytdlp-music-${item.type}-${item.id}`;
    const pubDate = new Date(item.releaseDate || Date.now()).toUTCString();

    // A single seeder: there is no swarm, the release is always "available", and Lidarr's
    // default minimum-seeders check (1) passes without inflating the numbers.
    return `    <item>
      <title>${escapeXml(releaseTitle)}</title>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
      <link>${escapeXml(downloadUrl)}</link>
      <pubDate>${pubDate}</pubDate>
      <size>${estSizeBytes}</size>
      <category>3000</category>
      <category>${releaseFormat.category}</category>
      <enclosure url="${escapeXml(downloadUrl)}" length="${estSizeBytes}" type="application/x-bittorrent"/>
      <torznab:attr name="category" value="3000"/>
      <torznab:attr name="category" value="${releaseFormat.category}"/>
      <torznab:attr name="artist" value="${escapeXml(item.artist)}"/>
      <torznab:attr name="album" value="${escapeXml(item.album || item.name)}"/>
      ${item.releaseYear ? `<torznab:attr name="year" value="${item.releaseYear}"/>` : ''}
      <torznab:attr name="seeders" value="1"/>
      <torznab:attr name="peers" value="1"/>
      <torznab:attr name="size" value="${estSizeBytes}"/>
      <torznab:attr name="downloadvolumefactor" value="0"/>
      <torznab:attr name="uploadvolumefactor" value="1"/>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
  <channel>
    <newznab:response offset="${pageStart}" total="${items.length}"/>
    <title>yt-dlp Music</title>
    <description>yt-dlp Music Torznab Indexer Feed for Lidarr</description>
    <link>${escapeXml(hostUrl)}</link>
${itemsXml}
  </channel>
</rss>`;
}

// Mirrors enqueueMusicDownload's <base>/<album artist>/<album> layout so the content_path we
// report to Lidarr is the folder the files actually land in.
function musicContentPath(baseDir, artist, album) {
  const artistDir = music.sanitizeFilename(artist || 'Unknown Artist');
  const albumName = album && String(album).trim();
  return albumName
    ? path.join(baseDir, artistDir, music.sanitizeFilename(albumName))
    : path.join(baseDir, artistDir);
}

// iTunes rate-limits lookups (403/429), most often while Lidarr grabs several albums at once.
const ALBUM_LOOKUP_RETRY_DELAYS_MS = [2000, 5000];
const TRACK_MATCH_CONCURRENCY = 3;
async function getAlbumDetailsWithRetry(id, delaysMs = ALBUM_LOOKUP_RETRY_DELAYS_MS) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await (String(id).startsWith('lidarr-') ? getLidarrAlbumDetails(id) : music.getAlbumDetails(id));
    } catch (err) {
      if (attempt >= delaysMs.length || err.message === 'Album not found') throw err;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

async function handleDownloadAdd({ type = 'album', id, artist, album, track = null, hash = null, category = 'music', savePath = null }) {
  if (!id || !['album', 'track'].includes(type)) return { ok: false, error: 'Invalid release' };
  const config = getLidarrConfig();
  const musicSettings = music.getMusicSettings();
  const targetFormat = config.format || musicSettings.musicFormat || 'mp3';
  const targetQuality = config.quality || musicSettings.musicQuality || '320k';
  const targetFolder = config.musicFolder || musicSettings.musicFolder || 'Music';

  const categoryPath = getQbitCategories()[category]?.savePath;
  const resolvedBaseDir = resolveMusicDir(savePath || categoryPath || targetFolder);

  hash = String(hash || computeReleaseHash({ type, id, artist, album, track })).toLowerCase();

  const existing = db.prepare('SELECT * FROM lidarr_tasks WHERE hash = ?').get(hash);
  if (existing) {
    return { ok: existing.status !== 'failed', hash, existing: true };
  }

  let albumDetails = null;
  let tracksToDownload = [];
  let title = `${artist || 'Unknown'} - ${album || id}`;
  let contentPath = resolvedBaseDir;

  if (type === 'album') {
    try {
      albumDetails = await getAlbumDetailsWithRetry(id);
      if (albumDetails && albumDetails.tracks && albumDetails.tracks.length > 0) {
        const year = albumDetails.album.releaseYear ? ` (${albumDetails.album.releaseYear})` : '';
        title = `${albumDetails.album.artist} - ${albumDetails.album.name}${year}`;
        contentPath = musicContentPath(resolvedBaseDir, albumDetails.album.artist, albumDetails.album.name || 'Album');

        tracksToDownload = albumDetails.tracks.map((t) => ({
          ...t,
          album: albumDetails.album.name || 'Album',
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

  // An album grab without a track list can't be downloaded: falling back to a single search
  // for the album's name fetches its title track (or an unrelated song) as the "album". Report
  // it failed instead, so Lidarr blocklists this grab and can search again.
  if (type === 'album' && tracksToDownload.length === 0) {
    db.prepare(`
      INSERT INTO lidarr_tasks (
        hash, title, artist, album, type, external_id, total_tracks,
        job_ids, status, save_path, content_path, category, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, 0, '[]', 'failed', ?, ?, ?, 0)
    `).run(hash, title, artist || null, album || null, type, String(id), resolvedBaseDir,
      musicContentPath(resolvedBaseDir, artist, album || 'Unknown Album'), category || 'music');
    return { ok: false, hash, title, error: 'Album track list unavailable' };
  }

  // Single-track releases need no lookup.
  if (tracksToDownload.length === 0) {
    const fallbackAlbum = album || 'Unknown Album';
    tracksToDownload.push({
      title: track || album || title,
      artist: artist || 'Unknown Artist',
      album: fallbackAlbum,
      trackNumber: 1,
      totalTracks: 1,
    });
    if (track) title = `${artist || 'Unknown'} - ${track}`;
    contentPath = musicContentPath(resolvedBaseDir, artist, fallbackAlbum);
  }

  const estSizeBytes = estimateReleaseSize(tracksToDownload.length, targetFormat, targetQuality);

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

  // Enqueue downloads asynchronously. Matching a track runs YouTube searches that take
  // seconds each, so a few tracks are matched side by side; job order follows the album.
  (async () => {
    const slots = new Array(tracksToDownload.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < tracksToDownload.length) {
        const index = next++;
        const tr = tracksToDownload[index];
        // Lidarr removed the grab while its tracks were still being matched.
        if (!getTaskByHash(hash)) return;
        try {
          const job = await music.enqueueMusicDownload({
            track: tr,
            audioFormat: targetFormat,
            audioQuality: targetQuality,
            // Same base dir as the reported save/content path (Lidarr may send its own savepath).
            musicFolder: resolvedBaseDir,
            saveCover: true,
            // Lidarr imports these itself via the download client; skip the per-track scan.
            extraOptions: { lidarrHash: hash },
          });
          if (job && job.jobId) slots[index] = job.jobId;
        } catch (err) {
          console.error(`[lidarr] Failed to enqueue track "${tr.title}":`, err.message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TRACK_MATCH_CONCURRENCY, tracksToDownload.length) }, worker));
    const jobIds = slots.filter(Boolean);

    // Leaving 'downloading' marks the batch as fully enqueued, so getQbitTorrents knows how
    // many jobs to wait for even if some tracks couldn't be matched.
    const updated = db.prepare(`UPDATE lidarr_tasks SET job_ids = ?, status = ?, updated_at = datetime('now') WHERE hash = ?`)
      .run(JSON.stringify(jobIds), jobIds.length > 0 ? 'enqueued' : 'failed', hash);
    if (updated.changes === 0) {
      const queue = require('./queue');
      for (const jobId of jobIds) queue.removeJob(jobId);
    }
  })().catch((err) => {
    console.error(`[lidarr] Error processing download batch for ${hash}:`, err.message);
  });

  return { ok: true, hash, title, contentPath };
}

function getQbitTorrents({ category, hashes, filter } = {}) {
  let tasks = db.prepare('SELECT * FROM lidarr_tasks ORDER BY created_at DESC').all();

  if (category && category !== 'all') {
    tasks = tasks.filter((t) => (t.category ?? 'music') === category);
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
        totalPercent += r.status === 'completed' ? 100 : (r.percent || 0);
        if (r.status === 'completed') completedCount++;
        else if (r.status === 'failed') failedCount++;
        else if (r.status === 'downloading') downloadingCount++;
      }
      // Jobs removed from the download queue will never finish; count them as failed.
      failedCount += jobIds.length - rows.length;
    }

    // job_ids is written once, together with the status change, after every track was enqueued.
    // (Older rows stayed 'downloading' but already have job_ids.)
    const enqueueDone = task.status !== 'downloading' || jobIds.length > 0;
    const expected = Math.max(task.total_tracks || 1, jobIds.length, 1);
    if (enqueueDone) failedCount += Math.max(0, expected - jobIds.length);
    const allTerminal = enqueueDone && completedCount + failedCount >= expected;

    let progress = totalPercent / (Math.max(task.total_tracks || 1, expected, 1) * 100);
    let state;
    if (allTerminal && completedCount === expected && failedCount === 0) {
      // The adapter has no swarm to seed. Paused + zero seed goal permits Lidarr cleanup.
      state = 'pausedUP';
      progress = 1.0;
      if (task.status !== 'completed' && task.status !== 'imported') {
        const actualSize = listContentFiles(task).reduce((sum, f) => sum + f.size, 0);
        if (actualSize > 0) task.size_bytes = actualSize;
        db.prepare("UPDATE lidarr_tasks SET status = 'completed', size_bytes = ?, updated_at = datetime('now') WHERE id = ?")
          .run(task.size_bytes || 0, task.id);
      }
    } else if (allTerminal) {
      state = 'error';
    } else if (downloadingCount > 0) {
      state = 'downloading';
    } else {
      state = 'queuedDL';
    }

    const size = task.size_bytes || 50 * 1024 * 1024;
    const amountLeft = Math.max(0, Math.round(size * (1 - progress)));
    // SQLite datetime('now') is UTC without a zone suffix; without the Z it parses as local time.
    const addedOn = Math.floor(new Date(`${task.created_at}Z`).getTime() / 1000);
    const completionOn = state === 'pausedUP' ? Math.floor(new Date(`${task.updated_at}Z`).getTime() / 1000) : -1;

    result.push({
      hash: task.hash,
      name: task.title,
      size,
      total_size: size,
      progress: Math.min(1.0, Math.max(0, progress)),
      dlspeed: 0, // Aggregate transfer speed is unavailable during matching and tagging.
      upspeed: 0,
      priority: 0,
      num_seeds: 1,
      num_leechs: 0,
      num_incomplete: 0,
      ratio: 0,
      ratio_limit: 0,
      seeding_time: 0,
      seeding_time_limit: 0,
      eta: state === 'pausedUP' ? 0 : 8640000, // qBittorrent's unknown-ETA sentinel.
      state,
      seq_dl: true,
      f_l_piece_prio: false,
      category: task.category ?? 'music',
      super_seeding: false,
      force_start: false,
      save_path: normalizeMusicFolder(task.save_path).replace(/\\/g, '/'),
      content_path: normalizeMusicFolder(task.content_path).replace(/\\/g, '/'),
      added_on: addedOn,
      completion_on: completionOn,
      amount_left: amountLeft,
    });
  }

  return result.filter((torrent) => {
    if (!filter || filter === 'all') return true;
    if (filter === 'completed' || filter === 'paused') return torrent.state === 'pausedUP';
    if (filter === 'downloading') return ['downloading', 'queuedDL'].includes(torrent.state);
    if (filter === 'errored') return torrent.state === 'error';
    if (filter === 'seeding') return false;
    return true;
  });
}

function setQbitTorrentCategory(hashes, category) {
  if (category && !getQbitCategories()[category]) return false;
  const list = String(hashes || '').toLowerCase().split('|').filter(Boolean);
  if (!list.length) return false;
  const update = db.prepare('UPDATE lidarr_tasks SET category = ? WHERE hash = ?');
  for (const hash of list) update.run(category || '', hash);
  return true;
}

// Files under the task's content folder, named relative to its save path the way qBittorrent
// names a multi-file torrent's files (e.g. "Artist/Album/01 - Title.mp3").
function listContentFiles(task) {
  const root = task.content_path;
  const base = task.save_path || path.dirname(root || '');
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && !/\.(part|ytdl|temp)$/i.test(entry.name)) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch (_) {}
        files.push({ name: path.relative(base, full).replace(/\\/g, '/'), size });
      }
    }
  };
  if (root) walk(root);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function getTaskByHash(hash) {
  if (!hash) return null;
  return db.prepare('SELECT * FROM lidarr_tasks WHERE hash = ?').get(String(hash).toLowerCase()) || null;
}

function getQbitTorrentFiles(hash) {
  const task = getTaskByHash(hash);
  if (!task) return null;
  const done = task.status === 'completed' || task.status === 'imported';
  return listContentFiles(task).map((f, index) => ({
    index,
    name: f.name,
    size: f.size,
    progress: done ? 1 : 0,
    priority: 1,
    is_seed: done,
    piece_range: [0, 0],
    availability: 1,
  }));
}

function getQbitTorrentProperties(hash) {
  if (!hash) return null;
  const torrent = getQbitTorrents({ hashes: hash })[0];
  if (!torrent) return null;
  return {
    save_path: torrent.save_path,
    total_size: torrent.size,
    total_downloaded: Math.round(torrent.size * torrent.progress),
    pieces_num: Math.max(1, Math.ceil(torrent.size / 262144)),
    piece_size: 262144,
    addition_date: torrent.added_on,
    completion_date: torrent.completion_on,
    seeding_time: 0,
    share_ratio: torrent.ratio,
    eta: torrent.eta,
    dl_speed: torrent.dlspeed,
    up_speed: 0,
    seeds: torrent.num_seeds,
    peers: torrent.num_leechs,
  };
}

// Lidarr removes a grab it gave up on (failed, blocklisted, or removed by the user): stop its
// tracks that haven't finished so they don't keep downloading into the library. Finished files
// stay where they are.
function deleteQbitTorrents(hashes, deleteFiles = false) {
  if (!hashes) return;
  const list = String(hashes).toLowerCase().split('|').filter(Boolean);
  if (list.length === 0) return;
  const placeholders = list.map(() => '?').join(',');
  const tasks = db.prepare(`SELECT job_ids, content_path FROM lidarr_tasks WHERE hash IN (${placeholders})`).all(...list);
  db.prepare(`DELETE FROM lidarr_tasks WHERE hash IN (${placeholders})`).run(...list);
  const queue = require('./queue');
  for (const task of tasks) {
    let jobIds = [];
    try { jobIds = JSON.parse(task.job_ids || '[]'); } catch (_) {}
    for (const jobId of jobIds) {
      const job = queue.getJobSummary(jobId);
      if (job && (job.status === 'queued' || job.status === 'downloading')) queue.removeJob(jobId);
      // Delete only finished files recorded for this grab, never an entire shared album folder.
      if (deleteFiles && job?.filepath && job.status === 'completed' && task.content_path) {
        try {
          const root = fs.realpathSync(task.content_path);
          const file = fs.realpathSync(job.filepath);
          const relative = path.relative(root, file);
          if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) fs.unlinkSync(file);
        } catch (err) {
          if (err.code !== 'ENOENT') console.error('[lidarr:qbit] Failed to delete downloaded file:', err.message);
        }
      }
    }
  }
}

function getSabQueue() {
  const torrents = getQbitTorrents();
  const active = torrents.filter((t) => !['pausedUP', 'error'].includes(t.state));
  
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
  const finished = torrents.filter((t) => ['pausedUP', 'error'].includes(t.state));

  const slots = finished.map((t) => ({
    nzo_id: t.hash,
    name: t.name,
    status: t.state === 'error' ? 'Failed' : 'Completed',
    storage: t.content_path,
    category: t.category,
    bytes: t.size,
    fail_message: t.state === 'error' ? 'One or more album tracks failed' : '',
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
  const url = `${targetUrl}/api/v1/wanted/missing?page=${page}&pageSize=${pageSize}`;

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

// Album downloads finish one track at a time; wait for the folder to go quiet before asking
// Lidarr to scan it, otherwise it imports (and moves) a partial album.
const SCAN_DEBOUNCE_MS = 60 * 1000;
const pendingScans = new Map();

function notifyDownloadComplete(job, result, extraOptions = {}) {
  const config = getLidarrConfig();
  if (!config.enabled || !config.autoNotify || !config.url || !config.apiKey) return;
  // Lidarr-grabbed downloads are imported by Lidarr's own completed-download handling.
  if (extraOptions.lidarrHash) return;

  const filepath = result?.filepath;
  if (!filepath) return;
  const albumDir = path.dirname(filepath);

  clearTimeout(pendingScans.get(albumDir));
  const timer = setTimeout(() => {
    pendingScans.delete(albumDir);
    triggerDownloadedAlbumsScan(albumDir)
      .then(() => console.log(`[lidarr] Triggered DownloadedAlbumsScan for completed music folder: ${albumDir}`))
      .catch((err) => console.error(`[lidarr] Failed to notify Lidarr of completed download: ${err.message}`));
  }, SCAN_DEBOUNCE_MS);
  timer.unref?.();
  pendingScans.set(albumDir, timer);
}

// Categories Lidarr creates through the qBittorrent API, persisted so they survive restarts.
function loadQbitCategories() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'lidarr_qbit_categories'").get();
  try {
    const parsed = JSON.parse(row?.value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveQbitCategories(categories) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('lidarr_qbit_categories', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(categories));
}

function getQbitCategories() {
  const config = getLidarrConfig();
  const defaultPath = normalizeMusicFolder(config.musicFolder).replace(/\\/g, '/');
  const categories = loadQbitCategories();
  const cat = config.category || 'music';
  if (!categories[cat]) categories[cat] = { name: cat, savePath: defaultPath };
  for (const entry of Object.values(categories)) {
    if (!entry.savePath) entry.savePath = defaultPath;
  }
  return categories;
}

function addQbitCategory(category, savePath = '') {
  if (!category) return;
  const config = getLidarrConfig();
  const resolved = normalizeMusicFolder(savePath || config.musicFolder).replace(/\\/g, '/');
  const categories = loadQbitCategories();
  categories[category] = { name: category, savePath: resolved };
  saveQbitCategories(categories);
}

function removeQbitCategories(categories) {
  if (!categories) return;
  const list = String(categories).split(/\r?\n|\|/).map((c) => c.trim()).filter(Boolean);
  const stored = loadQbitCategories();
  for (const c of list) delete stored[c];
  saveQbitCategories(stored);
}

module.exports = {
  bencode,
  bdecode,
  parseTorrentBuffer,
  escapeXml,
  getDeterministicHash,
  getInfoHash,
  computeReleaseHash,
  generateTorrentBuffer,
  getLidarrConfig,
  updateLidarrConfig,
  normalizeMusicFolder,
  validateTorznabApiKey,
  getCapsXml,
  searchTorznab,
  handleDownloadAdd,
  getQbitTorrents,
  getQbitTorrentFiles,
  getQbitTorrentProperties,
  deleteQbitTorrents,
  setQbitTorrentCategory,
  describeReleaseFormat,
  estimateReleaseSize,
  getQbitCategories,
  addQbitCategory,
  removeQbitCategories,
  getSabQueue,
  getSabHistory,
  testConnection,
  triggerDownloadedAlbumsScan,
  getWantedMissing,
  getArtists,
  notifyDownloadComplete,
};


