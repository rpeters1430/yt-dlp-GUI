const express = require('express');
const queue = require('../services/queue');
const ytdlp = require('../services/ytdlp');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Fetch metadata/formats for a URL before download, supporting both single videos and playlists.
router.post('/info', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    let info = await ytdlp.getInfo(url, { flatPlaylist: true });
    const isPlaylist = info._type === 'playlist' || Array.isArray(info.entries);

    if (isPlaylist) {
      const entries = (info.entries || []).slice(0, 50).map((entry, idx) => ({
        index: idx + 1,
        id: entry.id,
        title: entry.title,
        url: entry.url || entry.webpage_url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null),
        duration: entry.duration,
        thumbnail: entry.thumbnail || (entry.thumbnails && entry.thumbnails[0] ? entry.thumbnails[0].url : null),
      }));

      return res.json({
        isPlaylist: true,
        title: info.title || 'Playlist',
        uploader: info.uploader || info.channel || null,
        videoCount: info.playlist_count || (info.entries ? info.entries.length : entries.length),
        thumbnail: info.thumbnail || (entries[0] ? entries[0].thumbnail : null),
        extractor: info.extractor || 'youtube:playlist',
        entries,
      });
    }

    if (!info.formats || info.formats.length === 0) {
      info = await ytdlp.getInfo(url, { flatPlaylist: false });
    }

    const heights = [...new Set((info.formats || []).map((f) => f.height).filter(Boolean))].sort((a, b) => b - a);
    const bestVideo = (info.formats || [])
      .filter((f) => f.vcodec && f.vcodec !== 'none')
      .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0))[0];

    let highestQuality = 'Best available';
    if (bestVideo && bestVideo.height) {
      const fps = bestVideo.fps && bestVideo.fps > 30 ? ` ${bestVideo.fps}fps` : '';
      if (bestVideo.height >= 2160) highestQuality = `4K (${bestVideo.height}p${fps})`;
      else if (bestVideo.height >= 1440) highestQuality = `1440p (2K${fps})`;
      else if (bestVideo.height >= 1080) highestQuality = `1080p (Full HD${fps})`;
      else if (bestVideo.height >= 720) highestQuality = `720p (HD${fps})`;
      else highestQuality = `${bestVideo.height}p${fps}`;
    }

    const formats = (info.formats || []).map((f) => ({
      format_id: f.format_id,
      ext: f.ext,
      resolution: f.resolution || (f.height ? `${f.height}p` : null),
      height: f.height,
      fps: f.fps,
      note: f.format_note,
      filesize: f.filesize || f.filesize_approx || null,
      vcodec: f.vcodec,
      acodec: f.acodec,
    }));

    res.json({
      isPlaylist: false,
      title: info.title,
      uploader: info.uploader || info.channel || null,
      duration: info.duration,
      thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : null),
      viewCount: info.view_count || null,
      extractor: info.extractor || null,
      highestQuality,
      resolutions: heights.map((h) => ({
        height: h,
        label: h >= 2160 ? `4K (${h}p)` : h >= 1440 ? `1440p (${h}p)` : h >= 1080 ? `1080p (${h}p)` : `${h}p`,
      })),
      formats,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Accepts either a single URL or newline-separated multiple URLs.
router.post('/', (req, res) => {
  const {
    urls,
    url,
    formatSelector,
    audioOnly,
    quality,
    container,
    subtitles,
    subLangs,
    embedThumbnail,
    embedMetadata,
    embedChapters,
    sponsorblockRemove,
  } = req.body || {};
  const list = urls ? urls : url ? [url] : [];
  const cleaned = list.map((u) => String(u).trim()).filter(Boolean);

  if (cleaned.length === 0) return res.status(400).json({ error: 'At least one URL is required' });

  const optionsJson = {
    embedThumbnail: !!embedThumbnail,
    embedMetadata: !!embedMetadata,
    embedChapters: !!embedChapters,
    sponsorblockRemove: sponsorblockRemove || '',
  };

  const ids = cleaned.map((u) =>
    queue.enqueue(u, { formatSelector, audioOnly, quality, container, subtitles, subLangs, optionsJson })
  );
  res.json({ ids });
});

router.get('/', (req, res) => {
  res.json(queue.listJobs());
});

router.delete('/:id', (req, res) => {
  queue.removeJob(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
