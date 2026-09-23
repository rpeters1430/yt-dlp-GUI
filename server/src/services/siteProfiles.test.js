const test = require('node:test');
const assert = require('node:assert/strict');
const {
  matchProfile,
  getCapabilities,
  capabilitiesFromUrl,
  parseLiveFromStartSites,
} = require('./siteProfiles');
const { buildDownloadArgs, resolveDownloadOptions } = require('./ytdlp');

const HELP_EXCERPT = `
    --live-from-start               Download livestreams from the start.
                                    Currently experimental and only supported
                                    for YouTube, Twitch, TVer, and mellow-fan
    --no-live-from-start            Download livestreams from the current time
                                    (default)
`;

test('parseLiveFromStartSites reads the supported list out of yt-dlp --help', () => {
  assert.deepEqual(parseLiveFromStartSites(HELP_EXCERPT), ['YouTube', 'Twitch', 'TVer', 'mellow-fan']);
  assert.equal(parseLiveFromStartSites('no such option here'), null);
});

test('matchProfile prefers the extractor over the URL domain', () => {
  assert.equal(matchProfile({ extractorKey: 'Youtube' }).id, 'youtube');
  assert.equal(matchProfile({ extractor: 'twitch:vod' }).id, 'twitch');
  assert.equal(matchProfile({ url: 'https://www.twitch.tv/somechannel' }).id, 'twitch');
  assert.equal(matchProfile({ url: 'https://m.youtube.com/watch?v=x' }).id, 'youtube');
  // An extractor we have no profile for wins over a misleading domain.
  assert.equal(matchProfile({ url: 'https://youtube.com.example.org/v', extractorKey: 'Generic' }).id, 'generic');
  // Anchored: yt-dlp's Kickstarter extractor is not the Kick streaming site.
  assert.equal(matchProfile({ extractorKey: 'Kickstarter' }).id, 'generic');
});

test('getCapabilities derives media facts from the probe, not the site', () => {
  const xvideosLike = {
    extractor: 'XVideos',
    extractor_key: 'XVideos',
    // Progressive MP4s with no codec info must still count as video.
    formats: [{ format_id: 'mp4-high', url: 'x', ext: 'mp4' }, { format_id: 'hls-720p', vcodec: 'avc1', acodec: 'mp4a', height: 720 }],
    subtitles: {},
    thumbnails: [{ url: 't.jpg' }],
  };
  const caps = getCapabilities(xvideosLike, 'https://www.xvideos.com/video123/x');
  assert.equal(caps.site.id, 'generic');
  assert.equal(caps.site.name, 'XVideos');
  assert.equal(caps.sponsorblock, false);
  assert.equal(caps.liveFromStart, false);
  assert.equal(caps.video, true);
  assert.equal(caps.audioOnlyMedia, false);
  assert.equal(caps.hasSubtitles, false);
  assert.equal(caps.chapters, false);
  assert.equal(caps.thumbnail, true);

  const soundcloudLike = {
    extractor_key: 'Soundcloud',
    formats: [{ format_id: 'hls_opus', vcodec: 'none', acodec: 'opus' }],
  };
  assert.equal(getCapabilities(soundcloudLike).audioOnlyMedia, true);
});

test('getCapabilities flags auth-gated and DRM media', () => {
  const caps = getCapabilities({ extractor_key: 'Youtube', availability: 'subscriber_only', _has_drm: true, formats: [] });
  assert.equal(caps.needsAuth, true);
  assert.equal(caps.drm, true);
  assert.equal(caps.warnings.length, 2);
});

test('live-from-start follows the yt-dlp list, which includes Twitch', () => {
  assert.equal(getCapabilities({ extractor_key: 'TwitchStream', formats: [] }).liveFromStart, true);
  assert.equal(getCapabilities({ extractor_key: 'Kick', formats: [] }).liveFromStart, false);

  const args = buildDownloadArgs('https://www.twitch.tv/somechannel', { isLive: true, liveFromStart: true });
  assert.ok(args.includes('--live-from-start'));
});

test('resolveDownloadOptions drops options the probed link cannot use and explains why', () => {
  const caps = getCapabilities({
    extractor_key: 'XVideos',
    extractor: 'XVideos',
    formats: [{ format_id: 'mp4-high', ext: 'mp4' }],
    thumbnails: [{ url: 't.jpg' }],
  });
  const { options, adjustments } = resolveDownloadOptions('https://www.xvideos.com/video123/x', {
    subtitles: true,
    embedChapters: true,
    embedThumbnail: true,
    sponsorblockRemove: 'sponsor',
    caps,
  });
  assert.equal(options.subtitles, false);
  assert.equal(options.embedChapters, false);
  assert.equal(options.embedThumbnail, true);
  assert.equal(options.sponsorblockRemove, '');
  assert.equal(adjustments.length, 3);

  const args = buildDownloadArgs('https://www.xvideos.com/video123/x', {
    subtitles: true, embedChapters: true, sponsorblockRemove: 'sponsor', caps,
  });
  for (const flag of ['--write-subs', '--embed-subs', '--convert-subs', '--embed-chapters', '--sponsorblock-remove']) {
    assert.equal(args.includes(flag), false, `${flag} should be omitted`);
  }
});

