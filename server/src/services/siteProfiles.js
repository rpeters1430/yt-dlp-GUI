const { spawn } = require('child_process');

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';

// Per-site knowledge that yt-dlp's `-J` output can't tell us on its own. Everything that *can*
// be read from the probe (formats, subtitles, chapters, live status, auth/DRM) is derived per
// link in getCapabilities() instead, so it stays current as yt-dlp updates its extractors.
//
// `extractors` is matched against yt-dlp's extractor_key (e.g. "Youtube", "TwitchVod") or,
// failing that, its lowercase `extractor` name (e.g. "twitch:vod"). `domains` is only the
// pre-probe fallback for a pasted URL that hasn't been analyzed yet.
//
// Feature flags:
//   sponsorblock  — SponsorBlock's database only catalogs YouTube video IDs.
//   autoSubs      — pre-probe guess only; after a probe, `automatic_captions` decides.
// liveFromStart isn't a flag here: it's read from the installed yt-dlp's own --help text
// (see refreshYtdlpFacts) so it tracks yt-dlp's supported list without code changes.
const SITE_PROFILES = [
  {
    id: 'youtube',
    name: 'YouTube & YouTube Music',
    extractors: /^youtube/i,
    domains: ['youtube.com', 'youtu.be', 'music.youtube.com', 'youtube-nocookie.com'],
    features: { sponsorblock: true, autoSubs: true },
    guide: {
      category: 'Video & Music',
      video: true,
      audio: true,
      live: true,
      subtitles: 'Manual & Auto-generated',
      cookies: 'Optional (needed for age-gate/members)',
      notes: 'Full feature support: 4K/8K, live broadcast rewind (--live-from-start), auto captions, and SponsorBlock segment removal.',
    },
  },
  {
    id: 'twitch',
    name: 'Twitch',
    extractors: /^twitch/i,
    domains: ['twitch.tv'],
    features: {},
    guide: {
      category: 'Live & VOD',
      video: true,
      audio: true,
      live: true,
      subtitles: 'Chat replay',
      cookies: 'Optional (needed for sub-only VODs)',
      notes: 'Live capture and VOD downloads. Sub-only content requires Twitch auth-token in Settings or Twitch tab.',
    },
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    extractors: /^soundcloud/i,
    domains: ['soundcloud.com'],
    features: {},
    guide: {
      category: 'Music & Audio',
      video: false,
      audio: true,
      live: false,
      subtitles: 'None',
      cookies: 'Optional (needed for Go+ tracks)',
      notes: 'Pure audio platform. Downloads highest quality audio stream with embedded metadata and cover artwork.',
    },
  },
  {
    id: 'bandcamp',
    name: 'Bandcamp',
    extractors: /^bandcamp/i,
    domains: ['bandcamp.com'],
    features: {},
    guide: {
      category: 'Music & Audio',
      video: false,
      audio: true,
      live: false,
      subtitles: 'None',
      cookies: 'Not needed',
      notes: 'Individual tracks and full albums supported. Preserves pristine audio quality and album metadata.',
    },
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    extractors: /^vimeo/i,
    domains: ['vimeo.com'],
    features: {},
    guide: {
      category: 'Video',
      video: true,
      audio: true,
      live: true,
      subtitles: 'Manual CC (if uploaded)',
      cookies: 'Optional (needed for private links)',
      notes: 'Supports up to original 4K uploads. Subtitles are automatically converted to SRT for seamless MP4 container embedding.',
    },
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    extractors: /^tiktok/i,
    domains: ['tiktok.com'],
    features: {},
    guide: {
      category: 'Social Media',
      video: true,
      audio: true,
      live: false,
      subtitles: 'Limited',
      cookies: 'Recommended for age-gated clips',
      notes: 'Downloads high quality videos without platform watermarks where available. Audio-only tracks also supported.',
    },
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    extractors: /^twitter/i,
    domains: ['twitter.com', 'x.com'],
    features: {},
    guide: {
      category: 'Social Media',
      video: true,
      audio: true,
      live: true,
      subtitles: 'Limited',
      cookies: 'Recommended (frequent rate-limits)',
      notes: 'Pulls the highest bitrate video variant. Logged-in cookies help prevent aggressive unauthenticated rate limits.',
    },
  },
  {
    id: 'reddit',
    name: 'Reddit',
    extractors: /^reddit$/i,
    domains: ['reddit.com', 'v.redd.it'],
    features: {},
    guide: {
      category: 'Social Media',
      video: true,
      audio: true,
      live: false,
      subtitles: 'None',
      cookies: 'Optional (needed for NSFW posts)',
      notes: 'Automatically downloads and merges separate video and audio DASH streams into a single synchronized MP4 or MKV.',
    },
  },
  {
    id: 'instagram',
    name: 'Instagram',
    extractors: /^instagram/i,
    domains: ['instagram.com'],
    features: {},
    guide: {
      category: 'Social Media',
      video: true,
      audio: true,
      live: false,
      subtitles: 'None',
      cookies: 'Required for most content',
      notes: 'Reels, Posts, and Stories. Instagram heavily gates media behind user sessions, so cookies.txt is recommended.',
    },
  },
  {
    id: 'facebook',
    name: 'Facebook',
    extractors: /^facebook/i,
    domains: ['facebook.com', 'fb.watch'],
    features: {},
    guide: {
      category: 'Social Media',
      video: true,
      audio: true,
      live: true,
      subtitles: 'Limited',
      cookies: 'Optional (needed for private/groups)',
      notes: 'Public posts and reels download freely. Private group videos require cookies.',
    },
  },
  {
    id: 'bilibili',
    name: 'Bilibili',
    extractors: /^bili/i,
    domains: ['bilibili.com'],
    features: {},
    guide: {
      category: 'Video',
      video: true,
      audio: true,
      live: true,
      subtitles: 'Danmaku / CC',
      cookies: 'Recommended for 1080p+ / 4K',
      notes: 'Standard downloads max out at 480p/720p without an account; VIP cookies unlock 1080p60 and 4K streams.',
    },
  },
  {
    id: 'kick',
    name: 'Kick',
    // Anchored so it doesn't also claim yt-dlp's unrelated "Kickstarter" extractor.
    extractors: /^kick(vod|clip)?$/i,
    domains: ['kick.com'],
    features: {},
    guide: {
      category: 'Live & VOD',
      video: true,
      audio: true,
      live: true,
      subtitles: 'None',
      cookies: 'Not needed',
      notes: 'Captures ongoing live streams and archives past VODs.',
    },
  },
];

