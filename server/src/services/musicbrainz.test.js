const test = require('node:test');
const assert = require('node:assert/strict');
const mb = require('./musicbrainz');
const releaseId = '12345678-1234-1234-1234-123456789012';
const credit = (name, id) => [{ name, artist: { id, name, 'sort-name': `${name}, Sort` } }];
const release = { id: releaseId, title: 'Album', date: '2020-05-02', country: 'US', status: 'Official',
  disambiguation: 'Deluxe', 'artist-credit': credit('Band', 'band-id'),
  'release-group': { id: 'group-id', 'first-release-date': '1999-01-01', 'primary-type': 'Album' },
  'label-info': [{label: { name: 'Label' }}], media: [
    {position: 1, 'track-count': 2, tracks: [1, 2].map(n => ({id: `d1t${n}`, position:n, title:`Song ${n}`, length:200000, recording:{id:`rec${n}`}}))},
    {position: 2, 'track-count': 1, tracks: [{id:'d2t1', position:1, title:'Guest Song', 'artist-credit': credit('Guest', 'guest-id'), recording:{id:'rec3'}}]},
  ] };

test('normalizes release identity, credits, dates and per-disc totals without conflating recordings and tracks', () => {
  const {album, tracks} = mb.normalizeRelease(release);
  assert.equal(album.edition, 'Deluxe');
  assert.equal(tracks[0].totalTracks, 2);
  assert.equal(tracks[2].totalTracks, 1);
  assert.equal(tracks[2].totalDiscs, 2);
  assert.equal(tracks[2].artist, 'Guest');
  assert.equal(tracks[2].albumArtist, 'Band');
  assert.equal(tracks[2].musicbrainzRecordingId, 'rec3');
  assert.equal(tracks[2].musicbrainzReleaseTrackId, 'd2t1');
  assert.equal(tracks[2].musicbrainzReleaseId, releaseId);
  assert.equal(tracks[2].originalDate, '1999-01-01');
  assert.equal(tracks[2].date, '2020-05-02');
});

test('rejects invalid release IDs and incomplete tracklists', async () => {
  await assert.rejects(mb.getRelease('../bad'), /Invalid MusicBrainz release/);
  assert.throws(() => mb.normalizeRelease({...release, media:[{position:1, 'track-count':3, tracks:[]}]}), /incomplete/i);
});

test('search uses identified public MusicBrainz client and caches repeated queries', async t => {
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(new URL(url).hostname, 'musicbrainz.org');
    assert.match(options.headers['User-Agent'], /yt-dlp-GUI/);
    return {ok:true, json:async()=>({releases:[release]})};
  });
  const items = await mb.searchReleases('Band Album');
  assert.equal(items[0].id, `mb-${releaseId}`);
  assert.equal(items[0].artist, 'Band');
  assert.equal((await mb.searchReleases('Band Album'))[0].id, items[0].id);
  assert.equal(global.fetch.mock.callCount(), 1);
});
