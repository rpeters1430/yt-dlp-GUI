const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadQueue, waitFor, deferred, insertJob } = require('../helpers/queueHarness');

const URL_A = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const URL_B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
const URL_C = 'https://www.youtube.com/watch?v=ccccccccccc';

const statusOf = (q, id) => q.queue.getJob(id)?.status;
const finished = (q, id) => ['completed', 'failed'].includes(statusOf(q, id));

test('a download runs to completion and records metadata, file and notification', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  q.state.download = async (url, opts, onProgress, onLog) => {
    onLog('[download] working');
    onProgress({ percent: 50, speed: '1MiB/s', eta: '00:05' });
    return { filepath: '/downloads/a.mp4' };
  };

  const id = q.queue.enqueue(URL_A, { quality: '1080' });
  await waitFor(() => finished(q, id), { label: 'job to finish' });

  const job = q.queue.getJob(id);
  assert.equal(job.status, 'completed');
  assert.equal(job.percent, 100);
  assert.equal(job.filepath, '/downloads/a.mp4');
  assert.equal(job.title, `Title for ${URL_A}`);
  assert.equal(job.video_id, 'vid1');
  assert.equal(job.pid, null);
  assert.match(job.log, /Download completed successfully/);
  assert.match(job.command_args, /yt-dlp/);
  assert.equal(q.completed.mock.callCount(), 1);
  assert.equal(q.failed.mock.callCount(), 0);
  assert.equal(q.state.downloadCalls.length, 1);
});

test('socket updates leave out the log except when it changed, and counts follow status changes', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  const id = q.queue.enqueue(URL_A);
  await waitFor(() => finished(q, id));

  const updates = q.io.of('job:update').filter((j) => j.id === id);
  assert.ok(updates.length >= 3);
  assert.ok(updates.some((u) => !('log' in u)), 'some updates are slim');
  assert.ok(updates.some((u) => typeof u.log === 'string'), 'log is sent when it changes');
  for (const u of updates) assert.ok(!('command_args' in u) || typeof u.command_args === 'string');

  const counts = q.io.of('jobs:counts');
  assert.ok(counts.length >= 2);
  assert.deepEqual(counts.at(-1), { queued: 0, downloading: 0, completed: 1, failed: 0 });
});

test('a failed download is marked failed with the error and a failure notification', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  q.state.download = async () => { throw new Error('ERROR: HTTP Error 403: Forbidden'); };

  const id = q.queue.enqueue(URL_A);
  await waitFor(() => finished(q, id));

  const job = q.queue.getJob(id);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /403/);
  assert.equal(job.stage, 'Failed');
  assert.equal(q.failed.mock.callCount(), 1);
  assert.equal(q.completed.mock.callCount(), 0);
});

test('a bot-check during the metadata lookup fails the job without starting the download', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  q.state.info = new Error("ERROR: [youtube] x: Sign in to confirm you're not a bot");

  const id = q.queue.enqueue(URL_A);
  await waitFor(() => finished(q, id));

  assert.equal(statusOf(q, id), 'failed');
  assert.equal(q.state.downloadCalls.length, 0);
  assert.match(q.queue.getJob(id).error, /not a bot/);
});

test('any other metadata failure is logged and the download still runs', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  q.state.info = new Error('ERROR: Unsupported URL');

  const id = q.queue.enqueue(URL_A);
  await waitFor(() => finished(q, id));

  assert.equal(statusOf(q, id), 'completed');
  assert.equal(q.state.downloadCalls.length, 1);
  assert.match(q.queue.getJob(id).log, /Metadata lookup note: ERROR: Unsupported URL/);
});

test('a subtitle download error retries once without subtitles', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  q.state.info = { id: 'vid1', title: 'Has captions', extractor: 'youtube', subtitles: { en: [{ ext: 'vtt', url: 'https://x/en.vtt' }] } };
  q.state.download = async (url, opts) => {
    if (opts.subtitles) throw new Error('ERROR: Unable to download video subtitles for "en": HTTP Error 429');
    return { filepath: '/downloads/a.mp4' };
  };

  const id = q.queue.enqueue(URL_A, { subtitles: true, subLangs: 'en' });
  await waitFor(() => finished(q, id));

  assert.equal(statusOf(q, id), 'completed');
  assert.equal(q.state.downloadCalls.length, 2);
  assert.equal(q.state.downloadCalls[0].opts.subtitles, true);
  assert.equal(q.state.downloadCalls[1].opts.subtitles, false);
  assert.match(q.queue.getJob(id).log, /retrying without subtitles/);
});

test('removing a job mid-download stops it and skips completion', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  const gate = deferred();
  q.state.download = () => gate.promise;

  const id = q.queue.enqueue(URL_A);
  await waitFor(() => q.state.downloadCalls.length === 1, { label: 'download to start' });
  assert.equal(q.queue.removeJob(id), true);
  gate.resolve({ filepath: '/downloads/a.mp4' });
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(q.queue.getJob(id), undefined);
  assert.deepEqual(q.state.stopped, [id]);
  assert.equal(q.completed.mock.callCount(), 0);
  assert.deepEqual(q.io.of('job:removed'), [{ id }]);
  assert.equal(q.queue.getActiveCount(), 0);
  assert.equal(q.queue.removeJob(id), false, 'removing again reports nothing removed');
});

