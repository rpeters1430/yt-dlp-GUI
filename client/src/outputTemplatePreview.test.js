import test from 'node:test';
import assert from 'node:assert/strict';
import { previewTemplate } from './outputTemplatePreview.js';

test('previewTemplate formats the date field that matched an alternative', () => {
  assert.equal(
    previewTemplate('%(missing_date>%Y,release_date>%B)s'),
    'September'
  );
});

test('previewTemplate keeps a shared date format for fallback fields', () => {
  assert.equal(
    previewTemplate('%(upload_date,release_date>%Y|unknown)s'),
    '2026'
  );
});

test('previewTemplate preserves defaults when none of the fields exist', () => {
  assert.equal(previewTemplate('%(missing_date|unknown)s'), 'unknown');
});
