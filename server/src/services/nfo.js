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
async function writeSidecarFiles(filepath, info) {
  if (!filepath) return;
  const ext = path.extname(filepath);
  const base = filepath.slice(0, filepath.length - ext.length);

  try {
    fs.writeFileSync(`${base}.nfo`, buildNfoXml(info));
  } catch (err) {
    console.error(`[nfo] Failed to write .nfo for ${filepath}: ${err.message}`);
  }

  if (info.thumbnailUrl) {
    await downloadThumbnail(info.thumbnailUrl, `${base}.jpg`);
  }
}

module.exports = { writeSidecarFiles, buildNfoXml };
