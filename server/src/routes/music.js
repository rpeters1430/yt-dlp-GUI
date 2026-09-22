const express = require('express');
const music = require('../services/music');
const db = require('../db');
const scheduler = require('../services/scheduler');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Search for albums or tracks
router.get('/search', async (req, res) => {
  const query = req.query.q || '';
  const type = req.query.type || 'album';
  const limit = parseInt(req.query.limit || '20', 10);

  if (!query.trim()) {
    return res.json({ results: [] });
  }

  try {
    if (type === 'track' || type === 'song') {
      const results = await music.searchTracks(query, limit);
      res.json({ results, type: 'track' });
    } else if (type === 'artist') {
      const results = await music.searchArtists(query, limit);
      res.json({ results, type: 'artist' });
    } else {
      const data = await music.searchAlbums(query, limit);
      res.json({ results: data.results, matchedArtist: data.matchedArtist, type: 'album' });
    }
  } catch (err) {
    console.error('[music:search] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get artist discography with albums and singles separated
router.get('/artist/:id', async (req, res) => {
  const artistId = req.params.id;
  try {
    const data = await music.getArtistDiscography(artistId);
    res.json(data);
  } catch (err) {
    console.error('[music:artist] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get album details and full tracklist
router.get('/album/:id', async (req, res) => {
  const collectionId = req.params.id;
  try {
    const data = await music.getAlbumDetails(collectionId);
    res.json(data);
  } catch (err) {
    console.error('[music:album] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Match a single track to YouTube
router.post('/match-track', async (req, res) => {
  const { track } = req.body || {};
  if (!track || !track.title) {
    return res.status(400).json({ error: 'Track title is required' });
  }
  try {
    const match = await music.matchTrackToYouTube(track);
    res.json(match);
  } catch (err) {
    console.error('[music:match-track] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Match a batch of tracks to YouTube (with controlled concurrency)
router.post('/match-batch', async (req, res) => {
  const { tracks } = req.body || {};
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: 'Tracks array is required' });
  }

  const results = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < tracks.length; i += CONCURRENCY) {
    const chunk = tracks.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (t) => {
        try {
          const match = await music.matchTrackToYouTube(t);
          return { trackNumber: t.trackNumber, title: t.title, match, ok: true };
        } catch (err) {
          return { trackNumber: t.trackNumber, title: t.title, error: err.message, ok: false };
        }
      })
    );
    results.push(...chunkResults);
  }

  res.json({ results });
});

// Inspect a direct YouTube or YouTube Music URL
router.post('/inspect-url', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid http(s) URL is required' });
  }
  try {
    const info = await music.inspectUrl(url);
    res.json(info);
  } catch (err) {
    console.error('[music:inspect-url] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Download one or multiple tracks
router.post('/download', async (req, res) => {
  const {
    tracks,
    track,
    audioFormat,
    audioQuality,
    musicFolder,
    saveCover = true,
  } = req.body || {};

  const items = Array.isArray(tracks) ? tracks : (track ? [track] : []);
  if (items.length === 0) {
    return res.status(400).json({ error: 'At least one track must be specified' });
  }

  const settings = music.getMusicSettings();
  const targetFormat = audioFormat || settings.musicFormat || 'mp3';
  const targetQuality = audioQuality || settings.musicQuality || '320k';
  const targetFolder = musicFolder || settings.musicFolder || 'Music';

  const jobs = [];
  for (const item of items) {
    try {
      const job = await music.enqueueMusicDownload({
        track: item,
        audioFormat: targetFormat,
        audioQuality: targetQuality,
        musicFolder: targetFolder,
        saveCover,
      });
      jobs.push(job);
    } catch (err) {
      console.error(`[music:download] Failed to enqueue "${item.title}":`, err.message);
      jobs.push({ title: item.title, error: err.message });
    }
  }

  res.json({ enqueued: jobs.filter((j) => !j.error).length, total: items.length, jobs });
});

// List music watches
router.get('/watches', (req, res) => {
  const rows = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM watch_seen_ids WHERE watch_id = w.id) AS seen_count,
      (SELECT COUNT(*) FROM downloads WHERE watch_id = w.id) AS download_count
    FROM watches w
    WHERE w.is_music = 1
    ORDER BY w.created_at DESC
  `).all();
  res.json(rows);
});

// Create a music watch
router.post('/watches', async (req, res) => {
  const {
    url,
    name,
    audioFormat = 'mp3',
    audioQuality = '320k',
    musicFolder = 'Music',
    checkIntervalMins = 60,
    matchTitle = null,
    rejectTitle = null,
    downloadLimit = 5,
  } = req.body || {};

  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid http(s) URL is required' });
  }

  try {
    const info = await music.inspectUrl(url).catch(() => ({}));
    const watchName = (name && name.trim()) || info.uploader || info.title || 'Music Watch';
    const thumbnail = info.thumbnail || null;
    const channelName = info.uploader || null;

    const result = db.prepare(`
      INSERT INTO watches (
        url, name, format_selector, audio_only, check_interval_mins,
        quality, container, subtitles, sub_langs, embed_thumbnail,
        embed_metadata, embed_chapters, sponsorblock, sponsorblock_categories,
        match_title, reject_title, min_duration, max_duration, download_limit,
        max_scan_entries, thumbnail, channel_name, cleanup_exempt,
        is_music, music_folder, audio_quality
      ) VALUES (
        ?, ?, NULL, 1, ?,
        NULL, ?, 0, 'en.*', 1,
        1, 0, 0, NULL,
        ?, ?, NULL, NULL, ?,
        30, ?, ?, 1,
        1, ?, ?
      )
    `).run(
      url,
      watchName,
      parseInt(checkIntervalMins, 10) || 60,
      audioFormat,
      matchTitle ? String(matchTitle).trim() : null,
      rejectTitle ? String(rejectTitle).trim() : null,
      parseInt(downloadLimit, 10) || 5,
      thumbnail,
      channelName,
      musicFolder || 'Music',
      audioQuality || '320k'
    );

    const watch = db.prepare(`
      SELECT w.*,
        (SELECT COUNT(*) FROM watch_seen_ids WHERE watch_id = w.id) AS seen_count,
        (SELECT COUNT(*) FROM downloads WHERE watch_id = w.id) AS download_count
      FROM watches w WHERE w.id = ?
    `).get(result.lastInsertRowid);

    scheduler.checkWatch(watch, { manual: true })
      .catch((e) => console.error('Initial music watch check failed:', e.message));

    res.json(watch);
  } catch (err) {
    console.error('[music:watches] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Music settings
router.get('/settings', (req, res) => {
  res.json(music.getMusicSettings());
});

router.put('/settings', (req, res) => {
  const updated = music.updateMusicSettings(req.body || {});
  res.json(updated);
});

module.exports = router;
