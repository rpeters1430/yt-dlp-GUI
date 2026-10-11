const path = require('path');
const { openTempDb } = require('./tempDb');

const SRC = path.join(__dirname, '..', '..', 'src');
const DB_PATH = require.resolve(path.join(SRC, 'db'));

// A temp database plus a clean module cache, so every src module required afterwards binds
// to it (modules cached by an earlier test hold that test's closed database).
function openFreshDb(t) {
  const tmp = openTempDb();
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC + path.sep) && key !== DB_PATH) delete require.cache[key];
  }
  t.after(() => tmp.cleanup());
  return tmp;
}

// Loads the real queue (and everything it requires) against a fresh temp database, with the
// yt-dlp process boundary stubbed: getInfo/download/stopDownload are fakes a test can steer.
// Everything else — SQL, option resolution, notifications, status bookkeeping — is real.
function loadQueue(t, { maxConcurrent = 2 } = {}) {
  const previousMax = process.env.MAX_CONCURRENT_DOWNLOADS;
  process.env.MAX_CONCURRENT_DOWNLOADS = String(maxConcurrent);
  const tmp = openFreshDb(t);
  const queue = require(path.join(SRC, 'services', 'queue'));
  if (previousMax === undefined) delete process.env.MAX_CONCURRENT_DOWNLOADS;
  else process.env.MAX_CONCURRENT_DOWNLOADS = previousMax;

  const ytdlp = require(path.join(SRC, 'services', 'ytdlp'));
  const notify = require(path.join(SRC, 'services', 'notify'));
  const liveSplitter = require(path.join(SRC, 'services', 'liveSplitter'));
  const nfo = require(path.join(SRC, 'services', 'nfo'));

  const state = {
    info: (url) => ({ id: 'vid1', title: `Title for ${url}`, extractor: 'youtube', thumbnail: 'https://i.ytimg.com/x.jpg' }),
    download: async () => ({ filepath: '/downloads/video.mp4' }),
    downloadCalls: [],
    stopped: [],
  };

  t.mock.method(ytdlp, 'getInfo', async (url, opts) => {
    const info = typeof state.info === 'function' ? state.info(url, opts) : state.info;
    if (info instanceof Error) throw info;
    return info;
  });
  t.mock.method(ytdlp, 'download', async (url, opts, onProgress, onLog) => {
    state.downloadCalls.push({ url, opts });
    if (opts.onSpawn) opts.onSpawn(4242);
    return state.download(url, opts, onProgress, onLog);
  });
  t.mock.method(ytdlp, 'stopDownload', (id) => {
    state.stopped.push(id);
    return true;
  });
  // Sidecar files would be written next to the fake output path.
  t.mock.method(nfo, 'writeSidecarFiles', async () => {});
  // Spies that still call through, so notification message building is exercised for real.
  const completed = t.mock.method(notify, 'downloadCompleted');
  const failed = t.mock.method(notify, 'downloadFailed');

  const io = {
    events: [],
    emit(event, payload) { this.events.push({ event, payload }); },
    of(event) { return this.events.filter((e) => e.event === event).map((e) => e.payload); },
  };

  return { queue, db: tmp.db, ytdlp, notify, liveSplitter, state, io, completed, failed };
}

// Resolves once predicate() is truthy, polling the (synchronous) database.
async function waitFor(predicate, { timeout = 2000, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Inserts a download row directly, for listing/search tests that shouldn't run anything.
function insertJob(db, { id, status = 'completed', title = null, url = 'https://example.com/v', extractor = null, createdAt, log = null }) {
  db.prepare(`
    INSERT INTO downloads (id, url, status, title, extractor, log, created_at)
    VALUES (?, ?, ?, ?, ?, ?, coalesce(?, datetime('now')))
  `).run(id, url, status, title, extractor, log, createdAt || null);
}

module.exports = { openFreshDb, loadQueue, waitFor, deferred, insertJob };
