const express = require('express');
const db = require('../db');
const queue = require('../services/queue');
const ytdlp = require('../services/ytdlp');
const siteProfiles = require('../services/siteProfiles');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Fetch metadata/formats for a URL before download, supporting both single videos and playlists.
router.post('/info', async (req, res) => {
  const { url: rawUrl } = req.body || {};
  if (!rawUrl) return res.status(400).json({ error: 'url is required' });
  try {
    const url = await ytdlp.resolveShareUrl(String(rawUrl).trim());
    let info = await ytdlp.getInfo(url, { flatPlaylist: true, resolveShare: false, reuseRecent: true });
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
        capabilities: siteProfiles.getCapabilities(info, url),
        entries,
      });
    }

    // --flat-playlist only flattens playlist entries, so a single-video result above is already
    // the full extraction. Re-probing it when formats are empty (scheduled streams, image or
    // text posts) just ran the same slow lookup twice; only a bare URL reference needs it.
    if (info._type === 'url' || info._type === 'url_transparent') {
      info = await ytdlp.getInfo(info.url || url, { flatPlaylist: false });
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

    // live_status comes straight from yt-dlp: 'is_live' (broadcasting now), 'is_upcoming'
    // (scheduled but not started — has no formats yet), 'was_live'/'post_live' (a finished
    // broadcast now served as a VOD — downloads like any normal video), or unset/'not_live'.
    const liveStatus = info.live_status || (info.is_live ? 'is_live' : null);
    // getInfo tolerates "no formats" so scheduled broadcasts can be probed; anything else
    // without formats (geo-blocked, removed, …) still can't be downloaded.
    if (heights.length === 0 && !(info.formats || []).length && liveStatus !== 'is_upcoming') {
      return res.status(502).json({ error: 'No downloadable formats found for this link' });
    }

    res.json({
      isPlaylist: false,
      title: info.title,
      uploader: info.uploader || info.channel || null,
      duration: info.duration,
      thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : null),
      viewCount: info.view_count || null,
      extractor: info.extractor || null,
      // What this link supports (site features + what the probe found); drives which
      // download options the UI offers. The queue re-derives it at download time too.
      capabilities: siteProfiles.getCapabilities(info, url),
      highestQuality,
      resolutions: heights.map((h) => ({
        height: h,
        label: h >= 2160 ? `4K (${h}p)` : h >= 1440 ? `1440p (${h}p)` : h >= 1080 ? `1080p (${h}p)` : `${h}p`,
      })),
      formats,
      isLive: liveStatus === 'is_live',
      liveStatus,
      liveViewers: info.concurrent_view_count || null,
      releaseTimestamp: info.release_timestamp || null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Accepts either a single URL or newline-separated multiple URLs.
router.post('/', async (req, res) => {
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
    isLive,
    liveFromStart,
    waitForLive,
    waitInterval,
  } = req.body || {};
  const list = urls ? urls : url ? [url] : [];
  const trimmed = list.map((u) => String(u).trim()).filter(Boolean);

  if (trimmed.length === 0) return res.status(400).json({ error: 'At least one URL is required' });
  const MAX_URLS_PER_REQUEST = 100;
  if (trimmed.length > MAX_URLS_PER_REQUEST) {
    return res.status(400).json({ error: `Too many URLs in one request (max ${MAX_URLS_PER_REQUEST})` });
  }
  // Expand share/short links (e.g. Reddit /s/ links) up front so the stored job URL is the
  // canonical one yt-dlp's site extractor recognizes. Non-share URLs pass through untouched.
  const cleaned = await Promise.all(trimmed.map((u) => ytdlp.resolveShareUrl(u)));
  // Fails fast here for immediate feedback; getInfo/download would reject the same URLs
  // anyway once the job actually runs, but that's a queued failure minutes later instead.
  for (const u of cleaned) {
    try {
      ytdlp.assertPublicUrl(u);
    } catch (e) {
      return res.status(400).json({ error: `${e.message}: ${u}` });
    }
  }

  const optionsJson = {
    embedThumbnail: !!embedThumbnail,
    embedMetadata: !!embedMetadata,
    embedChapters: !!embedChapters,
    sponsorblockRemove: sponsorblockRemove || '',
    liveFromStart: !!liveFromStart,
    waitForLive: !!waitForLive,
    waitInterval: parseInt(waitInterval, 10) || 15,
  };

  const ids = cleaned.map((u) =>
    queue.enqueue(u, {
      formatSelector, audioOnly, quality, container, subtitles, subLangs,
      isLive: !!isLive || !!waitForLive,
      optionsJson,
    })
  );
  res.json({ ids });
});

// Stops a running download/recording gracefully — the process is sent SIGINT so yt-dlp/ffmpeg
// finalize the output file, and the job goes on to a normal 'completed' state (see queue.js)
// instead of being removed. This is the "Stop recording" action for an indefinite live
// capture; use DELETE /:id instead to abandon a job and remove it from the list entirely.
router.post('/:id/stop', (req, res) => {
  const stopped = queue.stopJob(req.params.id);
  res.json({ ok: true, stopped });
});

router.get('/', (req, res) => {
  res.json(queue.listJobs());
});

router.delete('/:id', (req, res) => {
  queue.removeJob(req.params.id);
  res.json({ ok: true });
});

// Protects (or un-protects) a single download from the nightly auto-delete job — see
// services/cleanup.js. Purely a flag; never touches the file itself.
router.patch('/:id/protect', (req, res) => {
  const download = db.prepare('SELECT * FROM downloads WHERE id = ?').get(req.params.id);
  if (!download) return res.status(404).json({ error: 'Download not found' });

  const { protected: protectedFlag } = req.body || {};
  const next = protectedFlag !== undefined ? (protectedFlag ? 1 : 0) : (download.protected ? 0 : 1);
  db.prepare('UPDATE downloads SET protected = ? WHERE id = ?').run(next, download.id);

  const updated = db.prepare('SELECT * FROM downloads WHERE id = ?').get(download.id);
  res.json(updated);
});

module.exports = router;
