const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { entry, setupWatchService } = require('../helpers/watchFixtures');
const { createWatchesRouter } = require('../../src/routes/watches');

async function startApp(t, { auth = (req, res, next) => next() } = {}) {
  const s = setupWatchService(t);
  const app = express();
  app.use(express.json());
  app.use('/api/watches', createWatchesRouter({
    repository: s.repository,
    watchService: s.service,
    checkAllWatches: async () => {},
    database: s.db,
    ytdlp: s.ytdlp,
    requireAuthMiddleware: auth,
  }));
  const server = await new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/watches`;
  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  return { s, call };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test('routes require authentication', async (t) => {
  const { call } = await startApp(t, { auth: (req, res) => res.status(401).json({ error: 'Not authenticated' }) });
  for (const [method, path] of [['GET', '/'], ['POST', '/preview-filter'], ['GET', '/1/items'], ['GET', '/1/runs'], ['POST', '/1/items/1/retry']]) {
    assert.equal((await call(method, path, method === 'POST' ? {} : undefined)).status, 401, `${method} ${path}`);
  }
});

test('create and update reject invalid or unsafe regex with the validator message', async (t) => {
  const { s, call } = await startApp(t);
  let res = await call('POST', '/', { url: 'https://www.youtube.com/@x', matchTitle: '(' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Include title must be a valid regular expression');
  res = await call('POST', '/', { url: 'https://www.youtube.com/@x', rejectTitle: '(a+)+$' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Exclude title regex is unsafe/);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM watches').get().n, 0);

  const id = s.addWatch();
  res = await call('PUT', `/${id}`, { matchTitle: 'x'.repeat(201) });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /200 characters/);
});

test('create returns at once and runs an initial check with the requested backfill', async (t) => {
  const { s, call } = await startApp(t);
  s.state.entries = [entry('a'), entry('b'), entry('c')];
  const res = await call('POST', '/', { url: 'https://www.youtube.com/@x', backfillCount: 1 });
  assert.equal(res.status, 200);
  assert.ok(res.body.initial_run_id);
  await settle();
  const runs = (await call('GET', `/${res.body.id}/runs`)).body;
  assert.equal(runs[0].trigger, 'initial');
  assert.equal(runs[0].backfill_count, 1);
  assert.equal(runs[0].queued_count, 1);
  assert.equal(runs[0].baseline_count, 2);
});

test('create with backfillCount "all" queues everything already posted', async (t) => {
  const { s, call } = await startApp(t);
  s.state.entries = [entry('a'), entry('b'), entry('c')];
  const res = await call('POST', '/', { url: 'https://www.youtube.com/playlist?list=PLx', backfillCount: 'all' });
  assert.equal(res.status, 200);
  await settle();
  const runs = (await call('GET', `/${res.body.id}/runs`)).body;
  assert.equal(runs[0].backfill_count, 3);
  assert.equal(runs[0].queued_count, 3);
  assert.equal(runs[0].baseline_count, 0);
});

test('preview evaluates recent entries and persists nothing', async (t) => {
  const { s, call } = await startApp(t);
  s.state.entries = [entry('a', 'Official Trailer'), entry('b', 'Trailer reaction'), entry('c', 'Podcast')];
  const res = await call('POST', '/preview-filter', { url: 'https://www.youtube.com/@x', matchTitle: 'trailer', rejectTitle: 'reaction' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.entries.map(({ id, eligible, reason }) => ({ id, eligible, reason })), [
    { id: 'a', eligible: true, reason: null },
    { id: 'b', eligible: false, reason: 'Exclude title regex matched' },
    { id: 'c', eligible: false, reason: 'Include title regex did not match' },
  ]);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM watch_items').get().n, 0);
  assert.equal((await call('POST', '/preview-filter', { url: 'https://www.youtube.com/@x', matchTitle: '[' })).status, 400);
});

test('list aggregates distinguish baseline, pending, queued, completed and failed', async (t) => {
  const { s, call } = await startApp(t);
  const id = s.addWatch({ download_limit: 4, max_scan_entries: 100 });
  s.state.entries = Array.from({ length: 89 }, (_, i) => entry(`old-${i}`));
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  s.state.entries = [entry('n1'), entry('n2'), entry('n3'), entry('n4'), entry('n5'), ...s.state.entries];
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  const item = (v) => s.itemByVideo(id, v);
  s.repository.applyDownloadState(item('n1').id, 'completed', { downloadId: item('n1').download_id });
  s.repository.applyDownloadState(item('n2').id, 'completed', { downloadId: item('n2').download_id });
  s.repository.applyDownloadState(item('n3').id, 'failed', { downloadId: item('n3').download_id, error: 'x' });

  const [card] = (await call('GET', '/')).body;
  assert.deepEqual(
    { b: card.baseline_count, n: card.latest_new_count, p: card.pending_count, q: card.queued_count, c: card.completed_count, f: card.failed_count },
    { b: 89, n: 5, p: 1, q: 1, c: 2, f: 1 },
  );
  assert.equal(card.download_count, 2, 'download_count only counts completed downloads');
  assert.equal(card.seen_count, 94);
});

test('item and run lists and retry are scoped to their watch', async (t) => {
  const { s, call } = await startApp(t);
  const id = s.addWatch();
  const other = s.addWatch({ url: 'https://www.youtube.com/@other' });
  s.state.entries = [entry('known')];
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  s.state.entries = [entry('v1'), entry('known')];
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  const item = s.itemByVideo(id, 'v1');

  const items = (await call('GET', `/${id}/items?status=queued`)).body;
  assert.equal(items.total, 1);
  assert.equal(items.items[0].video_id, 'v1');
  assert.equal((await call('GET', `/${other}/items`)).body.total, 0);
  assert.equal((await call('GET', '/9999/items')).status, 404);
  assert.equal((await call('GET', `/${id}/items?status=bogus`)).status, 400);
  assert.equal((await call('GET', `/${id}/runs`)).body.length, 2);

  assert.equal((await call('POST', `/${id}/items/${item.id}/retry`)).status, 409, 'not failed yet');
  s.repository.applyDownloadState(item.id, 'failed', { downloadId: item.download_id, error: 'x' });
  assert.equal((await call('POST', `/${other}/items/${item.id}/retry`)).status, 404, 'foreign item');
  const retry = await call('POST', `/${id}/items/${item.id}/retry`);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.item.download_status, 'queued');
});

test('check returns the run id and reports an overlapping check', async (t) => {
  const { s, call } = await startApp(t);
  const id = s.addWatch();
  s.state.entries = [entry('a')];
  s.state.delayMs = 30;
  const [first, second] = await Promise.all([call('POST', `/${id}/check`), call('POST', `/${id}/check`)]);
  const results = [first.body, second.body];
  assert.ok(results.every((r) => r.runId === results[0].runId));
  assert.deepEqual(results.map((r) => r.alreadyRunning).sort(), [false, true]);
});

test('deleting a watch removes its items and runs', async (t) => {
  const { s, call } = await startApp(t);
  const id = s.addWatch();
  s.state.entries = [entry('a')];
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal((await call('DELETE', `/${id}`)).status, 200);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM watch_items').get().n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM watch_runs').get().n, 0);
  assert.equal((await call('DELETE', `/${id}`)).status, 404);
});

test('a watch cannot be deleted or reset while it is being checked', async (t) => {
  const { s, call } = await startApp(t);
  const id = s.addWatch();
  s.state.entries = [entry('a')];
  s.state.delayMs = 50;
  const check = s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal((await call('DELETE', `/${id}`)).status, 409);
  assert.equal((await call('POST', `/${id}/reset-seen`)).status, 409);
  await check;
  assert.equal((await call('DELETE', `/${id}`)).status, 200);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM watch_items').get().n, 0);
});