const GENERIC_PROFILE = {
  id: 'generic',
  name: null, // filled in from the extractor name when known
  extractors: null,
  domains: [],
  features: {},
  guide: null,
};

// ---- Facts read from the installed yt-dlp itself ----------------------------------------

// Fallback used until the first `yt-dlp --help` read completes (or if it fails): the list as
// of yt-dlp 2026.08.19. Kept as yt-dlp's display names; compared via normalizeName().
const DEFAULT_LIVE_FROM_START_SITES = ['YouTube', 'Twitch', 'TVer', 'mellow-fan'];

let ytdlpFacts = {
  liveFromStartSites: DEFAULT_LIVE_FROM_START_SITES,
  source: 'default',
};

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Pulls the "only supported for YouTube, Twitch, TVer, and mellow-fan" sentence out of the
// --live-from-start help entry. Returns null if the wording has changed beyond recognition,
// so the caller keeps its previous list rather than silently disabling the feature.
function parseLiveFromStartSites(helpText) {
  const match = /--live-from-start\s+([\s\S]*?)(?:\n\s*--|$)/.exec(String(helpText || ''));
  if (!match) return null;
  const description = match[1].replace(/\s+/g, ' ');
  const listMatch = /supported\s+for\s+(.+?)(?:\.|$)/i.exec(description);
  if (!listMatch) return null;
  const sites = listMatch[1]
    .split(/,|\band\b/i)
    .map((name) => name.trim())
    .filter((name) => normalizeName(name));
  return sites.length ? sites : null;
}

let refreshInFlight = null;

// Re-reads facts from the installed yt-dlp. Called at startup and after every yt-dlp update.
function refreshYtdlpFacts() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = new Promise((resolve) => {
    let stdout = '';
    let proc;
    try {
      proc = spawn(YTDLP_BIN, ['--help']);
    } catch (_) {
      refreshInFlight = null;
      return resolve(ytdlpFacts);
    }
    proc.stdout.on('data', (d) => (stdout += d));
    proc.on('close', () => {
      const sites = parseLiveFromStartSites(stdout);
      if (sites) {
        ytdlpFacts = { liveFromStartSites: sites, source: 'yt-dlp --help' };
      }
      refreshInFlight = null;
      resolve(ytdlpFacts);
    });
    proc.on('error', () => {
      refreshInFlight = null;
      resolve(ytdlpFacts);
    });
  });
  return refreshInFlight;
}

