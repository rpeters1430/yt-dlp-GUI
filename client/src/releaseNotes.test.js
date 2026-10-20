import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissReleaseNotes, RELEASE_NOTES_DISMISSAL_KEY, shouldShowReleaseNotes } from './releaseNotes.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('shows notes with a revision until that revision is dismissed', () => {
  const storage = createStorage();
  const metadata = { version: '1.2.3', revision: 'abc123', notes: '## Changes\n- Improved things' };
  assert.equal(shouldShowReleaseNotes(metadata, storage), true);
  dismissReleaseNotes(metadata.revision, storage);
  assert.equal(storage.getItem(RELEASE_NOTES_DISMISSAL_KEY), 'abc123');
  assert.equal(shouldShowReleaseNotes(metadata, storage), false);
  assert.equal(shouldShowReleaseNotes({ ...metadata, revision: 'def456' }, storage), true);
});

test('hides missing, blank, or invalid release notes', () => {
  const storage = createStorage();
  assert.equal(shouldShowReleaseNotes(null, storage), false);
  assert.equal(shouldShowReleaseNotes({ revision: 'abc', notes: '  ' }, storage), false);
  assert.equal(shouldShowReleaseNotes({ revision: '', notes: 'Change' }, storage), false);
});

test('still offers release notes when browser storage is unavailable', () => {
  const metadata = { revision: 'abc', notes: 'Change' };
  assert.equal(shouldShowReleaseNotes(metadata, { getItem: () => { throw new Error('blocked'); } }), true);
});
