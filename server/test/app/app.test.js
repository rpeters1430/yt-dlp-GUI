// The real app from src/app.js (session, auth and every router), as index.js wires it.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { openFreshDb } = require('../helpers/queueHarness');

const SRC = path.join(__dirname, '..', '..', 'src');
// Generated per run rather than written out, so no credential-looking literals live in the repo.
const ADMIN_PASSWORD = crypto.randomBytes(12).toString('hex');

async function startApp(t) {
  const { db } = openFreshDb(t);
  const auth = require(path.join(SRC, 'auth'));
  const savedPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  const log = console.log;
  console.log = () => {};
  try {
    auth.ensureBootstrapAdmin();
  } finally {
    console.log = log;
    if (savedPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = savedPassword;
  }
  const { createRepository } = require(path.join(SRC, 'services', 'watch', 'repository'));
  const { createApp } = require(path.join(SRC, 'app'));
  const { app } = createApp({
    watchRepository: createRepository(db),
    watchService: {},
    checkAllWatches: async () => {},
  });
  const server = await new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function call(method, p, body) {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, body: json, headers: res.headers };
  }
  return { db, call };
}

// One read-only endpoint per router; together they cover every /api mount point.
const READ_ENDPOINTS = [
  '/api/downloads', '/api/downloads/stats', '/api/downloads/history', '/api/watches',
  '/api/settings', '/api/settings/output-template', '/api/twitch/settings', '/api/twitch/jobs',
  '/api/cleanup/settings', '/api/jellyfin/settings', '/api/plex/settings', '/api/music/settings',
  '/api/music/watches', '/api/sites/guide', '/api/library', '/api/notifications/settings',
  '/api/lidarr/settings', '/api/linkgrabber/settings', '/api/linkgrabber/crawls', '/api/linkgrabber/watches',
];

test('health answers without a session and is not cached', async (t) => {
  const { call } = await startApp(t);
  const res = await call('GET', '/api/health');
  assert.deepEqual(res.body, { status: 'ok' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('set-cookie'), null, 'no session is created');
});

test('every API router refuses requests without a session', async (t) => {
  const { call } = await startApp(t);
  for (const p of READ_ENDPOINTS) {
    assert.equal((await call('GET', p)).status, 401, p);
  }
  for (const [method, p] of [
    ['POST', '/api/downloads'], ['DELETE', '/api/downloads/x'], ['PUT', '/api/settings'],
    ['PUT', '/api/settings/cookies'], ['POST', '/api/settings/ytdlp/update'], ['POST', '/api/cleanup/run'],
    ['DELETE', '/api/library/x/file'], ['POST', '/api/twitch/download'], ['POST', '/api/music/download'],
    ['POST', '/api/watches'], ['POST', '/api/notifications/test'], ['POST', '/api/auth/change-password'],
  ]) {
    assert.equal((await call(method, p, {})).status, 401, `${method} ${p}`);
  }
});

test('signed in, every router answers its read endpoint without a server error', async (t) => {
  const { call } = await startApp(t);
  assert.equal((await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD })).status, 200);
  for (const p of READ_ENDPOINTS) {
    const res = await call('GET', p);
    assert.equal(res.status, 200, `${p} -> ${res.status} ${JSON.stringify(res.body)}`);
  }
});

test('sessions are stored in the database and survive across requests', async (t) => {
  const { db, call } = await startApp(t);
  await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);
  assert.deepEqual((await call('GET', '/api/auth/me')).body, { username: 'admin' });
});

test('unknown /api paths are not answered with the client app', async (t) => {
  const { call } = await startApp(t);
  const res = await call('GET', '/api/does-not-exist');
  assert.equal(res.status, 404);
});

test('linkgrabber test-jd only contacts the saved JDownloader address', async (t) => {
  const http = require('http');
  const hits = [];
  const fake = http.createServer((req, res) => { hits.push(req.url); res.end('jdownloader=true'); });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => fake.close());
  const fakeUrl = `http://127.0.0.1:${fake.address().port}`;

  const { call } = await startApp(t);
  await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });

  const unsaved = await call('POST', '/api/linkgrabber/test-jd', { jdUrl: fakeUrl });
  assert.equal(unsaved.status, 400, 'a URL in the request body is ignored');
  assert.equal(hits.length, 0);

  assert.equal((await call('PUT', '/api/linkgrabber/settings', { jdUrl: fakeUrl })).status, 200);
  const saved = await call('POST', '/api/linkgrabber/test-jd', { jdUrl: 'http://10.0.0.1:9666' });
  assert.equal(saved.body.ok, true);
  assert.deepEqual(hits, ['/jdcheck.js']);
});

