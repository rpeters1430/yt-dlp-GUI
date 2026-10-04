const test = require('node:test');
const assert = require('node:assert/strict');
const plex = require('./plex');

function mockFetch(t, handler) {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    const body = handler(new URL(String(url)), init);
    return {
      ok: true,
      status: body === null ? 204 : 200,
      statusText: 'OK',
      text: async () => (body === null ? '' : JSON.stringify(body)),
    };
  };
  return calls;
}

const SECTIONS = {
  MediaContainer: {
    Directory: [
      { key: '1', title: 'YouTube', type: 'movie', Location: [{ path: '/data/youtube' }] },
      { key: '2', title: 'Shows', type: 'show' },
      { key: '3', title: 'Music', type: 'artist' },
      { key: '4', title: 'Photos', type: 'photo' },
    ],
  },
};

test('getLibraryIndex maps file basenames to rating keys and collects played files', async (t) => {
  const calls = mockFetch(t, (url) => {
    if (url.pathname === '/library/sections') return SECTIONS;
    if (url.pathname === '/library/sections/1/all') {
      return { MediaContainer: { totalSize: 2, Metadata: [
        { ratingKey: 10, viewCount: 1, Media: [{ Part: [{ file: '/data/youtube/Chan/Video A [abc].mp4' }] }] },
        { ratingKey: 11, Media: [{ Part: [{ file: '/data/youtube/Chan/Video B [def].mp4' }] }] },
      ] } };
    }
    if (url.pathname === '/library/sections/2/all') return { MediaContainer: { totalSize: 0, Metadata: [] } };
    throw new Error(`unexpected ${url}`);
  });

  const { byBasename, played } = await plex.getLibraryIndex('plex.local:32400', 'tok');

  assert.equal(byBasename.get('Video A [abc].mp4'), '10');
  assert.equal(byBasename.get('Video B [def].mp4'), '11');
  assert.deepEqual([...played], ['Video A [abc].mp4']);
  // Movie and show libraries only; music and photos skipped. Show libraries list episodes.
  const listed = calls.filter((c) => c.url.pathname.endsWith('/all'));
  assert.deepEqual(listed.map((c) => c.url.pathname), ['/library/sections/1/all', '/library/sections/2/all']);
  assert.equal(listed[1].url.searchParams.get('type'), '4');
  assert.equal(calls[0].url.origin, 'http://plex.local:32400');
  assert.equal(calls[0].init.headers['X-Plex-Token'], 'tok');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
});

test('getTargetSections honours an explicit section list and music mode', async (t) => {
  mockFetch(t, () => SECTIONS);
  const explicit = await plex.getTargetSections('http://plex', 'tok', { sectionIds: '3, 4' });
  assert.deepEqual(explicit.map((s) => s.id), ['3', '4']);
  const music = await plex.getTargetSections('http://plex', 'tok', { includeAudio: true });
  assert.deepEqual(music.map((s) => s.id), ['3']);
});

test('createPlaylist sends a server:// uri and chunks extra items into follow-up adds', async (t) => {
  const calls = mockFetch(t, (url, init) => {
    if (init.method === 'POST') return { MediaContainer: { Metadata: [{ ratingKey: 99 }] } };
    return null;
  });

  const keys = Array.from({ length: 150 }, (_, i) => String(i + 1));
  const id = await plex.createPlaylist('http://plex', 'tok', 'MID', 'My Watch', keys);

  assert.equal(id, '99');
  assert.equal(calls.length, 2);
  const create = calls[0];
  assert.equal(create.init.method, 'POST');
  assert.equal(create.url.pathname, '/playlists');
  assert.equal(create.url.searchParams.get('type'), 'video');
  assert.equal(create.url.searchParams.get('title'), 'My Watch');
  assert.match(create.url.searchParams.get('uri'), /^server:\/\/MID\/com\.plexapp\.plugins\.library\/library\/metadata\/1,2,/);
  const add = calls[1];
  assert.equal(add.init.method, 'PUT');
  assert.equal(add.url.pathname, '/playlists/99/items');
  assert.match(add.url.searchParams.get('uri'), /metadata\/101,102,.*,150$/);
});

test('getPlaylistItemKeys returns null when the playlist was deleted in Plex', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
  assert.equal(await plex.getPlaylistItemKeys('http://plex', 'tok', '5'), null);
});

test('a rejected token surfaces a clear error', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
  await assert.rejects(plex.getSections('http://plex', 'bad'), /rejected the token/);
});

test('fileBasename handles paths from a Windows-hosted Plex server', () => {
  assert.equal(plex.fileBasename('C:\\Media\\YouTube\\Chan\\Video A [abc].mp4'), 'Video A [abc].mp4');
  assert.equal(plex.fileBasename('/data/youtube/Chan/Video B.mp4'), 'Video B.mp4');
});

test('getPlaylistItemKeys pages through large playlists', async (t) => {
  const calls = mockFetch(t, (url) => {
    const start = Number(url.searchParams.get('X-Plex-Container-Start'));
    const size = Number(url.searchParams.get('X-Plex-Container-Size'));
    const total = 5;
    const Metadata = [];
    for (let i = start; i < Math.min(start + size, total); i++) Metadata.push({ ratingKey: i + 1 });
    return { MediaContainer: { totalSize: total, Metadata } };
  });
  const keys = await plex.getPlaylistItemKeys('http://plex', 'tok', '7', { pageSize: 2 });
  assert.deepEqual([...keys], ['1', '2', '3', '4', '5']);
  assert.equal(calls.length, 3);
});

test('findPlaylistByName skips playlists already owned by another watch', async (t) => {
  mockFetch(t, () => ({ MediaContainer: { Metadata: [
    { ratingKey: 1, title: 'Same Name' },
    { ratingKey: 2, title: 'Same Name' },
    { ratingKey: 3, title: 'Same Name', smart: true },
  ] } }));
  assert.equal(await plex.findPlaylistByName('http://plex', 'tok', 'Same Name'), '1');
  assert.equal(await plex.findPlaylistByName('http://plex', 'tok', 'Same Name', { excludeIds: ['1'] }), '2');
  assert.equal(await plex.findPlaylistByName('http://plex', 'tok', 'Same Name', { excludeIds: ['1', '2'] }), null);
});
