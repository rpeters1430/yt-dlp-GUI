const test = require('node:test');
const assert = require('node:assert/strict');
const { entry, setupWatchService } = require('../helpers/watchFixtures');

const many = (n, prefix) => Array.from({ length: n }, (_, i) => entry(`${prefix}-${i + 1}`));

test('first check of 89 videos is a baseline: nothing new, nothing queued', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ max_scan_entries: 100 });
  s.state.entries = many(89, 'old');
  const initial = await s.service.checkWatch(s.getWatch(id), { manual: true, backfillCount: 0, trigger: 'initial' });
  assert.equal(initial.baselineCount, 89);
  assert.equal(initial.newCount, 0);
  assert.equal(initial.queuedCount, 0);
  assert.equal(s.downloadsFor(id).length, 0);
  const card = s.repository.getWatch(id);
  assert.equal(card.latest_run_trigger, 'initial');
  assert.equal(card.latest_baseline_count, 89);
  assert.equal(card.last_new_count, 0);

  s.state.entries = [entry('fresh-1', 'New Movie Trailer'), entry('fresh-2', 'IGN Daily Fix'), ...many(89, 'old')];
  s.db.prepare("UPDATE watches SET match_title = ? WHERE id = ?").run('\\b(movie|video game|gameplay|official)\\s+trailer\\b', id);
  const second = await s.service.checkWatch(s.getWatch(id), { manual: true, trigger: 'manual' });
  assert.equal(second.newCount, 2);
  assert.equal(second.matchedCount, 1);
  assert.equal(second.excludedCount, 1);
  assert.equal(second.queuedCount, 1);
  assert.equal(second.boundaryReached, true);
  assert.equal(s.itemByVideo(id, 'fresh-1').download_status, 'queued');
  assert.equal(s.itemByVideo(id, 'fresh-2').filter_reason, 'Include title regex did not match');

  const third = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(third.newCount, 0);
  assert.equal(third.queuedCount, 0, 'a queued video is never queued twice');
  assert.equal(s.downloadsFor(id).length, 1);
});

test('initial backfill queues exactly the requested newest eligible videos', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ reject_title: 'reaction' });
  s.state.entries = [entry('a', 'A reaction'), entry('b'), entry('c'), entry('d'), entry('e')];
  const result = await s.service.checkWatch(s.getWatch(id), { manual: true, backfillCount: 2 });
  assert.equal(result.backfillCount, 2);
  assert.equal(result.queuedCount, 2);
  assert.equal(result.baselineCount, 3);
  assert.deepEqual(s.downloadsFor(id).map((d) => d.url).sort(), ['https://www.youtube.com/watch?v=b', 'https://www.youtube.com/watch?v=c']);
  assert.equal(s.itemByVideo(id, 'a').discovery_type, 'baseline');
});

test('exclude wins over include', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ match_title: 'trailer', reject_title: '\\breaction\\b', last_checked_at: '2026-01-01 00:00:00' });
  s.repository.upsertItems(id, [{ entry: entry('known'), discoveryType: 'baseline' }]);
  s.state.entries = [entry('x', 'Trailer REACTION'), entry('y', 'Official trailer'), entry('known')];
  const result = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(result.queuedCount, 1);
  assert.equal(s.itemByVideo(id, 'x').filter_reason, 'Exclude title regex matched');
});

test('eligible videos beyond the download limit stay pending and queue on the next check', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ download_limit: 5 });
  s.state.entries = [entry('known')];
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  s.state.entries = [...many(10, 'new'), entry('known')];
  const first = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(first.queuedCount, 5);
  assert.equal(first.pendingCount, 5);
  assert.deepEqual(s.downloadsFor(id).map((d) => d.url.split('=')[1]), ['new-1', 'new-2', 'new-3', 'new-4', 'new-5']);
  const second = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(second.newCount, 0);
  assert.equal(second.queuedCount, 5);
  assert.equal(second.pendingCount, 0);
  assert.equal(s.downloadsFor(id).length, 10);
});

