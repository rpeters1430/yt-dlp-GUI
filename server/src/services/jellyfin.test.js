const test = require('node:test');
const assert = require('node:assert/strict');
const jellyfin = require('./jellyfin');

test('Jellyfin service loads with playlist sync helpers exported', () => {
  assert.equal(typeof jellyfin.addPlaylistItems, 'function');
  assert.equal(typeof jellyfin.getPlaylistItemIds, 'function');
});

test('addPlaylistItems posts item IDs to the playlist endpoint', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  let requestedUrl;
  let requestInit;
  global.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestInit = init;
    return { ok: true, status: 204, statusText: 'No Content' };
  };

  await jellyfin.addPlaylistItems('http://jellyfin.local', 'api-key', 'user id', 'playlist/id', ['item-1', 'item-2']);

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, '/Playlists/playlist%2Fid/Items');
  assert.equal(url.searchParams.get('ids'), 'item-1,item-2');
  assert.equal(url.searchParams.get('userId'), 'user id');
  assert.equal(requestInit.method, 'POST');
  assert.equal(requestInit.body, undefined);
});

test('addPlaylistItems skips empty item lists', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error('fetch should not be called'); };

  await jellyfin.addPlaylistItems('http://jellyfin.local', 'api-key', 'user', 'playlist', []);
});