test('no more than MAX_CONCURRENT_DOWNLOADS run at once; the next starts when one finishes', async (t) => {
  const q = loadQueue(t, { maxConcurrent: 2 });
  q.queue.init(q.io);
  const gates = new Map();
  q.state.download = (url) => {
    const gate = deferred();
    gates.set(url, gate);
    return gate.promise;
  };

  const a = q.queue.enqueue(URL_A);
  const b = q.queue.enqueue(URL_B);
  const c = q.queue.enqueue(URL_C);
  await waitFor(() => gates.size === 2, { label: 'two downloads to start' });
  assert.equal(statusOf(q, c), 'queued');
  assert.equal(q.queue.getActiveCount(), 2);

  gates.get(URL_A).resolve({ filepath: '/downloads/a.mp4' });
  await waitFor(() => gates.has(URL_C), { label: 'third download to start' });
  assert.equal(statusOf(q, a), 'completed');

  gates.get(URL_B).resolve({ filepath: '/downloads/b.mp4' });
  gates.get(URL_C).resolve({ filepath: '/downloads/c.mp4' });
  await waitFor(() => finished(q, b) && finished(q, c));
  assert.equal(q.queue.getActiveCount(), 0);
});

test('queued jobs start in the order they were added', async (t) => {
  const q = loadQueue(t, { maxConcurrent: 1 });
  q.queue.init(q.io);
  const started = [];
  q.state.download = async (url) => {
    started.push(url);
    return { filepath: '/downloads/x.mp4' };
  };
  const ids = [URL_A, URL_B, URL_C].map((u) => q.queue.enqueue(u));
  await waitFor(() => ids.every((id) => finished(q, id)));
  assert.deepEqual(started, [URL_A, URL_B, URL_C]);
});

test('a wait-for-live job never holds or waits for a download slot', async (t) => {
  const q = loadQueue(t, { maxConcurrent: 1 });
  q.queue.init(q.io);
  const gates = [];
  q.state.download = () => {
    const gate = deferred();
    gates.push(gate);
    return gate.promise;
  };

  const normal1 = q.queue.enqueue(URL_A);
  const normal2 = q.queue.enqueue(URL_B);
  const live = q.queue.enqueue('https://www.twitch.tv/somechannel', { isLive: true, optionsJson: { waitForLive: true } });

  await waitFor(() => gates.length === 2, { label: 'normal + waiting job to start' });
  assert.equal(statusOf(q, normal1), 'downloading');
  assert.equal(statusOf(q, live), 'downloading');
  assert.equal(statusOf(q, normal2), 'queued');
  assert.equal(q.queue.getActiveCount(), 1, 'the waiting job does not count against the limit');

  for (const g of gates) g.resolve({ filepath: '/downloads/x.mp4' });
  await waitFor(() => gates.length === 3);
  gates[2].resolve({ filepath: '/downloads/y.mp4' });
  await waitFor(() => [normal1, normal2, live].every((id) => finished(q, id)));
});

test('a live recording with chunk splitting completes and records its parts', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-split-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recording = path.join(dir, 'stream.mp4');
  fs.writeFileSync(recording, 'x');
  const parts = [path.join(dir, 'stream_part1.mp4'), path.join(dir, 'stream_part2.mp4')];
  q.state.download = async () => ({ filepath: recording });
  const split = t.mock.method(q.liveSplitter, 'splitRecording', async () => ({ split: true, files: parts }));

  const id = q.queue.enqueue('https://www.twitch.tv/somechannel', {
    isLive: true,
    optionsJson: { splitLiveChunks: true, liveChunkDuration: 60 },
  });
  await waitFor(() => finished(q, id));

  const job = q.queue.getJob(id);
  assert.equal(job.status, 'completed', job.error || '');
  assert.equal(split.mock.callCount(), 1);
  assert.equal(split.mock.calls[0].arguments[1], 60);
  assert.deepEqual(JSON.parse(job.split_parts), parts);
  assert.equal(job.filepath, parts[0]);
  assert.equal(job.stage, 'Split into 2 chunks');
  // The completion notification lists the chunk files by name.
  assert.equal(q.completed.mock.callCount(), 1);
});

test('a failed split keeps the single recording and still completes', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-split-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recording = path.join(dir, 'stream.mp4');
  fs.writeFileSync(recording, 'x');
  q.state.download = async () => ({ filepath: recording });
  t.mock.method(q.liveSplitter, 'splitRecording', async () => { throw new Error('ffmpeg exploded'); });

  const id = q.queue.enqueue('https://www.twitch.tv/somechannel', {
    isLive: true,
    optionsJson: { splitLiveChunks: true, liveChunkDuration: 30 },
  });
  await waitFor(() => finished(q, id));

  const job = q.queue.getJob(id);
  assert.equal(job.status, 'completed');
  assert.equal(job.filepath, recording);
  assert.match(job.log, /Chunk splitting failed \(ffmpeg exploded\)/);
});

