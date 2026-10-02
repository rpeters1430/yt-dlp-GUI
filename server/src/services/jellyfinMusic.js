const jellyfin = require('./jellyfin');

// Answers "is this album/song already in the Jellyfin music library?" for the Music Hub, so
// search results can flag what's already owned and downloads can skip it. Matching goes by
// artist + name through Jellyfin's API rather than file paths, so it works no matter which
// folder Jellyfin's music library points at (it doesn't have to be this app's music folder).
//
// Jellyfin's SearchTerm only matches an item's own name (a song's title, never its album), so
// instead of searching per album the whole music library is pulled once into an in-memory
// index and matched locally. The index is cached briefly and rebuilt on demand.

const INDEX_TTL_MS = 5 * 60 * 1000;

// Lowercased, accent-free, punctuation-free form of a name ("Beyoncé & Jay-Z" -> "beyonce and jay z").
function normText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Words that mark a " - ..." suffix as an edition/version note rather than part of the name.
const EDITION_WORDS = /\b(single|ep|remaster(ed)?|deluxe|edition|version|live|edit|mix|mono|stereo|bonus|anniversary|expanded|explicit|clean|acoustic|demo|instrumental)\b/i;

// The name with edition noise removed, so Apple's "Abbey Road (Remastered) - Single" and a
// library's "Abbey Road" compare equal: bracketed parts, "feat." credits and edition-style
// " - ..." suffixes are dropped. Falls back to the plain normalized name if nothing is left.
function baseName(value) {
  let s = String(value || '');
  s = s.replace(/\s*[([{][^)\]}]*[)\]}]/g, ' ');
  s = s.replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '');
  s = s.replace(/\s+-\s+([^-]+)$/, (whole, suffix) => (EDITION_WORDS.test(suffix) ? '' : whole));
  const base = normText(s);
  return base || normText(value);
}

function stripThe(name) {
  return name.replace(/^the /, '');
}

// Every individual artist credited in a string ("A feat. B & C" -> a, b, c), plus the whole
// credit itself, so "A & B" still matches a library that tags the duo as one artist.
function artistKeys(...credits) {
  const keys = new Set();
  for (const credit of credits.flat()) {
    if (!credit) continue;
    const whole = stripThe(normText(credit));
    if (whole) keys.add(whole);
    for (const part of String(credit).split(/\s*(?:,|;|\/|&|\bfeat\b\.?|\bft\b\.?|\bfeaturing\b)\s*/i)) {
      const k = stripThe(normText(part));
      if (k) keys.add(k);
    }
  }
  return keys;
}

function artistsOverlap(wanted, have) {
  if (wanted.size === 0) return true;
  for (const k of wanted) if (have.has(k)) return true;
  return false;
}

function pushTo(map, key, value) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function buildIndex(albumItems, audioItems) {
  const albumsByBase = new Map();
  const tracksByBase = new Map();
  const tracksByAlbumBase = new Map();

  for (const a of albumItems || []) {
    if (!a || !a.Name) continue;
    const album = {
      id: a.Id,
      name: a.Name,
      exact: normText(a.Name),
      artists: artistKeys(a.AlbumArtist, a.AlbumArtists ? a.AlbumArtists.map((x) => x.Name) : [], a.Artists || []),
    };
    pushTo(albumsByBase, baseName(a.Name), album);
  }

  for (const t of audioItems || []) {
    if (!t || !t.Name) continue;
    const track = {
      id: t.Id,
      name: t.Name,
      album: t.Album || null,
      trackNumber: t.IndexNumber || null,
      discNumber: t.ParentIndexNumber || null,
      artists: artistKeys(t.AlbumArtist, t.Artists || []),
    };
    pushTo(tracksByBase, baseName(t.Name), track);
    if (t.Album) pushTo(tracksByAlbumBase, baseName(t.Album), track);
  }

  return {
    albumsByBase,
    tracksByBase,
    tracksByAlbumBase,
    albumCount: (albumItems || []).length,
    trackCount: (audioItems || []).length,
    builtAt: Date.now(),
  };
}

// The library's copy of a song, matched by title (edition noise ignored) and any shared artist.
function matchTrack(index, { artist, title }) {
  if (!index || !title) return null;
  const wanted = artistKeys(artist);
  const candidates = index.tracksByBase.get(baseName(title)) || [];
  return candidates.find((t) => artistsOverlap(wanted, t.artists)) || null;
}

function matchAlbum(index, { artist, album }) {
  if (!index || !album) return { album: null, tracks: [] };
  const wanted = artistKeys(artist);
  const base = baseName(album);
  const albums = (index.albumsByBase.get(base) || []).filter((a) => artistsOverlap(wanted, a.artists));
  const exact = normText(album);
  const matched = albums.find((a) => a.exact === exact) || albums[0] || null;
  const tracks = (index.tracksByAlbumBase.get(base) || []).filter((t) => artistsOverlap(wanted, t.artists));
  return { album: matched, tracks };
}

// Summary for a release card: how many of its songs the library already has.
//   status: 'complete' (every track), 'partial' (some, or the album exists with fewer tracks),
//   or 'missing'.
function albumStatus(index, { artist, name, trackCount }) {
  const { album, tracks } = matchAlbum(index, { artist, album: name });
  let owned = new Set(tracks.map((t) => baseName(t.name))).size;

  // A single is often in the library as part of an album rather than as its own release.
  if (owned === 0 && !album && (trackCount || 0) <= 1 && name) {
    if (matchTrack(index, { artist, title: name })) owned = 1;
  }

  const total = trackCount || 0;
  let status = 'missing';
  if (owned > 0 || album) status = total > 0 && owned >= total ? 'complete' : 'partial';
  return { status, ownedTracks: owned, totalTracks: total, albumId: album ? album.id : null };
}

let cache = null; // { key, index, builtAt } once built
let pending = null; // { key, promise } while building
let generation = 0; // bumped by invalidate() so a build started before it isn't cached

function cacheKey(cfg) {
  return `${cfg.url}|${cfg.userId || ''}`;
}

async function loadIndex(cfg) {
  const userId = cfg.userId ? await jellyfin.resolveUserId(cfg.url, cfg.apiKey, cfg.userId) : null;
  const [albums, tracks] = await Promise.all([
    jellyfin.fetchMusicItems(cfg.url, cfg.apiKey, userId, 'MusicAlbum'),
    jellyfin.fetchMusicItems(cfg.url, cfg.apiKey, userId, 'Audio'),
  ]);
  return buildIndex(albums, tracks);
}

// Returns the cached index for this server/user, rebuilding it when stale. Concurrent callers
// share one in-flight build.
async function getIndex(cfg, { force = false } = {}) {
  if (!cfg || !cfg.url || !cfg.apiKey) return null;
  const key = cacheKey(cfg);
  if (!force && cache && cache.key === key && Date.now() - cache.builtAt < INDEX_TTL_MS) {
    return cache.index;
  }
  if (pending && pending.key === key) return pending.promise;

  const gen = generation;
  const promise = loadIndex(cfg)
    .then((index) => {
      if (gen === generation) cache = { key, index, builtAt: index.builtAt };
      return index;
    })
    .finally(() => {
      if (pending && pending.promise === promise) pending = null;
    });
  pending = { key, promise };
  return promise;
}

// Called after a Jellyfin library scan is triggered, so the next lookup sees new music.
function invalidate() {
  generation++;
  cache = null;
  pending = null;
}

module.exports = {
  normText,
  baseName,
  artistKeys,
  buildIndex,
  matchTrack,
  matchAlbum,
  albumStatus,
  getIndex,
  invalidate,
};
