// Thread watches: forum threads (or any paginated page) re-crawled on a schedule. Each check
// reads the last few pages; links that aren't in the history yet are sent to the watch's
// downloader, or with target 'none' just reported, counting only those the previous check
// didn't already report.
const cron = require('node-cron');
const db = require('../db');
const notify = require('./notify');
const linkGrabber = require('./linkGrabber');
const crawls = require('./linkGrabberCrawls');
const { TARGETS, sendLinks } = require('./linkGrabberSend');

const WATCH_TARGETS = ['none', ...TARGETS];
const TARGET_NAMES = { queue: 'the download queue', jdownloader: 'JDownloader', aria2: 'aria2' };
const LIMITS = { lastN: [1, 10], intervalMins: [15, 7 * 24 * 60] };

const checking = new Set();
let io = null;
let ticking = false;

function init(socketIo) {
  io = socketIo;
}

function toApi(row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    lastN: row.last_n,
    intervalMins: row.interval_mins,
    target: row.target,
    packagePerPage: !!row.package_per_page,
    hostersOnly: !!row.hosters_only,
    enabled: !!row.enabled,
    lastCheckedAt: row.last_checked_at,
    lastCrawlId: row.last_crawl_id,
    lastNewCount: row.last_new_count,
    lastError: row.last_error,
    checking: checking.has(row.id),
    createdAt: row.created_at,
  };
}

function getRow(id) {
  return db.prepare('SELECT * FROM linkgrabber_watches WHERE id = ?').get(id);
}

function emitWatch(id) {
  const row = getRow(id);
  if (io && row) io.emit('linkgrabber:watch', toApi(row));
}

function listWatches() {
  return db.prepare('SELECT * FROM linkgrabber_watches ORDER BY created_at DESC, id DESC').all().map(toApi);
}

function getWatch(id) {
  const row = getRow(id);
  return row ? toApi(row) : null;
}

class WatchInputError extends Error {}

