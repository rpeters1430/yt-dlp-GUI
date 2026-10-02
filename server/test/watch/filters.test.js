const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePattern, validateWatchFilters, watchConfigError, evaluateEntry } = require('../../src/services/watch/filters');

test('rejects malformed, unsafe, and oversized patterns', () => {
  assert.match(validatePattern('[', 'Include'), /valid regular expression/i);
  assert.match(validatePattern('(a+)+$', 'Include'), /unsafe/i);
  assert.match(validatePattern('x'.repeat(201), 'Include'), /200/);
  assert.equal(validatePattern('', 'Include'), null);
  assert.equal(validatePattern(null, 'Include'), null);
  assert.equal(validatePattern('\\b(movie|video game|gameplay|official)\\s+trailer\\b', 'Include'), null);
});

test('validateWatchFilters labels each field', () => {
  assert.deepEqual(validateWatchFilters({ matchTitle: 'ok', rejectTitle: '(' }), ['Exclude title must be a valid regular expression']);
  assert.deepEqual(validateWatchFilters({}), []);
  assert.match(watchConfigError({ match_title: '[', reject_title: null }), /Include title/);
});

test('IGN trailer include is case-insensitive and exclude wins', () => {
  const watch = {
    match_title: '\\b(movie|video game|gameplay|official)\\s+trailer\\b',
    reject_title: '\\breaction\\b',
    min_duration: null,
    max_duration: null,
  };
  assert.deepEqual(evaluateEntry({ title: 'New Movie Trailer', duration: 120 }, watch), { eligible: true, reason: null });
  assert.deepEqual(evaluateEntry({ title: 'MOVIE TRAILER reaction', duration: 120 }, watch), { eligible: false, reason: 'Exclude title regex matched' });
  assert.deepEqual(evaluateEntry({ title: 'IGN Daily Fix', duration: 600 }, watch), { eligible: false, reason: 'Include title regex did not match' });
});

test('duration rules allow unknown duration and report first failed rule', () => {
  const watch = { match_title: null, reject_title: null, min_duration: 60, max_duration: 300 };
  assert.equal(evaluateEntry({ title: 'Unknown', duration: null }, watch).eligible, true);
  assert.deepEqual(evaluateEntry({ title: 'Short', duration: 30 }, watch), { eligible: false, reason: 'Shorter than 60 seconds' });
  assert.deepEqual(evaluateEntry({ title: 'Long', duration: 301 }, watch), { eligible: false, reason: 'Longer than 300 seconds' });
});
