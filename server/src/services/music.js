const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ytdlp = require('./ytdlp');
const queue = require('./queue');
const db = require('../db');

// Only replacing path separators/reserved characters isn't enough: a name that sanitizes to
// exactly ".." (or ".") is still a valid path segment that walks up a directory when joined
// (enqueueMusicDownload uses artist/album names as raw path segments), and both album/artist
// names here can come straight from a client-submitted track object, not just iTunes search
// results. Collapsing an all-dots result to a safe placeholder closes that off.
function sanitizeFilename(name) {
  if (!name) return 'Unknown';
  const cleaned = String(name)
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!cleaned || /^\.+$/.test(cleaned)) return 'Unknown';
  return cleaned;
}

function escapeFfmpegMeta(val) {
  if (val == null) return '""';
  const str = String(val).replace(/"/g, '\\"');
  return `"${str}"`;
}

function upgradeArtworkUrl(url, size = 600) {
  if (!url || typeof url !== 'string') return null;
  return url.replace(/\/\d+x\d+bb\./i, `/${size}x${size}bb.`);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function classifyRelease(collectionName, trackCount, collectionType) {
  const nameLower = (collectionName || '').toLowerCase();
  const isSingle =
    /\s*-\s*single$/i.test(nameLower) ||
    /\s*-\s*ep$/i.test(nameLower) ||
    (typeof trackCount === 'number' && trackCount > 0 && trackCount <= 3) ||
    collectionType === 'Single';
  return isSingle ? 'single' : 'album';
}

async function getArtistDiscography(artistId) {
  if (!artistId) throw new Error('Artist ID is required');
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(artistId)}&entity=album&limit=200`;
  const data = await fetchJson(url);
  const items = data.results || [];
  if (items.length === 0) throw new Error('Artist not found');

  const artistItem = items.find((i) => i.wrapperType === 'artist') || {
    artistId,
    artistName: 'Unknown Artist',
  };

  const rawCollections = items.filter((i) => i.wrapperType === 'collection');

  const seenKeys = new Set();
  const allReleases = [];
  const albums = [];
  const singles = [];

  for (const c of rawCollections) {
    if (!c.collectionName) continue;
    const normName = c.collectionName.toLowerCase().replace(/\s+/g, ' ').trim();
    const dedupKey = `${normName}|${c.trackCount || 0}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    const releaseType = classifyRelease(c.collectionName, c.trackCount, c.collectionType);
    const isSingle = releaseType === 'single';

    const item = {
      id: c.collectionId,
      name: c.collectionName,
      artist: c.artistName,
      artistId: c.artistId,
      artwork: upgradeArtworkUrl(c.artworkUrl100 || c.artworkUrl60, 600),
      thumbnail: c.artworkUrl100 || c.artworkUrl60,
      releaseYear: c.releaseDate ? c.releaseDate.slice(0, 4) : null,
      releaseDate: c.releaseDate || null,
      trackCount: c.trackCount || 0,
      genre: c.primaryGenreName || artistItem.primaryGenreName || null,
      copyright: c.copyright || null,
      isSingle,
      releaseType,
      explicitness: c.collectionExplicitness || null,
    };

    allReleases.push(item);
    if (isSingle) {
      singles.push(item);
    } else {
      albums.push(item);
    }
  }

  const sortByDateDesc = (a, b) => {
    const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
    const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
    return db - da;
  };

  allReleases.sort(sortByDateDesc);
  albums.sort(sortByDateDesc);
  singles.sort(sortByDateDesc);

  const topArtwork = albums[0]?.artwork || singles[0]?.artwork || allReleases[0]?.artwork || null;

  return {
    artist: {
      id: artistItem.artistId,
      name: artistItem.artistName,
      genre: artistItem.primaryGenreName || null,
      artwork: topArtwork,
      url: artistItem.artistLinkUrl || null,
    },
    counts: {
      albums: albums.length,
      singles: singles.length,
      total: allReleases.length,
    },
    albums,
    singles,
    all: allReleases,
  };
}

