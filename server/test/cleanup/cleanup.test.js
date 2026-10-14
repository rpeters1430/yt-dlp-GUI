// Auto-delete deletes real files, so its rules and protections get pinned down here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadQueue } = require('../helpers/queueHarness');

const SRC = path.join(__dirname, '..', '..', 'src', 'services');

function setup(t, settings = {}) {
  const q = loadQueue(t);
  const cleanup = require(path.join(SRC, 'cleanup'));
  const jellyfin = require(path.join(SRC, 'jellyfin'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-cleanup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const setSetting = q.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(settings)) setSetting.run(key, String(value));

  const addWatch = (name, { exempt = 0 } = {}) =>
    q.db.prepare('INSERT INTO watches (url, name, cleanup_exempt) VALUES (?, ?, ?)')
      .run(`https://www.youtube.com/@${name}`, name, exempt).lastInsertRowid;

  // A completed download with a real file on disk, created `daysAgo` days back.
  function addDownload(id, { watchId, daysAgo = 0, protectedFlag = 0, file = `${id}.mp4`, status = 'completed' } = {}) {
    const filepath = path.join(dir, file);
    fs.writeFileSync(filepath, 'media');
    const created = new Date(Date.now() - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    q.db.prepare(`
      INSERT INTO downloads (id, url, status, title, filepath, watch_id, protected, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, `https://www.youtube.com/watch?v=${id}`, status, `Video ${id}`, filepath, watchId ?? null, protectedFlag, created);
    return filepath;
  }

  return { q, cleanup, jellyfin, dir, addWatch, addDownload };
}

const ids = (list) => list.map((d) => d.id).sort();

test('the age rule only targets old, completed, watch-triggered downloads', async (t) => {
  const s = setup(t, { cleanup_age_enabled: 1, cleanup_age_days: 30 });
  const w = s.addWatch('chan');
  s.addDownload('old', { watchId: w, daysAgo: 40 });
  s.addDownload('new', { watchId: w, daysAgo: 5 });
  s.addDownload('manual-old', { daysAgo: 400 }); // queued by hand: never auto-deleted
  s.addDownload('old-failed', { watchId: w, daysAgo: 40, status: 'failed' });

  const plan = await s.cleanup.computeCleanupPlan();
  assert.deepEqual(ids(plan.toDelete), ['old']);
  assert.deepEqual(plan.toDelete[0].matchedReasons, ['older than 30d']);
  assert.equal(plan.toDelete[0].watchName, 'chan');
  assert.equal(plan.checked, 2);
});

test('protected videos, exempt watches and the newest N per watch are kept', async (t) => {
  const s = setup(t, { cleanup_age_enabled: 1, cleanup_age_days: 1, cleanup_keep_recent: 1 });
  const w1 = s.addWatch('one');
  const w2 = s.addWatch('two', { exempt: 1 });
  s.addDownload('w1-newest', { watchId: w1, daysAgo: 2 });
  s.addDownload('w1-older', { watchId: w1, daysAgo: 3 });
  s.addDownload('w1-protected', { watchId: w1, daysAgo: 4, protectedFlag: 1 });
  s.addDownload('w2-any', { watchId: w2, daysAgo: 9 });

  const plan = await s.cleanup.computeCleanupPlan();
  assert.deepEqual(ids(plan.toDelete), ['w1-older']);
  const kept = Object.fromEntries(plan.toKeep.map((d) => [d.id, d.protectedReason]));
  assert.deepEqual(kept, {
    'w1-newest': 'newest 1 for this watch',
    'w1-protected': 'video marked protected',
    'w2-any': 'watch excluded from auto-delete',
  });
});

test('a download whose watch was deleted stays eligible', async (t) => {
  const s = setup(t, { cleanup_age_enabled: 1, cleanup_age_days: 1 });
  s.addDownload('orphan', { watchId: 999, daysAgo: 5 });
  const plan = await s.cleanup.computeCleanupPlan();
  assert.deepEqual(ids(plan.toDelete), ['orphan']);
  assert.equal(plan.toDelete[0].watchName, null);
});

test('the Jellyfin rule deletes watched files, and a Jellyfin error deletes nothing by it', async (t) => {
  const s = setup(t, { cleanup_jellyfin_enabled: 1, jellyfin_url: 'http://jf.local', jellyfin_api_key: 'k' });
  const w = s.addWatch('chan');
  s.addDownload('watched', { watchId: w });
  s.addDownload('unwatched', { watchId: w });

  const played = t.mock.method(s.jellyfin, 'getPlayedBasenames', async () => new Set(['watched.mp4']));
  let plan = await s.cleanup.computeCleanupPlan();
  assert.deepEqual(ids(plan.toDelete), ['watched']);
  assert.deepEqual(plan.toDelete[0].matchedReasons, ['watched in Jellyfin']);
  assert.deepEqual(played.mock.calls[0].arguments, ['http://jf.local', 'k', null]);

  played.mock.mockImplementation(async () => { throw new Error('401'); });
  plan = await s.cleanup.computeCleanupPlan();
  assert.deepEqual(plan.toDelete, []);
  assert.equal(plan.jellyfinError, '401');
});

test('deleting removes the media file, its sidecars and subtitles, but not a sibling file’s', (t) => {
  const s = setup(t);
  const w = s.addWatch('chan');
  const media = s.addDownload('v', { watchId: w, file: 'Show.mp4' });
  const own = ['Show.nfo', 'Show.jpg', 'Show.en.vtt', 'Show.srt'].map((n) => path.join(s.dir, n));
  const sibling = ['Show.part2.mp4', 'Show.part2.en.vtt'].map((n) => path.join(s.dir, n));
  for (const f of [...own, ...sibling]) fs.writeFileSync(f, 'x');

  assert.equal(s.cleanup.deleteDownloadFile('v', media, 'Show', 'test'), true);
  for (const f of [media, ...own]) assert.equal(fs.existsSync(f), false, `${path.basename(f)} removed`);
  for (const f of sibling) assert.equal(fs.existsSync(f), true, `${path.basename(f)} kept`);

  const row = s.q.db.prepare('SELECT status, filepath FROM downloads WHERE id = ?').get('v');
  assert.deepEqual({ ...row }, { status: 'deleted', filepath: null });
});

test('deleting a split recording removes every part', (t) => {
  const s = setup(t);
  const w = s.addWatch('chan');
  const first = s.addDownload('live', { watchId: w, file: 'stream_part1.mp4' });
  const second = path.join(s.dir, 'stream_part2.mp4');
  fs.writeFileSync(second, 'x');
  fs.writeFileSync(path.join(s.dir, 'stream_part2.nfo'), 'x');
  s.q.db.prepare('UPDATE downloads SET split_parts = ? WHERE id = ?').run(JSON.stringify([first, second]), 'live');

  assert.equal(s.cleanup.deleteDownloadFile('live', first, 'Stream', 'test'), true);
  assert.deepEqual(fs.readdirSync(s.dir), []);
});

test('runCleanup is a no-op while every rule is off, and deletes the plan when on', async (t) => {
  const s = setup(t);
  const w = s.addWatch('chan');
  const file = s.addDownload('old', { watchId: w, daysAgo: 90 });

  assert.deepEqual(await s.cleanup.runCleanup(), { deleted: 0, checked: 0, kept: 0 });
  assert.equal(fs.existsSync(file), true);

  s.q.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cleanup_age_enabled', '1')").run();
  assert.deepEqual(await s.cleanup.runCleanup(), { deleted: 1, checked: 1, kept: 0 });
  assert.equal(fs.existsSync(file), false);
});

test('a deletion announces the updated row and counts over the socket', (t) => {
  const s = setup(t);
  s.q.queue.init(s.q.io);
  s.cleanup.init(s.q.io);
  const w = s.addWatch('chan');
  const file = s.addDownload('v', { watchId: w });
  s.cleanup.deleteDownloadFile('v', file, 'V', 'test');
  const update = s.q.io.of('job:update').find((j) => j.id === 'v');
  assert.equal(update.status, 'deleted');
  assert.ok(!('log' in update));
  assert.equal(s.q.io.of('jobs:counts').at(-1).deleted, 1);
});

test('runDbMaintenance prunes old watch_runs past the per-watch keep limit and removes expired sessions', (t) => {
  const s = setup(t);
  const w = s.addWatch('chan');
  const oldTime = new Date(Date.now() - 45 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const insertRun = s.q.db.prepare(
    "INSERT INTO watch_runs (watch_id, trigger, status, started_at, finished_at) VALUES (?, 'scheduled', 'completed', ?, ?)"
  );
  for (let i = 0; i < 15; i++) insertRun.run(w, oldTime, oldTime);

  s.q.db.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, expired NUMERIC, sess TEXT)');
  s.q.db.prepare('INSERT INTO sessions (sid, expired, sess) VALUES (?, ?, ?)').run('expired-1', Date.now() - 10000, '{}');
  s.q.db.prepare('INSERT INTO sessions (sid, expired, sess) VALUES (?, ?, ?)').run('valid-1', Date.now() + 60000, '{}');

  const maint = s.cleanup.runDbMaintenance({ maxRunsPerWatch: 10, maxRunAgeDays: 30 });
  assert.equal(maint.prunedRuns, 5);
  assert.equal(maint.expiredSessions, 1);
  assert.equal(s.q.db.prepare('SELECT COUNT(*) AS c FROM watch_runs WHERE watch_id = ?').get(w).c, 10);
  assert.equal(s.q.db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);
});
