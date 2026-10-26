import test from 'node:test';
import assert from 'node:assert/strict';
import {musicTrackKey} from './musicTracks.js';
test('a manual match or selection for disc one cannot affect disc two', () => {
  const one = {discNumber:1,trackNumber:1}, two = {discNumber:2,trackNumber:1};
  const selected = new Set([musicTrackKey(one)]);
  const matches = {[musicTrackKey(one)]: 'source-one'};
  assert.equal(selected.has(musicTrackKey(two)), false);
  assert.equal(matches[musicTrackKey(two)], undefined);
  assert.equal(musicTrackKey({trackNumber:1}), musicTrackKey(one));
});
