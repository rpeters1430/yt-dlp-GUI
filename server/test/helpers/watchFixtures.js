const { openTempDb } = require('./tempDb');
const { createRepository } = require('../../src/services/watch/repository');
const { createWatchService } = require('../../src/services/watch/service');

const entry = (id, title = `Video ${id}`, duration = 120) => ({ id, title, duration, url: `https://www.youtube.com/watch?v=${id}` });

// A watch service over a temp database with a fake yt-dlp listing (newest first) and a fake
// queue that writes real download rows, so transactions behave as in production.
function setupWatchService(t, { clock } = {}) {
  const tmp = openTempDb();
  t.after(() => tmp.cleanup());
  const db = tmp.db;
  const state = { entries: [], byUrl: null, urls: [], failInfo: null, started: [], calls: 0, delayMs: 0 };
  const now = () => (clock ? clock.now : new Date());
  const repository = createRepository(db, { now });

  const ytdlp = {
    DOWNLOAD_DIR: '/downloads',
    assertPublicUrl() {},
    async getInfo(url, { playlistStart = 1, playlistEnd }) {
      state.calls++;
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (state.failInfo) throw new Error(state.failInfo);
      state.urls.push(url);
      // `byUrl` maps a listing URL to its entries, or to an error message string.
      const listing = state.byUrl ? state.byUrl[url] : state.entries;
      if (listing === undefined) throw new Error(`No listing for ${url}`);
      if (typeof listing === 'string') throw new Error(listing);
      return { _type: 'playlist', uploader: 'Example', entries: listing.slice(playlistStart - 1, playlistEnd) };
    },
  };
  let seq = 0;
  const queue = {
    createQueuedJob(url, options) {
      const id = `job-${++seq}`;
      db.prepare("INSERT INTO downloads (id, url, status, watch_id, watch_item_id) VALUES (?, ?, 'queued', ?, ?)")
        .run(id, url, options.watchId, options.watchItemId);
      return { id };
    },
    startQueuedJobs(ids) { state.started.push(...ids); },
  };
  const service = createWatchService({ repository, ytdlp, queue });

  function addWatch(fields = {}) {
    const cols = { url: 'https://www.youtube.com/@example', name: 'Example', download_limit: 5, max_scan_entries: 30, enabled: 1, ...fields };
    const keys = Object.keys(cols);
    const id = Number(db.prepare(`INSERT INTO watches (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
      .run(...keys.map((k) => cols[k])).lastInsertRowid);
    return id;
  }
  const getWatch = (id) => db.prepare('SELECT * FROM watches WHERE id = ?').get(id);
  const itemByVideo = (watchId, videoId) => db.prepare('SELECT * FROM watch_items WHERE watch_id = ? AND video_id = ?').get(watchId, videoId);
  const downloadsFor = (watchId) => db.prepare('SELECT * FROM downloads WHERE watch_id = ?').all(watchId);

  return { tmp, db, state, ytdlp, repository, service, addWatch, getWatch, itemByVideo, downloadsFor };
}

module.exports = { entry, setupWatchService };
