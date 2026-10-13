const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
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
  const lidarr = require(path.join(SRC, 'services', 'lidarr'));
  const key = lidarr.getLidarrConfig().torznabApiKey;
  return { db, base, key, lidarr };
}

async function qbitLogin(base, key, prefix = '/api/lidarr/qbit/api/v2') {
  const res = await fetch(`${base}${prefix}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=lidarr&password=${encodeURIComponent(key)}`,
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'Ok.');
  return res.headers.get('set-cookie').split(';')[0];
}

test('Torznab indexer endpoint returns capabilities XML', async (t) => {
  const { base, key } = await startApp(t);
  const res = await fetch(`${base}/api/lidarr/torznab?t=caps&apikey=${key}`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').includes('xml'));
  const text = await res.text();
  assert.ok(text.includes('<caps>'));
  assert.ok(text.includes('music-search'));
});

test('Torznab indexer endpoint responds on alias /api/torznab', async (t) => {
  const { base, key } = await startApp(t);
  const res = await fetch(`${base}/api/torznab?t=caps&apikey=${key}`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('<caps>'));
});

test('indexer, torrent download and SABnzbd endpoints reject a missing or wrong API key', async (t) => {
  const { base } = await startApp(t);
  for (const url of [
    '/api/lidarr/torznab?t=caps',
    '/api/lidarr/torznab?t=caps&apikey=wrong',
    '/api/torznab?t=music&artist=Incubus',
    '/api/lidarr?t=caps',
    '/api/lidarr/download?type=album&id=1',
  ]) {
    const res = await fetch(`${base}${url}`);
    assert.equal(res.status, 401, url);
  }

  const sab = await (await fetch(`${base}/api/lidarr/sab/api?mode=queue&apikey=wrong`)).json();
  assert.equal(sab.status, false);
  assert.equal(sab.error, 'API Key Incorrect');
});

test('Torrent download endpoint returns valid .torrent file', async (t) => {
  const { base, key } = await startApp(t);
  const res = await fetch(`${base}/api/lidarr/download?type=album&id=999&artist=Radiohead&album=OK+Computer&apikey=${key}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/x-bittorrent');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf[0], 'd'.charCodeAt(0));
});

test('qBittorrent API requires logging in with the API key as the password', async (t) => {
  const { base, key } = await startApp(t);

  const noSession = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info`);
  assert.equal(noSession.status, 403);

  const bad = await fetch(`${base}/api/lidarr/qbit/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=lidarr&password=nope',
  });
  assert.equal(await bad.text(), 'Fails.');
  assert.equal(bad.headers.get('set-cookie'), null);

  const forged = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info`, { headers: { Cookie: 'SID=made-up' } });
  assert.equal(forged.status, 403);

  const cookie = await qbitLogin(base, key);
  const ok = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info`, { headers: { Cookie: cookie } });
  assert.equal(ok.status, 200);

  await fetch(`${base}/api/lidarr/qbit/api/v2/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
  const afterLogout = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 403);
});

test('Mock qBittorrent Web API handles auth, version, and torrents/info', async (t) => {
  const { base, key } = await startApp(t);

  // 1. Test with URL Base /api/lidarr/qbit
  const cookie = await qbitLogin(base, key);
  const headers = { Cookie: cookie };

  const verRes = await fetch(`${base}/api/lidarr/qbit/api/v2/app/version`, { headers });
  assert.equal(verRes.status, 200);
  assert.ok(verRes.headers.get('content-type').includes('text/plain'));
  assert.equal(await verRes.text(), 'v4.6.0');

  const webapiRes = await fetch(`${base}/api/lidarr/qbit/api/v2/app/webapiVersion`, { headers });
  assert.equal(webapiRes.status, 200);
  assert.equal(await webapiRes.text(), '2.9.3');

  const prefRes = await fetch(`${base}/api/lidarr/qbit/api/v2/app/preferences`, { headers });
  assert.equal(prefRes.status, 200);
  const pref = await prefRes.json();
  assert.ok(pref.save_path.startsWith('/'));
  assert.equal(pref.queueing_enabled, true);

  const catRes = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/categories`, { headers });
  assert.equal(catRes.status, 200);
  assert.ok((await catRes.json()).music);

  const createCatRes = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/createCategory`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'category=rock',
  });
  assert.equal(createCatRes.status, 200);

  const infoRes = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info`, { headers });
  assert.equal(infoRes.status, 200);
  assert.ok(Array.isArray(await infoRes.json()));

  // 2. Direct mount at /api/v2 (URL Base left blank) and the doubled prefix
  const directCookie = await qbitLogin(base, key, '/api/v2');
  const directWebapi = await fetch(`${base}/api/v2/app/webapiVersion`, { headers: { Cookie: directCookie } });
  assert.equal(directWebapi.status, 200);
  assert.equal(await directWebapi.text(), '2.9.3');
  await qbitLogin(base, key, '/api/lidarr/qbit/api/v2/api/v2');
});

test('qBittorrent categories survive a restart', async (t) => {
  const { base, key, db } = await startApp(t);
  const cookie = await qbitLogin(base, key);
  await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/createCategory`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'category=lidarr-music&savePath=/downloads/Lidarr',
  });
  const stored = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'lidarr_qbit_categories'").get().value);
  assert.deepEqual(stored['lidarr-music'], { name: 'lidarr-music', savePath: '/downloads/Lidarr' });

  await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/removeCategories`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'categories=lidarr-music',
  });
  const cats = await (await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/categories`, { headers: { Cookie: cookie } })).json();
  assert.equal(cats['lidarr-music'], undefined);
  assert.ok(cats.music);
});

