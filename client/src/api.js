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
  changePassword: (currentPassword, newPassword) => request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  getInfo: (url) => request('/downloads/info', { method: 'POST', body: JSON.stringify({ url }) }),
  enqueue: (payload) => request('/downloads', { method: 'POST', body: JSON.stringify(payload) }),
  listDownloads: () => request('/downloads'),
  searchDownloads: ({ status = 'all', q = '', limit = 50, offset = 0, category = 'all' } = {}) =>
    request(`/downloads/history?${new URLSearchParams({ status, q, limit: String(limit), offset: String(offset), category })}`),
  getDownloadStats: () => request('/downloads/stats'),
  getDownloadLog: (id) => request(`/downloads/${id}/log`),
  deleteDownload: (id, { deleteFile = false } = {}) =>
    request(`/downloads/${id}${deleteFile ? '?deleteFile=1' : ''}`, { method: 'DELETE' }),
  stopDownload: (id) => request(`/downloads/${id}/stop`, { method: 'POST' }),
  retryDownload: (id) => request(`/downloads/${id}/retry`, { method: 'POST' }),
  prioritizeDownload: (id) => request(`/downloads/${id}/prioritize`, { method: 'POST' }),
  pauseQueue: () => request('/downloads/pause', { method: 'POST' }),
  resumeQueue: () => request('/downloads/resume', { method: 'POST' }),
  clearFailedDownloads: () => request('/downloads/clear-failed', { method: 'POST' }),
  retryFailedDownloads: (options = {}) => request('/downloads/retry-failed', { method: 'POST', body: JSON.stringify(options) }),
  checkDuplicates: (items) => request('/downloads/check-duplicates', { method: 'POST', body: JSON.stringify({ items }) }),
  toggleDownloadProtect: (id, protectedFlag) => request(`/downloads/${id}/protect`, { method: 'PATCH', body: JSON.stringify({ protected: protectedFlag }) }),

  crawlLinks: (payload) => request('/linkgrabber/crawl', { method: 'POST', body: JSON.stringify(payload) }),
  sendLinks: (payload) => request('/linkgrabber/send', { method: 'POST', body: JSON.stringify(payload) }),
  getLinkGrabberSettings: () => request('/linkgrabber/settings'),
  updateLinkGrabberSettings: (payload) => request('/linkgrabber/settings', { method: 'PUT', body: JSON.stringify(payload) }),

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
  previewWatchFilters: (payload) => request('/watches/preview-filter', { method: 'POST', body: JSON.stringify(payload) }),
  getWatchRuns: (id) => request(`/watches/${id}/runs`),
  getWatchItems: (id, query = '') => request(`/watches/${id}/items${query}`),
  retryWatchItem: (watchId, itemId) => request(`/watches/${watchId}/items/${itemId}/retry`, { method: 'POST' }),
  resetWatchSeen: (id) => request(`/watches/${id}/reset-seen`, { method: 'POST' }),
  syncWatchJellyfin: (id) => request(`/watches/${id}/sync-jellyfin`, { method: 'POST' }),
  syncWatchPlex: (id) => request(`/watches/${id}/sync-plex`, { method: 'POST' }),

  getSettings: () => request('/settings'),
  updateSettings: (payload) => request('/settings', { method: 'PUT', body: JSON.stringify(payload) }),

  getCookiesStatus: () => request('/settings/cookies'),
  saveCookies: (content) => request('/settings/cookies', { method: 'PUT', body: JSON.stringify({ content }) }),
  clearCookies: () => request('/settings/cookies', { method: 'DELETE' }),

  getYtdlpVersions: () => request('/settings/ytdlp/version'),
  updateYtdlp: (channel) => request('/settings/ytdlp/update', { method: 'POST', body: JSON.stringify({ channel }) }),
  updateFfmpeg: () => request('/settings/ffmpeg/update', { method: 'POST' }),
  updateQuickjs: () => request('/settings/quickjs/update', { method: 'POST' }),

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
  refreshJellyfinLibrary: () => request('/jellyfin/refresh', { method: 'POST' }),
  getJellyfinStatus: () => request('/jellyfin/status'),
  // Plex — library scan, playlist per watch, and delete-when-watched for the token's account
  getPlexSettings: () => request('/plex/settings'),
  updatePlexSettings: (payload) => request('/plex/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testPlexConnection: (payload) => request('/plex/test', { method: 'POST', body: JSON.stringify(payload || {}) }),
  refreshPlexLibrary: () => request('/plex/refresh', { method: 'POST' }),
  syncPlexPlaylists: () => request('/plex/sync', { method: 'POST' }),
  checkJellyfinAlbum: (artist, album) => request(`/jellyfin/music-check?artist=${encodeURIComponent(artist || '')}&album=${encodeURIComponent(album || '')}`),
  checkJellyfinMusicLibrary: (payload) => request('/jellyfin/music-library', { method: 'POST', body: JSON.stringify(payload) }),

  // Twitch
  getTwitchChannel: (channel) => request(`/twitch/channel/${encodeURIComponent(channel)}`),
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
  resolveMusicArtistChannel: (name) => request(`/music/artist-channel?name=${encodeURIComponent(name)}`),
  matchMusicTrack: (track) => request('/music/match-track', { method: 'POST', body: JSON.stringify({ track }) }),
  getMusicMatchCandidates: (track, limit = 5) => request('/music/match-candidates', { method: 'POST', body: JSON.stringify({ track, limit }) }),
  matchMusicBatch: (tracks) => request('/music/match-batch', { method: 'POST', body: JSON.stringify({ tracks }) }),
  inspectMusicUrl: (url) => request('/music/inspect-url', { method: 'POST', body: JSON.stringify({ url }) }),
  downloadMusic: (payload) => request('/music/download', { method: 'POST', body: JSON.stringify(payload) }),
  listMusicWatches: () => request('/music/watches'),
  createMusicWatch: (payload) => request('/music/watches', { method: 'POST', body: JSON.stringify(payload) }),
  getMusicSettings: () => request('/music/settings'),
  updateMusicSettings: (payload) => request('/music/settings', { method: 'PUT', body: JSON.stringify(payload) }),

  // Library — completed downloads on disk, with in-browser playback
  listLibrary: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return request(`/library${qs ? `?${qs}` : ''}`);
  },
  getLibraryItem: (id) => request(`/library/${encodeURIComponent(id)}`),
  deleteLibraryFile: (id) => request(`/library/${id}/file`, { method: 'DELETE' }),
  libraryStreamUrl: (id, part = null) =>
    `${BASE}/library/${encodeURIComponent(id)}/stream${part !== null && part !== undefined ? `?part=${encodeURIComponent(part)}` : ''}`,
  libraryFileUrl: (id, part = null) =>
    `${BASE}/library/${encodeURIComponent(id)}/file${part !== null && part !== undefined ? `?part=${encodeURIComponent(part)}` : ''}`,
  libraryPosterUrl: (id) => `${BASE}/library/${encodeURIComponent(id)}/poster`,

  // Notifications (Discord / Slack / ntfy / Gotify / generic webhook)
  getNotificationSettings: () => request('/notifications/settings'),
  updateNotificationSettings: (payload) => request('/notifications/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testNotification: (payload) => request('/notifications/test', { method: 'POST', body: JSON.stringify(payload || {}) }),

  // Filename templates
  getOutputTemplate: () => request('/settings/output-template'),

  // Lidarr Integration
  getLidarrSettings: () => request('/lidarr/settings'),
  updateLidarrSettings: (payload) => request('/lidarr/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testLidarrConnection: (payload) => request('/lidarr/test', { method: 'POST', body: JSON.stringify(payload || {}) }),
  getLidarrStatus: () => request('/lidarr/status'),
  getLidarrWanted: ({ page = 1, pageSize = 30 } = {}) => request(`/lidarr/wanted?page=${page}&pageSize=${pageSize}`),
  getLidarrArtists: () => request('/lidarr/artists'),
  scanLidarr: (targetPath) => request('/lidarr/scan', { method: 'POST', body: JSON.stringify({ path: targetPath }) }),
  downloadLidarrWanted: (payload) => request('/lidarr/download-wanted', { method: 'POST', body: JSON.stringify(payload) }),

  // Supported Sites & Extractors
  getSiteGuide: () => request('/sites/guide'),
  listExtractors: (q = '') => request(`/sites/extractors${q ? `?q=${encodeURIComponent(q)}` : ''}`),
};
