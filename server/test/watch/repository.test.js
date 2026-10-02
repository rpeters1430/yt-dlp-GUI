const test = require('node:test');
const assert = require('node:assert/strict');
const { openTempDb } = require('../helpers/tempDb');
const { createRepository } = require('../../src/services/watch/repository');

function insertWatch(db, fields = {}) {
  return Number(db.prepare("INSERT INTO watches (url, name, last_checked_at) VALUES (?, ?, datetime('now'))")
    .run(fields.url || 'https://www.youtube.com/@example', fields.name || 'Example').lastInsertRowid);
}

function insertDownload(db, id, watchId, videoId, status, error = null) {
  db.prepare('INSERT INTO downloads (id, url, status, watch_id, video_id, error) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, `https://www.youtube.com/watch?v=${videoId}`, status, watchId, videoId, error);
}

// A database as left by the old watcher: seen IDs, no ledger, migration not yet run.
function legacyDb(t) {
  const tmp = openTempDb();
  t.after(() => tmp.cleanup());
  const { db } = tmp;
  db.exec('DELETE FROM watch_items');
  db.prepare("DELETE FROM settings WHERE key = 'watch_items_migrated'").run();
  return tmp;
}

test('legacy seen IDs migrate to baseline items linked to their downloads', (t) => {
  const tmp = legacyDb(t);
  const watchId = insertWatch(tmp.db);
  const seen = tmp.db.prepare('INSERT INTO watch_seen_ids (watch_id, video_id, title) VALUES (?, ?, ?)');
  seen.run(watchId, 'vid-a', 'A');
  seen.run(watchId, 'vid-b', 'B');
  seen.run(watchId, 'vid-c', 'C');
  insertDownload(tmp.db, 'dl-a', watchId, 'vid-a', 'completed');
  insertDownload(tmp.db, 'dl-b', watchId, 'vid-b', 'failed', 'network');

  const db = tmp.reopen();
  const repo = createRepository(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM watch_items').get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM watch_items WHERE discovery_type = 'baseline'").get().n, 3);
  const agg = repo.aggregateWatch(watchId);
  assert.equal(agg.completed_count, 1);
  assert.equal(agg.failed_count, 1);
  assert.equal(agg.new_count, 0);
  assert.equal(agg.pending_count, 0);
  assert.equal(db.prepare("SELECT watch_item_id FROM downloads WHERE id = 'dl-a'").get().watch_item_id !== null, true);

  const failed = db.prepare("SELECT * FROM watch_items WHERE video_id = 'vid-b'").get();
  assert.equal(failed.last_error, 'network');
  assert.equal(failed.next_retry_at, null, 'migrated failures are never retried automatically');

  const again = tmp.reopen();
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM watch_items').get().n, 3);
});

test('a watch item is unique per watch and video', (t) => {
  const tmp = openTempDb();
  t.after(() => tmp.cleanup());
  const watchId = insertWatch(tmp.db);
  const insert = () => tmp.db.prepare("INSERT INTO watch_items (watch_id, video_id, discovery_type) VALUES (?, 'x', 'new')").run(watchId);
  insert();
  assert.throws(insert, /UNIQUE/);
});

test('upsertItems keeps newest-first order and refreshes known items', (t) => {
  const tmp = openTempDb();
  t.after(() => tmp.cleanup());
  const repo = createRepository(tmp.db);
  const watchId = insertWatch(tmp.db);
  const inserted = repo.upsertItems(watchId, [
    { entry: { id: 'newest', title: 'Newest' }, discoveryType: 'new' },
    { entry: { id: 'older', title: 'Older' }, discoveryType: 'new' },
  ]);
  assert.equal(inserted, 2);
  repo.upsertItems(watchId, [{ entry: { id: 'older', title: 'Renamed' } }]);
  assert.deepEqual(repo.queueCandidates(watchId).map((i) => i.title), ['Newest', 'Renamed']);
  assert.deepEqual(repo.listItems(watchId, { status: 'pending' }).total, 2);
});

test('runs record their counters and finish time', (t) => {
  const tmp = openTempDb();
  t.after(() => tmp.cleanup());
  const repo = createRepository(tmp.db);
  const watchId = insertWatch(tmp.db);
  const runId = repo.createRun(watchId, 'manual');
  const run = repo.finishRun(runId, { status: 'partial', scanned_count: 1000, scan_boundary_reached: false });
  assert.equal(run.status, 'partial');
  assert.equal(run.scanned_count, 1000);
  assert.ok(run.finished_at);
  assert.equal(repo.getWatch(watchId).latest_run_status, 'partial');
});

test('deleting a watch removes its ledger but keeps download history', (t) => {
  const tmp = openTempDb();
  t.after(() => tmp.cleanup());
  const repo = createRepository(tmp.db);
  const watchId = insertWatch(tmp.db);
  repo.upsertItems(watchId, [{ entry: { id: 'v1' }, discoveryType: 'new' }]);
  const item = repo.queueCandidates(watchId)[0];
  insertDownload(tmp.db, 'dl-1', watchId, 'v1', 'completed');
  tmp.db.prepare('UPDATE downloads SET watch_item_id = ? WHERE id = ?').run(item.id, 'dl-1');
  assert.equal(repo.deleteWatch(watchId), true);
  assert.equal(tmp.db.prepare('SELECT COUNT(*) AS n FROM watch_items').get().n, 0);
  const dl = tmp.db.prepare("SELECT watch_id, watch_item_id FROM downloads WHERE id = 'dl-1'").get();
  assert.deepEqual({ ...dl }, { watch_id: watchId, watch_item_id: null });
});

test('reset history keeps completed items and forgets the rest', (t) => {
  const tmp = openTempDb();
  t.after(() => tmp.cleanup());
  const repo = createRepository(tmp.db);
  const watchId = insertWatch(tmp.db);
  repo.upsertItems(watchId, [
    { entry: { id: 'done' }, discoveryType: 'new' },
    { entry: { id: 'pending' }, discoveryType: 'new' },
  ]);
  const done = tmp.db.prepare("SELECT id FROM watch_items WHERE video_id = 'done'").get().id;
  repo.applyDownloadState(done, 'completed', {});
  repo.resetHistory(watchId);
  assert.deepEqual([...repo.knownIds(watchId)], ['done']);
  assert.equal(tmp.db.prepare('SELECT last_checked_at FROM watches WHERE id = ?').get(watchId).last_checked_at, null);
});