test('jobs left "downloading" by a restart are re-queued and run on init', async (t) => {
  const q = loadQueue(t);
  insertJob(q.db, { id: 'stale', status: 'downloading', url: URL_A });
  q.queue.init(q.io);
  await waitFor(() => finished(q, 'stale'));
  assert.equal(statusOf(q, 'stale'), 'completed');
  assert.equal(q.state.downloadCalls.length, 1);
});

test('stopJob asks yt-dlp to stop and marks the job as finalizing', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  const gate = deferred();
  q.state.download = () => gate.promise;
  const id = q.queue.enqueue(URL_A, { isLive: true });
  await waitFor(() => q.state.downloadCalls.length === 1);

  assert.equal(q.queue.stopJob(id), true);
  assert.equal(q.queue.getJob(id).stage, 'Finalizing recording…');
  gate.resolve({ filepath: '/downloads/live.mp4', stoppedByUser: true });
  await waitFor(() => finished(q, id));
  assert.match(q.queue.getJob(id).log, /stopped by user/);
});

test('listJobs returns every active job plus the newest finished ones, without logs', (t) => {
  const q = loadQueue(t);
  for (let i = 1; i <= 5; i++) {
    insertJob(q.db, { id: `done${i}`, createdAt: `2026-01-0${i} 00:00:00`, log: 'big log' });
  }
  insertJob(q.db, { id: 'old-queued', status: 'queued', createdAt: '2025-01-01 00:00:00' });

  const list = q.queue.listJobs({ limit: 2 });
  assert.deepEqual(list.map((j) => j.id), ['done5', 'done4', 'old-queued']);
  assert.ok(list.every((j) => !('log' in j) && !('command_args' in j)));

  assert.deepEqual(q.queue.listJobs({ activeOnly: true }).map((j) => j.id), ['old-queued']);
  assert.equal(q.queue.listJobs().length, 6);
  assert.equal(q.queue.listJobs({ limit: 'nonsense' }).length, 6, 'bad limit falls back to the default');
});

test('searchJobs filters by status and text, pages, and treats wildcards literally', (t) => {
  const q = loadQueue(t);
  insertJob(q.db, { id: '1', status: 'completed', title: 'Cats compilation', extractor: 'youtube', createdAt: '2026-01-01 00:00:00' });
  insertJob(q.db, { id: '2', status: 'failed', title: 'More cats', extractor: 'youtube', createdAt: '2026-01-02 00:00:00' });
  insertJob(q.db, { id: '3', status: 'failed', title: 'Dogs', extractor: 'twitch', createdAt: '2026-01-03 00:00:00' });
  insertJob(q.db, { id: '4', status: 'completed', title: '100% real', extractor: 'vimeo', createdAt: '2026-01-04 00:00:00' });

  assert.deepEqual(q.queue.searchJobs({ status: 'failed' }).jobs.map((j) => j.id), ['3', '2']);
  assert.deepEqual(q.queue.searchJobs({ q: 'CATS' }).jobs.map((j) => j.id), ['2', '1']);
  assert.deepEqual(q.queue.searchJobs({ q: 'twitch' }).jobs.map((j) => j.id), ['3']);
  assert.deepEqual(q.queue.searchJobs({ q: '%' }).jobs.map((j) => j.id), ['4']);
  assert.deepEqual(q.queue.searchJobs({ status: 'failed', q: 'dog' }).jobs.map((j) => j.id), ['3']);

  const page1 = q.queue.searchJobs({ limit: 3, offset: 0 });
  const page2 = q.queue.searchJobs({ limit: 3, offset: 3 });
  assert.equal(page1.total, 4);
  assert.deepEqual(page1.jobs.map((j) => j.id), ['4', '3', '2']);
  assert.deepEqual(page2.jobs.map((j) => j.id), ['1']);
  assert.ok(!('log' in page1.jobs[0]));
});

test('getStatusCounts counts every status across the whole history', (t) => {
  const q = loadQueue(t);
  insertJob(q.db, { id: '1', status: 'completed' });
  insertJob(q.db, { id: '2', status: 'failed' });
  insertJob(q.db, { id: '3', status: 'failed' });
  insertJob(q.db, { id: '4', status: 'deleted' });
  assert.deepEqual(q.queue.getStatusCounts(), { queued: 0, downloading: 0, completed: 1, failed: 2, deleted: 1 });
});

test('a watch-linked job reports its status to the watch listener', async (t) => {
  const q = loadQueue(t);
  q.queue.init(q.io);
  const seen = [];
  q.queue.setWatchItemListener((itemId, status) => seen.push([itemId, status]));
  const id = q.queue.enqueue(URL_A, { watchItemId: 77 });
  await waitFor(() => finished(q, id));
  assert.deepEqual(seen, [[77, 'downloading'], [77, 'completed']]);
});