async function searchArtists(query, limit = 20) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&limit=${Math.min(50, Math.max(1, limit))}`;
  const data = await fetchJson(url);
  const results = data.results || [];

  return await Promise.all(
    results.map(async (a) => {
      let artwork = null;
      try {
        const lookup = await fetchJson(`https://itunes.apple.com/lookup?id=${a.artistId}&entity=album&limit=2`);
        const col = (lookup.results || []).find((x) => x.wrapperType === 'collection');
        if (col) {
          artwork = upgradeArtworkUrl(col.artworkUrl100 || col.artworkUrl60, 600);
        }
      } catch (_) {}
      return {
        id: a.artistId,
        name: a.artistName,
        genre: a.primaryGenreName || null,
        linkUrl: a.artistLinkUrl || null,
        artwork,
      };
    })
  );
}

async function searchAlbums(query, limit = 50) {
  const q = String(query || '').trim();
  if (!q) return { results: [], matchedArtist: null };

  const albumUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=${Math.min(50, Math.max(1, limit))}`;
  const artistUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&limit=3`;

  const [albumData, artistData] = await Promise.all([
    fetchJson(albumUrl).catch(() => ({ results: [] })),
    fetchJson(artistUrl).catch(() => ({ results: [] })),
  ]);

  const rawResults = albumData.results || [];
  const results = rawResults.map((r) => {
    const releaseType = classifyRelease(r.collectionName, r.trackCount, r.collectionType);
    const isSingle = releaseType === 'single';
    return {
      id: r.collectionId,
      name: r.collectionName,
      artist: r.artistName,
      artistId: r.artistId,
      artwork: upgradeArtworkUrl(r.artworkUrl100 || r.artworkUrl60, 600),
      thumbnail: r.artworkUrl100 || r.artworkUrl60,
      releaseYear: r.releaseDate ? r.releaseDate.slice(0, 4) : null,
      releaseDate: r.releaseDate || null,
      trackCount: r.trackCount || 0,
      genre: r.primaryGenreName || null,
      copyright: r.copyright || null,
      isSingle,
      releaseType,
    };
  });

  const cleanQ = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  let matchedArtist = null;
  const artists = artistData.results || [];

  for (const a of artists) {
    if (!a.artistName) continue;
    const cleanName = a.artistName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isExact = cleanName === cleanQ;
    const isClose = cleanName.length >= 3 && cleanQ.length >= 3 && (cleanName.includes(cleanQ) || cleanQ.includes(cleanName));

    if (isExact || isClose) {
      matchedArtist = {
        id: a.artistId,
        name: a.artistName,
        genre: a.primaryGenreName || null,
        isExact,
      };
      break;
    }
  }

  if (matchedArtist) {
    try {
      const disco = await getArtistDiscography(matchedArtist.id);
      matchedArtist.counts = disco.counts;
      matchedArtist.artwork = disco.artist.artwork;
      matchedArtist.albums = disco.albums;
      matchedArtist.singles = disco.singles;
      matchedArtist.all = disco.all;
    } catch (_) {}
  }

  return { results, matchedArtist };
}

