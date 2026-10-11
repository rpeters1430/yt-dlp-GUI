// ytdlp.download() end to end against a fake yt-dlp binary (test/fixtures/fake-yt-dlp.js):
// spawning, output parsing, progress scaling, exit-code handling, stop and the idle watchdog.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Read once at module load by ytdlp.js, so set before requiring it. Each test file runs in
// its own process, so this doesn't leak into other tests.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-download-'));
process.env.YTDLP_BIN = path.join(__dirname, '..', 'fixtures', 'fake-yt-dlp.js');
process.env.CONFIG_DIR = path.join(sandbox, 'config');
process.env.DOWNLOAD_DIR = path.join(sandbox, 'downloads');
process.env.DOWNLOAD_IDLE_TIMEOUT_MS = '400';
process.env.DOWNLOAD_MAX_QUIET_MS = '1'; // skip the CPU-busy grace period
const ytdlp = require('../../src/services/ytdlp');
const db = require('../../src/db');

test.after(() => {
  db.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const URL = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
let jobSeq = 0;

function run(scenario, options = {}) {
  process.env.FAKE_YTDLP = JSON.stringify(scenario);
  const progress = [];
  const logs = [];
  const jobId = `t${++jobSeq}`;
  const promise = ytdlp.download(URL, { jobId, ...options }, (p) => progress.push(p), (l) => logs.push(l));
  return { promise, progress, logs, jobId };
}

test('parses progress, scales the video and audio passes, and resolves with the moved file', async () => {
  const { promise, progress, logs } = run({
    steps: [
      { out: 'YTDLP_PROGRESS  10.0%|1.00MiB/s|00:30' },
      { out: 'YTDLP_PROGRESS 100.0%|1.00MiB/s|00:00' },
      { out: 'YTDLP_PROGRESS   5.0%|2.00MiB/s|00:05' },
      { out: 'YTDLP_PROGRESS 100.0%|2.00MiB/s|00:00' },
      { out: '[Merger] Merging formats into "/x/video.mp4"' },
      { out: 'FILEPATH /x/video.mp4' },
    ],
  });
  const result = await promise;

  assert.equal(result.filepath, '/x/video.mp4');
  assert.equal(result.stoppedByUser, false);
  assert.equal(result.completedWithErrors, false);
  assert.deepEqual(progress.map((p) => p.percent), [8.5, 85, 85.7, 98, 99]);
  assert.deepEqual(progress.map((p) => p.stage), [
    'Downloading video…', 'Processing video stream…', 'Downloading audio…', 'Merging streams…', 'Merging formats…',
  ]);
  assert.equal(progress[0].speed, '1.00MiB/s');
  assert.equal(progress[0].eta, '00:30');
  assert.ok(logs.includes('[destination] /x/video.mp4'));
});

test('audio-only downloads report a single pass on the raw percentage', async () => {
  const { promise, progress } = run({
    steps: [{ out: 'YTDLP_PROGRESS  40.0%|1MiB/s|00:03' }, { out: '[ExtractAudio] Destination: a.mp3' }, { out: 'FILEPATH /x/a.mp3' }],
  }, { audioOnly: true });
  await promise;
  assert.deepEqual(progress.map((p) => [p.percent, p.stage]), [[40, 'Downloading audio…'], [99, 'Extracting audio…']]);
});

test('handles carriage-return updates, thread prefixes and native [download] lines', async () => {
  const { promise, progress } = run({
    steps: [
      { raw: 'YTDLP_PROGRESS  20.0%|1MiB/s|00:04\rYTDLP_PROGRESS  30.0%|1MiB/s|00:03\r\n' },
      { out: '1: YTDLP_PROGRESS  40.0%|1MiB/s|00:02' },
      { out: '[download]  50.0% of ~ 10.00MiB at 2.00MiB/s ETA 00:02' },
      { out: 'FILEPATH /x/v.mp4' },
    ],
  }, { audioOnly: true });
  await promise;
  assert.deepEqual(progress.map((p) => p.percent), [20, 30, 40, 50]);
  assert.equal(progress[3].speed, '2.00MiB/s');
});

test('post-processing ticks map onto 90–99% with an estimated ETA', async () => {
  const { promise, progress } = run({
    steps: [
      { out: 'YTDLP_POSTPROCESS 0.0%' },
      { sleep: 50 },
      { out: 'YTDLP_POSTPROCESS 50.0%' },
      { out: 'FILEPATH /x/v.mp4' },
    ],
  });
  await promise;
  assert.deepEqual(progress.map((p) => p.percent), [90, 94.5]);
  assert.equal(progress[0].stage, 'Post-processing recording…');
  assert.equal(progress[0].eta, null);
  assert.match(progress[1].eta, /^\d+s$/);
});

test('a non-zero exit rejects with the de-duplicated error output', async () => {
  const { promise, logs } = run({
    steps: [
      { err: 'ERROR: [youtube] aaaaaaaaaaa: Video unavailable' },
      { err: 'ERROR: [youtube] aaaaaaaaaaa: Video unavailable' },
    ],
    exit: 1,
  });
  await assert.rejects(promise, { message: 'ERROR: [youtube] aaaaaaaaaaa: Video unavailable (×2)' });
  assert.ok(logs.some((l) => l.startsWith('[failed] Exit code 1')));
});

test('a non-zero exit with no output still rejects with the exit code', async () => {
  await assert.rejects(run({ exit: 3 }).promise, { message: 'yt-dlp exited with code 3' });
});

test('a non-zero exit after the file was moved into place keeps the file', async () => {
  const file = path.join(sandbox, 'saved.mp4');
  fs.writeFileSync(file, 'x');
  const { promise } = run({
    steps: [{ err: 'ERROR: fragment 12 not found' }, { out: `FILEPATH ${file}` }],
    exit: 1,
  });
  const result = await promise;
  assert.equal(result.completedWithErrors, true);
  assert.equal(result.filepath, file);
});

test('stopDownload sends SIGINT and the job resolves as stopped by the user', async () => {
  const { promise, progress, jobId } = run({
    steps: [{ out: 'YTDLP_PROGRESS  10.0%|1MiB/s|00:30' }],
    heartbeat: true,
    onSigint: { out: 'FILEPATH /x/live.mp4', exit: 1 },
  }, { isLive: true });
  // Wait for the process to start printing before stopping it.
  while (progress.length === 0) await new Promise((r) => setTimeout(r, 10));

  assert.equal(ytdlp.stopDownload(jobId), true);
  const result = await promise;
  assert.equal(result.stoppedByUser, true);
  assert.equal(result.filepath, '/x/live.mp4');
  assert.ok(progress.some((p) => p.stage === 'Finalizing recording…'));
  assert.equal(ytdlp.stopDownload(jobId), false, 'nothing left to stop');
});

test('the idle watchdog kills a download that prints nothing', async () => {
  const { promise, logs } = run({ steps: [{ out: '[youtube] Extracting URL' }], hang: true });
  await assert.rejects(promise, /Download stalled: no output/);
  assert.ok(logs.some((l) => /terminating as hung/.test(l)));
});

test('a private/local URL is refused before anything is spawned', async () => {
  process.env.FAKE_YTDLP = '{}';
  await assert.rejects(ytdlp.download('http://127.0.0.1/x', { jobId: 'local' }), /./);
});

test('a missing binary rejects instead of hanging', async () => {
  // Spawn errors arrive asynchronously; point at a path that doesn't exist via a fresh load.
  const { spawnSync } = require('child_process');
  const script = `
    process.env.YTDLP_BIN = ${JSON.stringify(path.join(sandbox, 'no-such-yt-dlp'))};
    process.env.CONFIG_DIR = ${JSON.stringify(path.join(sandbox, 'config2'))};
    const ytdlp = require(${JSON.stringify(require.resolve('../../src/services/ytdlp'))});
    ytdlp.download(${JSON.stringify(URL)}, { jobId: 'missing' }).then(
      () => { console.log('RESOLVED'); process.exit(0); },
      (e) => { console.log('REJECTED ' + e.code); process.exit(0); });
  `;
  const out = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.match(out.stdout, /REJECTED ENOENT/);
});
