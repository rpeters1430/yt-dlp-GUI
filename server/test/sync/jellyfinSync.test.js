const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { openFreshDb } = require('../helpers/queueHarness');

const SRC = path.join(__dirname, '..', '..', 'src');

test('a sync-all run reads the Jellyfin library once for every watch', async (t) => {
  const { db } = openFreshDb(t);
  const jellyfin = require(path.join(SRC, 'services', 'jellyfin'));
  const jellyfinSync = require(path.join(SRC, 'services', 'jellyfinSync'));
  for (const [key, value] of [['jellyfin_sync_enabled', '1'], ['jellyfin_url', 'http://jf'], ['jellyfin_api_key', 'k'], ['jellyfin_user_id', 'u']]) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
  for (const id of [1, 2]) {
    db.prepare("INSERT INTO watches (id, url, name) VALUES (?, ?, ?)").run(id, `https://www.youtube.com/@c${id}`, `Watch ${id}`);
    db.prepare("INSERT INTO downloads (id, url, status, watch_id, filepath) VALUES (?, 'x', 'completed', ?, ?)").run(`d${id}`, id, `/v/${id}.mp4`);
  }
  t.mock.method(jellyfin, 'resolveUserId', async () => 'u');
  const library = t.mock.method(jellyfin, 'getLibraryItemsByBasename', async () => new Map([['1.mp4', 'i1'], ['2.mp4', 'i2']]));
  t.mock.method(jellyfin, 'findPlaylistByName', async () => null);
  t.mock.method(jellyfin, 'createPlaylist', async () => 'p');
  t.mock.method(jellyfin, 'getPlaylistItemIds', async () => []);
  t.mock.method(jellyfin, 'addPlaylistItems', async () => {});

  const { results } = await jellyfinSync.syncAllWatches();
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => !r.error), JSON.stringify(results));
  assert.equal(library.mock.callCount(), 1);
});