async function getAlbumDetails(collectionId) {
  if (!collectionId) throw new Error('Collection ID is required');
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(collectionId)}&entity=song`;
  const data = await fetchJson(url);
  const items = data.results || [];
  if (items.length === 0) throw new Error('Album not found');

  const albumItem = items.find((i) => i.wrapperType === 'collection') || items[0];
  const songItems = items.filter((i) => i.wrapperType === 'track');

  const album = {
    id: albumItem.collectionId,
    name: albumItem.collectionName,
    artist: albumItem.artistName,
    artwork: upgradeArtworkUrl(albumItem.artworkUrl100 || albumItem.artworkUrl60, 1000),
    thumbnail: albumItem.artworkUrl100 || albumItem.artworkUrl60,
    releaseYear: albumItem.releaseDate ? albumItem.releaseDate.slice(0, 4) : null,
    releaseDate: albumItem.releaseDate || null,
    trackCount: songItems.length || albumItem.trackCount || 0,
    genre: albumItem.primaryGenreName || null,
    copyright: albumItem.copyright || null,
  };

  const tracks = songItems
    .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0))
    .map((t, index) => ({
      trackNumber: t.trackNumber || index + 1,
      discNumber: t.discNumber || 1,
      title: t.trackName,
      artist: t.artistName || album.artist,
      album: album.name,
      duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
      previewUrl: t.previewUrl || null,
      genre: t.primaryGenreName || album.genre,
      year: album.releaseYear,
      artwork: album.artwork,
      youtubeUrl: null,
      videoId: null,
    }));

  return { album, tracks };
}

async function searchTracks(query, limit = 25) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=${Math.min(50, Math.max(1, limit))}`;
  const data = await fetchJson(url);
  const results = data.results || [];
  return results.map((t) => ({
    trackNumber: t.trackNumber || 1,
    discNumber: t.discNumber || 1,
    title: t.trackName,
    artist: t.artistName,
    album: t.collectionName,
    collectionId: t.collectionId,
    artwork: upgradeArtworkUrl(t.artworkUrl100 || t.artworkUrl60, 600),
    thumbnail: t.artworkUrl100 || t.artworkUrl60,
    duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
    previewUrl: t.previewUrl || null,
    genre: t.primaryGenreName || null,
    releaseYear: t.releaseDate ? t.releaseDate.slice(0, 4) : null,
    youtubeUrl: null,
    videoId: null,
  }));
}