test('Mock SABnzbd API handles version, queue, and history modes', async (t) => {
  const { base, key } = await startApp(t);

  const ver = await (await fetch(`${base}/api/lidarr/sab/api?mode=version&apikey=${key}`)).json();
  assert.equal(ver.version, '4.3.0');

  const q = await (await fetch(`${base}/api/lidarr/sab/api?mode=queue&apikey=${key}`)).json();
  assert.ok(q.queue);

  const h = await (await fetch(`${base}/api/lidarr/sab/api?mode=history&apikey=${key}`)).json();
  assert.ok(h.history);
});

test('qBittorrent torrents/add reports the uploaded torrent under its real infohash', async (t) => {
  const { db, base, key, lidarr } = await startApp(t);
  const music = require(path.join(SRC, 'services', 'music'));
  const saveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lidarr-'));
  t.after(() => fs.rmSync(saveRoot, { recursive: true, force: true }));

  const enqueued = [];
  const original = music.enqueueMusicDownload;
  music.enqueueMusicDownload = async (opts) => {
    enqueued.push(opts);
    // Stand in for the real download: write the file where enqueueMusicDownload would.
    const dir = path.join(opts.musicFolder, opts.track.albumArtist || opts.track.artist, opts.track.album);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `01 - ${opts.track.title}.mp3`), Buffer.alloc(1234));
    const id = `job-${enqueued.length}`;
    db.prepare("INSERT INTO downloads (id, url, status, percent) VALUES (?, 'x', 'completed', 100)").run(id);
    return { jobId: id };
  };
  t.after(() => { music.enqueueMusicDownload = original; });

  // A track release skips the album lookup, so the test needs no network.
  const torrent = lidarr.generateTorrentBuffer({ type: 'track', id: '7-1', artist: 'Incubus', album: 'Morning View', track: 'Wish You Were Here' });
  const infoHash = lidarr.getInfoHash(torrent);

  const cookie = await qbitLogin(base, key);
  const form = new FormData();
  form.append('category', 'music');
  form.append('savepath', saveRoot);
  form.append('torrents', new Blob([torrent], { type: 'application/x-bittorrent' }), 'release.torrent');
  const addRes = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/add`, { method: 'POST', body: form, headers: { Cookie: cookie } });
  assert.equal(addRes.status, 200);

  // Enqueueing runs in the background after the response.
  for (let i = 0; i < 50 && !enqueued.length; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].track.title, 'Wish You Were Here');
  assert.equal(enqueued[0].extraOptions.lidarrHash, infoHash);

  const headers = { Cookie: cookie };
  const list = await (await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info?hashes=${infoHash.toUpperCase()}`, { headers })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].hash, infoHash);
  assert.equal(list[0].state, 'uploading');
  assert.equal(list[0].content_path, path.join(saveRoot, 'Incubus', 'Morning View'));
  assert.equal(list[0].size, 1234, 'reports the real size once finished');

  const files = await (await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/files?hash=${infoHash}`, { headers })).json();
  assert.deepEqual(files.map((f) => [f.name, f.size, f.progress]), [['Incubus/Morning View/01 - Wish You Were Here.mp3', 1234, 1]]);

  const props = await (await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/properties?hash=${infoHash}`, { headers })).json();
  assert.equal(props.save_path, saveRoot);
  assert.equal(props.total_size, 1234);

  const missing = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/files?hash=deadbeef`, { headers });
  assert.equal(missing.status, 404);
});

test('search results carry the API key and the configured format', async (t) => {
  const { base, key, lidarr } = await startApp(t);
  const music = require(path.join(SRC, 'services', 'music'));
  const original = music.searchAlbums;
  music.searchAlbums = async () => ({ results: [{ id: 5, name: 'Morning View', artist: 'Incubus', releaseYear: 2001, trackCount: 13 }] });
  t.after(() => { music.searchAlbums = original; });
  lidarr.updateLidarrConfig({ format: 'flac', quality: 'best' });

  const xml = await (await fetch(`${base}/api/lidarr/torznab?t=music&artist=Incubus&album=Morning+View&apikey=${key}`)).text();
  assert.ok(xml.includes('Incubus - Morning View (2001) [FLAC] [WEB]'));
  assert.ok(xml.includes(`apikey=${key}`));
  assert.ok(xml.includes('<torznab:attr name="category" value="3040"/>'));
  assert.ok(!xml.includes('value="3010"'));
  assert.ok(xml.includes('<torznab:attr name="seeders" value="1"/>'));
  assert.ok(xml.includes(`<size>${lidarr.estimateReleaseSize(13, 'flac', 'best')}</size>`));
});

test('album search finds the album in the artist catalog when keyword search misses it', async (t) => {
  const { base, key } = await startApp(t);
  const music = require(path.join(SRC, 'services', 'music'));
  const original = music.searchAlbums;
  const catalog = [
    { id: 1, name: '8', artist: 'Incubus', releaseYear: '2017', trackCount: 11 },
    { id: 2, name: 'Drive - EP', artist: 'Incubus', releaseYear: '2001', trackCount: 5 },
    { id: 3, name: 'Morning View (Special Edition)', artist: 'Incubus', releaseYear: '2001', trackCount: 13 },
    { id: 4, name: 'Morning View (Live)', artist: 'Incubus', releaseYear: '2001', trackCount: 13 },
    { id: 5, name: 'Morning View [Disc 1]', artist: 'Incubus', releaseYear: '2001', trackCount: 13 },
  ];
  const searchCalls = [];
  music.searchAlbums = async (q, limit, options) => {
    searchCalls.push({ q, limit, options });
    if (q === 'Incubus') return { results: [catalog[2]], matchedArtist: { id: 9, name: 'Incubus', isExact: true, all: catalog } };
    if (q === 'Incubus Morning View') return { results: [] };
    return { results: [{ id: 6, name: '8-Bit Versions of Incubus', artist: '8-Bit Misfits', trackCount: 8 }, catalog[2]] };
  };
  t.after(() => { music.searchAlbums = original; });

  const titles = (xml) => [...xml.matchAll(/<title>(.*?) \[/g)].map((m) => m[1]);

  const album = await (await fetch(`${base}/api/lidarr/torznab?t=music&artist=Incubus&album=8&apikey=${key}`)).text();
  assert.deepEqual(titles(album), ['Incubus - 8 (2017)']);
  assert.deepEqual(searchCalls.map(({ options }) => options), [undefined, { includeArtist: false }]);

  const ep = await (await fetch(`${base}/api/lidarr/torznab?t=music&artist=Incubus&album=Drive&apikey=${key}`)).text();
  assert.equal(titles(ep)[0], 'Incubus - Drive - EP (2001)');

  const specialEdition = await (await fetch(`${base}/api/lidarr/torznab?t=music&artist=Incubus&album=Morning+View&apikey=${key}`)).text();
  assert.deepEqual(titles(specialEdition), ['Incubus - Morning View (Special Edition) (2001)']);

  catalog.push({ id: 7, name: 'Morning View - Single', artist: 'Incubus', releaseYear: '2001', trackCount: 1, releaseType: 'single' });
  const withSingle = await (await fetch(`${base}/api/lidarr/torznab?t=music&artist=Incubus&album=Morning+View&apikey=${key}`)).text();
  assert.deepEqual(titles(withSingle), ['Incubus - Morning View (Special Edition) (2001)']);

  const onlySingle = await (await fetch(`${base}/api/lidarr/torznab?t=music&artist=Incubus&album=Drive&apikey=${key}`)).text();
  assert.equal(titles(onlySingle)[0], 'Incubus - Drive - EP (2001)');
  catalog.pop();

  const artist = await (await fetch(`${base}/api/lidarr/torznab?t=music&artist=Incubus&apikey=${key}`)).text();
  assert.equal(titles(artist).length, 5);

  const page2 = await (await fetch(`${base}/api/lidarr/torznab?t=music&artist=Incubus&limit=2&offset=2&apikey=${key}`)).text();
  assert.deepEqual(titles(page2), [
    'Incubus - Morning View (Special Edition) (2001)',
    'Incubus - Morning View (Live) (2001)',
  ]);
});

test('an album grab whose track list cannot be fetched fails instead of downloading one song', async (t) => {
  const { base, key, lidarr } = await startApp(t);
  const music = require(path.join(SRC, 'services', 'music'));
  const originals = { getAlbumDetails: music.getAlbumDetails, enqueueMusicDownload: music.enqueueMusicDownload };
  const enqueued = [];
  music.getAlbumDetails = async () => { throw new Error('Album not found'); };
  music.enqueueMusicDownload = async (opts) => { enqueued.push(opts); return { jobId: 'x' }; };
  t.after(() => Object.assign(music, originals));

  const torrent = lidarr.generateTorrentBuffer({ type: 'album', id: '42', artist: 'Incubus', album: 'Morning View' });
  const infoHash = lidarr.getInfoHash(torrent);
  const cookie = await qbitLogin(base, key);
  const form = new FormData();
  form.append('torrents', new Blob([torrent], { type: 'application/x-bittorrent' }), 'release.torrent');
  await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/add`, { method: 'POST', body: form, headers: { Cookie: cookie } });
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(enqueued.length, 0);
  const list = await (await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/info?hashes=${infoHash}`, { headers: { Cookie: cookie } })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].state, 'error');
});

test('removing a grab in Lidarr stops its unfinished tracks', async (t) => {
  const { db, base, key } = await startApp(t);
  const queue = require(path.join(SRC, 'services', 'queue'));
  db.prepare("INSERT INTO downloads (id, url, status) VALUES ('done', 'x', 'completed'), ('waiting', 'x', 'queued')").run();
  db.prepare(`INSERT INTO lidarr_tasks (hash, title, type, external_id, total_tracks, job_ids, status, save_path, content_path)
    VALUES ('abcdef', 'Incubus - Morning View', 'album', '42', 2, '["done","waiting"]', 'enqueued', '/m', '/m/Incubus')`).run();

  const cookie = await qbitLogin(base, key);
  const res = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/delete`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'hashes=ABCDEF&deleteFiles=false',
  });
  assert.equal(res.status, 200);
  assert.equal(db.prepare("SELECT 1 FROM lidarr_tasks WHERE hash = 'abcdef'").get(), undefined);
  assert.ok(queue.getJob('done'), 'finished tracks are kept');
  assert.equal(queue.getJob('waiting'), undefined);
});

