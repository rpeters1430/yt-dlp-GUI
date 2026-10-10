const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const liveSplitter = require('./liveSplitter');

const TEST_DIR = path.join(__dirname, '..', '..', 'temp_test_splitter');

describe('liveSplitter service', () => {
  before(() => {
    if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('formats durations correctly', () => {
    assert.equal(liveSplitter.formatDuration(45), '45s');
    assert.equal(liveSplitter.formatDuration(150), '2m 30s');
    assert.equal(liveSplitter.formatDuration(3665), '1h 1m 5s');
  });

  test('probes file duration and splits a video into chunks', async () => {
    const inputVideo = path.join(TEST_DIR, 'broadcast_stream.mp4');
    // Generate a 6-second test video
    const ffmpegBin = liveSplitter.getFfmpegBin();
    const gen = spawnSync(ffmpegBin, [
      '-f', 'lavfi', '-i', 'testsrc=duration=6:size=320x240:rate=1',
      '-c:v', 'libx264',
      '-g', '2',
      '-y', inputVideo,
    ]);
    assert.equal(gen.status, 0, 'Generated test video');

    // Probe duration
    const duration = await liveSplitter.probeDuration(inputVideo);
    assert.ok(duration >= 5.5 && duration <= 6.5, `Duration was ${duration}`);

    // If chunk size is 1 minute (60s), it should NOT split since duration (6s) < 60s
    const logs = [];
    const noSplitResult = await liveSplitter.splitRecording(inputVideo, 1, (msg) => logs.push(msg));
    assert.equal(noSplitResult.split, false);
    assert.equal(noSplitResult.reason, 'within_limit');
    assert.equal(fs.existsSync(inputVideo), true);

    // If chunk size is 0.05 min (3 seconds):
    const splitLogs = [];
    const splitResult = await liveSplitter.splitRecording(inputVideo, 0.05, (msg) => splitLogs.push(msg));
    assert.equal(splitResult.split, true);
    assert.ok(splitResult.files.length >= 2, 'Should create at least 2 part files');
    assert.equal(fs.existsSync(inputVideo), false, 'Original unsplit file should be removed');
    for (const file of splitResult.files) {
      assert.ok(fs.existsSync(file), `Part file exists: ${file}`);
      assert.ok(fs.statSync(file).size > 0, `Part file is non-empty: ${file}`);
    }
  });

  test('splitRecording rejects non-existent files', async () => {
    await assert.rejects(
      () => liveSplitter.splitRecording(path.join(TEST_DIR, 'nonexistent.mp4'), 30),
      /File does not exist/
    );
  });
});