async function matchTrackToYouTube(track) {
  const artist = track.artist || '';
  const title = track.title || '';
  const targetDuration = typeof track.duration === 'number' ? track.duration : null;

  const queries = [
    `${artist} - ${title} official audio`,
    `${artist} - ${title} audio`,
    `${artist} ${title}`,
  ];

  let candidates = [];
  for (const q of queries) {
    try {
      const results = await ytdlp.searchYouTube(q, 3);
      if (results && results.length > 0) {
        candidates = results;
        break;
      }
    } catch (_) {}
  }

  if (candidates.length === 0) {
    throw new Error(`Could not find a YouTube match for "${artist} - ${title}"`);
  }

  // Score candidates: prioritize duration match (within 10s) and channel/uploader match
  let best = candidates[0];
  let bestScore = -1000;

  for (const c of candidates) {
    let score = 0;
    if (targetDuration && c.duration) {
      const diff = Math.abs(c.duration - targetDuration);
      if (diff <= 3) score += 50;
      else if (diff <= 8) score += 30;
      else if (diff <= 15) score += 15;
      else if (diff > 45) score -= 40;
    }
    const cTitle = (c.title || '').toLowerCase();
    const cUploader = (c.uploader || '').toLowerCase();
    const artLower = artist.toLowerCase();
    const titLower = title.toLowerCase();

    if (cUploader.includes(artLower)) score += 25;
    if (cTitle.includes(titLower)) score += 25;
    if (cTitle.includes('official audio') || cTitle.includes('topic')) score += 20;
    if (cTitle.includes('music video')) score += 10;
    if (cTitle.includes('live') && !titLower.includes('live')) score -= 30;
    if (cTitle.includes('cover') && !titLower.includes('cover')) score -= 40;
    if (cTitle.includes('karaoke') || cTitle.includes('instrumental')) score -= 40;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return {
    youtubeUrl: best.url,
    videoId: best.id,
    title: best.title,
    duration: best.duration,
    uploader: best.uploader,
    thumbnail: best.thumbnail,
  };
}

async function inspectUrl(url) {
  ytdlp.assertPublicUrl(url);
  const info = await ytdlp.getInfo(url, { flatPlaylist: true });

  const entries = [];
  function walk(node) {
    if (!node) return;
    if (node.entries && Array.isArray(node.entries)) {
      for (const item of node.entries) walk(item);
    } else if (node.id && (node.url || node.webpage_url || node._type === 'url' || node.title)) {
      entries.push({
        id: node.id,
        title: node.title,
        duration: node.duration,
        thumbnail: node.thumbnails?.[0]?.url || node.thumbnail || null,
        url: node.url || node.webpage_url || `https://www.youtube.com/watch?v=${node.id}`,
        uploader: node.uploader || node.channel || null,
      });
    }
  }
  walk(info);

  return {
    id: info.id,
    title: info.title,
    uploader: info.uploader || info.channel || null,
    thumbnail: info.thumbnail || entries[0]?.thumbnail || null,
    isPlaylist: entries.length > 1,
    trackCount: entries.length,
    entries,
  };
}

async function saveCoverArt(targetDir, artworkUrl) {
  if (!artworkUrl || !targetDir) return;
  const coverPath = path.join(targetDir, 'cover.jpg');
  if (fs.existsSync(coverPath)) return;

  try {
    const res = await fetch(artworkUrl);
    if (!res.ok) return;
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(coverPath, Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(`[music] Failed to save cover art: ${err.message}`);
  }
}

async function fetchToTempFile(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const tmpPath = path.join(os.tmpdir(), `music-art-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    fs.writeFileSync(tmpPath, buf);
    return tmpPath;
  } catch (err) {
    console.error(`[music] Failed to fetch artwork for embedding: ${err.message}`);
    return null;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlp.getFfmpegBin(), args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))));
    proc.on('error', reject);
  });
}

// mp3/m4a/flac all reliably support an embedded "attached picture" via ffmpeg's generic
// -disposition:v attached_pic path; opus (ogg) and wav don't, so those just keep relying on
// the folder-level cover.jpg from saveCoverArt for media-server artwork.
const EMBEDDABLE_ARTWORK_FORMATS = new Set(['mp3', 'm4a', 'flac']);

// yt-dlp's own --embed-thumbnail only has access to the matched YouTube video's own
// thumbnail (a video frame/channel avatar), not the real album art this feature already
// resolved via iTunes — so cover art is embedded here as its own post-download ffmpeg step
// using the exact artwork URL the track was matched against, instead of relying on that flag.
async function embedCoverArt(filepath, artworkUrl) {
  if (!filepath || !artworkUrl || !fs.existsSync(filepath)) return;
  const ext = path.extname(filepath).slice(1).toLowerCase();
  if (!EMBEDDABLE_ARTWORK_FORMATS.has(ext)) return;

  const coverPath = await fetchToTempFile(artworkUrl);
  if (!coverPath) return;

  const tempOut = `${filepath}.artwork-tmp${path.extname(filepath)}`;
  try {
    await runFfmpeg([
      '-y', '-i', filepath, '-i', coverPath,
      '-map', '0:a', '-map', '1:v',
      '-c', 'copy', '-id3v2_version', '3',
      '-metadata:s:v', 'title=Album cover',
      '-metadata:s:v', 'comment=Cover (front)',
      '-disposition:v', 'attached_pic',
      tempOut,
    ]);
    fs.renameSync(tempOut, filepath);
  } catch (err) {
    console.error(`[music] Failed to embed cover art into ${filepath}: ${err.message}`);
    try { fs.unlinkSync(tempOut); } catch (_) {}
  } finally {
    try { fs.unlinkSync(coverPath); } catch (_) {}
  }
}

function getMusicSettings() {
  const keys = ['music_folder', 'music_format', 'music_quality', 'music_save_cover'];
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys);
  const map = {};
  for (const r of rows) map[r.key] = r.value;

  return {
    musicFolder: map.music_folder || 'Music',
    musicFormat: map.music_format || 'mp3',
    musicQuality: map.music_quality || '320k',
    saveCover: map.music_save_cover !== '0',
  };
}

function updateMusicSettings({ musicFolder, musicFormat, musicQuality, saveCover }) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  if (musicFolder !== undefined) upsert.run('music_folder', String(musicFolder).trim() || 'Music');
  if (musicFormat !== undefined) upsert.run('music_format', String(musicFormat).trim() || 'mp3');
  if (musicQuality !== undefined) upsert.run('music_quality', String(musicQuality).trim() || '320k');
  if (saveCover !== undefined) upsert.run('music_save_cover', saveCover ? '1' : '0');

  return getMusicSettings();
}

async function enqueueMusicDownload({
  track,
  audioFormat = 'mp3',
  audioQuality = '320k',
  musicFolder = 'Music',
  saveCover = true,
}) {
  let youtubeUrl = track.youtubeUrl;
  let matchedInfo = null;

  if (!youtubeUrl) {
    matchedInfo = await matchTrackToYouTube(track);
    youtubeUrl = matchedInfo.youtubeUrl;
  }

  const baseFolder = String(musicFolder || 'Music').trim();
  const resolvedBaseDir = path.isAbsolute(baseFolder)
    ? baseFolder
    : path.join(ytdlp.DOWNLOAD_DIR, baseFolder);

  const artistDir = sanitizeFilename(track.artist || 'Unknown Artist');
  const albumName = track.album && String(track.album).trim();
  // A track with no real album (a single) goes straight into the artist folder rather than
  // an extra "Single" subfolder, matching how album tracks are only nested when there's an
  // actual album to group them under.
  const targetDir = albumName
    ? path.join(resolvedBaseDir, artistDir, sanitizeFilename(albumName))
    : path.join(resolvedBaseDir, artistDir);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (saveCover && track.artwork) {
    saveCoverArt(targetDir, track.artwork).catch(() => {});
  }

  const trackNumStr = String(track.trackNumber || 1).padStart(2, '0');
  const titleStr = sanitizeFilename(track.title || 'Track');
  const outputTemplate = path.join(targetDir, `${trackNumStr} - ${titleStr}.%(ext)s`);

  // Build ID3 / Vorbis metadata arguments for FFmpeg via --postprocessor-args
  const ppaParts = [
    `-metadata title=${escapeFfmpegMeta(track.title)}`,
    `-metadata artist=${escapeFfmpegMeta(track.artist)}`,
    `-metadata album_artist=${escapeFfmpegMeta(track.artist)}`,
    `-metadata album=${escapeFfmpegMeta(track.album || 'Single')}`,
    `-metadata track=${track.trackNumber || 1}/${track.totalTracks || track.trackNumber || 1}`,
  ];
  if (track.discNumber) ppaParts.push(`-metadata disc=${track.discNumber}`);
  if (track.year) {
    ppaParts.push(`-metadata date=${escapeFfmpegMeta(track.year)}`);
    ppaParts.push(`-metadata year=${escapeFfmpegMeta(track.year)}`);
  }
  if (track.genre) ppaParts.push(`-metadata genre=${escapeFfmpegMeta(track.genre)}`);

  const ppa = `ExtractAudio+ffmpeg:${ppaParts.join(' ')}`;

  const jobId = queue.enqueue(youtubeUrl, {
    audioOnly: true,
    container: audioFormat || 'mp3',
    quality: null,
    optionsJson: {
      audioQuality: audioQuality || '320k',
      outputTemplate,
      // Deliberately NOT embedThumbnail/embedMetadata: yt-dlp's FFmpegMetadata/EmbedThumbnail
      // postprocessors run *after* the ExtractAudio postprocessor-args below (see yt-dlp's
      // get_postprocessors() ordering) and would stomp the clean iTunes-sourced tags with the
      // raw YouTube title/uploader, and embed the video's own thumbnail instead of real album
      // art. The metadata is fully handled by postprocessorArgs; artwork is embedded separately
      // in queue.js via embedCoverArt() using the actual matched artwork URL.
      isMusicDownload: true,
      postprocessorArgs: [ppa],
      musicMetadata: {
        title: track.title,
        artist: track.artist,
        album: track.album,
        trackNumber: track.trackNumber,
        totalTracks: track.totalTracks,
        discNumber: track.discNumber,
        year: track.year,
        genre: track.genre,
        artworkUrl: track.artwork,
      },
    },
  });

  return {
    jobId,
    youtubeUrl,
    title: track.title,
    artist: track.artist,
    album: track.album,
    outputTemplate,
  };
}

module.exports = {
  searchAlbums,
  searchArtists,
  getArtistDiscography,
  classifyRelease,
  getAlbumDetails,
  searchTracks,
  matchTrackToYouTube,
  inspectUrl,
  saveCoverArt,
  embedCoverArt,
  getMusicSettings,
  updateMusicSettings,
  enqueueMusicDownload,
  sanitizeFilename,
};
