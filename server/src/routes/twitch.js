const express = require('express');
const queue = require('../services/queue');
const ytdlp = require('../services/ytdlp');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function cleanChannelName(input) {
  if (!input) return '';
  let str = String(input).trim();
  str = str.replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '');
  str = str.replace(/^\/+|\/+$/g, '');
  str = str.replace(/^@/, '');
  const parts = str.split('/');
  return parts[0] || '';
}

// Check channel live status and fetch recent VODs
router.get('/channel/:channel', async (req, res) => {
  const channel = cleanChannelName(req.params.channel);
  if (!channel) return res.status(400).json({ error: 'Channel name is required' });

  const channelUrl = `https://www.twitch.tv/${channel}`;
  let live = false;
  let streamInfo = null;

  try {
    const info = await ytdlp.getInfo(channelUrl);
    live = true;
    const formats = (info.formats || []).map((f) => ({
      format_id: f.format_id,
      resolution: f.resolution || (f.height ? `${f.height}p` : null),
      height: f.height,
      fps: f.fps,
      vcodec: f.vcodec,
      tbr: f.tbr,
      note: f.format_note,
    }));

    const bestVideo = (info.formats || [])
      .filter((f) => f.vcodec && f.vcodec !== 'none')
      .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0))[0];

    streamInfo = {
      id: info.id,
      title: info.title || `${channel} (Live Stream)`,
      uploader: info.uploader || channel,
      thumbnail: info.thumbnail,
      viewCount: info.view_count || null,
      formats,
      highestQuality: bestVideo ? `${bestVideo.height}p${bestVideo.fps > 30 ? bestVideo.fps : ''}` : 'Source',
      url: channelUrl,
    };
  } catch (err) {
    live = false;
  }

  // Fetch recent VODs
  let vods = [];
  try {
    const vodsPlaylist = await ytdlp.getInfo(`https://www.twitch.tv/${channel}/videos`, { flatPlaylist: true });
    vods = (vodsPlaylist.entries || []).slice(0, 24).map((v) => {
      const rawId = String(v.id || '').replace(/^v/, '');
      return {
        id: v.id,
        rawId,
        title: v.title || 'Untitled Broadcast',
        duration: v.duration || null,
        url: v.url || `https://www.twitch.tv/videos/${rawId}`,
        thumbnail: v.thumbnail || (v.thumbnails && v.thumbnails[0]?.url) || null,
        uploader: v.uploader || channel,
      };
    });
  } catch (_) {
    vods = [];
  }

  res.json({
    channel,
    live,
    channelUrl,
    stream: streamInfo,
    vods,
  });
});

// Fetch info for a specific VOD
router.get('/vod-info', async (req, res) => {
  const { url } = req.query || {};
  if (!url) return res.status(400).json({ error: 'url query parameter is required' });

  try {
    const info = await ytdlp.getInfo(url);
    const formats = (info.formats || []).map((f) => ({
      format_id: f.format_id,
      resolution: f.resolution || (f.height ? `${f.height}p` : null),
      height: f.height,
      fps: f.fps,
      vcodec: f.vcodec,
      tbr: f.tbr,
      note: f.format_note,
    }));

    res.json({
      id: info.id,
      title: info.title,
      duration: info.duration,
      uploader: info.uploader,
      thumbnail: info.thumbnail,
      formats,
      url,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Enqueue a Twitch live stream or VOD download with specialized options
router.post('/download', (req, res) => {
  const {
    url,
    channel,
    isLive = false,
    waitForLive = false,
    waitInterval = 15,
    quality = '',
    container = 'mp4',
    twitchChat = false,
    hlsUseMpegts = true,
    downloadSections = '',
    audioOnly = false,
    twitchAuthToken = '',
  } = req.body || {};

  let targetUrl = (url || '').trim();
  if (!targetUrl && channel) {
    targetUrl = `https://www.twitch.tv/${cleanChannelName(channel)}`;
  }

  if (!targetUrl) {
    return res.status(400).json({ error: 'URL or channel is required' });
  }

  const optionsJson = {
    isLive: !!isLive,
    waitForLive: !!waitForLive,
    waitInterval: parseInt(waitInterval, 10) || 15,
    twitchChat: !!twitchChat,
    hlsUseMpegts: hlsUseMpegts !== false,
    downloadSections: downloadSections ? downloadSections.trim() : null,
    twitchAuthToken: twitchAuthToken ? twitchAuthToken.trim() : null,
    isTwitch: true,
  };

  const id = queue.enqueue(targetUrl, {
    quality,
    container,
    audioOnly: !!audioOnly,
    isLive: !!isLive,
    optionsJson,
  });

  res.json({ id, ok: true });
});

// Stop a live recording gracefully (saves stream up to this point)
router.post('/stop/:id', (req, res) => {
  const stopped = queue.stopJob(req.params.id);
  res.json({ ok: true, stopped });
});

// Get Twitch Settings (OAuth auth token & client ID)
router.get('/settings', (req, res) => {
  const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'twitch_auth_token'").get();
  const clientRow = db.prepare("SELECT value FROM settings WHERE key = 'twitch_client_id'").get();
  res.json({
    authToken: tokenRow ? tokenRow.value : '',
    clientId: clientRow ? clientRow.value : '',
  });
});

// Save Twitch Settings
router.post('/settings', (req, res) => {
  const { authToken = '', clientId = '' } = req.body || {};
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('twitch_auth_token', ?)").run(authToken.trim());
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('twitch_client_id', ?)").run(clientId.trim());
  res.json({ ok: true });
});

// List active Twitch recordings and all Twitch jobs
router.get('/jobs', (req, res) => {
  const jobs = db
    .prepare(
      "SELECT * FROM downloads WHERE is_live = 1 OR url LIKE '%twitch.tv%' ORDER BY created_at DESC"
    )
    .all();
  res.json(jobs);
});

module.exports = router;