function getYtdlpFacts() {
  return ytdlpFacts;
}

function supportsLiveFromStart(extractorKey, extractor, profile) {
  const candidates = [extractorKey, extractor, profile && profile.id !== 'generic' ? profile.id : null]
    .map(normalizeName)
    .filter(Boolean);
  return candidates.some((c) => ytdlpFacts.liveFromStartSites.some((site) => c.startsWith(normalizeName(site))));
}

// ---- Profile matching -------------------------------------------------------------------

function hostOf(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const looksLikeHostWithoutScheme = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw);
    const normalized = raw.startsWith('//')
      ? `https:${raw}`
      : (looksLikeHostWithoutScheme ? `https://${raw}` : raw);
    return new URL(normalized).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

function matchProfile({ url = null, extractor = null, extractorKey = null } = {}) {
  for (const key of [extractorKey, extractor]) {
    if (!key) continue;
    const found = SITE_PROFILES.find((p) => p.extractors.test(key));
    if (found) return found;
  }
  // An extractor name we don't have a profile for is authoritative: don't let the URL's
  // domain override what yt-dlp says actually handled the link.
  if (!extractorKey && !extractor) {
    if (/^ytsearch/i.test(String(url || '').trim())) return SITE_PROFILES[0];
    const host = hostOf(url);
    if (host) {
      const found = SITE_PROFILES.find((p) => p.domains.some((d) => host === d || host.endsWith(`.${d}`)));
      if (found) return found;
    }
  }
  return GENERIC_PROFILE;
}

// ---- Capabilities -----------------------------------------------------------------------

function siteSummary(profile, extractor, extractorKey) {
  return {
    id: profile.id,
    name: profile.name || extractorKey || extractor || 'Generic',
    extractor: extractor || null,
    extractorKey: extractorKey || null,
  };
}

// Best guess from the URL alone, before (or without) a yt-dlp probe. Media facts that only a
// probe can answer are left null ("unknown") so callers don't strip options on a guess.
function capabilitiesFromUrl(url, extractor = null) {
  const profile = matchProfile({ url, extractor });
  return {
    probed: false,
    site: siteSummary(profile, extractor, null),
    sponsorblock: !!profile.features.sponsorblock,
    liveFromStart: supportsLiveFromStart(null, extractor, profile),
    autoSubs: !!profile.features.autoSubs,
    video: null,
    audio: null,
    audioOnlyMedia: null,
    subtitles: null,
    hasSubtitles: null,
    chapters: null,
    thumbnail: null,
    thumbnailFormat: null,
    thumbnailConvertible: null,
    thumbnailFallbackUrl: null,
    liveStatus: null,
    needsAuth: null,
    drm: null,
    warnings: [],
  };
}

function thumbnailExt(thumb) {
  const fromUrl = (() => {
    try {
      return (new URL(thumb.url).pathname.match(/\.([a-z0-9]+)$/i) || [])[1];
    } catch (_) {
      return null;
    }
  })();
  return String(thumb.ext || fromUrl || '').toLowerCase().replace('jpeg', 'jpg') || null;
}

// Formats yt-dlp's thumbnail convertor can read: it forces ffmpeg's image2 demuxer, which
// has no AVIF (or other ISOBMFF image) mapping, so an AVIF thumbnail fails the embed step
// with "Error opening output files: Invalid argument" after the whole video downloaded.
// MKV output attaches the file as-is and needs no conversion.
const CONVERTIBLE_THUMBNAIL_EXTS = new Set(['jpg', 'png', 'webp', 'gif', 'bmp']);

// yt-dlp's -J output has thumbnails already sorted by preference; it embeds the last one.
// Reports that one's format and, if it isn't convertible, a JPG/PNG alternative to embed
// ourselves after the download (see ytdlp.embedThumbnailFromUrl).
function thumbnailInfo(info) {
  const thumbs = Array.isArray(info.thumbnails) ? info.thumbnails.filter((t) => t && t.url) : [];
  if (thumbs.length === 0) {
    return info.thumbnail ? { ext: null, convertible: true, fallbackUrl: null } : null;
  }
  const ext = thumbnailExt(thumbs[thumbs.length - 1]);
  const convertible = !ext || CONVERTIBLE_THUMBNAIL_EXTS.has(ext);
  const fallback = convertible
    ? null
    : [...thumbs].reverse().find((t) => ['jpg', 'png'].includes(thumbnailExt(t)));
  return { ext, convertible, fallbackUrl: fallback ? fallback.url : null };
}

