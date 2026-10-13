const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMusicTags, buildMetadataBlockPicture, searchAlbums } = require('./music');

test('buildMusicTags maps iTunes metadata to ffmpeg tag names and skips blanks', () => {
  assert.deepEqual(buildMusicTags({
    title: 'Song', artist: 'Artist', album: 'Album', trackNumber: 3, totalTracks: 12,
    discNumber: 1, totalDiscs: 2, year: '2020', genre: '',
  }), {
    title: 'Song', artist: 'Artist', album_artist: 'Artist', album: 'Album',
    track: '3/12', disc: '1/2', date: '2020',
  });
});

test('buildMetadataBlockPicture encodes a FLAC front-cover picture block', () => {
  const data = Buffer.from([1, 2, 3]);
  const block = Buffer.from(buildMetadataBlockPicture({ data, mime: 'image/jpeg' }), 'base64');
  assert.equal(block.readUInt32BE(0), 3);
  assert.equal(block.readUInt32BE(4), 'image/jpeg'.length);
  assert.deepEqual(block.subarray(block.length - 3), data);
  assert.equal(block.readUInt32BE(block.length - 7), 3);
});

test('searchAlbums can return keyword results without searching or enriching an artist', async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ results: [] }) };
  };

  try {
    const result = await searchAlbums('Incubus 8', 50, { includeArtist: false });
    assert.equal(urls.length, 1);
    assert.match(urls[0], /entity=album/);
    assert.equal(result.matchedArtist, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('scoreCandidate matches flag words whole and penalises other songs', () => {
  const { scoreCandidate } = require('./music');
  const studio = scoreCandidate({ title: 'Life Goes On', uploader: 'Oliver Tree - Topic', duration: 160 }, 'Oliver Tree', 'Life Goes On', 160);
  const live = scoreCandidate({ title: 'Life Goes On (Live)', uploader: 'Oliver Tree', duration: 160 }, 'Oliver Tree', 'Life Goes On', 160);
  assert.ok(studio > live);
  // "Discover" and "Alive" are not "cover" and "live".
  assert.ok(scoreCandidate({ title: 'Discover Alive', uploader: 'X - Topic', duration: 200 }, 'X', 'Alive', 200) >= 140);
  // Same artist's Topic channel, same length, different song.
  const right = scoreCandidate({ title: 'Wish You Were Here', uploader: 'Incubus - Topic', duration: 210 }, 'Incubus', 'Wish You Were Here', 210);
  const wrong = scoreCandidate({ title: 'Nice to Know You', uploader: 'Incubus - Topic', duration: 211 }, 'Incubus', 'Wish You Were Here', 210);
  assert.ok(right - wrong >= 80);
  // A featured artist in the iTunes title doesn't count as a different song.
  const feat = scoreCandidate({ title: 'Song Name', uploader: 'A - Topic', duration: 180 }, 'A', 'Song Name (feat. B)', 180);
  assert.ok(feat >= 115);
});

test('getAlbumDetails requests all multi-disc tracks and rejects truncated metadata', async (t) => {
  const { getAlbumDetails } = require('./music');
  let count = 60;
  t.mock.method(global, 'fetch', async (url) => {
    assert.match(url, /entity=song&limit=200/);
    return { ok: true, json: async () => ({ results: [
      { wrapperType: 'collection', collectionName: 'Compilation', artistName: 'Artist', trackCount: 60, discCount: 2 },
      ...Array.from({ length: count }, (_, i) => ({
        wrapperType: 'track', trackName: `Song ${i + 1}`, trackNumber: i % 30 + 1, discNumber: i < 30 ? 1 : 2,
      })),
    ] }) };
  });
  const details = await getAlbumDetails(1);
  assert.equal(details.tracks.length, 60);
  assert.equal(details.tracks[30].discNumber, 2);
  count = 50;
  await assert.rejects(getAlbumDetails(1), /Album track list incomplete/);
});
