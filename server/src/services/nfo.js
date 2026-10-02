const fs = require('fs');
const path = require('path');

function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// yt-dlp's upload_date is YYYYMMDD; Kodi/Jellyfin's NFO schema wants YYYY-MM-DD for
// <premiered> and a bare YYYY for <year>.
function formatUploadDate(uploadDate) {
  if (!uploadDate || !/^\d{8}$/.test(uploadDate)) return null;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

// Treats each downloaded video as its own "movie" for NFO purposes — the convention Kodi,
// Jellyfin, and Emby all recognize for a single video file with a same-named .nfo sidecar,
// regardless of what kind of library the folder is actually configured as.
function buildNfoXml(info) {
  const premiered = formatUploadDate(info.uploadDate);
  const year = premiered ? premiered.slice(0, 4) : null;
  const runtimeMinutes = info.duration ? Math.round(info.duration / 60) : null;
  const tags = Array.isArray(info.tags) ? info.tags.filter((t) => typeof t === 'string').slice(0, 20) : [];

  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<movie>',
    `  <title>${escapeXml(info.title)}</title>`,
    `  <plot>${escapeXml(info.description || '')}</plot>`,
    info.videoId ? `  <uniqueid type="youtube" default="true">${escapeXml(info.videoId)}</uniqueid>` : null,
    premiered ? `  <premiered>${premiered}</premiered>` : null,
    year ? `  <year>${year}</year>` : null,
    runtimeMinutes ? `  <runtime>${runtimeMinutes}</runtime>` : null,
    info.uploader ? `  <studio>${escapeXml(info.uploader)}</studio>` : null,
    info.uploader ? `  <director>${escapeXml(info.uploader)}</director>` : null,
    '  <genre>YouTube</genre>',
    ...tags.map((t) => `  <tag>${escapeXml(t)}</tag>`),
    info.sourceUrl ? `  <source>${escapeXml(info.sourceUrl)}</source>` : null,
    '</movie>',
    '',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

// A file in a "Season N" folder is a TV-style layout (the "TV show" filename preset): the
// season folder's parent is the show, i.e. the channel. Returns null for any other layout.
function tvLayout(filepath) {
  const seasonDir = path.dirname(filepath);
  const m = /^season\s+(\d+)$/i.exec(path.basename(seasonDir));
  if (!m) return null;
  const showDir = path.dirname(seasonDir);
  if (!showDir || showDir === seasonDir) return null;
  return { season: Number(m[1]), seasonDir, showDir };
}

// Episode NFO for the TV layout: season = upload year, episode = month and day (1002 for
// Oct 2), the same numbers the preset puts in the filename.
function buildEpisodeNfoXml(info, { season } = {}) {
  const aired = formatUploadDate(info.uploadDate);
  const episode = info.uploadDate && /^\d{8}$/.test(info.uploadDate) ? Number(info.uploadDate.slice(4)) : null;
  const runtimeMinutes = info.duration ? Math.round(info.duration / 60) : null;
  const tags = Array.isArray(info.tags) ? info.tags.filter((t) => typeof t === 'string').slice(0, 20) : [];

  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<episodedetails>',
    `  <title>${escapeXml(info.title)}</title>`,
    info.uploader ? `  <showtitle>${escapeXml(info.uploader)}</showtitle>` : null,
    Number.isFinite(season) ? `  <season>${season}</season>` : null,
    episode ? `  <episode>${episode}</episode>` : null,
    `  <plot>${escapeXml(info.description || '')}</plot>`,
    info.videoId ? `  <uniqueid type="youtube" default="true">${escapeXml(info.videoId)}</uniqueid>` : null,
    aired ? `  <aired>${aired}</aired>` : null,
    aired ? `  <premiered>${aired}</premiered>` : null,
    aired ? `  <year>${aired.slice(0, 4)}</year>` : null,
    runtimeMinutes ? `  <runtime>${runtimeMinutes}</runtime>` : null,
    info.uploader ? `  <studio>${escapeXml(info.uploader)}</studio>` : null,
    ...tags.map((t) => `  <tag>${escapeXml(t)}</tag>`),
    info.sourceUrl ? `  <source>${escapeXml(info.sourceUrl)}</source>` : null,
    '</episodedetails>',
    '',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

// tvshow.nfo for the channel's show folder.
function buildShowNfoXml(channel) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<tvshow>',
    `  <title>${escapeXml(channel.title)}</title>`,
    `  <plot>${escapeXml(channel.description || '')}</plot>`,
    channel.channelId ? `  <uniqueid type="youtube" default="true">${escapeXml(channel.channelId)}</uniqueid>` : null,
    `  <studio>${escapeXml(channel.title)}</studio>`,
    '  <genre>YouTube</genre>',
    channel.url ? `  <source>${escapeXml(channel.url)}</source>` : null,
    '</tvshow>',
    '',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

// Channel avatar (poster) and banner (fanart) from a yt-dlp channel listing.
function channelArtwork(channelInfo) {
  const thumbs = Array.isArray(channelInfo && channelInfo.thumbnails) ? channelInfo.thumbnails.filter((t) => t && t.url) : [];
  const byId = (id) => thumbs.find((t) => t.id === id);
  const widest = (list) => list.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  const poster = byId('avatar_uncropped')
    || widest(thumbs.filter((t) => t.width && t.height && t.width === t.height));
  const fanart = byId('banner_uncropped')
    || widest(thumbs.filter((t) => t.width && t.height && t.width > t.height * 2));
  return { posterUrl: poster ? poster.url : null, fanartUrl: fanart ? fanart.url : null };
}

const showsInProgress = new Set();

// Show folders whose channel was looked up successfully, so a channel with no banner (fanart
// stays missing) isn't looked up again for every episode. Failed lookups aren't recorded and
// are retried on the next episode; entries expire so new artwork is eventually picked up.
const SHOW_LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
const SHOW_LOOKUP_MAX = 500;
const showLookups = new Map(); // showDir -> time of last successful lookup

function recentlyLookedUp(showDir) {
  const at = showLookups.get(showDir);
  if (at === undefined) return false;
  if (Date.now() - at < SHOW_LOOKUP_TTL_MS) return true;
  showLookups.delete(showDir);
  return false;
}

function rememberLookup(showDir) {
  showLookups.delete(showDir);
  if (showLookups.size >= SHOW_LOOKUP_MAX) showLookups.delete(showLookups.keys().next().value);
  showLookups.set(showDir, Date.now());
}

// Writes tvshow.nfo, poster.jpg and fanart.jpg into the show folder, each only if missing,
// so files a user replaced by hand are left alone. `fetchChannelInfo(url)` returns the
// channel's yt-dlp listing; it's only called when something is actually missing.
async function writeShowFiles(showDir, info, fetchChannelInfo) {
  if (showsInProgress.has(showDir)) return;
  const nfoPath = path.join(showDir, 'tvshow.nfo');
  const posterPath = path.join(showDir, 'poster.jpg');
  const fanartPath = path.join(showDir, 'fanart.jpg');
  if ([nfoPath, posterPath, fanartPath].every((p) => fs.existsSync(p))) return;
  if (fs.existsSync(nfoPath) && recentlyLookedUp(showDir)) return;

  showsInProgress.add(showDir);
  try {
    let channelInfo = null;
    if (info.channelUrl && fetchChannelInfo) {
      try {
        channelInfo = await fetchChannelInfo(info.channelUrl);
      } catch (err) {
        console.error(`[nfo] Failed to fetch channel info for ${showDir}: ${err.message}`);
      }
    }
    if (!fs.existsSync(nfoPath)) {
      fs.writeFileSync(nfoPath, buildShowNfoXml({
        title: (channelInfo && (channelInfo.channel || channelInfo.uploader || channelInfo.title)) || info.uploader || path.basename(showDir),
        description: channelInfo ? channelInfo.description : '',
        channelId: (channelInfo && channelInfo.channel_id) || info.channelId || null,
        url: info.channelUrl || null,
      }));
    }
    const { posterUrl, fanartUrl } = channelArtwork(channelInfo);
    if (posterUrl && !fs.existsSync(posterPath)) await downloadThumbnail(posterUrl, posterPath);
    if (fanartUrl && !fs.existsSync(fanartPath)) await downloadThumbnail(fanartUrl, fanartPath);
    // Remember only a complete success: the lookup worked and every image it offered was saved.
    const saved = (url, p) => !url || fs.existsSync(p);
    if (channelInfo && saved(posterUrl, posterPath) && saved(fanartUrl, fanartPath)) rememberLookup(showDir);
  } catch (err) {
    console.error(`[nfo] Failed to write show files for ${showDir}: ${err.message}`);
  } finally {
    showsInProgress.delete(showDir);
  }
}

// Best-effort — a thumbnail fetch failure shouldn't fail the whole download or block the NFO
// from being written.
async function downloadThumbnail(url, destPath) {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return true;
  } catch (err) {
    console.error(`[nfo] Failed to fetch thumbnail for ${destPath}: ${err.message}`);
    return false;
  }
}

// Writes a same-named .nfo and poster image next to a downloaded video — the layout Kodi,
// Jellyfin, and Emby all scrape automatically for a single video file, so title/plot/artwork
// show up reliably instead of depending on each media server's support for reading metadata
// embedded inside the MP4/MKV container itself.
//
// In the TV layout (a "Season N" folder) the .nfo is an episode instead, and the show folder
// above it gets the channel's tvshow.nfo and artwork.
async function writeSidecarFiles(filepath, info, { fetchChannelInfo = null } = {}) {
  if (!filepath) return;
  const ext = path.extname(filepath);
  const base = filepath.slice(0, filepath.length - ext.length);
  const tv = tvLayout(filepath);

  try {
    fs.writeFileSync(`${base}.nfo`, tv ? buildEpisodeNfoXml(info, tv) : buildNfoXml(info));
  } catch (err) {
    console.error(`[nfo] Failed to write .nfo for ${filepath}: ${err.message}`);
  }

  if (info.thumbnailUrl) {
    // A same-named .jpg is the poster for a movie and the still for an episode.
    await downloadThumbnail(info.thumbnailUrl, `${base}.jpg`);
  }

  if (tv) await writeShowFiles(tv.showDir, info, fetchChannelInfo);
}

module.exports = {
  writeSidecarFiles,
  writeShowFiles,
  buildNfoXml,
  buildEpisodeNfoXml,
  buildShowNfoXml,
  channelArtwork,
  tvLayout,
  _resetShowLookups: () => showLookups.clear(),
};
