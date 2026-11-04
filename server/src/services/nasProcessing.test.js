const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const nas = require('./nasProcessing');

test('work directory checks fail early for insufficient storage and leave live output untouched', t => {
  const previous = process.env.YTDLP_WORK_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-work-'));
  process.env.YTDLP_WORK_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.YTDLP_WORK_DIR;
    else process.env.YTDLP_WORK_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  t.mock.method(fs, 'statfsSync', () => ({ bavail: 100, bsize: 4096 }));
  assert.throws(() => nas.prepareWorkDirectory('/videos/%(title)s.mp4', { jobId: 'small' }), /Not enough free space/);
  assert.deepEqual(nas.workingPaths('/videos/file.mp4', { isLive: true }), { output: '/videos/file.mp4', args: [], directory: null });
  assert.throws(() => nas.workingPaths('/videos/file.mp4', { jobId: '../../escape' }), /Invalid work directory/);
});

test('successful work cleanup removes empty directories but preserves resumable partials', t => {
  const previous = process.env.YTDLP_WORK_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-work-clean-'));
  process.env.YTDLP_WORK_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.YTDLP_WORK_DIR;
    else process.env.YTDLP_WORK_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const work = path.join(root, 'test', 'videos');
  fs.mkdirSync(work, { recursive: true });
  const partial = path.join(work, 'video.mp4.part');
  fs.writeFileSync(partial, 'resume me');
  nas.cleanupEmptyWorkDirectory('/videos/video.mp4', { jobId: 'test' });
  assert.equal(fs.readFileSync(partial, 'utf8'), 'resume me');
  fs.unlinkSync(partial);
  nas.cleanupEmptyWorkDirectory('/videos/video.mp4', { jobId: 'test' });
  assert.equal(fs.existsSync(path.join(root, 'test')), false);
});
