const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { openFreshDb } = require('../helpers/queueHarness');

const SRC = path.join(__dirname, '..', '..', 'src');

// Runs the bootstrap with the given env, restoring it afterwards.
function bootstrap(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const logs = [];
  const log = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    require(path.join(SRC, 'auth')).ensureBootstrapAdmin();
  } finally {
    console.log = log;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return logs;
}

// The real auth router plus one auth-gated route, behind a real (in-memory) session store.
async function startApp(t) {
  const { db } = openFreshDb(t);
  bootstrap({ ADMIN_USER: 'admin', ADMIN_PASSWORD: 'correct-horse' });
  const auth = require(path.join(SRC, 'auth'));

  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use('/api/auth', require(path.join(SRC, 'routes', 'auth')));
  app.get('/api/private', auth.requireAuth, (req, res) => res.json({ user: req.currentUser.username }));
  const server = await new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;

  // Each client keeps its own cookie, like a separate browser.
  function client() {
    let cookie = '';
    return async function call(method, p, body) {
      const res = await fetch(base + p, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  }
  return { db, client };
}

test('bootstrap creates the admin once, with a generated password when none is set', (t) => {
  const { db } = openFreshDb(t);
  const logs = bootstrap({ ADMIN_USER: 'boss', ADMIN_PASSWORD: undefined });
  const generated = logs.join('\n').match(/Generated password \(change it after logging in\): (\S+)/);
  assert.ok(generated, 'the generated password is printed');
  const auth = require(path.join(SRC, 'auth'));
  assert.equal(auth.login('boss', generated[1]).username, 'boss');

  bootstrap({ ADMIN_USER: 'second', ADMIN_PASSWORD: 'whatever123' });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1, 'no second admin once one exists');
});

test('login checks credentials and sets a session that /me and protected routes accept', async (t) => {
  const { client } = await startApp(t);
  const call = client();

  assert.equal((await call('GET', '/auth/me')).status, 401);
  assert.equal((await call('GET', '/private')).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'admin' })).status, 400);
  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'nobody', password: 'correct-horse' })).status, 401);

  const ok = await call('POST', '/auth/login', { username: 'admin', password: 'correct-horse' });
  assert.deepEqual(ok, { status: 200, body: { username: 'admin' } });
  assert.deepEqual((await call('GET', '/auth/me')).body, { username: 'admin' });
  assert.deepEqual((await call('GET', '/private')).body, { user: 'admin' });

  assert.deepEqual((await call('POST', '/auth/logout')).body, { ok: true });
  assert.equal((await call('GET', '/auth/me')).status, 401);
});

test('changing the password signs out other sessions but keeps the current one', async (t) => {
  const { client } = await startApp(t);
  const phone = client();
  const laptop = client();
  await phone('POST', '/auth/login', { username: 'admin', password: 'correct-horse' });
  await laptop('POST', '/auth/login', { username: 'admin', password: 'correct-horse' });

  assert.equal((await laptop('POST', '/auth/change-password', { newPassword: 'short' })).status, 400);
  assert.equal((await laptop('POST', '/auth/change-password', { newPassword: 'battery-staple' })).status, 200);

  assert.equal((await laptop('GET', '/private')).status, 200, 'the session that changed it stays signed in');
  assert.equal((await phone('GET', '/private')).status, 401, 'other sessions are signed out');

  const fresh = client();
  assert.equal((await fresh('POST', '/auth/login', { username: 'admin', password: 'correct-horse' })).status, 401);
  assert.equal((await fresh('POST', '/auth/login', { username: 'admin', password: 'battery-staple' })).status, 200);
});

test('change-password requires a session', async (t) => {
  const { client } = await startApp(t);
  assert.equal((await client()('POST', '/auth/change-password', { newPassword: 'battery-staple' })).status, 401);
});

test('repeated failed logins are rate limited', async (t) => {
  const { client } = await startApp(t);
  const call = client();
  for (let i = 0; i < 10; i++) {
    assert.equal((await call('POST', '/auth/login', { username: 'admin', password: `bad${i}` })).status, 401);
  }
  const limited = await call('POST', '/auth/login', { username: 'admin', password: 'correct-horse' });
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /Too many login attempts/);
});
