// Link grabber crawls as background jobs: each runs on the server with its progress pushed over
// Socket.IO, can be cancelled, and is stored so its result outlives the browser tab. Only the
// newest KEEP_CRAWLS are kept, plus the latest crawl of each thread watch (it's what the next
// check compares against).
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const linkGrabber = require('./linkGrabber');
const { getSetting } = require('./linkGrabberSend');

const KEEP_CRAWLS = 50;
// The options a crawl is stored with. Pasted cookies are deliberately not among them.
const STORED_OPTIONS = ['url', 'mode', 'maxPages', 'startPage', 'endPage', 'lastN', 'skipQuotes', 'skipBots', 'decodeBase64', 'ignoreHistory', 'useSavedCookies'];

const running = new Map();
let io = null;

function nowIso() {
  return new Date().toISOString();
}

function emit(event, payload) {
  if (io) io.emit(event, payload);
}

// A crawl doesn't survive a restart; one left "running" by the last process never finishes.
function init(socketIo) {
  io = socketIo;
  db.prepare("UPDATE linkgrabber_crawls SET status = 'failed', error = 'Interrupted by a server restart', finished_at = ? WHERE status = 'running'")
    .run(nowIso());
}

function parse(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function summarize(row) {
  return {
    id: row.id,
    url: row.url,
    watchId: row.watch_id,
    status: row.status,
    threadTitle: row.thread_title || '',
    error: row.error || null,
    linkCount: row.link_count,
    newCount: row.new_count,
    progress: parse(row.progress_json),
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

function getRow(id) {
  return db.prepare('SELECT * FROM linkgrabber_crawls WHERE id = ?').get(id);
}

function emitSummary(id) {
  const row = getRow(id);
  if (row) emit('linkgrabber:crawl', summarize(row));
}

function prune() {
  db.prepare(`
    DELETE FROM linkgrabber_crawls
    WHERE status <> 'running'
      AND id NOT IN (SELECT last_crawl_id FROM linkgrabber_watches WHERE last_crawl_id IS NOT NULL)
      AND id NOT IN (SELECT id FROM linkgrabber_crawls ORDER BY created_at DESC LIMIT ?)
  `).run(KEEP_CRAWLS);
}

function finish(id, status, { result = null, error = null }) {
  db.prepare(`
    UPDATE linkgrabber_crawls
    SET status = ?, error = ?, result_json = ?, link_count = ?, new_count = ?,
        thread_title = COALESCE(?, thread_title), finished_at = ?
    WHERE id = ?
  `).run(
    status,
    error,
    result ? JSON.stringify(result) : null,
    result ? result.links.length : 0,
    result ? result.newCount : 0,
    result ? result.threadTitle : null,
    nowIso(),
    id,
  );
  prune();
  emitSummary(id);
}

// Starts a crawl and returns { id, promise } at once; the promise settles with the crawl result
// (or its error) for callers that wait, such as thread watches. `options` are linkGrabber.crawl's.
function startCrawl(options, { watchId = null } = {}) {
  const id = uuidv4();
  const stored = Object.fromEntries(STORED_OPTIONS.filter((k) => options[k] !== undefined).map((k) => [k, options[k]]));
  db.prepare(`
    INSERT INTO linkgrabber_crawls (id, url, watch_id, status, options_json, created_at)
    VALUES (?, ?, ?, 'running', ?, ?)
  `).run(id, String(options.url || ''), watchId, JSON.stringify(stored), nowIso());
  const controller = new AbortController();
  running.set(id, controller);
  emitSummary(id);

  const solverUrl = (typeof options.solverUrl === 'string' && options.solverUrl.trim())
    ? options.solverUrl.trim()
    : (getSetting('solverUrl') || process.env.SOLVERR_URL || process.env.SOLVER_URL || process.env.FLARESOLVERR_URL || '');
  const userAgent = (typeof options.userAgent === 'string' && options.userAgent.trim())
    ? options.userAgent.trim()
    : getSetting('userAgent');

  const promise = linkGrabber.crawl({
    ...options,
    userAgent,
    solverUrl,
    signal: controller.signal,
    onPage(progress) {
      db.prepare('UPDATE linkgrabber_crawls SET progress_json = ?, thread_title = ? WHERE id = ?')
        .run(JSON.stringify(progress), progress.title || null, id);
      emit('linkgrabber:progress', { id, ...progress });
    },
  }).then(
    (result) => {
      finish(id, result.cancelled ? 'cancelled' : 'done', { result });
      return result;
    },
    (err) => {
      const cancelled = controller.signal.aborted;
      finish(id, cancelled ? 'cancelled' : 'failed', { error: cancelled ? 'Cancelled' : err.message });
      throw err;
    },
  ).finally(() => running.delete(id));
  // Callers that only want the id never await it; a failure is already stored on the row.
  promise.catch(() => {});
  return { id, promise };
}

function cancelCrawl(id) {
  const controller = running.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

function listCrawls(limit = 30) {
  return db.prepare('SELECT * FROM linkgrabber_crawls ORDER BY created_at DESC LIMIT ?').all(limit).map(summarize);
}

// The stored result, with "new" re-checked against today's history: links sent since the crawl
// ran are no longer new.
function getCrawl(id) {
  const row = getRow(id);
  if (!row) return null;
  const result = parse(row.result_json);
  if (result) {
    linkGrabber.markHistory(result.links);
    result.newCount = result.links.filter((l) => l.isNew).length;
    result.historyCount = result.links.length - result.newCount;
  }
  return { ...summarize(row), options: parse(row.options_json) || {}, result };
}

// The raw stored result, as crawled (for sending, and for watches comparing checks).
function getStoredResult(id) {
  const row = id ? getRow(id) : null;
  return row ? parse(row.result_json) : null;
}

function deleteCrawl(id) {
  if (running.has(id)) return false;
  return db.prepare('DELETE FROM linkgrabber_crawls WHERE id = ?').run(id).changes > 0;
}

// Keeps link-check results with the crawl, so reopening it still shows them.
function saveCheckResults(id, results) {
  const row = getRow(id);
  const result = row && parse(row.result_json);
  if (!result) return;
  const byUrl = new Map(results.map((r) => [r.url, r]));
  for (const link of result.links) {
    const check = byUrl.get(link.url);
    if (check) link.check = { status: check.status, name: check.name, size: check.size, detail: check.detail, checkedAt: nowIso() };
  }
  db.prepare('UPDATE linkgrabber_crawls SET result_json = ? WHERE id = ?').run(JSON.stringify(result), id);
}

module.exports = {
  KEEP_CRAWLS,
  init,
  startCrawl,
  cancelCrawl,
  listCrawls,
  getCrawl,
  getStoredResult,
  deleteCrawl,
  saveCheckResults,
};
