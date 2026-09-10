const path = require('path');

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

// Jellyfin accepts the API key either as a query param or via the X-Emby-Token header;
// the header keeps it out of server access logs.
async function jellyfinFetch(baseUrl, apiKey, requestPath) {
  const url = `${normalizeBaseUrl(baseUrl)}${requestPath}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'X-Emby-Token': apiKey } });
  } catch (err) {
    throw new Error(`Could not reach Jellyfin at ${normalizeBaseUrl(baseUrl)}: ${err.message}`);
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('Jellyfin rejected the API key (401 Unauthorized)');
    throw new Error(`Jellyfin request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
  const userIds = userId ? [userId] : (await getUsers(baseUrl, apiKey)).map((u) => u.Id).filter(Boolean);
  const combined = new Set();
  for (const uid of userIds) {
    try {
      const basenames = await fetchPlayedBasenames(baseUrl, apiKey, uid);
      for (const name of basenames) combined.add(name);
    } catch (err) {
      console.error(`[jellyfin] Failed to fetch watched items for user ${uid}: ${err.message}`);
    }
  }
  return combined;
}

module.exports = { testConnection, getUsers, getPlayedBasenames };
