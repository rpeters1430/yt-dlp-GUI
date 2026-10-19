const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { entry, setupWatchService } = require('../helpers/watchFixtures');
const { createWatchesRouter } = require('../../src/routes/watches');

const PLAYLIST = 'https://www.youtube.com/playlist?list=PL123';
const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
const onDisk = new Set(['/downloads/b.mp4']);
const fileExists = (p) => onDisk.has(p);

function setup(t) {
  const s = setupWatchService(t);
  s.state.entries = ids.map((id) => entry(id));
  const watchId = s.addWatch({ url: PLAYLIST, name: 'My playlist' });
  return { ...s, watchId, watch: () => s.getWatch(watchId) };
}

function addItem(s, watchId, videoId, fields = {}) {
  const cols = { watch_id: watchId, video_id: videoId, discovery_type: 'baseline', ...fields };
  const keys = Object.keys(cols);
  return Number(s.db.prepare(`INSERT INTO watch_items (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => cols[k])).lastInsertRowid);
}

function addDownload(s, id, fields = {}) {
  const cols = { id, url: 'https://www.youtube.com/watch?v=x', status: 'completed', ...fields };
  const keys = Object.keys(cols);
  s.db.prepare(`INSERT INTO downloads (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
}

test('listPlaylistVideos lists every video in order with its download state', async (t) => {
  const s = setup(t);
  // b: downloaded by this watch and on disk; c: finished but the file is gone;
  // d: failed; e: downloaded from Home, outside the watch. a: never downloaded.
  addDownload(s, 'job-b', { filepath: '/downloads/b.mp4' });
  addItem(s, s.watchId, ids[1], { download_status: 'completed', download_id: 'job-b' });
  addDownload(s, 'job-c', { filepath: '/downloads/c.mp4' });
  addItem(s, s.watchId, ids[2], { download_status: 'completed', download_id: 'job-c' });
  addItem(s, s.watchId, ids[3], { download_status: 'failed', last_error: 'HTTP 403' });
  addDownload(s, 'job-e', { video_id: ids[4], filepath: '/downloads/b.mp4' });

  const result = await s.service.listPlaylistVideos(s.watch(), { fileExists });
  assert.deepEqual(result.videos.map((v) => [v.id, v.index, v.state]), [
    [ids[0], 1, 'not_downloaded'],
    [ids[1], 2, 'downloaded'],
    [ids[2], 3, 'missing'],
    [ids[3], 4, 'failed'],
    [ids[4], 5, 'downloaded'],
  ]);
  assert.equal(result.videos[1].downloadId, 'job-b');
  assert.equal(result.videos[3].error, 'HTTP 403');
  assert.equal(result.videos[4].downloadId, 'job-e');
});

test('listPlaylistVideos refuses channel watches', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ url: 'https://www.youtube.com/@example' });
  const result = await s.service.listPlaylistVideos(s.getWatch(id));
  assert.equal(result.status, 400);
  assert.equal(s.state.calls, 0);
});

test('downloadPlaylistVideos queues picked videos ahead of backfills and skips ones already there', async (t) => {
  const s = setup(t);
  addDownload(s, 'job-b', { filepath: '/downloads/b.mp4' });
  addItem(s, s.watchId, ids[1], { download_status: 'completed', download_id: 'job-b' });
  addDownload(s, 'job-c', { status: 'deleted' });
  addItem(s, s.watchId, ids[2], { download_status: 'completed', download_id: 'job-c', attempt_count: 1 });
  await s.service.listPlaylistVideos(s.watch(), { fileExists });

  const result = s.service.downloadPlaylistVideos(s.watch(), [ids[0], ids[1], ids[2], 'not-an-id'], { fileExists });

  assert.deepEqual(result.queued.map((q) => q.videoId).sort(), [ids[0], ids[2]]);
  assert.deepEqual(result.skipped, [ids[1]]);
  assert.deepEqual(s.state.started.sort(), result.queued.map((q) => q.downloadId).sort());

  // The never-cataloged video is recorded with the listing's title; the deleted one keeps its history.
  const a = s.itemByVideo(s.watchId, ids[0]);
  assert.equal(a.download_status, 'queued');
  assert.equal(a.title, `Video ${ids[0]}`);
  const c = s.itemByVideo(s.watchId, ids[2]);
  assert.equal(c.download_status, 'queued');
  assert.equal(c.attempt_count, 1);
  assert.ok(s.state.jobOptions.every((o) => o.priority === 10 && o.watchId === s.watchId));

  // Asking again while they're queued queues nothing more.
  const again = s.service.downloadPlaylistVideos(s.watch(), [ids[0], ids[2]], { fileExists });
  assert.equal(again.queued.length, 0);
  assert.deepEqual(again.skipped, [ids[0], ids[2]]);
});

test('playlist routes list videos and queue picks', async (t) => {
  const s = setup(t);
  const app = express();
  app.use(express.json());
  app.use('/api/watches', createWatchesRouter({
    repository: s.repository, watchService: s.service, checkAllWatches: async () => {}, database: s.db, ytdlp: s.ytdlp,
    requireAuthMiddleware: (req, res, next) => next(),
  }));
  const server = await new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/watches/${s.watchId}`;

  let res = await fetch(`${base}/playlist`);
  assert.equal(res.status, 200);
  const listed = await res.json();
  assert.equal(listed.videos.length, ids.length);
  assert.ok(listed.videos.every((v) => v.state === 'not_downloaded'));

  res = await fetch(`${base}/playlist/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: [ids[3]] }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).queued[0].videoId, ids[3]);

  res = await fetch(`${base}/playlist/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoIds: 'x' }) });
  assert.equal(res.status, 400);

  s.state.failInfo = 'This playlist does not exist';
  res = await fetch(`${base}/playlist`);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /does not exist/);
});