function intIn(value, [min, max], name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new WatchInputError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

// Validates a create (all fields) or an update (only the fields given) into column values.
function toColumns(input, { partial }) {
  const cols = {};
  if (!partial || input.url !== undefined) {
    const [url] = linkGrabber.cleanUrls([input.url]);
    if (!url) throw new WatchInputError('url must be an http(s) URL');
    cols.url = url;
  }
  if (input.title !== undefined) cols.title = String(input.title || '').trim().slice(0, 200);
  if (input.lastN !== undefined) cols.last_n = intIn(input.lastN, LIMITS.lastN, 'lastN');
  if (input.intervalMins !== undefined) cols.interval_mins = intIn(input.intervalMins, LIMITS.intervalMins, 'intervalMins');
  if (input.target !== undefined) {
    if (!WATCH_TARGETS.includes(input.target)) throw new WatchInputError(`target must be one of ${WATCH_TARGETS.join(', ')}`);
    cols.target = input.target;
  }
  for (const [field, col] of [['packagePerPage', 'package_per_page'], ['hostersOnly', 'hosters_only'], ['enabled', 'enabled']]) {
    if (input[field] !== undefined) cols[col] = input[field] ? 1 : 0;
  }
  return cols;
}

function createWatch(input) {
  const cols = toColumns(input || {}, { partial: false });
  const names = Object.keys(cols);
  const info = db.prepare(`INSERT INTO linkgrabber_watches (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((n) => cols[n]));
  return getWatch(info.lastInsertRowid);
}

function updateWatch(id, input) {
  if (!getRow(id)) return null;
  const cols = toColumns(input || {}, { partial: true });
  const names = Object.keys(cols);
  if (names.length) {
    db.prepare(`UPDATE linkgrabber_watches SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`)
      .run(...names.map((n) => cols[n]), id);
  }
  emitWatch(id);
  return getWatch(id);
}

function deleteWatch(id) {
  return db.prepare('DELETE FROM linkgrabber_watches WHERE id = ?').run(id).changes > 0;
}

// One check: crawl, pick the links to act on, send them, record the outcome, notify.
async function checkWatch(id, { crawlOptions = {} } = {}) {
  const watch = getRow(id);
  if (!watch) throw new Error('Watch not found');
  if (checking.has(id)) throw new Error('This watch is already being checked');
  checking.add(id);
  emitWatch(id);

  let crawlId = null;
  let found = [];
  let error = null;
  let result = null;
  try {
    const isThread = linkGrabber.parseThreadUrl(watch.url).isThread;
    const started = crawls.startCrawl({
      url: watch.url,
      mode: isThread ? 'last' : 'follow',
      lastN: watch.last_n,
      maxPages: watch.last_n,
      useSavedCookies: true,
      ...crawlOptions,
    }, { watchId: id });
    crawlId = started.id;
    result = await started.promise;

    found = result.links.filter((l) => l.isNew && (!watch.hosters_only || l.hoster));
    if (watch.target === 'none') {
      // Nothing is sent, so nothing reaches the history: compare with the previous check instead.
      const previous = crawls.getStoredResult(watch.last_crawl_id);
      const before = new Set((previous?.links || []).map((l) => linkGrabber.canonicalUrl(l.url)));
      found = found.filter((l) => !before.has(linkGrabber.canonicalUrl(l.url)));
    } else if (found.length) {
      const sent = await sendLinks({ target: watch.target, urls: found.map((l) => l.url), crawl: result, packagePerPage: !!watch.package_per_page });
      if (sent.failed.length) error = `${sent.failed.length} link${sent.failed.length === 1 ? '' : 's'} failed to send: ${sent.failed[0]}`;
    }
    if (result.error) error = error || `Stopped early: ${result.error}`;
  } catch (err) {
    error = err.message;
  } finally {
    checking.delete(id);
  }

  const title = watch.title || result?.threadTitle || '';
  db.prepare(`
    UPDATE linkgrabber_watches
    SET last_checked_at = ?, last_crawl_id = COALESCE(?, last_crawl_id), last_new_count = ?, last_error = ?, title = ?
    WHERE id = ?
  `).run(new Date().toISOString(), result ? crawlId : null, found.length, error, title, id);

  const named = { ...watch, title };
  if (found.length) notify.threadWatchNewLinks(named, found, TARGET_NAMES[watch.target] || null);
  // Only when it starts failing, not on every failed check after that.
  if (error && !watch.last_error) notify.watchError({ id: watch.id, name: title, url: watch.url }, error);
  console.log(`[linkgrabber] watch #${id}: ${error ? `error: ${error}` : `${found.length} new link(s)`}`);
  emitWatch(id);
  return { ...getWatch(id), found: found.length };
}

function isDue(watch, now) {
  if (!watch.last_checked_at) return true;
  return now - Date.parse(watch.last_checked_at) >= watch.interval_mins * 60 * 1000;
}

// Checks every enabled watch that's due, one at a time so a forum sees one crawler, not many.
async function checkDueWatches({ now = Date.now(), check = checkWatch } = {}) {
  if (ticking) return;
  ticking = true;
  try {
    const due = db.prepare('SELECT * FROM linkgrabber_watches WHERE enabled = 1').all().filter((w) => isDue(w, now));
    for (const watch of due) {
      try {
        await check(watch.id);
      } catch (err) {
        console.error(`[linkgrabber] watch #${watch.id} check failed: ${err.message}`);
      }
    }
  } finally {
    ticking = false;
  }
}

function start() {
  cron.schedule('*/5 * * * *', () => {
    checkDueWatches().catch((err) => console.error(`[linkgrabber] Watch run failed: ${err.message}`));
  });
}

module.exports = {
  WATCH_TARGETS,
  LIMITS,
  WatchInputError,
  init,
  start,
  listWatches,
  getWatch,
  createWatch,
  updateWatch,
  deleteWatch,
  checkWatch,
  checkDueWatches,
};
