const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEntries, scanToBoundary } = require('../../src/services/watch/discovery');

function fakePagedInfo(entries, calls) {
  return async (url, { playlistStart, playlistEnd }) => {
    calls.push([playlistStart, playlistEnd]);
    return { _type: 'playlist', entries: entries.slice(playlistStart - 1, playlistEnd) };
  };
}

const makeEntries = (n, prefix = 'new') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i + 1}`, title: `Video ${i + 1}`, url: `https://youtube.example/${i + 1}` }));

test('normalizeEntries walks nested tabs and drops duplicate IDs', () => {
  const info = {
    entries: [
      { entries: [{ id: 'a', title: 'A', duration: 61, upload_date: '20260901' }, { id: 'b', title: 'B' }] },
      { entries: [{ id: 'a', title: 'A again' }, { id: 'c', url: 'https://x/c' }] },
    ],
  };
  const out = normalizeEntries(info);
  assert.deepEqual(out.map((e) => e.id), ['a', 'b', 'c']);
  assert.equal(out[0].duration, 61);
  assert.equal(out[0].publishedAt, '2026-09-01');
  assert.equal(out[1].duration, null);
  assert.equal(out[1].url, 'https://www.youtube.com/watch?v=b');
});

test('scanning stops after the page that contains a known ID', async () => {
  const entries = [...makeEntries(39), { id: 'known-40', title: 'Known' }, ...makeEntries(30, 'old')];
  const calls = [];
  const result = await scanToBoundary({
    getInfo: fakePagedInfo(entries, calls),
    url: 'https://youtube.example/channel',
    knownIds: new Set(['known-40']),
    pageSize: 30,
    hardLimit: 1000,
  });
  assert.equal(result.boundaryReached, true);
  assert.equal(result.saturated, false);
  assert.equal(new Set(result.entries.map((e) => e.id)).size, result.entries.length);
  assert.deepEqual(calls, [[1, 30], [31, 60]]);
});

test('1,000 unknown entries saturate the scan without requesting past the limit', async () => {
  const calls = [];
  const result = await scanToBoundary({
    getInfo: fakePagedInfo(makeEntries(1500), calls),
    url: 'u',
    knownIds: new Set(['nope']),
    pageSize: 30,
    hardLimit: 1000,
  });
  assert.equal(result.boundaryReached, false);
  assert.equal(result.saturated, true);
  assert.equal(result.entries.length, 1000);
  assert.ok(calls.every(([, end]) => end <= 1000));
  assert.equal(calls[calls.length - 1][1], 1000);
});

test('a short listing ends the scan without reporting saturation', async () => {
  const calls = [];
  const result = await scanToBoundary({ getInfo: fakePagedInfo(makeEntries(12), calls), url: 'u', knownIds: new Set(), pageSize: 30 });
  assert.equal(result.exhausted, true);
  assert.equal(result.saturated, false);
  assert.equal(result.entries.length, 12);
  assert.equal(calls.length, 1);
});
