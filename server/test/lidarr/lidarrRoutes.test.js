const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { openFreshDb } = require('../helpers/queueHarness');

const SRC = path.join(__dirname, '..', '..', 'src');

async function startApp(t) {
  const { db } = openFreshDb(t);
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
  return { db, base };
}

test('Torznab indexer endpoint returns capabilities XML', async (t) => {
  const { base } = await startApp(t);
  const res = await fetch(`${base}/api/lidarr/torznab?t=caps`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').includes('xml'));
  const text = await res.text();
  assert.ok(text.includes('<caps>'));
  assert.ok(text.includes('music-search'));
});

test('Torznab indexer endpoint responds on alias /api/torznab', async (t) => {
  const { base } = await startApp(t);
  const res = await fetch(`${base}/api/torznab?t=caps`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('<caps>'));
});

test('Torrent download endpoint returns valid .torrent file', async (t) => {
  const { base } = await startApp(t);
  const res = await fetch(`${base}/api/lidarr/download?type=album&id=999&artist=Radiohead&album=OK+Computer`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/x-bittorrent');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf[0], 'd'.charCodeAt(0));
});

test('Mock qBittorrent Web API handles auth, version, and torrents/info', async (t) => {
  const { base } = await startApp(t);

  const loginRes = await fetch(`${base}/api/lidarr/qbit/api/v2/auth/login`, { method: 'POST' });
  assert.equal(loginRes.status, 200);
  const loginText = await loginRes.text();
  assert.equal(loginText, 'Ok.');

  const verRes = await fetch(`${base}/api/lidarr/qbit/api/v2/app/version`);
  assert.equal(verRes.status, 200);
  const verText = await verRes.text();
  assert.equal(verText, 'v4.6.0');

  const prefRes = await fetch(`${base}/api/lidarr/qbit/api/v2/app/preferences`);
  assert.equal(prefRes.status, 200);
  const pref = await prefRes.json();
  assert.ok(pref.save_path);

  const infoRes = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info`);
  assert.equal(infoRes.status, 200);
  const list = await infoRes.json();
  assert.ok(Array.isArray(list));
});

test('Mock SABnzbd API handles version, queue, and history modes', async (t) => {
  const { base } = await startApp(t);

  const verRes = await fetch(`${base}/api/lidarr/sab/api?mode=version`);
  assert.equal(verRes.status, 200);
  const ver = await verRes.json();
  assert.equal(ver.version, '4.3.0');

  const qRes = await fetch(`${base}/api/lidarr/sab/api?mode=queue`);
  assert.equal(qRes.status, 200);
  const q = await qRes.json();
  assert.ok(q.queue);

  const hRes = await fetch(`${base}/api/lidarr/sab/api?mode=history`);
  assert.equal(hRes.status, 200);
  const h = await hRes.json();
  assert.ok(h.history);
});
