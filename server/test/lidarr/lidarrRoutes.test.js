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

  // 1. Test with URL Base /api/lidarr/qbit
  const loginRes = await fetch(`${base}/api/lidarr/qbit/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=&password=',
  });
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.headers.get('content-type').includes('text/plain'));
  const loginText = await loginRes.text();
  assert.equal(loginText, 'Ok.');
  assert.ok(loginRes.headers.get('set-cookie').includes('SID='));

  const verRes = await fetch(`${base}/api/lidarr/qbit/api/v2/app/version`);
  assert.equal(verRes.status, 200);
  assert.ok(verRes.headers.get('content-type').includes('text/plain'));
  const verText = await verRes.text();
  assert.equal(verText, 'v4.6.0');

  const webapiRes = await fetch(`${base}/api/lidarr/qbit/api/v2/app/webapiVersion`);
  assert.equal(webapiRes.status, 200);
  assert.ok(webapiRes.headers.get('content-type').includes('text/plain'));
  const webapiText = await webapiRes.text();
  assert.equal(webapiText, '2.9.3');

  const prefRes = await fetch(`${base}/api/lidarr/qbit/api/v2/app/preferences`);
  assert.equal(prefRes.status, 200);
  const pref = await prefRes.json();
  assert.ok(pref.save_path);
  assert.ok(pref.save_path.startsWith('/'));
  assert.equal(pref.queueing_enabled, true);

  const catRes = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/categories`);
  assert.equal(catRes.status, 200);
  const cats = await catRes.json();
  assert.ok(cats.music);

  const createCatRes = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/createCategory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'category=rock',
  });
  assert.equal(createCatRes.status, 200);

  const infoRes = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info`);
  assert.equal(infoRes.status, 200);
  const list = await infoRes.json();
  assert.ok(Array.isArray(list));

  // 2. Test direct mount at /api/v2 (when URL Base is left blank)
  const directWebapi = await fetch(`${base}/api/v2/app/webapiVersion`);
  assert.equal(directWebapi.status, 200);
  assert.equal(await directWebapi.text(), '2.9.3');

  const directLogin = await fetch(`${base}/api/v2/auth/login`, { method: 'POST' });
  assert.equal(directLogin.status, 200);
  assert.equal(await directLogin.text(), 'Ok.');
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

test('qBittorrent torrents/add reports the uploaded torrent under its real infohash', async (t) => {
  const { db, base } = await startApp(t);
  const lidarr = require(path.join(SRC, 'services', 'lidarr'));
  const music = require(path.join(SRC, 'services', 'music'));

  const enqueued = [];
  const original = music.enqueueMusicDownload;
  music.enqueueMusicDownload = async (opts) => {
    enqueued.push(opts);
    const id = `job-${enqueued.length}`;
    db.prepare("INSERT INTO downloads (id, url, status, percent) VALUES (?, 'x', 'completed', 100)").run(id);
    return { jobId: id };
  };
  t.after(() => { music.enqueueMusicDownload = original; });

  // A track release skips the album lookup, so the test needs no network.
  const torrent = lidarr.generateTorrentBuffer({ type: 'track', id: '7-1', artist: 'Incubus', album: 'Morning View', track: 'Wish You Were Here' });
  const infoHash = lidarr.getInfoHash(torrent);

  const form = new FormData();
  form.append('category', 'music');
  form.append('torrents', new Blob([torrent], { type: 'application/x-bittorrent' }), 'release.torrent');
  const addRes = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/add`, { method: 'POST', body: form });
  assert.equal(addRes.status, 200);

  // Enqueueing runs in the background after the response.
  for (let i = 0; i < 50 && !enqueued.length; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].track.title, 'Wish You Were Here');
  assert.equal(enqueued[0].extraOptions.lidarrHash, infoHash);

  const list = await (await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info?hashes=${infoHash.toUpperCase()}`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].hash, infoHash);
  assert.equal(list[0].state, 'uploading');
  assert.ok(list[0].content_path.endsWith('/Incubus/Morning View'));
});
