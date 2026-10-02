// YouTube channel tabs. A bare channel URL (youtube.com/@name) makes yt-dlp return one nested
// playlist per tab, and --playlist-start/--playlist-end then page over the *tabs* rather than
// the videos — so a watch on a channel URL could never scan past its first page, and Shorts
// (which have no duration in a flat listing) slipped past duration filters. Watches on a
// channel URL therefore scan each selected tab's own URL instead.

const CONTENT_TYPES = ['videos', 'shorts', 'streams'];
const DEFAULT_CONTENT_TYPES = ['videos'];

const CHANNEL_ROOT_RE = /^(https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:@[^/?#]+|channel\/[\w-]+|c\/[^/?#]+|user\/[^/?#]+))(?:\/(?:featured|home))?\/?(?:[?#].*)?$/i;

// The channel's base URL (no tab, no query) when `url` is a bare YouTube channel page, else null.
function channelRoot(url) {
  const m = CHANNEL_ROOT_RE.exec(String(url || '').trim());
  return m ? m[1] : null;
}

// Parses a stored or submitted list ("videos,shorts" or an array) into known types, in
// canonical order. Returns null for "not set".
function parseContentTypes(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const wanted = new Set(raw.map((v) => String(v).trim().toLowerCase()).filter(Boolean));
  return CONTENT_TYPES.filter((t) => wanted.has(t));
}

// Error message for a submitted content type list, or null when it's usable.
function validateContentTypes(value) {
  if (value === null || value === undefined) return null;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const bad = raw.map((v) => String(v).trim().toLowerCase()).filter((v) => v && !CONTENT_TYPES.includes(v));
  if (bad.length) return `Unknown content type: ${bad.join(', ')}`;
  if (!(parseContentTypes(value) || []).length) return 'Pick at least one of Videos, Shorts, or Streams';
  return null;
}

// The tabs a watch follows. A watch saved before tabs existed (content_types NULL) keeps
// following everything the bare channel URL used to return.
function watchContentTypes(watch) {
  return parseContentTypes(watch.content_types) || [...CONTENT_TYPES];
}

// What to scan for a watch: one source per selected tab for a channel URL, or the URL as-is.
function scanSources(watch) {
  const root = channelRoot(watch.url);
  if (!root) return [{ tab: null, url: watch.url }];
  return watchContentTypes(watch).map((tab) => ({ tab, url: `${root}/${tab}` }));
}

// Merges per-tab listings (each newest first) into one newest-first list. Flat channel
// listings usually carry no dates, so tabs are interleaved by position — the nth newest of
// each tab together — and only when every entry has a date are they sorted by it instead.
function mergeNewestFirst(lists) {
  const merged = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (i < list.length) merged.push(list[i]);
  }
  if (merged.length && merged.every((e) => e.publishedAt)) {
    return merged
      .map((e, i) => ({ e, i }))
      .sort((a, b) => (a.e.publishedAt < b.e.publishedAt ? 1 : a.e.publishedAt > b.e.publishedAt ? -1 : a.i - b.i))
      .map(({ e }) => e);
  }
  return merged;
}

// yt-dlp's error when a channel simply has no such tab (e.g. no live streams ever).
function isMissingTabError(message) {
  return /does not have an? \w+ tab/i.test(String(message || ''));
}

module.exports = {
  CONTENT_TYPES,
  DEFAULT_CONTENT_TYPES,
  channelRoot,
  parseContentTypes,
  validateContentTypes,
  watchContentTypes,
  scanSources,
  mergeNewestFirst,
  isMissingTabError,
};
