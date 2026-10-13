const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { loadQueue, waitFor } = require('../helpers/queueHarness');

const ROUTES = path.join(__dirname, '..', '..', 'src', 'routes', 'twitch');

async function startApp(t) {
  const q = loadQueue(t);
  q.queue.init(q.io);
  const userId = q.db.prepare("INSERT INTO users (username, password_hash) VALUES ('admin', 'x')").run().lastInsertRowid;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId, sessionVersion: 1, destroy: (cb) => cb && cb() };
    next();
  });
  app.use('/api/twitch', require(ROUTES));
  const server = await new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/twitch`;
  async function post(urlPath, body) {
    const res = await fetch(base + urlPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  }
  return { q, post };
}

test('POST /download passes liveFromStart only for a live recording that is not waiting', async (t) => {
  const { q, post } = await startApp(t);
  const options = async (body) => {
    const res = await post('/download', body);
    assert.equal(res.status, 200);
    await waitFor(() => q.queue.listJobs({ activeOnly: true }).length === 0, { label: 'queue to drain' });
    return JSON.parse(q.queue.getJob(res.body.id).options_json);
  };

  assert.equal((await options({ channel: 'somechannel', isLive: true, liveFromStart: true })).liveFromStart, true);
  assert.equal((await options({ channel: 'somechannel', isLive: true, liveFromStart: false })).liveFromStart, false);
  assert.equal((await options({ channel: 'somechannel', isLive: true, waitForLive: true, liveFromStart: true })).liveFromStart, false);
  assert.equal((await options({ url: 'https://www.twitch.tv/videos/1', liveFromStart: true })).liveFromStart, false);
});
