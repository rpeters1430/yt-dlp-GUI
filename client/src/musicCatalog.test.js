import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogRequests,catalogTrackId} from './musicCatalog.js';
test('switching to Apple rejects an older MusicBrainz response or error',()=>{
  const requests=createCatalogRequests(),musicbrainz=requests.start();
  requests.invalidate();
  const apple=requests.start();
  assert.equal(requests.isCurrent(musicbrainz),false);
  assert.equal(requests.isCurrent(apple),true);
});
test('Apple track identifiers are never treated as MusicBrainz identifiers',()=>{
  const track={catalogTrackId:'123',musicbrainzReleaseTrackId:'mb-track'};
  assert.equal(catalogTrackId(track,'itunes'),'123');
  assert.equal(catalogTrackId(track,'musicbrainz'),'mb-track');
});
