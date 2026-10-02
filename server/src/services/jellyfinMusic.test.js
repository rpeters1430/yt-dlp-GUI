const test = require('node:test');
const assert = require('node:assert/strict');
const jellyfinMusic = require('./jellyfinMusic');

const albums = [
  { Id: 'a1', Name: 'Abbey Road', AlbumArtist: 'The Beatles', Artists: ['The Beatles'] },
  { Id: 'a2', Name: 'Random Access Memories', AlbumArtist: 'Daft Punk', Artists: ['Daft Punk'] },
];
const tracks = [
  { Id: 't1', Name: 'Come Together', Album: 'Abbey Road', AlbumArtist: 'The Beatles', Artists: ['The Beatles'], IndexNumber: 1, ParentIndexNumber: 1 },
  { Id: 't2', Name: 'Something', Album: 'Abbey Road', AlbumArtist: 'The Beatles', Artists: ['The Beatles'], IndexNumber: 2, ParentIndexNumber: 1 },
  { Id: 't3', Name: 'Get Lucky', Album: 'Random Access Memories', AlbumArtist: 'Daft Punk', Artists: ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'], IndexNumber: 8 },
  { Id: 't4', Name: 'Halo', Album: 'I Am... Sasha Fierce', AlbumArtist: 'Beyoncé', Artists: ['Beyoncé'], IndexNumber: 2 },
];
const index = jellyfinMusic.buildIndex(albums, tracks);

test('baseName drops edition noise from Apple-style names', () => {
  assert.equal(jellyfinMusic.baseName('Abbey Road (Remastered)'), 'abbey road');
  assert.equal(jellyfinMusic.baseName('Get Lucky (feat. Pharrell Williams & Nile Rodgers) - Single'), 'get lucky');
  assert.equal(jellyfinMusic.baseName('Something - 2019 Mix'), 'something');
  assert.equal(jellyfinMusic.baseName('Rock - Paper - Scissors'), 'rock paper scissors');
});

test('matchAlbum finds the album and its tracks regardless of edition suffixes', () => {
  const m = jellyfinMusic.matchAlbum(index, { artist: 'The Beatles', album: 'Abbey Road (2019 Remaster)' });
  assert.equal(m.album.id, 'a1');
  assert.deepEqual(m.tracks.map((t) => t.id).sort(), ['t1', 't2']);
});

test('matchAlbum requires a shared artist', () => {
  const m = jellyfinMusic.matchAlbum(index, { artist: 'Some Cover Band', album: 'Abbey Road' });
  assert.equal(m.album, null);
  assert.equal(m.tracks.length, 0);
});

test('matchTrack matches featured-artist credits and accents', () => {
  assert.equal(jellyfinMusic.matchTrack(index, { artist: 'Daft Punk feat. Pharrell Williams', title: 'Get Lucky (Radio Edit)' }).id, 't3');
  assert.equal(jellyfinMusic.matchTrack(index, { artist: 'Beyonce', title: 'Halo' }).id, 't4');
  assert.equal(jellyfinMusic.matchTrack(index, { artist: 'Beatles', title: 'Come Together' }).id, 't1');
  assert.equal(jellyfinMusic.matchTrack(index, { artist: 'The Beatles', title: 'Let It Be' }), null);
});

test('albumStatus reports complete, partial and missing releases', () => {
  assert.equal(jellyfinMusic.albumStatus(index, { artist: 'The Beatles', name: 'Abbey Road', trackCount: 2 }).status, 'complete');
  const partial = jellyfinMusic.albumStatus(index, { artist: 'The Beatles', name: 'Abbey Road', trackCount: 17 });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.ownedTracks, 2);
  assert.equal(jellyfinMusic.albumStatus(index, { artist: 'The Beatles', name: 'Revolver', trackCount: 14 }).status, 'missing');
});

test('albumStatus counts a single owned as part of an album', () => {
  const s = jellyfinMusic.albumStatus(index, { artist: 'Daft Punk', name: 'Get Lucky - Single', trackCount: 1 });
  assert.equal(s.status, 'complete');
});

test('getIndex pulls albums and songs through the API and caches them', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; jellyfinMusic.invalidate(); });

  const calls = [];
  global.fetch = async (url) => {
    const u = new URL(String(url));
    calls.push(u);
    const type = u.searchParams.get('IncludeItemTypes');
    const items = type === 'MusicAlbum' ? albums : tracks;
    const body = JSON.stringify({ Items: items, TotalRecordCount: items.length });
    return { ok: true, status: 200, text: async () => body };
  };

  const cfg = { url: 'http://jellyfin.local', apiKey: 'key', userId: '0123456789abcdef0123456789abcdef' };
  const built = await jellyfinMusic.getIndex(cfg);
  assert.equal(built.trackCount, tracks.length);
  assert.ok(calls.every((u) => u.pathname === `/Users/${cfg.userId}/Items` && u.searchParams.get('Recursive') === 'true'));
  assert.deepEqual(calls.map((u) => u.searchParams.get('IncludeItemTypes')).sort(), ['Audio', 'MusicAlbum']);

  await jellyfinMusic.getIndex(cfg);
  assert.equal(calls.length, 2, 'second lookup is served from cache');

  jellyfinMusic.invalidate();
  await jellyfinMusic.getIndex(cfg);
  assert.equal(calls.length, 4, 'invalidate forces a rebuild');
});
