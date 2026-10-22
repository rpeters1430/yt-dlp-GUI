import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEta, parseEta, parseSpeed, smoothDownloadStats } from './downloadStats.js';

test('parses yt-dlp speed units and ETAs', () => {
  assert.equal(parseSpeed('1.5 MiB/s'), 1.5 * 1024 * 1024);
  assert.equal(parseSpeed('2 MB/s'), 2_000_000);
  assert.equal(parseEta('02:15'), 135);
  assert.equal(parseEta('01:02:03'), 3723);
  assert.equal(parseSpeed('N/A'), null);
  assert.equal(parseEta('N/A'), null);
});

test('formats a stable speed and compact ETA', () => {
  assert.equal(formatEta(135), '02:15');
  assert.equal(formatEta(3723), '01:02:03');
});

test('smooths short-lived speed and ETA swings over time', () => {
  const first = smoothDownloadStats(null, {
    id: 'job-a', percent: 10, speed: '10 MiB/s', eta: '01:00',
  }, 1000);
  const next = smoothDownloadStats(first, {
    id: 'job-a', percent: 11, speed: '2 MiB/s', eta: '05:00',
  }, 2000);

  assert.ok(next.speedBps < first.speedBps);
  assert.ok(next.speedBps > 2 * 1024 * 1024, 'does not jump to one brief low sample');
  assert.ok(next.etaSeconds > first.etaSeconds);
  assert.ok(next.etaSeconds < 300, 'does not jump to one brief high ETA');
});

test('resets smoothing when a new job starts or progress restarts', () => {
  const first = smoothDownloadStats(null, {
    id: 'job-a', percent: 80, speed: '10 MiB/s', eta: '00:10',
  }, 1000);
  const newJob = smoothDownloadStats(first, {
    id: 'job-b', percent: 1, speed: '2 MiB/s', eta: '03:00',
  }, 1100);
  assert.equal(newJob.speed, '2.0 MiB/s');
  assert.equal(newJob.eta, '03:00');

  const restarted = smoothDownloadStats(first, {
    id: 'job-a', percent: 5, speed: '3 MiB/s', eta: '02:00',
  }, 1200);
  assert.equal(restarted.speed, '3.0 MiB/s');
  assert.equal(restarted.eta, '02:00');
});