function langKeys(obj) {
  if (!obj || typeof obj !== 'object') return [];
  // yt-dlp puts YouTube's live chat replay under subtitles.live_chat; it's not a caption track.
  return Object.keys(obj).filter((k) => k !== 'live_chat' && Array.isArray(obj[k]) && obj[k].length > 0);
}

// Combines one link's live `yt-dlp -J` output with the matching site profile. For a playlist
// probed with --flat-playlist, entry-level facts (formats, subtitles) are unknown and left null.
function getCapabilities(info, url = null) {
  if (!info || typeof info !== 'object') return capabilitiesFromUrl(url);

  const extractorKey = info.extractor_key || info.ie_key || null;
  const extractor = info.extractor || null;
  const profile = matchProfile({ url, extractor, extractorKey });
  const isPlaylist = info._type === 'playlist' || Array.isArray(info.entries);

  const formats = Array.isArray(info.formats) ? info.formats : null;
  const hasFormats = !!(formats && formats.length);
  // A missing vcodec means "unknown", not "no video" — plain progressive MP4s on many sites
  // carry no codec info at all. Only an explicit 'none' / "audio only" marks an audio format.
  const isAudioFormat = (f) => f.vcodec === 'none' || f.video_ext === 'none' || f.resolution === 'audio only';
  // audio_ext isn't used here: yt-dlp reports it as 'none' even when acodec is just unknown.
  const isVideoOnlyFormat = (f) => f.acodec === 'none';
  const audioOnlyMedia = hasFormats ? formats.every(isAudioFormat) : null;
  const hasVideo = hasFormats ? !audioOnlyMedia : null;
  const hasAudio = hasFormats ? !formats.every(isVideoOnlyFormat) : null;

  const manualSubs = isPlaylist ? null : langKeys(info.subtitles);
  const autoSubs = isPlaylist ? null : langKeys(info.automatic_captions);
  const hasSubtitles = isPlaylist ? null : (manualSubs.length > 0 || autoSubs.length > 0);

  const thumb = isPlaylist ? null : thumbnailInfo(info);
  const liveStatus = info.live_status || (info.is_live ? 'is_live' : null);
  const availability = info.availability || null;
  const needsAuth = ['needs_auth', 'premium_only', 'subscriber_only'].includes(availability);
  const drm = !!(info._has_drm || (hasFormats && formats.every((f) => f.has_drm)));

  const warnings = [];
  if (drm) warnings.push('This media is DRM-protected; yt-dlp cannot download it.');
  if (needsAuth) warnings.push(`This media is marked "${availability.replace(/_/g, ' ')}"; it will likely need cookies from a logged-in account (Settings → Cookies).`);

  return {
    probed: !isPlaylist,
    site: siteSummary(profile, extractor, extractorKey),
    sponsorblock: !!profile.features.sponsorblock,
    liveFromStart: supportsLiveFromStart(extractorKey, extractor, profile),
    autoSubs: isPlaylist ? !!profile.features.autoSubs : autoSubs.length > 0,
    video: hasVideo,
    audio: hasAudio,
    audioOnlyMedia,
    subtitles: isPlaylist ? null : { manual: manualSubs, auto: autoSubs },
    hasSubtitles,
    chapters: isPlaylist ? null : (Array.isArray(info.chapters) && info.chapters.length > 0),
    thumbnail: isPlaylist ? null : !!thumb,
    thumbnailFormat: thumb ? thumb.ext : null,
    thumbnailConvertible: thumb ? thumb.convertible : null,
    thumbnailFallbackUrl: thumb ? thumb.fallbackUrl : null,
    liveStatus,
    needsAuth,
    drm,
    warnings,
  };
}

// Shapes the profiles into the Supported Sites guide's existing `majorSites` format.
function guideSites() {
  return SITE_PROFILES.filter((p) => p.guide).map((p) => ({
    id: p.id,
    name: p.name,
    domains: p.domains.filter((d) => d !== 'youtube-nocookie.com'),
    ...p.guide,
    sponsorblock: !!p.features.sponsorblock,
    liveRewind: supportsLiveFromStart(null, null, p),
  }));
}

module.exports = {
  SITE_PROFILES,
  matchProfile,
  getCapabilities,
  capabilitiesFromUrl,
  guideSites,
  refreshYtdlpFacts,
  getYtdlpFacts,
  parseLiveFromStartSites,
};
