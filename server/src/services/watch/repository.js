// All SQL for the watch ledger (watch_items / watch_runs) lives here, so the scheduler,
// routes and queue share one set of state transitions instead of each writing their own.

// Minimum delays before automatic retry N (after the initial attempt plus N-1 retries fail).
// After the fourth failed attempt the item stays failed until someone retries it by hand.
const RETRY_DELAYS_MS = [15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

// Matches SQLite's datetime('now') format so stored times compare as plain strings.
function toSqlTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

const ITEM_STATUS_FILTERS = {
  pending: "filter_status = 'eligible' AND discovery_type != 'baseline' AND download_status = 'none'",
  queued: "download_status IN ('queued', 'downloading')",
  completed: "download_status = 'completed'",
  filtered: "filter_status = 'excluded' AND download_status IN ('none', 'failed')",
  failed: "download_status = 'failed'",
  baseline: "discovery_type = 'baseline' AND download_status = 'none'",
};

const AGGREGATE_COLUMNS = `
  COUNT(*) AS cataloged_count,
  COALESCE(SUM(discovery_type = 'baseline'), 0) AS baseline_count,
  COALESCE(SUM(discovery_type = 'new'), 0) AS new_count,
  COALESCE(SUM(discovery_type = 'backfill'), 0) AS backfill_count,
  COALESCE(SUM(${ITEM_STATUS_FILTERS.pending}), 0) AS pending_count,
  COALESCE(SUM(download_status IN ('queued', 'downloading')), 0) AS queued_count,
  COALESCE(SUM(download_status = 'downloading'), 0) AS downloading_count,
  COALESCE(SUM(download_status = 'completed'), 0) AS completed_count,
  COALESCE(SUM(download_status = 'failed'), 0) AS failed_count,
  COALESCE(SUM(filter_status = 'excluded' AND discovery_type != 'baseline'), 0) AS excluded_count
`;

const EMPTY_AGGREGATE = {
  cataloged_count: 0, baseline_count: 0, new_count: 0, backfill_count: 0, pending_count: 0,
  queued_count: 0, downloading_count: 0, completed_count: 0, failed_count: 0, excluded_count: 0,
};

function createRepository(db, { now = () => new Date() } = {}) {
  const nowSql = () => toSqlTime(now());

  const stmts = {
    createRun: db.prepare("INSERT INTO watch_runs (watch_id, trigger, status, started_at) VALUES (?, ?, 'running', ?)"),
    getRun: db.prepare('SELECT * FROM watch_runs WHERE id = ?'),
    knownIds: db.prepare('SELECT video_id FROM watch_items WHERE watch_id = ?'),
    getItem: db.prepare('SELECT * FROM watch_items WHERE id = ?'),
    getWatchItem: db.prepare('SELECT * FROM watch_items WHERE watch_id = ? AND id = ?'),
    insertItem: db.prepare(`
      INSERT OR IGNORE INTO watch_items
        (watch_id, video_id, url, title, duration, thumbnail, published_at,
         discovery_type, filter_status, filter_reason, first_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    refreshItem: db.prepare(`
      UPDATE watch_items SET
        url = COALESCE(?, url), title = COALESCE(?, title), duration = COALESCE(?, duration),
        thumbnail = COALESCE(?, thumbnail), published_at = COALESCE(?, published_at)
      WHERE watch_id = ? AND video_id = ?
    `),
    reconsiderable: db.prepare(`
      SELECT * FROM watch_items
      WHERE watch_id = ? AND discovery_type != 'baseline' AND download_status IN ('none', 'failed')
    `),
    setFilter: db.prepare('UPDATE watch_items SET filter_status = ?, filter_reason = ?, updated_at = ? WHERE id = ?'),
    pendingCandidates: db.prepare(`
      SELECT * FROM watch_items
      WHERE watch_id = ? AND filter_status = 'eligible' AND discovery_type != 'baseline' AND download_status = 'none'
      ORDER BY id DESC
    `),
    dueRetries: db.prepare(`
      SELECT * FROM watch_items
      WHERE watch_id = ? AND filter_status = 'eligible' AND download_status = 'failed'
        AND next_retry_at IS NOT NULL AND next_retry_at <= ?
      ORDER BY next_retry_at ASC, id DESC
    `),
    linkQueuedJob: db.prepare(`
      UPDATE watch_items SET download_status = 'queued', download_id = ?, next_retry_at = NULL, updated_at = ?
      WHERE id = ? AND (download_status = 'none'
        OR (download_status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ?))
    `),
    orphaned: db.prepare(`
      SELECT i.id FROM watch_items i
      WHERE i.watch_id = ? AND i.download_status IN ('queued', 'downloading')
        AND (i.download_id IS NULL OR NOT EXISTS (SELECT 1 FROM downloads d WHERE d.id = i.download_id))
    `),
    markRemoved: db.prepare(`
      UPDATE watch_items SET download_status = 'failed', download_id = NULL, next_retry_at = NULL,
        last_error = 'Download was removed before it finished', updated_at = ?
      WHERE id = ?
    `),
    manualRetry: db.prepare(`
      UPDATE watch_items SET next_retry_at = ?, updated_at = ?
      WHERE id = ? AND download_status = 'failed'
    `),
    latestRun: db.prepare('SELECT * FROM watch_runs WHERE watch_id = ? ORDER BY id DESC LIMIT 1'),
    aggregate: db.prepare(`SELECT ${AGGREGATE_COLUMNS} FROM watch_items WHERE watch_id = ?`),
  };

  function createRun(watchId, trigger) {
    return Number(stmts.createRun.run(watchId, trigger, nowSql()).lastInsertRowid);
  }

  const RUN_FIELDS = new Set([
    'status', 'scanned_count', 'baseline_count', 'new_count', 'backfill_count', 'matched_count',
    'excluded_count', 'queued_count', 'pending_count', 'failed_count', 'scan_boundary_reached', 'error',
  ]);

  function finishRun(id, fields = {}) {
    const keys = Object.keys(fields).filter((k) => RUN_FIELDS.has(k));
    const values = keys.map((k) => (typeof fields[k] === 'boolean' ? (fields[k] ? 1 : 0) : fields[k]));
    const sets = [...keys.map((k) => `${k} = ?`), 'finished_at = ?'];
    db.prepare(`UPDATE watch_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values, nowSql(), id);
    return stmts.getRun.get(id);
  }

  function knownIds(watchId) {
    return new Set(stmts.knownIds.all(watchId).map((r) => r.video_id));
  }

  // `items` are { entry, discoveryType, filterStatus, filterReason }, newest first. They are
  // inserted oldest first so that, within the ledger, a higher id always means newer.
  // Already-known videos only get their metadata refreshed. Returns the number inserted.
  function upsertItems(watchId, items) {
    const time = nowSql();
    let inserted = 0;
    for (const item of [...items].reverse()) {
      const e = item.entry;
      const duration = typeof e.duration === 'number' ? e.duration : null;
      if (item.discoveryType) {
        inserted += stmts.insertItem.run(
          watchId, e.id, e.url || null, e.title || null, duration, e.thumbnail || null, e.publishedAt || null,
          item.discoveryType, item.filterStatus || 'eligible', item.filterReason || null, time, time
        ).changes;
      } else {
        stmts.refreshItem.run(e.url || null, e.title || null, duration, e.thumbnail || null, e.publishedAt || null, watchId, e.id);
      }
    }
    return inserted;
  }

  // Re-applies the current filters to items that haven't been queued or finished, so an
  // edited rule can admit or exclude them. Baseline items are never reconsidered.
  function reevaluateItems(watchId, evaluate) {
    const time = nowSql();
    for (const item of stmts.reconsiderable.all(watchId)) {
      const { eligible, reason } = evaluate(item);
      const status = eligible ? 'eligible' : 'excluded';
      if (status !== item.filter_status || (reason || null) !== (item.filter_reason || null)) {
        stmts.setFilter.run(status, reason || null, time, item.id);
      }
    }
  }

  // Failures whose retry time has arrived come first (so a steady stream of new uploads
  // can't starve them), then pending items newest first.
  // `tabs`, when given, limits candidates to items found on those channel tabs (items with no
  // tab, e.g. from a playlist or recorded before tabs existed, always qualify).
  function queueCandidates(watchId, at = now(), limit = Infinity, { tabs = null } = {}) {
    let rows = [...stmts.dueRetries.all(watchId, toSqlTime(at)), ...stmts.pendingCandidates.all(watchId)];
    if (tabs) rows = rows.filter((r) => !r.source_tab || tabs.includes(r.source_tab));
    return Number.isFinite(limit) ? rows.slice(0, Math.max(0, limit)) : rows;
  }

  // Records which channel tab each item came from; an item's first tab wins.
  function setItemTabs(watchId, entries) {
    const stmt = db.prepare('UPDATE watch_items SET source_tab = ? WHERE watch_id = ? AND video_id = ? AND source_tab IS NULL');
    for (const e of entries) if (e.tab) stmt.run(e.tab, watchId, e.id);
  }

  function linkQueuedJob(itemId, downloadId) {
    const time = nowSql();
    const result = stmts.linkQueuedJob.run(downloadId, time, itemId, time);
    if (result.changes !== 1) {
      throw new Error(`Watch item ${itemId} is not waiting to be queued`);
    }
  }

  // Mirrors a download job's lifecycle onto its watch item. Updates from a job that is no
  // longer the item's current one (e.g. an old attempt) are ignored. Returns the item.
  function applyDownloadState(itemId, status, { downloadId = null, error = null } = {}) {
    const item = stmts.getItem.get(itemId);
    if (!item) return null;
    if (downloadId && item.download_id && item.download_id !== downloadId) return item;
    const time = nowSql();
    if (status === 'queued' || status === 'downloading') {
      db.prepare('UPDATE watch_items SET download_status = ?, download_id = COALESCE(?, download_id), next_retry_at = NULL, updated_at = ? WHERE id = ?')
        .run(status, downloadId, time, itemId);
    } else if (status === 'completed') {
      db.prepare(`
        UPDATE watch_items SET download_status = 'completed', download_id = COALESCE(?, download_id),
          attempt_count = attempt_count + 1, last_error = NULL, next_retry_at = NULL, completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(downloadId, time, time, itemId);
    } else if (status === 'removed') {
      if (item.download_status === 'queued' || item.download_status === 'downloading') stmts.markRemoved.run(time, itemId);
    } else if (status === 'failed') {
      const attempts = item.attempt_count + 1;
      const delay = attempts < MAX_ATTEMPTS ? RETRY_DELAYS_MS[attempts - 1] : null;
      const nextRetry = delay === null ? null : toSqlTime(new Date(now().getTime() + delay));
      db.prepare(`
        UPDATE watch_items SET download_status = 'failed', download_id = COALESCE(?, download_id),
          attempt_count = ?, last_error = ?, next_retry_at = ?, updated_at = ?
        WHERE id = ?
      `).run(downloadId, attempts, error || 'Download failed', nextRetry, time, itemId);
    }
    return stmts.getItem.get(itemId);
  }

  // Items left queued/downloading whose download job no longer exists (deleted from the
  // queue) become failed, retryable by hand only — someone removed them on purpose.
  function reconcileOrphans(watchId) {
    const time = nowSql();
    const rows = stmts.orphaned.all(watchId);
    for (const row of rows) stmts.markRemoved.run(time, row.id);
    return rows.length;
  }

  // Makes a failed item (including one that used up its automatic retries) queueable now,
  // keeping its attempt count and last error as history.
  function resetForManualRetry(itemId) {
    const time = nowSql();
    return stmts.manualRetry.run(time, time, itemId).changes === 1;
  }

  function getItem(itemId, watchId) {
    return watchId === undefined ? stmts.getItem.get(itemId) : stmts.getWatchItem.get(watchId, itemId);
  }

  function aggregateWatch(watchId) {
    return { ...EMPTY_AGGREGATE, ...stmts.aggregate.get(watchId) };
  }

  function decorate(watch) {
    if (!watch) return watch;
    const agg = aggregateWatch(watch.id);
    const run = stmts.latestRun.get(watch.id);
    return {
      ...watch,
      ...agg,
      // Kept while the UI transitions: "seen" was everything discovered, "download_count"
      // is now only completed downloads (it used to count queued and failed jobs too).
      seen_count: agg.cataloged_count,
      download_count: agg.completed_count,
      latest_run_id: run ? run.id : null,
      latest_run_status: run ? run.status : null,
      latest_run_trigger: run ? run.trigger : null,
      latest_run_error: run ? run.error : null,
      latest_run_started_at: run ? run.started_at : null,
      latest_run_finished_at: run ? run.finished_at : null,
      latest_scanned_count: run ? run.scanned_count : 0,
      latest_baseline_count: run ? run.baseline_count : 0,
      latest_new_count: run ? run.new_count : 0,
      latest_backfill_count: run ? run.backfill_count : 0,
      latest_matched_count: run ? run.matched_count : 0,
      latest_queued_count: run ? run.queued_count : 0,
      latest_pending_count: run ? run.pending_count : 0,
    };
  }

  function getWatch(watchId) {
    return decorate(db.prepare('SELECT * FROM watches WHERE id = ?').get(watchId));
  }

  function listWatches({ music = null } = {}) {
    const where = music === true ? 'WHERE is_music = 1' : music === false ? 'WHERE COALESCE(is_music, 0) = 0' : '';
    return db.prepare(`SELECT * FROM watches ${where} ORDER BY created_at DESC`).all().map(decorate);
  }

  function listItems(watchId, { status = 'all', limit = 100, offset = 0 } = {}) {
    const clause = ITEM_STATUS_FILTERS[status];
    const where = clause ? `watch_id = ? AND ${clause}` : 'watch_id = ?';
    const items = db.prepare(`SELECT * FROM watch_items WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(watchId, limit, offset);
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM watch_items WHERE ${where}`).get(watchId);
    return { items, total, limit, offset };
  }

  function listRuns(watchId, { limit = 20 } = {}) {
    return db.prepare('SELECT * FROM watch_runs WHERE watch_id = ? ORDER BY id DESC LIMIT ?').all(watchId, limit);
  }

  // "Reset history": forget everything except completed downloads (so files already on disk
  // aren't fetched again) and rebaseline on the next check.
  function resetHistory(watchId) {
    db.transaction(() => {
      db.prepare(`
        UPDATE downloads SET watch_item_id = NULL
        WHERE watch_item_id IN (SELECT id FROM watch_items WHERE watch_id = ? AND download_status != 'completed')
      `).run(watchId);
      db.prepare("DELETE FROM watch_items WHERE watch_id = ? AND download_status != 'completed'").run(watchId);
      db.prepare('DELETE FROM watch_runs WHERE watch_id = ?').run(watchId);
      db.prepare('DELETE FROM watch_seen_ids WHERE watch_id = ?').run(watchId);
      db.prepare("UPDATE watches SET last_checked_at = NULL, baselined_tabs = NULL, last_new_count = 0, last_status = 'ok', last_error = NULL WHERE id = ?").run(watchId);
    })();
  }

  // Download history rows are kept (and keep their watch_id, which cleanup relies on to
  // treat them as watch downloads); only the link to the deleted ledger goes.
  function deleteWatch(watchId) {
    let changes = 0;
    db.transaction(() => {
      changes = db.prepare('DELETE FROM watches WHERE id = ?').run(watchId).changes;
      if (!changes) return;
      db.prepare('UPDATE downloads SET watch_item_id = NULL WHERE watch_item_id IN (SELECT id FROM watch_items WHERE watch_id = ?)').run(watchId);
      db.prepare('DELETE FROM watch_items WHERE watch_id = ?').run(watchId);
      db.prepare('DELETE FROM watch_runs WHERE watch_id = ?').run(watchId);
      db.prepare('DELETE FROM watch_seen_ids WHERE watch_id = ?').run(watchId);
    })();
    return changes > 0;
  }

  function updateWatchStatus(watchId, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    db.prepare(`UPDATE watches SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), watchId);
  }

  return {
    transaction: (fn) => db.transaction(fn),
    now,
    nowSql,
    createRun,
    finishRun,
    getRun: (id) => stmts.getRun.get(id),
    knownIds,
    upsertItems,
    setItemTabs,
    reevaluateItems,
    queueCandidates,
    linkQueuedJob,
    applyDownloadState,
    reconcileOrphans,
    resetForManualRetry,
    getItem,
    getWatch,
    listWatches,
    listItems,
    listRuns,
    aggregateWatch,
    resetHistory,
    deleteWatch,
    updateWatchStatus,
  };
}

module.exports = { createRepository, toSqlTime, RETRY_DELAYS_MS, MAX_ATTEMPTS, ITEM_STATUS_FILTERS };
