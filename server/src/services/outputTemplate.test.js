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

test('resolveVideoDir uses the saved folder, else the VIDEO_DIR default', () => {
  const { resolveVideoDir, validateVideoFolder } = require('./outputTemplate');
  const { DOWNLOAD_DIR, VIDEO_DIR } = require('./ytdlpPaths');
  const path = require('path');
  assert.equal(resolveVideoDir(''), VIDEO_DIR);
  assert.equal(resolveVideoDir(null), VIDEO_DIR);
  assert.equal(resolveVideoDir('/videos'), '/videos');
  assert.equal(resolveVideoDir('YouTube'), path.join(DOWNLOAD_DIR, 'YouTube'));
  // An unusable saved value falls back rather than producing a broken -o path.
  assert.equal(resolveVideoDir('/videos/%(title)s'), VIDEO_DIR);
  assert.equal(validateVideoFolder(''), null);
  assert.equal(validateVideoFolder('/volume1/Media/YouTube'), null);
  assert.match(validateVideoFolder('a\nb'), /single-line/);
  assert.match(validateVideoFolder('%(uploader)s'), /%/);
});

test('resolveMusicDir maps blank and the old "Music" default to the default music folder', () => {
  const { DOWNLOAD_DIR, MUSIC_DIR, resolveMusicDir } = require('./ytdlpPaths');
  const path = require('path');
  const fallback = MUSIC_DIR || path.join(DOWNLOAD_DIR, 'Music');
  assert.equal(resolveMusicDir(''), fallback);
  assert.equal(resolveMusicDir('Music'), fallback);
  assert.equal(resolveMusicDir('/data/music'), '/data/music');
  assert.equal(resolveMusicDir('Songs'), path.join(DOWNLOAD_DIR, 'Songs'));
});
