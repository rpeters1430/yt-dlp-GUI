// notify's event functions end to end: settings decide what's sent, fetch is the boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { openFreshDb } = require('../helpers/queueHarness');

const SRC = path.join(__dirname, '..', '..', 'src');

function setup(t, settings = {}) {
  const { db } = openFreshDb(t);
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries({ notify_enabled: '1', notify_url: 'https://hooks.example.com/x', notify_format: 'json', ...settings })) {
    set.run(k, String(v));
  }
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response('ok', { status: 200 });
  });
  const notify = require(path.join(SRC, 'services', 'notify'));
  // Delivery is fire-and-forget; let its promise settle.
  const flush = () => new Promise((r) => setTimeout(r, 10));
  return { notify, sent, flush };
}

const job = { url: 'https://www.youtube.com/watch?v=a', title: 'My video', thumbnail: 't.jpg', watch_id: null };

test('a completed download sends its title and file', async (t) => {
  const { notify, sent, flush } = setup(t);
  notify.downloadCompleted(job, { filepath: '/downloads/My video.mp4' });
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://hooks.example.com/x');
  assert.equal(sent[0].body.title, 'Download completed');
  assert.match(sent[0].body.message, /My video\n\/downloads\/My video\.mp4/);
});

test('a split recording lists its chunk files by name', async (t) => {
  const { notify, sent, flush } = setup(t);
  const parts = Array.from({ length: 7 }, (_, i) => `/downloads/live/stream_part${i + 1}.mp4`);
  notify.downloadCompleted(job, { stoppedByUser: true, splitParts: parts });
  await flush();
  assert.equal(sent[0].body.title, 'Recording saved (7 chunks)');
  assert.match(sent[0].body.message, /• stream_part1\.mp4/);
  assert.doesNotMatch(sent[0].body.message, /\/downloads\/live/);
  assert.match(sent[0].body.message, /…and 2 more/);
});

test('failures send the first line of the error', async (t) => {
  const { notify, sent, flush } = setup(t);
  notify.downloadFailed(job, 'ERROR: HTTP 403\nTraceback...');
  await flush();
  assert.equal(sent[0].body.title, 'Download failed');
  assert.match(sent[0].body.message, /ERROR: HTTP 403$/);
});

test('nothing is sent when disabled, for a switched-off event, or for manual jobs in watch-only mode', async (t) => {
  let s = setup(t, { notify_enabled: '0' });
  s.notify.downloadCompleted(job, {});
  await s.flush();
  assert.equal(s.sent.length, 0);

  s = setup(t, { notify_on_completed: '0' });
  s.notify.downloadCompleted(job, {});
  s.notify.downloadFailed(job, 'x');
  await s.flush();
  assert.deepEqual(s.sent.map((m) => m.body.title), ['Download failed']);

  s = setup(t, { notify_watch_only: '1' });
  s.notify.downloadCompleted(job, {});
  s.notify.downloadCompleted({ ...job, watch_id: 3 }, {});
  await s.flush();
  assert.equal(s.sent.length, 1);
});

test('watch events are off/on by their own defaults', async (t) => {
  const s = setup(t);
  const watch = { id: 1, name: 'Chan', url: 'https://www.youtube.com/@chan' };
  s.notify.watchNewVideos(watch, ['A', 'B']);
  s.notify.watchError(watch, 'boom');
  await s.flush();
  assert.deepEqual(s.sent.map((m) => m.body.title), ['Watch check failed: Chan'], 'new-video pings are opt-in');
});

test('a failing webhook is logged, never thrown', async (t) => {
  const s = setup(t);
  globalThis.fetch.mock.mockImplementation(async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); });
  const errors = [];
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')));
  assert.doesNotThrow(() => s.notify.downloadCompleted(job, {}));
  await s.flush();
  assert.match(errors.join('\n'), /Could not reach the webhook: ECONNREFUSED/);
});
