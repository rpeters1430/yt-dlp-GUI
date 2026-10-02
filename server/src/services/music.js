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

  const totalDiscs = albumItem.discCount || Math.max(...songItems.map((s) => s.discNumber || 1), 1);
  const tracks = songItems
    .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0))
    .map((t, index) => ({
      trackNumber: t.trackNumber || index + 1,
      totalTracks: songItems.length,
      discNumber: t.discNumber || 1,
      totalDiscs,
      title: t.trackName,
      artist: t.artistName || album.artist,
      albumArtist: album.artist,
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
    albumArtist: t.artistName,
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

function scoreCandidate(c, artist, title, targetDuration) {
  let score = 0;
  if (targetDuration && c.duration) {
    const diff = Math.abs(c.duration - targetDuration);
    if (diff <= 2) score += 60;
    else if (diff <= 5) score += 40;
    else if (diff <= 10) score += 20;
    else if (diff <= 20) score += 5;
    else if (diff > 30 && diff <= 60) score -= 45;
    else if (diff > 60) score -= 100;
  }
  const cTitle = (c.title || '').toLowerCase();
  const cUploader = (c.uploader || '').toLowerCase();
  const artLower = (artist || '').toLowerCase();
  const titLower = (title || '').toLowerCase();

  // YouTube auto-generated Topic channels provide the pure record-label studio album audio
  const isTopicChannel = cUploader.endsWith('- topic') || cUploader.includes('topic');
  if (isTopicChannel) score += 55;
  else if (artLower && cUploader.includes(artLower)) score += 30;
  if (cUploader.includes('vevo')) score += 20;

  // Title matching
  if (titLower && cTitle.includes(titLower)) score += 25;
  if (cTitle.includes('official audio') || cTitle.includes('original audio')) score += 35;
  if (cTitle.includes('provided to youtube')) score += 40;
  if (cTitle.includes('remaster')) score += 10;

  // Music video penalty: music videos often contain sound effects, dialogue, or extended intro scenes
  if (cTitle.includes('music video') || cTitle.includes('official video')) score -= 15;

  // Heavy penalties for non-studio versions
  if (cTitle.includes('live') && !titLower.includes('live')) score -= 50;
  if (cTitle.includes('cover') && !titLower.includes('cover')) score -= 60;
  if (cTitle.includes('karaoke') || (cTitle.includes('instrumental') && !titLower.includes('instrumental'))) score -= 60;
  if (cTitle.includes('reaction') || cTitle.includes('review') || cTitle.includes('parody')) score -= 100;
  if (cTitle.includes('slowed') || cTitle.includes('reverb') || cTitle.includes('bass boosted') || cTitle.includes('nightcore') || cTitle.includes('8d audio')) score -= 80;
  if (cTitle.includes('teaser') || cTitle.includes('trailer') || cTitle.includes('snippet')) score -= 90;
  if (cTitle.includes('clean') && !titLower.includes('clean')) score -= 25;
  if (cTitle.includes('censored')) score -= 40;

  return score;
}

async function getMatchCandidates(track, limit = 5) {
  const artist = track.artist || '';
  const title = track.title || '';
  const targetDuration = typeof track.duration === 'number' ? track.duration : null;

  const queries = [
    `${artist} - ${title} topic`,
    `${artist} - ${title} official audio`,
    `${artist} ${title}`,
  ];

  const candidateMap = new Map();
  for (const q of queries) {
    try {
      const results = await ytdlp.searchYouTube(q, 3);
      if (results && results.length > 0) {
        for (const item of results) {
          if (item && item.id && !candidateMap.has(item.id)) {
            candidateMap.set(item.id, item);
          }
        }
      }
      if (candidateMap.size >= 6) break;
    } catch (_) {}
  }

  const list = Array.from(candidateMap.values());
  if (list.length === 0) return [];

  const scored = list.map((c) => ({
    ...c,
    youtubeUrl: c.url,
    videoId: c.id,
    score: scoreCandidate(c, artist, title, targetDuration),
    durationDiff: targetDuration && c.duration ? Math.abs(c.duration - targetDuration) : null,
    isTopic: !!((c.uploader || '').toLowerCase().includes('topic')),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

async function matchTrackToYouTube(track) {
  const candidates = await getMatchCandidates(track, 5);
  if (candidates.length === 0) {
    throw new Error(`Could not find a YouTube match for "${track.artist || ''} - ${track.title || ''}"`);
  }
  const best = candidates[0];
  return {
    youtubeUrl: best.youtubeUrl,
    videoId: best.videoId,
    title: best.title,
    duration: best.duration,
    uploader: best.uploader,
    thumbnail: best.thumbnail,
    score: best.score,
    isTopic: best.isTopic,
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

async function fetchArtwork(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const mime = /png/i.test(res.headers.get('content-type') || '') ? 'image/png' : 'image/jpeg';
    return { data: Buffer.from(await res.arrayBuffer()), mime };
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
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `ffmpeg exited with code ${code}`))));
    proc.on('error', reject);
  });
}

// Formats that take cover art as an ffmpeg "attached picture" video stream.
const ATTACHED_PIC_FORMATS = new Set(['mp3', 'm4a', 'flac']);
// Ogg (Opus/Vorbis) has no picture stream; cover art goes in a METADATA_BLOCK_PICTURE comment.
const VORBIS_COMMENT_FORMATS = new Set(['opus', 'ogg']);
const TAGGABLE_FORMATS = new Set([...ATTACHED_PIC_FORMATS, ...VORBIS_COMMENT_FORMATS, 'wav']);

// FLAC picture block (big-endian), base64'd — the Vorbis-comment cover art convention.
function buildMetadataBlockPicture({ data, mime }) {
  const mimeBuf = Buffer.from(mime, 'ascii');
  const desc = Buffer.from('Cover (front)', 'utf8');
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return Buffer.concat([
    u32(3), // front cover
    u32(mimeBuf.length), mimeBuf,
    u32(desc.length), desc,
    u32(0), u32(0), u32(0), u32(0), // width/height/depth/colors unknown
    u32(data.length), data,
  ]).toString('base64');
}

function escapeFfmetadata(val) {
  return String(val).replace(/[=;#\\\n]/g, (c) => `\\${c}`);
}

function buildMusicTags(meta = {}) {
  const tags = {};
  const set = (key, value) => {
    if (value != null && String(value).trim() !== '') tags[key] = String(value).trim();
  };
  set('title', meta.title);
  set('artist', meta.artist);
  set('album_artist', meta.albumArtist || meta.artist);
  set('album', meta.album);
  if (meta.trackNumber) set('track', meta.totalTracks ? `${meta.trackNumber}/${meta.totalTracks}` : meta.trackNumber);
  if (meta.discNumber) set('disc', meta.totalDiscs ? `${meta.discNumber}/${meta.totalDiscs}` : meta.discNumber);
  set('date', meta.year);
  set('genre', meta.genre);
  return tags;
}

// Writes the iTunes-sourced tags and album art into the finished file as one ffmpeg remux.
// Doing this ourselves after yt-dlp (rather than via ExtractAudio --postprocessor-args or
// --embed-thumbnail/--embed-metadata) is what makes it reliable: ExtractAudio skips ffmpeg
// entirely when the download is already in the target format (e.g. native M4A), so its args
// would never apply, and yt-dlp's own embed steps use the YouTube title/uploader/thumbnail.
// The original tags are replaced wholesale so YouTube's description/comment/URL don't leak in.
async function tagMusicFile(filepath, meta = {}) {
  if (!filepath || !fs.existsSync(filepath)) return { tagged: false, artwork: false };
  const ext = path.extname(filepath).slice(1).toLowerCase();
  if (!TAGGABLE_FORMATS.has(ext)) return { tagged: false, artwork: false };

  const tags = buildMusicTags(meta);
  const artwork = (ATTACHED_PIC_FORMATS.has(ext) || VORBIS_COMMENT_FORMATS.has(ext))
    ? await fetchArtwork(meta.artworkUrl)
    : null;
  if (artwork && VORBIS_COMMENT_FORMATS.has(ext)) {
    tags.METADATA_BLOCK_PICTURE = buildMetadataBlockPicture(artwork);
  }

  const tmpBase = path.join(os.tmpdir(), `music-tag-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const metaPath = `${tmpBase}.ffmeta`;
  const coverPath = artwork && ATTACHED_PIC_FORMATS.has(ext) ? `${tmpBase}.${artwork.mime === 'image/png' ? 'png' : 'jpg'}` : null;
  const tempOut = `${filepath}.tag-tmp.${ext}`;

  const lines = [';FFMETADATA1', ...Object.entries(tags).map(([k, v]) => `${k}=${escapeFfmetadata(v)}`)];
  fs.writeFileSync(metaPath, `${lines.join('\n')}\n`);
  if (coverPath) fs.writeFileSync(coverPath, artwork.data);

  const args = ['-y', '-i', filepath, '-f', 'ffmetadata', '-i', metaPath];
  if (coverPath) args.push('-i', coverPath);
  args.push('-map', '0:a', '-map_metadata', '1', '-map_chapters', '-1');
  // Ogg stores its comments per stream, so the stream's own (YouTube) tags must be replaced too.
  if (VORBIS_COMMENT_FORMATS.has(ext)) args.push('-map_metadata:s:a', '1:g');
  if (coverPath) {
    args.push('-map', '2:v', '-disposition:v', 'attached_pic', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
  }
  args.push('-c', 'copy');
  if (ext === 'mp3') args.push('-id3v2_version', '3');
  args.push(tempOut);

  try {
    await runFfmpeg(args);
    fs.renameSync(tempOut, filepath);
    return { tagged: true, artwork: !!artwork };
  } catch (err) {
    try { fs.unlinkSync(tempOut); } catch (_) {}
    throw err;
  } finally {
    for (const p of [metaPath, coverPath]) {
      if (p) try { fs.unlinkSync(p); } catch (_) {}
    }
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

  const discPrefix = track.discNumber > 1 || (track.totalDiscs && track.totalDiscs > 1) ? `${track.discNumber}-` : '';
  const trackNumStr = String(track.trackNumber || 1).padStart(2, '0');
  const titleStr = sanitizeFilename(track.title || 'Track');
  const outputTemplate = path.join(targetDir, `${discPrefix}${trackNumStr} - ${titleStr}.%(ext)s`);

  const albumArtist = track.albumArtist || track.artist;

  const jobId = queue.enqueue(youtubeUrl, {
    audioOnly: true,
    container: audioFormat || 'mp3',
    quality: null,
    optionsJson: {
      audioQuality: audioQuality || '320k',
      outputTemplate,
      sponsorblockRemove: 'music_offtopic',
      // Deliberately NOT embedThumbnail/embedMetadata: those would tag the file with the raw
      // YouTube title/uploader and the video's thumbnail. queue.js runs tagMusicFile() after
      // the download instead, using the iTunes metadata and album art below.
      isMusicDownload: true,
      musicMetadata: {
        title: track.title,
        artist: track.artist,
        albumArtist,
        album: track.album,
        trackNumber: track.trackNumber,
        totalTracks: track.totalTracks,
        discNumber: track.discNumber,
        totalDiscs: track.totalDiscs,
        year: track.year || track.releaseYear,
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
  getMatchCandidates,
  inspectUrl,
  saveCoverArt,
  tagMusicFile,
  buildMusicTags,
  buildMetadataBlockPicture,
  getMusicSettings,
  updateMusicSettings,
  enqueueMusicDownload,
  sanitizeFilename,
};
