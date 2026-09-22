const BASE = '/api';

// Fires when any request other than the login/me checks below comes back 401, so App can
// drop the client's session state and Login can show a "you were signed out" message —
// without every page having to special-case 401 in its own .catch().
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me' && unauthorizedHandler) {
      unauthorizedHandler();
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  me: () => request('/auth/me'),
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (newPassword) => request('/auth/change-password', { method: 'POST', body: JSON.stringify({ newPassword }) }),

  getInfo: (url) => request('/downloads/info', { method: 'POST', body: JSON.stringify({ url }) }),
  enqueue: (payload) => request('/downloads', { method: 'POST', body: JSON.stringify(payload) }),
  listDownloads: () => request('/downloads'),
  deleteDownload: (id) => request(`/downloads/${id}`, { method: 'DELETE' }),
  stopDownload: (id) => request(`/downloads/${id}/stop`, { method: 'POST' }),
  toggleDownloadProtect: (id, protectedFlag) => request(`/downloads/${id}/protect`, { method: 'PATCH', body: JSON.stringify({ protected: protectedFlag }) }),

  listWatches: () => request('/watches'),
  inspectWatch: (url) => request('/watches/inspect', { method: 'POST', body: JSON.stringify({ url }) }),
  addWatch: (payload) => request('/watches', { method: 'POST', body: JSON.stringify(payload) }),
  updateWatch: (id, payload) => request(`/watches/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  toggleWatch: (id) => request(`/watches/${id}/toggle`, { method: 'PATCH' }),
  toggleWatchCleanupExempt: (id) => request(`/watches/${id}/toggle-cleanup-exempt`, { method: 'PATCH' }),
  deleteWatch: (id) => request(`/watches/${id}`, { method: 'DELETE' }),
  checkWatch: (id) => request(`/watches/${id}/check`, { method: 'POST' }),
  checkAllWatches: () => request('/watches/check-all', { method: 'POST' }),
  getWatchDownloads: (id) => request(`/watches/${id}/downloads`),
  resetWatchSeen: (id) => request(`/watches/${id}/reset-seen`, { method: 'POST' }),
  syncWatchJellyfin: (id) => request(`/watches/${id}/sync-jellyfin`, { method: 'POST' }),

  getSettings: () => request('/settings'),
  updateSettings: (payload) => request('/settings', { method: 'PUT', body: JSON.stringify(payload) }),

  getCookiesStatus: () => request('/settings/cookies'),
  saveCookies: (content) => request('/settings/cookies', { method: 'PUT', body: JSON.stringify({ content }) }),
  clearCookies: () => request('/settings/cookies', { method: 'DELETE' }),

  getYtdlpVersions: () => request('/settings/ytdlp/version'),
  updateYtdlp: (channel) => request('/settings/ytdlp/update', { method: 'POST', body: JSON.stringify({ channel }) }),
  updateFfmpeg: () => request('/settings/ffmpeg/update', { method: 'POST' }),

  // Auto-delete / Jellyfin cleanup
  getCleanupSettings: () => request('/cleanup/settings'),
  updateCleanupSettings: (payload) => request('/cleanup/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testJellyfinConnection: (payload) => request('/cleanup/test-jellyfin', { method: 'POST', body: JSON.stringify(payload || {}) }),
  previewCleanup: () => request('/cleanup/preview', { method: 'POST' }),
  runCleanupNow: () => request('/cleanup/run', { method: 'POST' }),

  // Jellyfin playlist sync — builds a playlist per watch out of its downloaded videos
  getJellyfinSyncSettings: () => request('/jellyfin/settings'),
  updateJellyfinSyncSettings: (payload) => request('/jellyfin/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  syncJellyfinPlaylists: () => request('/jellyfin/sync', { method: 'POST' }),

  // Twitch
  getTwitchChannel: (channel) => request(`/twitch/channel/${encodeURIComponent(channel)}`),
  getTwitchVods: (channel) => request(`/twitch/vods/${encodeURIComponent(channel)}`),
  getTwitchVodInfo: (url) => request(`/twitch/vod-info?url=${encodeURIComponent(url)}`),
  downloadTwitch: (payload) => request('/twitch/download', { method: 'POST', body: JSON.stringify(payload) }),
  stopTwitchJob: (id) => request(`/twitch/stop/${id}`, { method: 'POST' }),
  getTwitchSettings: () => request('/twitch/settings'),
  saveTwitchSettings: (payload) => request('/twitch/settings', { method: 'POST', body: JSON.stringify(payload) }),
  listTwitchJobs: () => request('/twitch/jobs'),

  // Music Hub
  searchMusic: (q, type = 'album') => request(`/music/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`),
  getMusicAlbum: (id) => request(`/music/album/${encodeURIComponent(id)}`),
  getMusicArtist: (id) => request(`/music/artist/${encodeURIComponent(id)}`),
  matchMusicTrack: (track) => request('/music/match-track', { method: 'POST', body: JSON.stringify({ track }) }),
  matchMusicBatch: (tracks) => request('/music/match-batch', { method: 'POST', body: JSON.stringify({ tracks }) }),
  inspectMusicUrl: (url) => request('/music/inspect-url', { method: 'POST', body: JSON.stringify({ url }) }),
  downloadMusic: (payload) => request('/music/download', { method: 'POST', body: JSON.stringify(payload) }),
  listMusicWatches: () => request('/music/watches'),
  createMusicWatch: (payload) => request('/music/watches', { method: 'POST', body: JSON.stringify(payload) }),
  getMusicSettings: () => request('/music/settings'),
  updateMusicSettings: (payload) => request('/music/settings', { method: 'PUT', body: JSON.stringify(payload) }),
};
