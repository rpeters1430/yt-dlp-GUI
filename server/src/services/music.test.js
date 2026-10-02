const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMusicTags, buildMetadataBlockPicture } = require('./music');

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
