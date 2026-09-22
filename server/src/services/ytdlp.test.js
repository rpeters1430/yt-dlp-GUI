const test = require('node:test');
const assert = require('node:assert/strict');
const { isPlaylistUrl } = require('./ytdlp');

test('isPlaylistUrl detects playlist URLs across supported URL forms', () => {
  assert.equal(isPlaylistUrl('https://www.youtube.com/playlist?list=PL123'), true);
  assert.equal(isPlaylistUrl('www.youtube.com/playlist?list=PL123'), true);
  assert.equal(isPlaylistUrl('//www.youtube.com/playlist?list=PL123'), true);
  assert.equal(isPlaylistUrl('https://youtu.be/abc123?list=PL123'), true);
});

test('isPlaylistUrl does not treat arbitrary list query params as playlist', () => {
  assert.equal(isPlaylistUrl('https://example.com/watch?list=abc123'), false);
  assert.equal(isPlaylistUrl('https://www.youtube.com/watch?v=abc123'), false);
});

test('getDenoBin resolves binary name correctly', () => {
  const { getDenoBin } = require('./ytdlp');
  const bin = getDenoBin();
  assert.ok(typeof bin === 'string' && bin.length > 0);
});

test('getVersions returns deno version property', async () => {
  const { getVersions } = require('./ytdlp');
  const versions = await getVersions();
  assert.ok('deno' in versions);
  assert.ok('node' in versions);
});

test('dependencyUpdater exports updateDenoNightly function', () => {
  const updater = require('./dependencyUpdater');
  assert.equal(typeof updater.updateDenoNightly, 'function');
});
