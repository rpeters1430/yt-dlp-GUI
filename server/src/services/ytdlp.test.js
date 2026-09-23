const test = require('node:test');
const assert = require('node:assert/strict');
const { isPlaylistUrl, getDownloadIdleTimeoutMs } = require('./ytdlp');

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

test('getDownloadIdleTimeoutMs skips the watchdog for wait-for-live jobs', () => {
  assert.equal(getDownloadIdleTimeoutMs('https://www.twitch.tv/somechannel', {
    waitForLive: true,
    isLive: true,
  }), null);
});

test('getDownloadIdleTimeoutMs prefers the live watchdog for live recordings', () => {
  assert.equal(
    getDownloadIdleTimeoutMs('https://www.twitch.tv/somechannel', { isLive: true }, {
      standard: 1000,
      playlist: 2000,
      live: 3000,
    }),
    3000
  );
});

test('getDownloadIdleTimeoutMs still uses the playlist watchdog for playlist URLs', () => {
  assert.equal(
    getDownloadIdleTimeoutMs('https://www.youtube.com/playlist?list=PL123', {}, {
      standard: 1000,
      playlist: 2000,
      live: 3000,
    }),
    2000
  );
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

test('isYouTube correctly identifies YouTube and non-YouTube sources', () => {
  const { isYouTube } = require('./ytdlp');
  assert.equal(isYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(isYouTube('https://youtu.be/dQw4w9WgXcQ'), true);
  assert.equal(isYouTube('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(isYouTube('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(isYouTube('ytsearch:never gonna give you up'), true);
  assert.equal(isYouTube('https://example.com/video', 'youtube'), true);
  assert.equal(isYouTube('https://example.com/video', 'youtubetab'), true);

  assert.equal(isYouTube('https://soundcloud.com/artist/track'), false);
  assert.equal(isYouTube('https://www.twitch.tv/videos/12345'), false);
  assert.equal(isYouTube('https://vimeo.com/76979871'), false);
  assert.equal(isYouTube('https://x.com/user/status/123'), false);
  assert.equal(isYouTube('https://www.tiktok.com/@user/video/123'), false);
  assert.equal(isYouTube('https://example.com/video', 'twitch:vod'), false);
});

test('buildDownloadArgs includes YouTube-specific args only for YouTube URLs', () => {
  const { buildDownloadArgs } = require('./ytdlp');

  // YouTube URL with subtitles, sponsorblock, and live options
  const ytArgs = buildDownloadArgs('https://www.youtube.com/watch?v=abc123', {
    subtitles: true,
    sponsorblockRemove: 'sponsor,intro',
    isLive: true,
    liveFromStart: true,
  });

  assert.ok(ytArgs.includes('--sponsorblock-remove'));
  assert.ok(ytArgs.includes('--write-auto-subs'));
  assert.ok(ytArgs.includes('--live-from-start'));
  assert.ok(ytArgs.includes('--convert-subs'));

  // Non-YouTube URL with identical requested options
  const nonYtArgs = buildDownloadArgs('https://soundcloud.com/artist/track', {
    subtitles: true,
    sponsorblockRemove: 'sponsor,intro',
    isLive: true,
    liveFromStart: true,
  });

  // SponsorBlock and live-from-start should be safely omitted for non-YouTube
  assert.equal(nonYtArgs.includes('--sponsorblock-remove'), false);
  assert.equal(nonYtArgs.includes('--live-from-start'), false);
  // Auto-subs should be omitted, but regular subs converted to srt
  assert.equal(nonYtArgs.includes('--write-auto-subs'), false);
  assert.ok(nonYtArgs.includes('--write-subs'));
  assert.ok(nonYtArgs.includes('--convert-subs'));
});

test('buildDownloadArgs does not include subtitle or chapter flags for audio-only downloads', () => {
  const { buildDownloadArgs } = require('./ytdlp');

  const audioArgs = buildDownloadArgs('https://soundcloud.com/artist/track', {
    audioOnly: true,
    subtitles: true,
    embedChapters: true,
  });

  assert.equal(audioArgs.includes('--write-subs'), false);
  assert.equal(audioArgs.includes('--embed-subs'), false);
  assert.equal(audioArgs.includes('--embed-chapters'), false);
});
