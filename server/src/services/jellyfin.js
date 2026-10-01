const path = require('path');

function normalizeBaseUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) {
    u = `http://${u}`;
  }
  return u;
}

// Jellyfin authentication:
// Modern Jellyfin servers (10.9+) require the standard Authorization: MediaBrowser header.
// We also include X-Emby-Token and X-MediaBrowser-Token for backwards compatibility with older servers.
function getAuthHeaders(apiKey) {
  const headers = {};
  if (apiKey) {
    const key = String(apiKey).trim();
    headers['Authorization'] = `MediaBrowser Client="yt-dlp-gui", Device="Server", DeviceId="yt-dlp-gui", Version="1.0.0", Token="${key}"`;
    headers['X-Emby-Token'] = key;
    headers['X-MediaBrowser-Token'] = key;
  }
  return headers;
}

async function jellyfinRequest(baseUrl, apiKey, requestPath, { method = 'GET', body } = {}) {
  const normBase = normalizeBaseUrl(baseUrl);
  const url = `${normBase}${requestPath}`;
  const headers = getAuthHeaders(apiKey);
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`Could not reach Jellyfin at ${normBase}: ${err.message}`);
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('Jellyfin rejected the API key (401 Unauthorized)');
    const err = new Error(`Jellyfin request failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function jellyfinFetch(baseUrl, apiKey, requestPath) {
  return jellyfinRequest(baseUrl, apiKey, requestPath);
}

async function testConnection(baseUrl, apiKey) {
  if (!baseUrl) throw new Error('Jellyfin URL is required');
  if (!apiKey) throw new Error('Jellyfin API key is required');
  const info = await jellyfinFetch(baseUrl, apiKey, '/System/Info');
  return { serverName: info.ServerName || 'Jellyfin', version: info.Version || null };
}

async function getUsers(baseUrl, apiKey) {
  const users = await jellyfinFetch(baseUrl, apiKey, '/Users');
  return Array.isArray(users) ? users : [];
}

// Accepts either a Jellyfin user GUID (passed through as-is) or a username (resolved to a
// GUID via /Users) — the same "either works" convenience the Settings page's "Jellyfin user"
// field has always offered.
async function resolveUserId(baseUrl, apiKey, userId) {
  const trimmed = String(userId || '').trim();
  if (!trimmed) return null;
  const isGuid = /^[0-9a-f]{32}$/i.test(trimmed) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
  if (isGuid) return trimmed;
  try {
    const users = await getUsers(baseUrl, apiKey);
    const match = users.find((u) => u.Name && u.Name.toLowerCase() === trimmed.toLowerCase());
    if (match && match.Id) return match.Id;
  } catch (err) {
    console.error(`[jellyfin] Failed to resolve username "${trimmed}": ${err.message}`);
  }
  return trimmed;
}

// Returns the on-disk basenames of every video item marked "played" for the given user.
async function fetchPlayedBasenames(baseUrl, apiKey, userId) {
  const qs = new URLSearchParams({
    Recursive: 'true',
    Filters: 'IsPlayed',
    IncludeItemTypes: 'Movie,Episode,Video',
    Fields: 'Path',
  });
  const data = await jellyfinFetch(baseUrl, apiKey, `/Users/${encodeURIComponent(userId)}/Items?${qs}`);
  const items = (data && data.Items) || [];
  const basenames = new Set();
  for (const item of items) {
    if (item.Path) basenames.add(path.basename(item.Path));
  }
  return basenames;
}

// Aggregates "played" filenames across every configured user (or just one, if userId is set)
// since Jellyfin's watched status is tracked per-user, and there's no server-wide concept of it.
async function getPlayedBasenames(baseUrl, apiKey, userId) {
  let targetUserIds = [];
  if (userId) {
    targetUserIds = [await resolveUserId(baseUrl, apiKey, userId)];
  } else {
    targetUserIds = (await getUsers(baseUrl, apiKey)).map((u) => u.Id).filter(Boolean);
  }

  const combined = new Set();
  for (const uid of targetUserIds) {
    try {
      const basenames = await fetchPlayedBasenames(baseUrl, apiKey, uid);
      for (const name of basenames) combined.add(name);
    } catch (err) {
      console.error(`[jellyfin] Failed to fetch watched items for user ${uid}: ${err.message}`);
    }
  }
  return combined;
}

// Maps every video library item's on-disk basename to its Jellyfin item ID, for the given
// user's visible library. Used to translate a locally-downloaded file into the Jellyfin item
// that (once the library has scanned it) represents it, so it can be added to a playlist.
async function getLibraryItemsByBasename(baseUrl, apiKey, userId) {
  const qs = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Episode,Video',
    Fields: 'Path',
  });
  const data = await jellyfinFetch(baseUrl, apiKey, `/Users/${encodeURIComponent(userId)}/Items?${qs}`);
  const items = (data && data.Items) || [];
  const map = new Map();
  for (const item of items) {
    if (item.Path && item.Id) map.set(path.basename(item.Path), item.Id);
  }
  return map;
}

// Playlists don't have a dedicated "find by name" endpoint — they're just items of type
// Playlist in the user's view, so this searches like any other item.
async function findPlaylistByName(baseUrl, apiKey, userId, name) {
  const qs = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Playlist',
    SearchTerm: name,
  });
  const data = await jellyfinFetch(baseUrl, apiKey, `/Users/${encodeURIComponent(userId)}/Items?${qs}`);
  const items = (data && data.Items) || [];
  return items.find((i) => i.Name === name) || null;
}

// Returns null (rather than throwing) when the playlist ID no longer exists in Jellyfin, so
// callers can treat that as "needs to be recreated" instead of a hard failure.
async function getPlaylistItemIds(baseUrl, apiKey, userId, playlistId) {
  try {
    const data = await jellyfinRequest(
      baseUrl,
      apiKey,
      `/Playlists/${encodeURIComponent(playlistId)}/Items?${new URLSearchParams({ userId })}`
    );
    const items = (data && data.Items) || [];
    return new Set(items.map((i) => i.Id).filter(Boolean));
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function createPlaylist(baseUrl, apiKey, userId, name, itemIds) {
  const data = await jellyfinRequest(baseUrl, apiKey, '/Playlists', {
    method: 'POST',
    body: { Name: name, Ids: itemIds, UserId: userId, MediaType: 'Video' },
  });
  return data && data.Id;
}

async function refreshLibrary(baseUrl, apiKey) {
  if (!baseUrl) throw new Error('Jellyfin URL is required');
  if (!apiKey) throw new Error('Jellyfin API key is required');
  return jellyfinRequest(baseUrl, apiKey, '/Library/Refresh', { method: 'POST' });
}

// Searches the user's Jellyfin library to check if an album or its tracks are already present
async function checkMusicAlbum(baseUrl, apiKey, userId, { artist, album }) {
  if (!baseUrl || !apiKey || !album) return { inLibrary: false, tracks: [] };
  const uid = userId ? await resolveUserId(baseUrl, apiKey, userId) : null;
  const uidPart = uid ? `/Users/${encodeURIComponent(uid)}` : '';
  const qs = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'MusicAlbum,Audio',
    SearchTerm: album,
    Fields: 'Path,Artists,Album,IndexNumber,ParentIndexNumber',
  });
  let data;
  try {
    data = await jellyfinFetch(baseUrl, apiKey, `${uidPart}/Items?${qs}`);
  } catch (err) {
    console.error(`[jellyfin] checkMusicAlbum failed: ${err.message}`);
    return { inLibrary: false, tracks: [] };
  }
  const items = (data && data.Items) || [];

  const normAlbum = album.toLowerCase().trim();
  const normArtist = (artist || '').toLowerCase().trim();

  // Find matching album item
  const matchedAlbum = items.find((i) =>
    i.Type === 'MusicAlbum' &&
    i.Name && i.Name.toLowerCase().trim() === normAlbum &&
    (!normArtist || (i.AlbumArtist && i.AlbumArtist.toLowerCase().includes(normArtist)) || (i.Artists && i.Artists.some((a) => a.toLowerCase().includes(normArtist))))
  );

  // Find matching audio tracks
  const matchedTracks = items.filter((i) =>
    i.Type === 'Audio' &&
    i.Album && i.Album.toLowerCase().trim() === normAlbum &&
    (!normArtist || (i.AlbumArtist && i.AlbumArtist.toLowerCase().includes(normArtist)) || (i.Artists && i.Artists.some((a) => a.toLowerCase().includes(normArtist))))
  );

  return {
    inLibrary: !!matchedAlbum || matchedTracks.length > 0,
    albumId: matchedAlbum ? matchedAlbum.Id : null,
    albumName: matchedAlbum ? matchedAlbum.Name : (matchedTracks[0]?.Album || null),
    trackCount: matchedTracks.length,
    tracks: matchedTracks.map((t) => ({
      id: t.Id,
      name: t.Name,
      trackNumber: t.IndexNumber || null,
      discNumber: t.ParentIndexNumber || null,
      path: t.Path || null,
    })),
  };
}

module.exports = {
  testConnection,
  getUsers,
  resolveUserId,
  getPlayedBasenames,
  getLibraryItemsByBasename,
  findPlaylistByName,
  getPlaylistItemIds,
  createPlaylist,
  addPlaylistItems,
  refreshLibrary,
  checkMusicAlbum,
  normalizeBaseUrl,
};