test('an oversized torrents/add upload is refused with 413, not reported as queued', async (t) => {
  const { base, key } = await startApp(t);
  const cookie = await qbitLogin(base, key);
  const form = new FormData();
  form.append('torrents', new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: 'application/x-bittorrent' }), 'big.torrent');
  const res = await fetch(`${base}/api/lidarr/qbit/api/v2/torrents/add`, { method: 'POST', body: form, headers: { Cookie: cookie } });
  assert.equal(res.status, 413);
});

test('album and q-only searches exclude live title tracks and unrelated releases', async (t) => {
  const { base, key } = await startApp(t);
  const music = require(path.join(SRC, 'services', 'music'));
  const full = { id: 1, name: 'Make Yourself', artist: 'Incubus', trackCount: 13 };
  const wrong = [
    { id: 2, name: 'Make Yourself - Single', artist: 'Incubus', trackCount: 1 },
    { id: 3, name: 'Make Yourself (Live)', artist: 'Incubus', trackCount: 1 },
    { id: 4, name: 'Make Yourself (Live)', artist: 'Incubus', trackCount: 13 },
  ];
  let includeFull = true;
  t.mock.method(music, 'searchAlbums', async () => ({ results: includeFull ? [...wrong, full] : wrong }));
  t.mock.method(music, 'searchTracks', async () => { assert.fail('Album search must not return songs'); });
  for (const params of ['artist=Incubus&album=Make+Yourself', 'q=Incubus+Make+Yourself']) {
    const xml = await (await fetch(`${base}/api/lidarr/torznab?t=music&${params}&apikey=${key}`)).text();
    assert.equal((xml.match(/<item>/g) || []).length, 1);
    assert.ok(xml.includes('type=album&amp;id=1&amp;'));
    assert.ok(!xml.includes('(Live)'));
  }
  includeFull = false;
  const xml = await (await fetch(`${base}/api/lidarr/torznab?t=music&artist=Incubus&album=Make+Yourself&apikey=${key}`)).text();
  assert.ok(!xml.includes('<item>'));
});

