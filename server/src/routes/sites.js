const express = require('express');
const { spawn } = require('child_process');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';

const MAJOR_SITES = [
  {
    id: 'youtube',
    name: 'YouTube & YouTube Music',
    domains: ['youtube.com', 'youtu.be', 'music.youtube.com'],
    category: 'Video & Music',
    video: true,
    audio: true,
    live: true,
    liveRewind: true,
    subtitles: 'Manual & Auto-generated',
    sponsorblock: true,
    cookies: 'Optional (needed for age-gate/members)',
    notes: 'Full feature support: 4K/8K, live broadcast rewind (--live-from-start), auto captions, and SponsorBlock segment removal.',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    domains: ['twitch.tv'],
    category: 'Live & VOD',
    video: true,
    audio: true,
    live: true,
    liveRewind: false,
    subtitles: 'Chat replay',
    sponsorblock: false,
    cookies: 'Optional (needed for sub-only VODs)',
    notes: 'Live edge capture and VOD downloads. Sub-only content requires Twitch auth-token in Settings or Twitch tab. Live rewind not supported.',
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    domains: ['soundcloud.com'],
    category: 'Music & Audio',
    video: false,
    audio: true,
    live: false,
    liveRewind: false,
    subtitles: 'None',
    sponsorblock: false,
    cookies: 'Optional (needed for Go+ tracks)',
    notes: 'Pure audio platform. Downloads highest quality audio stream with embedded metadata and cover artwork.',
  },
  {
    id: 'bandcamp',
    name: 'Bandcamp',
    domains: ['bandcamp.com'],
    category: 'Music & Audio',
    video: false,
    audio: true,
    live: false,
    liveRewind: false,
    subtitles: 'None',
    sponsorblock: false,
    cookies: 'Not needed',
    notes: 'Individual tracks and full albums supported. Preserves pristine audio quality and album metadata.',
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    domains: ['vimeo.com'],
    category: 'Video',
    video: true,
    audio: true,
    live: true,
    liveRewind: false,
    subtitles: 'Manual CC (if uploaded)',
    sponsorblock: false,
    cookies: 'Optional (needed for private links)',
    notes: 'Supports up to original 4K uploads. Subtitles are automatically converted to SRT for seamless MP4 container embedding.',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    domains: ['tiktok.com'],
    category: 'Social Media',
    video: true,
    audio: true,
    live: false,
    liveRewind: false,
    subtitles: 'Limited',
    sponsorblock: false,
    cookies: 'Recommended for age-gated clips',
    notes: 'Downloads high quality videos without platform watermarks where available. Audio-only tracks also supported.',
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    domains: ['twitter.com', 'x.com'],
    category: 'Social Media',
    video: true,
    audio: true,
    live: true,
    liveRewind: false,
    subtitles: 'Limited',
    sponsorblock: false,
    cookies: 'Recommended (frequent rate-limits)',
    notes: 'Pulls the highest bitrate video variant. Logged-in cookies help prevent aggressive unauthenticated rate limits.',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    domains: ['reddit.com', 'v.redd.it'],
    category: 'Social Media',
    video: true,
    audio: true,
    live: false,
    liveRewind: false,
    subtitles: 'None',
    sponsorblock: false,
    cookies: 'Optional (needed for NSFW posts)',
    notes: 'Automatically downloads and merges separate video and audio DASH streams into a single synchronized MP4 or MKV.',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    domains: ['instagram.com'],
    category: 'Social Media',
    video: true,
    audio: true,
    live: false,
    liveRewind: false,
    subtitles: 'None',
    sponsorblock: false,
    cookies: 'Required for most content',
    notes: 'Reels, Posts, and Stories. Instagram heavily gates media behind user sessions, so cookies.txt is recommended.',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    domains: ['facebook.com', 'fb.watch'],
    category: 'Social Media',
    video: true,
    audio: true,
    live: true,
    liveRewind: false,
    subtitles: 'Limited',
    sponsorblock: false,
    cookies: 'Optional (needed for private/groups)',
    notes: 'Public posts and reels download freely. Private group videos require cookies.',
  },
  {
    id: 'bilibili',
    name: 'Bilibili',
    domains: ['bilibili.com'],
    category: 'Video',
    video: true,
    audio: true,
    live: true,
    liveRewind: false,
    subtitles: 'Danmaku / CC',
    sponsorblock: false,
    cookies: 'Recommended for 1080p+ / 4K',
    notes: 'Standard downloads max out at 480p/720p without an account; VIP cookies unlock 1080p60 and 4K streams.',
  },
  {
    id: 'kick',
    name: 'Kick',
    domains: ['kick.com'],
    category: 'Live & VOD',
    video: true,
    audio: true,
    live: true,
    liveRewind: false,
    subtitles: 'None',
    sponsorblock: false,
    cookies: 'Not needed',
    notes: 'Captures ongoing live streams from the live edge and archives past VODs.',
  },
];