test('unprobed links keep media options (facts unknown) but still drop site-only features', () => {
  const caps = capabilitiesFromUrl('https://vimeo.com/76979871');
  assert.equal(caps.hasSubtitles, null);
  const args = buildDownloadArgs('https://vimeo.com/76979871', { subtitles: true, embedChapters: true, sponsorblockRemove: 'sponsor' });
  assert.ok(args.includes('--write-subs'));
  assert.ok(args.includes('--embed-chapters'));
  assert.equal(args.includes('--write-auto-subs'), false);
  assert.equal(args.includes('--sponsorblock-remove'), false);
});

test('auto-captions are requested whenever the probe found them, on any site', () => {
  const caps = getCapabilities({ extractor_key: 'Vimeo', formats: [{ vcodec: 'avc1' }], automatic_captions: { en: [{ ext: 'vtt' }] } });
  const args = buildDownloadArgs('https://vimeo.com/1', { subtitles: true, caps });
  assert.ok(args.includes('--write-auto-subs'));
});

test('subtitle language patterns resolve to exact probed tracks', () => {
  const url = 'https://www.youtube.com/watch?v=abc123';
  const withManual = getCapabilities({ extractor_key: 'Youtube', formats: [{ vcodec: 'avc1' }], subtitles: { en: [{}], de: [{}] }, automatic_captions: { en: [{}], 'en-de': [{}] } });
  const a = resolveDownloadOptions(url, { subtitles: true, subLangs: 'en.*', caps: withManual }).options;
  assert.equal(a.subLangs, 'en');
  assert.equal(a.useAutoSubs, false);
  assert.equal(buildDownloadArgs(url, { subtitles: true, subLangs: 'en.*', caps: withManual }).includes('--write-auto-subs'), false);

  const autoOnly = getCapabilities({ extractor_key: 'Youtube', formats: [{ vcodec: 'avc1' }], automatic_captions: { 'en-orig': [{}], en: [{}], 'en-de': [{}], fr: [{}] } });
  const b = resolveDownloadOptions(url, { subtitles: true, subLangs: 'en.*', caps: autoOnly }).options;
  assert.equal(b.subLangs, 'en-orig,en');
  assert.equal(b.useAutoSubs, true);

  const none = resolveDownloadOptions(url, { subtitles: true, subLangs: 'ja.*', caps: withManual });
  assert.equal(none.options.subtitles, false);
  assert.match(none.adjustments[0], /available: en, de/);

  assert.equal(resolveDownloadOptions(url, { subtitles: true, subLangs: 'all', caps: withManual }).options.subLangs, 'all');
});

test('an unconvertible (AVIF) preferred thumbnail is swapped for a post-download JPG embed', () => {
  // Shape of a real XVideos probe (2026-09): JPG first, AVIF last — yt-dlp embeds the last.
  const info = {
    extractor_key: 'XVideos',
    formats: [{ format_id: 'hls-1080p', height: 1080 }],
    thumbnails: [
      { url: 'https://cdn.example.com/a/xv_10_t.jpg', preference: 0 },
      { url: 'https://cdn.example.com/a/xv_13_p.avif', preference: 1 },
    ],
  };
  const url = 'https://www.xvideos.com/video.abc/1/0/x';
  const caps = getCapabilities(info, url);
  assert.equal(caps.thumbnailFormat, 'avif');
  assert.equal(caps.thumbnailConvertible, false);

  const mp4 = resolveDownloadOptions(url, { embedThumbnail: true, container: 'mp4', caps });
  assert.equal(mp4.options.embedThumbnail, false);
  assert.equal(mp4.options.thumbnailFallbackUrl, 'https://cdn.example.com/a/xv_10_t.jpg');
  assert.equal(buildDownloadArgs(url, { embedThumbnail: true, container: 'mp4', caps }).includes('--embed-thumbnail'), false);

  // MKV attaches the image as-is, so yt-dlp can handle it directly.
  const mkv = resolveDownloadOptions(url, { embedThumbnail: true, container: 'mkv', caps });
  assert.equal(mkv.options.embedThumbnail, true);
  assert.equal(mkv.options.thumbnailFallbackUrl, undefined);

  // A normal JPG thumbnail is left to yt-dlp.
  const jpgOnly = getCapabilities({ ...info, thumbnails: [info.thumbnails[0]] }, url);
  assert.equal(resolveDownloadOptions(url, { embedThumbnail: true, caps: jpgOnly }).options.embedThumbnail, true);
});

test('default output template caps title length in bytes', () => {
  const args = buildDownloadArgs('https://www.youtube.com/watch?v=abc123', {});
  const template = args[args.indexOf('-o') + 1];
  assert.match(template, /%\(title\)\.150B \[%\(id\)s\]\.%\(ext\)s$/);
});
