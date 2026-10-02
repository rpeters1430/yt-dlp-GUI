// Turns flat yt-dlp channel/playlist listings into plain entries, and pages through a
// listing until it reaches a video the watch already knows about.

const HARD_SCAN_LIMIT = 1000;

function pickThumbnail(node) {
  if (Array.isArray(node.thumbnails) && node.thumbnails.length) {
    const withUrl = node.thumbnails.filter((t) => t && t.url);
    if (withUrl.length) return withUrl[withUrl.length - 1].url;
  }
  return node.thumbnail || null;
}

function publishedAt(node) {
  if (node.timestamp) return new Date(node.timestamp * 1000).toISOString();
  if (node.upload_date && /^\d{8}$/.test(node.upload_date)) {
    const d = node.upload_date;
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return null;
}

// Walks nested entries (a channel's tabs contain the actual videos) and returns
// { id, url, title, duration, thumbnail, publishedAt }, deduplicated by ID in source order
// (newest first for channels and most playlists).
function normalizeEntries(info) {
  const list = [];
  const seen = new Set();
  function walk(node) {
    if (!node) return;
    if (Array.isArray(node.entries)) {
      for (const item of node.entries) walk(item);
    } else if (node.id && (node.url || node.webpage_url || node._type === 'url' || node.title)) {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      list.push({
        id: String(node.id),
        url: node.url || node.webpage_url || `https://www.youtube.com/watch?v=${node.id}`,
        title: node.title || null,
        duration: typeof node.duration === 'number' ? node.duration : null,
        thumbnail: pickThumbnail(node),
        publishedAt: publishedAt(node),
      });
    }
  }
  walk(info);
  return list;
}

// Fetches pages of `pageSize` until a page contains a known ID (boundaryReached), the listing
// runs out (exhausted), or `hardLimit` entries have been requested without finding one
// (saturated — newer videos may have been missed, so the caller reports a partial scan).
// `info` is the first page's raw listing, for channel name/avatar.
async function scanToBoundary({ getInfo, url, knownIds, pageSize = 30, hardLimit = HARD_SCAN_LIMIT }) {
  const entries = [];
  const seen = new Set();
  let firstInfo = null;
  let start = 1;
  let boundaryReached = false;
  let exhausted = false;

  while (start <= hardLimit) {
    const end = Math.min(start + pageSize - 1, hardLimit);
    const info = await getInfo(url, { flatPlaylist: true, playlistStart: start, playlistEnd: end });
    if (!firstInfo) firstInfo = info;
    const page = normalizeEntries(info);
    for (const entry of page) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
      if (knownIds.has(entry.id)) boundaryReached = true;
    }
    if (boundaryReached) break;
    if (page.length < end - start + 1) {
      exhausted = true;
      break;
    }
    start = end + 1;
  }

  return {
    entries,
    info: firstInfo || {},
    boundaryReached,
    exhausted,
    saturated: !boundaryReached && !exhausted,
  };
}

module.exports = { HARD_SCAN_LIMIT, normalizeEntries, scanToBoundary };