const FEATURE_RULES = [
  {
    id: 'sponsorblock',
    title: 'SponsorBlock Segment Removal',
    appliesTo: 'YouTube only',
    status: 'youtube_only',
    description: 'SponsorBlock is powered by a community-maintained database (sponsor.ajay.app) which strictly catalogs YouTube video IDs. The GUI automatically suppresses SponsorBlock flags on non-YouTube links so downloads don’t print unsupported warnings.',
  },
  {
    id: 'subtitles',
    title: 'Subtitles & Closed Captions',
    appliesTo: 'YouTube (Auto & Manual) · Select platforms (Manual only)',
    status: 'varies',
    description: 'Automatic speech-to-text captions (--write-auto-subs) are exclusive to YouTube. Other platforms (like Vimeo or TED) only support subtitles if the uploader provided manual caption files. The GUI automatically converts WebVTT to SRT to ensure smooth embedding into MP4 files without FFmpeg codec errors.',
  },
  {
    id: 'live_rewind',
    title: 'Live Stream Rewind (--live-from-start)',
    appliesTo: 'YouTube DASH Live only',
    status: 'youtube_only',
    description: 'Joining an in-progress live broadcast and recording from its beginning requires a multi-period DASH manifest with rolling stream history. Only YouTube currently provides this; all other live platforms (Twitch, Kick, Facebook) can only be captured from the current live moment forward.',
  },
  {
    id: 'cookies',
    title: 'Cookies & Authentication',
    appliesTo: 'Any site with login or paywall',
    status: 'supported',
    description: 'Saving your Netscape cookies.txt file in the Settings tab allows yt-dlp to access age-restricted videos, private channels, members-only YouTube streams, and bypass Instagram/Twitter rate limits.',
  },
  {
    id: 'drm',
    title: 'DRM-Protected Content',
    appliesTo: 'Not supported on any site',
    status: 'unsupported',
    description: 'yt-dlp is an extractor tool, not a DRM bypass utility. Content locked behind Widevine, PlayReady, or FairPlay encryption (Netflix, Spotify, Hulu, Disney+, Amazon Prime) cannot be downloaded.',
  },
];

let cachedExtractors = null;
let cachedExtractorsTime = 0;

function fetchExtractors() {
  return new Promise((resolve) => {
    // Cache for 1 hour
    if (cachedExtractors && Date.now() - cachedExtractorsTime < 3600000) {
      return resolve(cachedExtractors);
    }
    const proc = spawn(YTDLP_BIN, ['--extractor-descriptions']);
    let stdout = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.on('close', (code) => {
      if (code !== 0 || !stdout) {
        cachedExtractors = [];
        return resolve([]);
      }
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const list = lines.map((line) => {
        const idx = line.indexOf(': ');
        if (idx !== -1) {
          return {
            name: line.substring(0, idx).trim(),
            description: line.substring(idx + 2).trim(),
          };
        }
        return { name: line, description: line };
      });
      cachedExtractors = list;
      cachedExtractorsTime = Date.now();
      resolve(list);
    });
    proc.on('error', () => {
      cachedExtractors = [];
      resolve([]);
    });
  });
}

// GET /api/sites/guide — returns structured major site info & feature rules
router.get('/guide', (req, res) => {
  res.json({
    majorSites: MAJOR_SITES,
    rules: FEATURE_RULES,
  });
});

// GET /api/sites/extractors?q=... — returns searchable list of all 1,700+ supported extractors
router.get('/extractors', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const all = await fetchExtractors();
  if (!q) {
    return res.json({ total: all.length, extractors: all.slice(0, 100) });
  }
  const filtered = all.filter(
    (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
  );
  res.json({
    total: filtered.length,
    extractors: filtered.slice(0, 100),
  });
});

module.exports = router;