test('missing compilations use all monitored-release tracks across discs from Lidarr', async (t) => {
  const { base, key, lidarr, db } = await startApp(t);
  lidarr.updateLidarrConfig({ url: 'http://lidarr.test', apiKey: 'test-key' });
  const music = require(path.join(SRC, 'services', 'music'));
  t.mock.method(music, 'searchAlbums', async () => ({ results: [] }));
  const record = {
    id: 42, artistId: 9, title: 'The Essential Incubus', releaseDate: '2012-10-30',
    releases: [{ id: 70, monitored: false, trackCount: 1 }, { id: 71, monitored: true, trackCount: 4 }],
  };
  const tracks = [
    { title: 'Drive', trackNumber: '2', mediumNumber: 2, duration: 232000 },
    { title: 'Pardon Me', trackNumber: '1', mediumNumber: 2, duration: 223000 },
    { title: 'Make Yourself', trackNumber: '2', mediumNumber: 1, duration: 183000 },
    { title: 'Privilege', trackNumber: '1', mediumNumber: 1, duration: 183000 },
  ];
  const realFetch = global.fetch;
  t.mock.method(global, 'fetch', async (url, opts) => {
    if (!String(url).startsWith('http://lidarr.test/')) return realFetch(url, opts);
    assert.equal(opts.headers['X-Api-Key'], 'test-key');
    const route = String(url).split('/api/v1/')[1];
    const resources = {
      artist: [{ id: 9, artistName: 'Incubus' }], 'artist/9': { id: 9, artistName: 'Incubus' },
      'album?artistId=9': [record], 'album/42': record, 'track?albumReleaseId=71': tracks,
    };
    assert.ok(route in resources, route);
    return { ok: true, json: async () => resources[route] };
  });
  for (const params of ['artist=Incubus&album=The+Essential+Incubus', 'q=Incubus+The+Essential+Incubus']) {
    const xml = await (await fetch(`${base}/api/lidarr/torznab?t=music&${params}&apikey=${key}`)).text();
    assert.ok(xml.includes('id=lidarr-42'));
    assert.ok(xml.includes('Incubus - The Essential Incubus (2012)'));
  }
  const enqueued = [];
  t.mock.method(music, 'enqueueMusicDownload', async (opts) => {
    enqueued.push(opts.track);
    return { jobId: `compilation-${enqueued.length}` };
  });
  const result = await lidarr.handleDownloadAdd({ type: 'album', id: 'lidarr-42', artist: 'Incubus', album: record.title });
  for (let i = 0; i < 100 && db.prepare('SELECT status FROM lidarr_tasks WHERE hash = ?').get(result.hash)?.status === 'downloading'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(enqueued.length, 4);
  assert.deepEqual(enqueued.map((tr) => [tr.title, tr.discNumber, tr.trackNumber]), [
    ['Privilege', 1, 1], ['Make Yourself', 1, 2], ['Pardon Me', 2, 1], ['Drive', 2, 2],
  ]);
  assert.ok(enqueued.every((tr) => tr.album === record.title && tr.totalDiscs === 2 && tr.totalTracks === 4));
  assert.equal(enqueued[3].duration, 232);
});

test('wanted/missing omits the nonexistent Albums.AirDateUtc sort column', async (t) => {
  const { lidarr } = await startApp(t);
  lidarr.updateLidarrConfig({ url: 'http://lidarr.test', apiKey: 'test-key' });
  t.mock.method(global, 'fetch', async (url) => {
    assert.equal(String(url), 'http://lidarr.test/api/v1/wanted/missing?page=2&pageSize=10');
    return { ok: true, json: async () => ({ records: [] }) };
  });
  assert.deepEqual(await lidarr.getWantedMissing({ page: 2, pageSize: 10 }), { records: [] });
});
