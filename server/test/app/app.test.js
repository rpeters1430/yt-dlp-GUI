// The real app from src/app.js (session, auth and every router), as index.js wires it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { openFreshDb } = require('../helpers/queueHarness');

const SRC = path.join(__dirname, '..', '..', 'src');

async function startApp(t) {
  const { db } = openFreshDb(t);
  const auth = require(path.join(SRC, 'auth'));
  const savedPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'correct-horse';
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
  assert.equal((await call('POST', '/api/auth/login', { username: 'admin', password: 'correct-horse' })).status, 200);
  for (const p of READ_ENDPOINTS) {
    const res = await call('GET', p);
    assert.equal(res.status, 200, `${p} -> ${res.status} ${JSON.stringify(res.body)}`);
  }
});

test('sessions are stored in the database and survive across requests', async (t) => {
  const { db, call } = await startApp(t);
  await call('POST', '/api/auth/login', { username: 'admin', password: 'correct-horse' });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);
  assert.deepEqual((await call('GET', '/api/auth/me')).body, { username: 'admin' });
});

test('unknown /api paths are not answered with the client app', async (t) => {
  const { call } = await startApp(t);
  const res = await call('GET', '/api/does-not-exist');
  assert.equal(res.status, 404);
});
