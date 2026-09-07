const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
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

  listWatches: () => request('/watches'),
  addWatch: (payload) => request('/watches', { method: 'POST', body: JSON.stringify(payload) }),
  deleteWatch: (id) => request(`/watches/${id}`, { method: 'DELETE' }),
  checkWatch: (id) => request(`/watches/${id}/check`, { method: 'POST' }),

  getSettings: () => request('/settings'),
  updateSettings: (payload) => request('/settings', { method: 'PUT', body: JSON.stringify(payload) }),

  getCookiesStatus: () => request('/settings/cookies'),
  saveCookies: (content) => request('/settings/cookies', { method: 'PUT', body: JSON.stringify({ content }) }),
  clearCookies: () => request('/settings/cookies', { method: 'DELETE' }),

  getYtdlpVersions: () => request('/settings/ytdlp/version'),
  updateYtdlp: (channel) => request('/settings/ytdlp/update', { method: 'POST', body: JSON.stringify({ channel }) }),
};