test('linkgrabber send accepts bodies over the 100kb JSON default', async (t) => {
  const http = require('http');
  const fake = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('success')); });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => fake.close());

  const { call } = await startApp(t);
  await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
  assert.equal((await call('PUT', '/api/linkgrabber/settings', { jdUrl: `http://127.0.0.1:${fake.address().port}` })).status, 200);

  const urls = Array.from({ length: 400 }, (_, i) => `https://example.com/file/${i}/${'x'.repeat(100)}`);
  const urlMetadata = urls.map((url, i) => ({ url, page: Math.floor(i / 50) + 1, title: 'y'.repeat(200) }));
  const body = { target: 'jdownloader', urls, urlMetadata, packageName: 'big thread' };
  assert.ok(JSON.stringify(body).length > 102400, 'payload exceeds the default limit');

  const res = await call('POST', '/api/linkgrabber/send', body);
  assert.notEqual(res.status, 413);
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('linkgrabber marks sent and copied links as seen in history', async (t) => {
  const http = require('http');
  const fake = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('success')); });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => fake.close());

  const { db, call } = await startApp(t);
  await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
  await call('PUT', '/api/linkgrabber/settings', { jdUrl: `http://127.0.0.1:${fake.address().port}` });

  const sent = await call('POST', '/api/linkgrabber/send', { target: 'jdownloader', urls: ['https://files.example.net/f/1'], packageName: 'T' });
  assert.deepEqual(sent.body.seen, ['https://files.example.net/f/1']);

  const copied = await call('POST', '/api/linkgrabber/history', { urls: ['https://files.example.net/f/2', 'nope'], threadTitle: 'T', threadUrl: 'https://forum.example.com/threads/t.1/' });
  assert.deepEqual(copied.body, { recorded: 1 });

  // Only these URLs: db.js also imports the Python crawler's history file when one exists.
  const urls = db.prepare("SELECT url FROM linkgrabber_history WHERE url LIKE 'https://files.example.net/%' ORDER BY url").all().map((r) => r.url);
  assert.deepEqual(urls, ['https://files.example.net/f/1', 'https://files.example.net/f/2']);
});

test('linkgrabber saves a single-line crawler User-Agent', async (t) => {
  const { call } = await startApp(t);
  await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
  assert.equal((await call('PUT', '/api/linkgrabber/settings', { userAgent: 'Mozilla/5.0 Test' })).status, 200);
  assert.equal((await call('GET', '/api/linkgrabber/settings')).body.userAgent, 'Mozilla/5.0 Test');
  assert.equal((await call('PUT', '/api/linkgrabber/settings', { userAgent: 'a\r\nX-Injected: 1' })).status, 400);
});

test('linkgrabber crawls run in the background and are listed with their outcome', async (t) => {
  const { call } = await startApp(t);
  await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
  assert.equal((await call('POST', '/api/linkgrabber/crawl', { url: 'ftp://x' })).status, 400);

  // .invalid never resolves, so the crawl fails on its first page.
  const started = await call('POST', '/api/linkgrabber/crawl', { url: 'https://forum.invalid/threads/t.1/', mode: 'single' });
  assert.equal(started.status, 202);
  let crawl;
  for (let i = 0; i < 100; i++) {
    crawl = (await call('GET', `/api/linkgrabber/crawls/${started.body.id}`)).body;
    if (crawl.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(crawl.status, 'failed');
  assert.ok(crawl.error);
  assert.equal((await call('GET', '/api/linkgrabber/crawls')).body[0].id, started.body.id);
  assert.equal((await call('DELETE', `/api/linkgrabber/crawls/${started.body.id}`)).status, 200);
  assert.equal((await call('GET', `/api/linkgrabber/crawls/${started.body.id}`)).status, 404);
});

test('linkgrabber send and check validate their input', async (t) => {
  const { call } = await startApp(t);
  await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
  assert.equal((await call('POST', '/api/linkgrabber/send', { target: 'queue', urls: ['https://a.example/x'], crawlId: 'nope' })).status, 404);
  assert.equal((await call('POST', '/api/linkgrabber/send', { target: 'ftp', urls: ['https://a.example/x'] })).status, 400);
  assert.equal((await call('POST', '/api/linkgrabber/send', { target: 'queue', urls: [] })).status, 400);
  assert.equal((await call('POST', '/api/linkgrabber/check', { urls: [] })).status, 400);
});

test('linkgrabber thread watches can be created, edited and deleted', async (t) => {
  const { call } = await startApp(t);
  await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
  assert.equal((await call('POST', '/api/linkgrabber/watches', { url: 'nope' })).status, 400);
  const created = await call('POST', '/api/linkgrabber/watches', { url: 'https://forum.example.com/threads/t.1/', target: 'jdownloader', lastN: 2 });
  assert.equal(created.status, 201);
  const updated = await call('PUT', `/api/linkgrabber/watches/${created.body.id}`, { intervalMins: 60 });
  assert.equal(updated.body.intervalMins, 60);
  assert.equal((await call('PUT', `/api/linkgrabber/watches/${created.body.id}`, { intervalMins: 1 })).status, 400);
  assert.equal((await call('GET', '/api/linkgrabber/watches')).body.length, 1);
  assert.equal((await call('DELETE', `/api/linkgrabber/watches/${created.body.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/linkgrabber/watches/${created.body.id}`)).status, 404);
});
