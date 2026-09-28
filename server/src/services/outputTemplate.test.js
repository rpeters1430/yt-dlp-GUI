const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_TEMPLATE, PRESETS, validateTemplate } = require('./outputTemplate');

test('the default template and every preset are valid', () => {
  assert.equal(validateTemplate(DEFAULT_TEMPLATE), null);
  for (const preset of PRESETS) {
    assert.equal(validateTemplate(preset.template), null, preset.id);
  }
});

test('validateTemplate accepts common yt-dlp template shapes', () => {
  assert.equal(validateTemplate('%(title)s.%(ext)s'), null);
  assert.equal(validateTemplate('%(id)s.%(ext)s'), null);
  assert.equal(validateTemplate('%(channel)s/Season %(upload_date>%Y)s/%(upload_date)s - %(title)s.%(ext)s'), null);
  assert.equal(validateTemplate('%(uploader,channel)s/%(fulltitle,title).100B.%(ext)s'), null);
});

test('validateTemplate keeps files inside the downloads folder', () => {
  assert.match(validateTemplate('/etc/%(title)s.%(ext)s'), /relative/);
  assert.match(validateTemplate('C:%(title)s.%(ext)s'), /relative/);
  assert.match(validateTemplate('../%(title)s.%(ext)s'), /\.\./);
  assert.match(validateTemplate('a/../../%(title)s.%(ext)s'), /\.\./);
  assert.match(validateTemplate('a\\..\\%(title)s.%(ext)s'), /\.\./);
  // A ".." inside a field's strftime/default text is not a path segment.
  assert.equal(validateTemplate('%(upload_date>%Y|..)s/%(title)s.%(ext)s'), null);
});

test('validateTemplate rejects templates that would break downloads', () => {
  assert.match(validateTemplate(''), /required/);
  assert.match(validateTemplate('%(title)s'), /%\(ext\)s/);
  assert.match(validateTemplate('%(uploader)s/video.%(ext)s'), /title/);
  assert.match(validateTemplate('%(uploader_id)s.%(ext)s'), /title/);
  assert.match(validateTemplate('%(title)s\n.%(ext)s'), /single line/);
  assert.match(validateTemplate(`${'x'.repeat(600)}%(title)s.%(ext)s`), /too long/);
});
