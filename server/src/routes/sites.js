const express = require('express');
const { spawn } = require('child_process');
const { requireAuth } = require('../auth');
const siteProfiles = require('../services/siteProfiles');

const router = express.Router();
router.use(requireAuth);

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';

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
    appliesTo: 'Sites listed by the installed yt-dlp',
    status: 'varies',
    description: 'Joining an in-progress live broadcast and recording from its beginning needs the site to expose the stream history. The supported list is read from the installed yt-dlp and updates with it; everywhere else, recording starts from the current live moment.',
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
  const { liveFromStartSites } = siteProfiles.getYtdlpFacts();
  res.json({
    majorSites: siteProfiles.guideSites(),
    rules: FEATURE_RULES,
    liveFromStartSites,
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
