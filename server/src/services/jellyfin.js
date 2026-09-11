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

async function jellyfinFetch(baseUrl, apiKey, requestPath) {
  const normBase = normalizeBaseUrl(baseUrl);
  const url = `${normBase}${requestPath}`;
  let res;
  try {
    res = await fetch(url, { headers: getAuthHeaders(apiKey) });
  } catch (err) {
    throw new Error(`Could not reach Jellyfin at ${normBase}: ${err.message}`);
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
  let targetUserIds = [];
  if (userId) {
    const trimmed = String(userId).trim();
    const isGuid = /^[0-9a-f]{32}$/i.test(trimmed) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    if (isGuid) {
      targetUserIds = [trimmed];
    } else {
      try {
        const users = await getUsers(baseUrl, apiKey);
        const match = users.find((u) => u.Name && u.Name.toLowerCase() === trimmed.toLowerCase());
        if (match && match.Id) {
          targetUserIds = [match.Id];
        } else {
          targetUserIds = [trimmed];
        }
      } catch (err) {
        console.error(`[jellyfin] Failed to resolve username "${trimmed}": ${err.message}`);
        targetUserIds = [trimmed];
      }
    }
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

module.exports = { testConnection, getUsers, getPlayedBasenames, normalizeBaseUrl };
