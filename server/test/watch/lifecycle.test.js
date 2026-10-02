const test = require('node:test');
const assert = require('node:assert/strict');
const { entry, setupWatchService } = require('../helpers/watchFixtures');

const MIN = 60 * 1000;

async function queuedItem(t) {
  const clock = { now: new Date('2026-09-08T20:00:00Z') };
  const s = setupWatchService(t, { clock });
  const watchId = s.addWatch();
  s.state.entries = [entry('known')];
  await s.service.checkWatch(s.getWatch(watchId), { manual: true });
  s.state.entries = [entry('v1'), entry('known')];
  await s.service.checkWatch(s.getWatch(watchId), { manual: true });
  const item = s.itemByVideo(watchId, 'v1');
  return { s, clock, watchId, itemId: item.id, downloadId: item.download_id };
}

test('a failed download retries after 15m, 1h and 6h, then stops', async (t) => {
  const { s, clock, watchId, itemId, downloadId } = await queuedItem(t);
  const repo = s.repository;
  repo.applyDownloadState(itemId, 'downloading', { downloadId });
  repo.applyDownloadState(itemId, 'failed', { downloadId, error: 'network' });
  let item = repo.getItem(itemId);
  assert.equal(item.attempt_count, 1);
  assert.equal(item.last_error, 'network');
  assert.equal(item.next_retry_at, '2026-09-08 20:15:00');

  // Not due yet: nothing is retried.
  clock.now = new Date(clock.now.getTime() + 14 * MIN);
  let result = await s.service.checkWatch(s.getWatch(watchId), { manual: true });
  assert.equal(result.queuedCount, 0);

  const expectedDelays = [60 * MIN, 360 * MIN];
  for (let attempt = 2; attempt <= 4; attempt++) {
    clock.now = new Date(clock.now.getTime() + 6 * 60 * MIN);
    result = await s.service.checkWatch(s.getWatch(watchId), { manual: true });
    assert.equal(result.queuedCount, 1, `retry ${attempt - 1} is queued`);
    const current = repo.getItem(itemId);
    assert.equal(current.download_status, 'queued');
    repo.applyDownloadState(itemId, 'failed', { downloadId: current.download_id, error: `fail ${attempt}` });
    item = repo.getItem(itemId);
    assert.equal(item.attempt_count, attempt);
    if (attempt < 4) {
      const expected = new Date(clock.now.getTime() + expectedDelays[attempt - 2]).toISOString().slice(0, 19).replace('T', ' ');
      assert.equal(item.next_retry_at, expected);
    }
  }
  assert.equal(item.attempt_count, 4);
  assert.equal(item.next_retry_at, null);
  clock.now = new Date(clock.now.getTime() + 48 * 60 * MIN);
  assert.equal(repo.queueCandidates(watchId, clock.now).some((x) => x.id === itemId), false);
  assert.equal(s.downloadsFor(watchId).length, 4, 'every attempt is a separate download job');

  // Manual retry still works after automatic retries stop.
  const retried = s.service.retryItem(s.getWatch(watchId), itemId);
  assert.equal(retried.item.download_status, 'queued');
  assert.equal(retried.item.attempt_count, 4, 'history is kept');
  assert.equal(s.downloadsFor(watchId).length, 5);
});

test('completion is recorded and stale jobs cannot overwrite the current attempt', async (t) => {
  const { s, itemId, downloadId } = await queuedItem(t);
  s.repository.applyDownloadState(itemId, 'failed', { downloadId: 'some-older-job', error: 'old' });
  assert.equal(s.repository.getItem(itemId).download_status, 'queued');
  s.repository.applyDownloadState(itemId, 'completed', { downloadId });
  const item = s.repository.getItem(itemId);
  assert.equal(item.download_status, 'completed');
  assert.ok(item.completed_at);
  assert.equal(s.repository.aggregateWatch(item.watch_id).completed_count, 1);
});

test('only failed items can be retried by hand, and only through their own watch', async (t) => {
  const { s, watchId, itemId } = await queuedItem(t);
  assert.equal(s.service.retryItem(s.getWatch(watchId), itemId).status, 409);
  const otherWatch = s.addWatch({ url: 'https://www.youtube.com/@other' });
  assert.equal(s.service.retryItem(s.getWatch(otherWatch), itemId).status, 404);
});

test('restart keeps the link between a download and its watch item', async (t) => {
  const { s, itemId, downloadId } = await queuedItem(t);
  const db = s.tmp.reopen();
  assert.equal(db.prepare('SELECT watch_item_id FROM downloads WHERE id = ?').get(downloadId).watch_item_id, itemId);
  assert.equal(db.prepare('SELECT download_id FROM watch_items WHERE id = ?').get(itemId).download_id, downloadId);
});

test('removing a queued job leaves the item failed and retryable by hand', async (t) => {
  const { s, watchId, itemId, downloadId } = await queuedItem(t);
  s.db.prepare('DELETE FROM downloads WHERE id = ?').run(downloadId);
  s.repository.applyDownloadState(itemId, 'removed', { downloadId });
  let item = s.repository.getItem(itemId);
  assert.equal(item.download_status, 'failed');
  assert.equal(item.next_retry_at, null);
  const result = await s.service.checkWatch(s.getWatch(watchId), { manual: true });
  assert.equal(result.queuedCount, 0, 'a removed job is not retried automatically');
  assert.equal(s.service.retryItem(s.getWatch(watchId), itemId).item.download_status, 'queued');
});

test('a job deleted without notice is reconciled on the next check', async (t) => {
  const { s, watchId, itemId, downloadId } = await queuedItem(t);
  s.db.prepare('DELETE FROM downloads WHERE id = ?').run(downloadId);
  await s.service.checkWatch(s.getWatch(watchId), { manual: true });
  assert.equal(s.repository.getItem(itemId).download_status, 'failed');
});

test('deleting a failed job keeps the item visible and retryable', async (t) => {
  const { s, watchId, itemId, downloadId } = await queuedItem(t);
  s.repository.applyDownloadState(itemId, 'failed', { downloadId, error: 'boom' });
  s.db.prepare('DELETE FROM downloads WHERE id = ?').run(downloadId);
  s.repository.applyDownloadState(itemId, 'removed', { downloadId });
  const item = s.repository.getItem(itemId);
  assert.equal(item.download_status, 'failed');
  assert.equal(item.last_error, 'boom');
  assert.equal(s.repository.listItems(watchId, { status: 'failed' }).total, 1);
});

test('the real queue stores watch_item_id and reports removal of a linked job', (t) => {
  const { openTempDb } = require('../helpers/tempDb');
  const tmp = openTempDb();
  const queuePath = require.resolve('../../src/services/queue');
  delete require.cache[queuePath];
  const queue = require(queuePath);
  t.after(() => { delete require.cache[queuePath]; tmp.cleanup(); });

  const events = [];
  queue.setWatchItemListener((itemId, status, info) => events.push([itemId, status, info.downloadId]));
  const { id, job } = queue.createQueuedJob('https://www.youtube.com/watch?v=abc', { watchId: 3, watchItemId: 42 });
  assert.equal(job.watch_item_id, 42);
  assert.equal(job.status, 'queued');
  queue.removeJob(id);
  assert.deepEqual(events, [[42, 'removed', id]]);
});
