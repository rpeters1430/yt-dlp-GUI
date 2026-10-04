const path = require('path');
const { normalizeBaseUrl } = require('./jellyfin');

// Plex Media Server talks XML by default; Accept: application/json switches every endpoint
// used here to JSON. A local server only needs the X-Plex-Token — no plex.tv sign-in flow.
function getHeaders(token) {
  const headers = {
    Accept: 'application/json',
    'X-Plex-Product': 'yt-dlp-gui',
    'X-Plex-Client-Identifier': 'yt-dlp-gui',
  };
  if (token) headers['X-Plex-Token'] = String(token).trim();
  return headers;
}

async function plexRequest(baseUrl, token, requestPath, { method = 'GET' } = {}) {
  const normBase = normalizeBaseUrl(baseUrl);
  const url = `${normBase}${requestPath}`;

  let res;
  try {
    res = await fetch(url, { method, headers: getHeaders(token) });
  } catch (err) {
    throw new Error(`Could not reach Plex at ${normBase}: ${err.message}`);
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('Plex rejected the token (401 Unauthorized)');
    const err = new Error(`Plex request failed: ${res.status} ${res.statusText}`);
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

function container(data) {
  return (data && data.MediaContainer) || {};
}

async function getIdentity(baseUrl, token) {
  const mc = container(await plexRequest(baseUrl, token, '/identity'));
  if (!mc.machineIdentifier) throw new Error('Plex did not return a server identifier');
  return { machineIdentifier: mc.machineIdentifier, version: mc.version || null };
}

async function testConnection(baseUrl, token) {
  if (!baseUrl) throw new Error('Plex URL is required');
  if (!token) throw new Error('Plex token is required');
  // /identity answers without auth, so also hit /library/sections to prove the token works.
  const identity = await getIdentity(baseUrl, token);
  const sections = await getSections(baseUrl, token);
  return { ...identity, sectionCount: sections.length };
}

// Library sections ("libraries" in the Plex UI). type is movie / show / artist / photo.
async function getSections(baseUrl, token) {
  const mc = container(await plexRequest(baseUrl, token, '/library/sections'));
  return (mc.Directory || []).map((d) => ({
    id: String(d.key),
    title: d.title,
    type: d.type,
    locations: (d.Location || []).map((l) => l.path).filter(Boolean),
  }));
}

// Narrows the server's libraries to the ones that can hold this app's downloads: video
// libraries (movie/show — "Other Videos" libraries report as movie) or music ones. An explicit
// comma-separated list of section IDs in Settings wins over the type-based default.
async function getTargetSections(baseUrl, token, { sectionIds = '', includeAudio = false } = {}) {
  const sections = await getSections(baseUrl, token);
  const wanted = String(sectionIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (wanted.length > 0) return sections.filter((s) => wanted.includes(s.id));
  const types = includeAudio ? ['artist'] : ['movie', 'show'];
  return sections.filter((s) => types.includes(s.type));
}

// Plex metadata type numbers: 1 = movie, 4 = episode, 10 = track.
function leafTypeForSection(section) {
  if (section.type === 'show') return 4;
  if (section.type === 'artist') return 10;
  return 1;
}

// Pages through every playable item in a section. Each item carries its file path(s) under
// Media[].Part[].file and, for the token's account, a viewCount once it has been played.
async function fetchSectionItems(baseUrl, token, section, { pageSize = 2000 } = {}) {
  const items = [];
  for (let start = 0; ; start += pageSize) {
    const qs = new URLSearchParams({
      type: String(leafTypeForSection(section)),
      'X-Plex-Container-Start': String(start),
      'X-Plex-Container-Size': String(pageSize),
    });
    const mc = container(await plexRequest(baseUrl, token, `/library/sections/${encodeURIComponent(section.id)}/all?${qs}`));
    const page = mc.Metadata || [];
    items.push(...page);
    const total = typeof mc.totalSize === 'number' ? mc.totalSize : null;
    if (page.length < pageSize || (total !== null && items.length >= total)) break;
  }
  return items;
}

function itemBasenames(item) {
  const names = [];
  for (const media of item.Media || []) {
    for (const part of media.Part || []) {
      if (part.file) names.push(path.basename(part.file));
    }
  }
  return names;
}

// Maps each on-disk basename to its Plex ratingKey, and collects the basenames the token's
// account has played. Matched by filename (not full path) since this app's download folder
// and Plex's library mount usually differ, same as the Jellyfin integration.
async function getLibraryIndex(baseUrl, token, opts = {}) {
  const sections = await getTargetSections(baseUrl, token, opts);
  const byBasename = new Map();
  const played = new Set();
  for (const section of sections) {
    const items = await fetchSectionItems(baseUrl, token, section);
    for (const item of items) {
      for (const name of itemBasenames(item)) {
        if (item.ratingKey) byBasename.set(name, String(item.ratingKey));
        if (item.viewCount > 0) played.add(name);
      }
    }
  }
  return { byBasename, played };
}

async function getPlayedBasenames(baseUrl, token, opts = {}) {
  return (await getLibraryIndex(baseUrl, token, opts)).played;
}

async function refreshSections(baseUrl, token, opts = {}) {
  if (!baseUrl) throw new Error('Plex URL is required');
  if (!token) throw new Error('Plex token is required');
  const sections = await getTargetSections(baseUrl, token, opts);
  for (const s of sections) {
    await plexRequest(baseUrl, token, `/library/sections/${encodeURIComponent(s.id)}/refresh`);
  }
  return sections.length;
}

function playlistType(isMusic) {
  return isMusic ? 'audio' : 'video';
}

function itemsUri(machineIdentifier, ratingKeys) {
  return `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(',')}`;
}

async function findPlaylistByName(baseUrl, token, name, { isMusic = false } = {}) {
  const qs = new URLSearchParams({ playlistType: playlistType(isMusic) });
  const mc = container(await plexRequest(baseUrl, token, `/playlists?${qs}`));
  const match = (mc.Metadata || []).find((p) => p.title === name && !p.smart);
  return match ? String(match.ratingKey) : null;
}

// Returns null (rather than throwing) when the playlist no longer exists in Plex, so callers
// can treat that as "needs to be recreated".
async function getPlaylistItemKeys(baseUrl, token, playlistId) {
  try {
    const mc = container(await plexRequest(baseUrl, token, `/playlists/${encodeURIComponent(playlistId)}/items`));
    return new Set((mc.Metadata || []).map((i) => String(i.ratingKey)).filter(Boolean));
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// Item keys go in the query string, so long lists are sent in chunks to stay well under
// URL length limits.
const CHUNK = 100;

async function addPlaylistItems(baseUrl, token, machineIdentifier, playlistId, ratingKeys) {
  for (let i = 0; i < ratingKeys.length; i += CHUNK) {
    const qs = new URLSearchParams({ uri: itemsUri(machineIdentifier, ratingKeys.slice(i, i + CHUNK)) });
    await plexRequest(baseUrl, token, `/playlists/${encodeURIComponent(playlistId)}/items?${qs}`, { method: 'PUT' });
  }
}

async function createPlaylist(baseUrl, token, machineIdentifier, name, ratingKeys, { isMusic = false } = {}) {
  const qs = new URLSearchParams({
    type: playlistType(isMusic),
    title: name,
    smart: '0',
    uri: itemsUri(machineIdentifier, ratingKeys.slice(0, CHUNK)),
  });
  const mc = container(await plexRequest(baseUrl, token, `/playlists?${qs}`, { method: 'POST' }));
  const created = (mc.Metadata || [])[0];
  if (!created || !created.ratingKey) throw new Error('Plex did not return the new playlist');
  const playlistId = String(created.ratingKey);
  if (ratingKeys.length > CHUNK) {
    await addPlaylistItems(baseUrl, token, machineIdentifier, playlistId, ratingKeys.slice(CHUNK));
  }
  return playlistId;
}

module.exports = {
  testConnection,
  getIdentity,
  getSections,
  getTargetSections,
  getLibraryIndex,
  getPlayedBasenames,
  refreshSections,
  findPlaylistByName,
  getPlaylistItemKeys,
  addPlaylistItems,
  createPlaylist,
};
