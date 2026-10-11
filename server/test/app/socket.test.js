// socket.io auth end to end: the real app, session store and socket server, with real clients.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { openFreshDb } = require('../helpers/queueHarness');

const SRC = path.join(__dirname, '..', '..', 'src');
// Generated per run rather than written out, so no credential-looking literals live in the repo.
const ADMIN_PASSWORD = crypto.randomBytes(12).toString('hex');
const NEW_PASSWORD = crypto.randomBytes(12).toString('hex');

async function startServer(t) {
  const { db } = openFreshDb(t);
  const auth = require(path.join(SRC, 'auth'));
  const saved = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  const log = console.log;
  console.log = () => {};
  try {
    auth.ensureBootstrapAdmin();
  } finally {
    console.log = log;
    if (saved === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = saved;
  }
  const { createRepository } = require(path.join(SRC, 'services', 'watch', 'repository'));
  const { createApp } = require(path.join(SRC, 'app'));
  const { createSocketServer } = require(path.join(SRC, 'socket'));
  const { app, sessionMiddleware } = createApp({ watchRepository: createRepository(db), watchService: {}, checkAllWatches: async () => {} });
  const server = http.createServer(app);
  const io = createSocketServer(server, { sessionMiddleware, onConnection: (socket) => socket.emit('hello', 'hi') });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => { io.close(); server.close(() => resolve()); }));

  // A browser: its own cookie, HTTP calls and socket.
  function browser() {
    let cookie = '';
    const sockets = [];
    t.after(() => sockets.forEach((s) => s.close()));
    return {
      async call(method, p, body) {
        const res = await fetch(base + p, {
          method,
          headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return res.status;
      },
      login() { return this.call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD }); },
      // Resolves with the socket once connected (and greeted), or rejects with the connect error.
      open() {
        const socket = connect(base, { transports: ['websocket'], reconnection: false, extraHeaders: cookie ? { Cookie: cookie } : {} });
        sockets.push(socket);
        socket.disconnectReason = null;
        socket.on('disconnect', (reason) => { socket.disconnectReason = reason; });
        return new Promise((resolve, reject) => {
          socket.once('hello', () => resolve(socket));
          socket.once('connect_error', reject);
        });
      },
    };
  }
  return { browser };
}

const until = async (predicate, ms = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('a socket without a signed-in session is refused', async (t) => {
  const { browser } = await startServer(t);
  await assert.rejects(browser().open(), /unauthorized/);
});

test('a password change disconnects other sessions’ open sockets but keeps the changer’s', async (t) => {
  const { browser } = await startServer(t);
  const phone = browser();
  const laptop = browser();
  await phone.login();
  await laptop.login();
  const phoneSocket = await phone.open();
  const laptopSocket = await laptop.open();

  assert.equal(await laptop.call('POST', '/api/auth/change-password', { newPassword: NEW_PASSWORD }), 200);
  await until(() => phoneSocket.disconnectReason);
  assert.equal(phoneSocket.disconnectReason, 'io server disconnect');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(laptopSocket.connected, true);

  await assert.rejects(phone.open(), /unauthorized/, 'the signed-out session cannot reconnect');
});

test('logging out disconnects that session’s open sockets', async (t) => {
  const { browser } = await startServer(t);
  const tab = browser();
  const other = browser();
  await tab.login();
  await other.login();
  const tabSocket = await tab.open();
  const otherSocket = await other.open();

  assert.equal(await tab.call('POST', '/api/auth/logout'), 200);
  await until(() => tabSocket.disconnectReason);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(otherSocket.connected, true, 'other sessions are unaffected');
});
