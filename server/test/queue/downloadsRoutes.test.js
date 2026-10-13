const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { loadQueue, waitFor, insertJob } = require('../helpers/queueHarness');

const ROUTES = path.join(__dirname, '..', '..', 'src', 'routes', 'downloads');

// The real downloads router (with its real requireAuth) over a temp database. `signedIn`
// fakes the session cookie by handing requireAuth the session a real login would create.
async function startApp(t, { signedIn = true } = {}) {
  const q = loadQueue(t);
  q.queue.init(q.io);
  const userId = q.db.prepare("INSERT INTO users (username, password_hash) VALUES ('admin', 'x')").run().lastInsertRowid;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = signedIn ? { userId, sessionVersion: 1, destroy: (cb) => cb && cb() } : { destroy: (cb) => cb && cb() };
    next();
  });
  app.use('/api/downloads', require(ROUTES));
  const server = await new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/downloads`;

  async function call(method, urlPath, body) {
    const res = await fetch(base + urlPath, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  // Lets any download a test started finish before the temp database is closed.
  async function settle() {
    await waitFor(() => q.queue.listJobs({ activeOnly: true }).length === 0, { label: 'queue to drain' });
  }
  return { q, call, settle };
}

test('every route requires a signed-in session', async (t) => {
  const { call } = await startApp(t, { signedIn: false });
  for (const [method, p] of [['GET', '/'], ['GET', '/history'], ['GET', '/stats'], ['POST', '/'], ['DELETE', '/x'], ['GET', '/x/log']]) {
    assert.equal((await call(method, p, method === 'POST' ? {} : undefined)).status, 401, `${method} ${p}`);
  }
});

test('POST / validates the URL list', async (t) => {
  const { call } = await startApp(t);
  assert.equal((await call('POST', '/', {})).status, 400);
  assert.equal((await call('POST', '/', { urls: ['   '] })).status, 400);

  const tooMany = Array.from({ length: 101 }, (_, i) => `https://www.youtube.com/watch?v=${String(i).padStart(11, '0')}`);
  const res = await call('POST', '/', { urls: tooMany });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /max 100/);

  const local = await call('POST', '/', { url: 'http://127.0.0.1:8080/admin' });
  assert.equal(local.status, 400);
});