test('a scan that never reaches known content is reported as partial', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ max_scan_entries: 100, download_limit: 1 });
  s.state.entries = [entry('known')];
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  s.state.entries = [...many(1200, 'burst'), entry('known')];
  const result = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(result.status, 'partial');
  assert.equal(result.scannedCount, 1000);
  assert.equal(result.boundaryReached, false);
  assert.equal(s.repository.getWatch(id).latest_run_status, 'partial');
  assert.equal(s.repository.aggregateWatch(id).pending_count, 999, 'discovered work is kept');
});

test('a discovery failure fails the run and leaves existing items alone', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch();
  s.state.entries = [entry('a'), entry('b')];
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  s.state.failInfo = 'HTTP Error 429';
  await assert.rejects(s.service.checkWatch(s.getWatch(id), { manual: true }), /429/);
  const card = s.repository.getWatch(id);
  assert.equal(card.latest_run_status, 'failed');
  assert.equal(card.latest_run_error, 'HTTP Error 429');
  assert.equal(card.last_status, 'error');
  assert.equal(card.cataloged_count, 2);
});

test('an invalid legacy regex is a visible configuration error that queues nothing', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ match_title: '(unclosed', last_checked_at: '2026-01-01 00:00:00' });
  s.state.entries = [entry('a')];
  await assert.rejects(s.service.checkWatch(s.getWatch(id), { manual: true }), /Filter configuration error/);
  assert.equal(s.state.calls, 0);
  assert.equal(s.downloadsFor(id).length, 0);
  assert.match(s.repository.getWatch(id).latest_run_error, /Include title/);
});

test('simultaneous checks of one watch share a single run', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch();
  s.state.entries = [entry('known')];
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  s.state.entries = [entry('n1'), entry('n2'), entry('known')];
  s.state.delayMs = 20;
  const [a, b] = await Promise.all([
    s.service.checkWatch(s.getWatch(id), { manual: true }),
    s.service.checkWatch(s.getWatch(id), { manual: true }),
  ]);
  assert.equal(b.alreadyRunning, true);
  assert.equal(b.runId, a.runId);
  assert.equal(a.queuedCount, 2);
  assert.equal(s.downloadsFor(id).length, 2);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM watch_items WHERE watch_id = ?').get(id).n, 3);
  assert.equal(s.service.isRunning(id), false);
});

test('a disabled watch is skipped unless checked manually', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ enabled: 0 });
  const result = await s.service.checkWatch(s.getWatch(id));
  assert.equal(result.skipped, true);
  assert.equal(s.state.calls, 0);
});

test('migration: upgrading a watch with 89 seen IDs triggers no downloads', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ max_scan_entries: 100, last_checked_at: '2026-01-01 00:00:00' });
  s.db.exec('DELETE FROM watch_items');
  s.db.prepare("DELETE FROM settings WHERE key = 'watch_items_migrated'").run();
  const seen = s.db.prepare('INSERT INTO watch_seen_ids (watch_id, video_id) VALUES (?, ?)');
  const entries = many(89, 'legacy');
  for (const e of entries) seen.run(id, e.id);

  const db = s.tmp.reopen();
  const { createRepository } = require('../../src/services/watch/repository');
  const { createWatchService } = require('../../src/services/watch/service');
  const repo = createRepository(db);
  const created = [];
  const service = createWatchService({
    repository: repo,
    ytdlp: { getInfo: async (u, { playlistStart, playlistEnd }) => ({ entries: entries.slice(playlistStart - 1, playlistEnd) }) },
    queue: { createQueuedJob: () => { created.push(1); return { id: 'x' }; }, startQueuedJobs() {} },
  });
  const result = await service.checkWatch(db.prepare('SELECT * FROM watches WHERE id = ?').get(id), { manual: true });
  assert.equal(result.baselineCount, 0);
  assert.equal(result.newCount, 0);
  assert.equal(result.queuedCount, 0);
  assert.equal(created.length, 0);
  assert.equal(repo.aggregateWatch(id).cataloged_count, 89);
});