test('POST / queues each URL with normalized options', async (t) => {
  const { q, call, settle } = await startApp(t);
  const res = await call('POST', '/', {
    urls: ['youtu.be/aaaaaaaaaaa', 'https://www.youtube.com/watch?v=bbbbbbbbbbb'],
    quality: '720',
    embedThumbnail: 1,
    splitLiveChunks: true,
    liveChunkDuration: '0',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ids.length, 2);
  await settle();

  const first = q.queue.getJob(res.body.ids[0]);
  assert.equal(first.url, 'https://youtu.be/aaaaaaaaaaa', 'a scheme-less link gets https://');
  assert.equal(first.quality, '720');
  const options = JSON.parse(first.options_json);
  assert.equal(options.embedThumbnail, true);
  assert.equal(options.splitLiveChunks, false, 'a zero chunk length turns splitting off');
  assert.equal(options.waitInterval, 15);
});

test('GET / returns the bounded list and ?active=1 only running jobs', async (t) => {
  const { q, call } = await startApp(t);
  for (let i = 0; i < 5; i++) insertJob(q.db, { id: `d${i}`, createdAt: `2026-01-0${i + 1} 00:00:00` });

  assert.equal((await call('GET', '/')).body.length, 5);
  assert.deepEqual((await call('GET', '/?limit=2')).body.map((j) => j.id), ['d4', 'd3']);
  assert.deepEqual((await call('GET', '/?active=1')).body, []);
});

test('GET /history pages and filters; GET /stats counts', async (t) => {
  const { q, call } = await startApp(t);
  insertJob(q.db, { id: 'a', status: 'failed', title: 'Alpha', createdAt: '2026-01-01 00:00:00' });
  insertJob(q.db, { id: 'b', status: 'completed', title: 'Beta', createdAt: '2026-01-02 00:00:00' });
  insertJob(q.db, { id: 'c', status: 'failed', title: 'Gamma', createdAt: '2026-01-03 00:00:00' });

  const failed = await call('GET', '/history?status=failed&limit=1&offset=0');
  assert.equal(failed.body.total, 2);
  assert.deepEqual(failed.body.jobs.map((j) => j.id), ['c']);
  const next = await call('GET', '/history?status=failed&limit=1&offset=1');
  assert.deepEqual(next.body.jobs.map((j) => j.id), ['a']);
  assert.deepEqual((await call('GET', '/history?q=bet')).body.jobs.map((j) => j.id), ['b']);

  assert.deepEqual((await call('GET', '/stats')).body, { queued: 0, downloading: 0, completed: 1, failed: 2 });
});

test('log, delete and protect act on a single job', async (t) => {
  const { q, call } = await startApp(t);
  insertJob(q.db, { id: 'j1', log: 'line 1' });

  assert.equal((await call('GET', '/j1/log')).body.log, 'line 1');
  assert.equal((await call('GET', '/missing/log')).status, 404);

  const protectedRow = await call('PATCH', '/j1/protect', { protected: true });
  assert.equal(protectedRow.body.protected, 1);
  assert.equal((await call('PATCH', '/j1/protect')).body.protected, 0, 'no body toggles');
  assert.equal((await call('PATCH', '/missing/protect')).status, 404);

  assert.deepEqual((await call('DELETE', '/j1')).body, { ok: true });
  assert.equal(q.queue.getJob('j1'), undefined);
  assert.deepEqual((await call('DELETE', '/j1')).body, { ok: true }, 'deleting again is harmless');
});

test('POST /info summarizes a single video: best quality, resolutions and formats', async (t) => {
  const { q, call } = await startApp(t);
  q.state.info = {
    title: 'A video', uploader: 'Someone', duration: 61, extractor: 'youtube', view_count: 5,
    thumbnails: [{ url: 'small.jpg' }, { url: 'big.jpg' }],
    formats: [
      { format_id: '18', ext: 'mp4', height: 360, vcodec: 'avc1', acodec: 'mp4a' },
      { format_id: '299', ext: 'mp4', height: 1080, fps: 60, vcodec: 'avc1', acodec: 'none', filesize_approx: 1000 },
      { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a' },
    ],
  };
  const res = await call('POST', '/info', { url: 'youtu.be/aaaaaaaaaaa' });
  assert.equal(res.status, 200);
  assert.equal(res.body.isPlaylist, false);
  assert.equal(res.body.highestQuality, '1080p (Full HD 60fps)');
  assert.deepEqual(res.body.resolutions.map((r) => r.height), [1080, 360]);
  assert.equal(res.body.thumbnail, 'big.jpg', 'falls back to the last (largest) thumbnail');
  assert.equal(res.body.formats.find((f) => f.format_id === '299').filesize, 1000);
  assert.equal(res.body.isLive, false);
  assert.ok(res.body.capabilities);
});

test('POST /info lists playlist entries', async (t) => {
  const { q, call } = await startApp(t);
  q.state.info = {
    _type: 'playlist', title: 'My list', playlist_count: 2, extractor: 'youtube:tab',
    entries: [{ id: 'aaaaaaaaaaa', title: 'One', duration: 10 }, { id: 'bbbbbbbbbbb', title: 'Two', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' }],
  };
  const res = await call('POST', '/info', { url: 'https://www.youtube.com/playlist?list=PL1' });
  assert.equal(res.body.isPlaylist, true);
  assert.equal(res.body.videoCount, 2);
  assert.deepEqual(res.body.entries.map((e) => e.url), [
    'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://www.youtube.com/watch?v=bbbbbbbbbbb',
  ]);
});

test('POST /info follows a bare URL reference with one full probe', async (t) => {
  const { q, call } = await startApp(t);
  const probes = [];
  q.state.info = (url, opts) => {
    probes.push([url, opts.flatPlaylist]);
    return probes.length === 1
      ? { _type: 'url', url: 'https://www.youtube.com/watch?v=ccccccccccc' }
      : { title: 'Target', formats: [{ format_id: '18', height: 360, vcodec: 'avc1' }] };
  };
  const res = await call('POST', '/info', { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  assert.equal(res.body.title, 'Target');
  assert.deepEqual(probes, [
    ['https://www.youtube.com/watch?v=aaaaaaaaaaa', true],
    ['https://www.youtube.com/watch?v=ccccccccccc', false],
  ]);
});

test('POST /info rejects links with nothing to download, except scheduled streams', async (t) => {
  const { q, call } = await startApp(t);
  assert.equal((await call('POST', '/info', {})).status, 400);

  q.state.info = { title: 'Removed', formats: [] };
  const none = await call('POST', '/info', { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  assert.equal(none.status, 502);
  assert.match(none.body.error, /No downloadable formats/);

  q.state.info = { title: 'Premiere', formats: [], live_status: 'is_upcoming', release_timestamp: 123 };
  const upcoming = await call('POST', '/info', { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  assert.equal(upcoming.status, 200);
  assert.equal(upcoming.body.liveStatus, 'is_upcoming');
  assert.equal(upcoming.body.releaseTimestamp, 123);
});

test('POST /info offers an offline live channel as a stream to wait for', async (t) => {
  const { q, call } = await startApp(t);
  q.state.info = new Error('ERROR: [tiktok:live] cinnanako: The channel is not currently live');
  const res = await call('POST', '/info', { url: 'https://www.tiktok.com/@cinnanako/live' });
  assert.equal(res.status, 200);
  assert.equal(res.body.offline, true);
  assert.equal(res.body.title, '@cinnanako (offline)');
  assert.equal(res.body.liveStatus, 'is_upcoming');

  q.state.info = new Error('ERROR: Unsupported URL');
  const other = await call('POST', '/info', { url: 'https://example.com/page' });
  assert.equal(other.status, 502);
  assert.equal(other.body.error, 'ERROR: Unsupported URL');
});

test('POST /:id/retry requeues a failed download; POST /clear-failed drops failed ones', async (t) => {
  const { q, call, settle } = await startApp(t);
  insertJob(q.db, { id: 'bad', status: 'failed', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  insertJob(q.db, { id: 'bad2', status: 'failed', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' });
  insertJob(q.db, { id: 'ok', status: 'completed', url: 'https://www.youtube.com/watch?v=ccccccccccc' });

  assert.equal((await call('POST', '/missing/retry')).status, 404);
  assert.equal((await call('POST', '/ok/retry')).status, 409);
  assert.equal((await call('POST', '/bad/retry')).status, 200);
  await waitFor(() => q.queue.getJob('bad').status === 'completed', { label: 'retried job to finish' });
  await settle();

  const cleared = await call('POST', '/clear-failed');
  assert.deepEqual(cleared.body, { removed: 1 });
  assert.equal(q.queue.getJob('bad2'), undefined);
  assert.ok(q.queue.getJob('ok'));
  assert.ok(q.io.of('job:removed').some((e) => e.id === 'bad2'));
});

test('POST /retry-failed requeues every failed download', async (t) => {
  const { q, call, settle } = await startApp(t);
  insertJob(q.db, { id: 'bad', status: 'failed', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  insertJob(q.db, { id: 'bad2', status: 'failed', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' });
  insertJob(q.db, { id: 'ok', status: 'completed', url: 'https://www.youtube.com/watch?v=ccccccccccc' });

  const updatesBefore = q.io.of('job:update').length;
  const res = await call('POST', '/retry-failed');
  assert.deepEqual(res.body, { retried: 2 });
  assert.equal(q.io.of('jobs:init').length, 1, 'clients get one list refresh, not a job:update per row');
  assert.ok(q.io.of('job:update').slice(updatesBefore).every((j) => j.status !== 'queued'));
  await waitFor(() => q.queue.getJob('bad').status === 'completed' && q.queue.getJob('bad2').status === 'completed', { label: 'retried jobs to finish' });
  await settle();
  assert.deepEqual((await call('POST', '/retry-failed')).body, { retried: 0 });
});

test('POST /check-duplicates matches completed downloads by URL or video ID', async (t) => {
  const { q, call } = await startApp(t);
  insertJob(q.db, { id: 'done', status: 'completed', title: 'Done', extractor: 'youtube', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  q.db.prepare("UPDATE downloads SET video_id = 'aaaaaaaaaaa' WHERE id = 'done'").run();
  insertJob(q.db, { id: 'failed', status: 'failed', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' });

  assert.equal((await call('POST', '/check-duplicates', {})).status, 400);
  const res = await call('POST', '/check-duplicates', {
    items: [
      { url: 'www.youtube.com/watch?v=aaaaaaaaaaa' },
      { url: 'https://youtu.be/aaaaaaaaaaa', id: 'aaaaaaaaaaa', extractor: 'youtube' },
      { url: 'https://vimeo.com/1', id: 'aaaaaaaaaaa', extractor: 'vimeo' },
      { url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
      null,
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.duplicates).sort(), ['https://youtu.be/aaaaaaaaaaa', 'www.youtube.com/watch?v=aaaaaaaaaaa']);
  assert.equal(res.body.duplicates['https://youtu.be/aaaaaaaaaaa'].id, 'done');
  assert.equal(res.body.duplicates['https://youtu.be/aaaaaaaaaaa'].title, 'Done');
});
