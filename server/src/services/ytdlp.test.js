const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-test-config-'));
process.env.CONFIG_DIR = testConfigDir;
process.on('exit', () => {
  try { fs.rmSync(testConfigDir, { recursive: true, force: true }); } catch (_) {}
});

const {
  isPlaylistUrl, getDownloadIdleTimeoutMs, clearRecentCaches, normalizeUrl, isNotLiveError, parseNotLiveError,
} = require('./ytdlp');

test.beforeEach(() => clearRecentCaches());

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

test('getQuickjsBin resolves binary name correctly', () => {
  const { getQuickjsBin } = require('./ytdlp');
  const bin = getQuickjsBin();
  assert.ok(typeof bin === 'string' && bin.length > 0);
});

test('buildDownloadArgs enables Node and QuickJS-ng by path instead of the default Deno-only', () => {
  const { buildDownloadArgs } = require('./ytdlp');
  const args = buildDownloadArgs('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {});
  const clear = args.indexOf('--no-js-runtimes');
  const enabled = args.flatMap((a, i) => (a === '--js-runtimes' ? [args[i + 1]] : []));
  assert.ok(clear !== -1 && args.indexOf('--js-runtimes') > clear);
  assert.ok(enabled.includes(`node:${process.execPath}`), enabled.join(' '));
  for (const rt of enabled) assert.match(rt, /^(deno|node|quickjs)(:|$)/);
});

test('JS_RUNTIMES limits which runtimes yt-dlp is given', () => {
  const { getJsRuntimes } = require('./ytdlpPaths');
  const saved = process.env.JS_RUNTIMES;
  try {
    process.env.JS_RUNTIMES = 'node';
    assert.deepEqual(getJsRuntimes(), [{ name: 'node', path: process.execPath }]);
    process.env.JS_RUNTIMES = 'bogus';
    assert.deepEqual(getJsRuntimes(), [{ name: 'quickjs', path: null }]);
  } finally {
    if (saved === undefined) delete process.env.JS_RUNTIMES;
    else process.env.JS_RUNTIMES = saved;
  }
});

test('getVersions returns quickjs version property', async () => {
  const { getVersions } = require('./ytdlp');
  const versions = await getVersions();
  assert.ok('quickjs' in versions);
  assert.ok('deno' in versions);
  assert.ok('jsRuntimes' in versions);
  assert.ok('node' in versions);
});

test('dependencyUpdater exports updateQuickjsNightly function', () => {
  const updater = require('./dependencyUpdater');
  assert.equal(typeof updater.updateQuickjsNightly, 'function');
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

test('buildDownloadArgs prints the planned output path before downloading', () => {
  const { buildDownloadArgs } = require('./ytdlp');
  const args = buildDownloadArgs('https://www.youtube.com/watch?v=abc123', { isLive: true });
  // A stopped live recording never reaches after_move, so the queue relies on this path to
  // find the file for chunk splitting.
  const i = args.indexOf('before_dl:DESTFILE %(filename)s');
  assert.ok(i > 0);
  assert.equal(args[i - 1], '--print');
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

test('isRedditShareUrl matches Reddit app share links only', () => {
  const { isRedditShareUrl } = require('./ytdlp');
  assert.equal(isRedditShareUrl('https://www.reddit.com/r/videos/s/eawAD6BLAE'), true);
  assert.equal(isRedditShareUrl('https://reddit.com/r/videos/s/eawAD6BLAE/?utm_source=share'), true);
  assert.equal(isRedditShareUrl('https://www.reddit.com/u/someone/s/Abc123'), true);
  assert.equal(isRedditShareUrl('https://www.reddit.com/r/videos/comments/abc123/title/'), false);
  assert.equal(isRedditShareUrl('https://example.com/r/videos/s/abc'), false);
});

test('resolveShareUrl follows the Reddit redirect and strips tracking params', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  const validateUrl = async () => {};
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 301,
    headers: { location: 'https://www.reddit.com/r/videos/comments/1abcde/some_title/?share_id=xyz&utm_medium=android_app' },
  }));
  assert.equal(
    await resolveShareUrl('https://www.reddit.com/r/videos/s/eawAD6BLAE', { validateUrl }),
    'https://www.reddit.com/r/videos/comments/1abcde/some_title/'
  );
});

test('resolveShareUrl falls back to the original URL when resolution fails', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  const validateUrl = async () => {};
  t.mock.method(globalThis, 'fetch', async () => new Response('Blocked', { status: 403 }));
  const share = 'https://www.reddit.com/r/videos/s/eawAD6BLAE';
  assert.equal(await resolveShareUrl(share, { validateUrl }), share);
});

test('resolveShareUrl leaves non-share URLs untouched without fetching', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('should not fetch'); });
  const url = 'https://www.youtube.com/watch?v=abc123';
  assert.equal(await resolveShareUrl(url), url);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('resolveShareUrl follows an intermediate Reddit redirect hop', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  const validateUrl = async () => {};
  const hops = [
    'https://www.reddit.com/r/videos/s/eawAD6BLAE',
    'https://www.reddit.com/r/videos/comments/1abcde/some_title/?share_id=xyz',
  ];
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 301, headers: { location: hops[call++] } }));
  assert.equal(
    await resolveShareUrl('https://reddit.com/r/videos/s/eawAD6BLAE', { validateUrl }),
    'https://www.reddit.com/r/videos/comments/1abcde/some_title/'
  );
});

test('resolveShareUrl does not follow redirects off Reddit', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  const validateUrl = async () => {};
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 302,
    headers: { location: 'http://169.254.169.254/latest/meta-data/' },
  }));
  const share = 'https://www.reddit.com/r/videos/s/eawAD6BLAE';
  assert.equal(await resolveShareUrl(share, { validateUrl }), share);
  // One request per user agent; the off-site hop is never fetched.
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('resolveShareUrl caches a resolved link so enqueue after Analyze does not refetch', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  const validateUrl = async () => {};
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 301,
    headers: { location: 'https://www.reddit.com/r/videos/comments/1abcde/some_title/' },
  }));
  const share = 'https://www.reddit.com/r/videos/s/eawAD6BLAE';
  const first = await resolveShareUrl(share, { validateUrl });
  const callsAfterFirst = fetchMock.mock.callCount();
  assert.equal(await resolveShareUrl(share, { validateUrl }), first);
  assert.equal(fetchMock.mock.callCount(), callsAfterFirst);
});

test('resolveShareUrl uses whichever user agent Reddit answers', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  const validateUrl = async () => {};
  t.mock.method(globalThis, 'fetch', async (_url, opts) => (
    /Chrome/.test(opts.headers['User-Agent'])
      ? new Response(null, { status: 301, headers: { location: 'https://www.reddit.com/r/videos/comments/1abcde/t/' } })
      : new Response('Blocked', { status: 403 })
  ));
  assert.equal(
    await resolveShareUrl('https://www.reddit.com/r/videos/s/eawAD6BLAE', { validateUrl }),
    'https://www.reddit.com/r/videos/comments/1abcde/t/'
  );
});

test('isSubtitleDownloadError matches yt-dlp subtitle fetch failures', () => {
  const { isSubtitleDownloadError } = require('./ytdlp');
  assert.equal(isSubtitleDownloadError("ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests"), true);
  assert.equal(isSubtitleDownloadError('ERROR: Unable to download subtitles for "en": HTTP Error 404'), true);
  assert.equal(isSubtitleDownloadError('ERROR: [youtube] abc: Video unavailable'), false);
  assert.equal(isSubtitleDownloadError(undefined), false);
});

test('isBotCheckError matches YouTube bot-check errors with straight or curly apostrophes', () => {
  const { isBotCheckError } = require('./ytdlp');
  assert.equal(isBotCheckError("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies"), true);
  assert.equal(isBotCheckError("ERROR: [youtube] abc: Sign in to confirm you're not a bot"), true);
  assert.equal(isBotCheckError('ERROR: [youtube] abc: Video unavailable'), false);
  assert.equal(isBotCheckError(undefined), false);
});

test('withPrivateCookies hands yt-dlp a temp copy so it never rewrites the shared cookies.txt', () => {
  const fs = require('fs');
  const { withPrivateCookies, COOKIES_FILE } = require('./ytdlp');
  const existed = fs.existsSync(COOKIES_FILE);
  const original = existed ? fs.readFileSync(COOKIES_FILE) : null;
  fs.mkdirSync(require('path').dirname(COOKIES_FILE), { recursive: true });
  fs.writeFileSync(COOKIES_FILE, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n');
  try {
    const args = ['-J', '--cookies', COOKIES_FILE, 'https://www.youtube.com/watch?v=x'];
    const { args: out, cleanup } = withPrivateCookies(args);
    assert.notEqual(out[2], COOKIES_FILE);
    assert.equal(args[2], COOKIES_FILE, 'input args are not mutated');
    assert.equal(fs.readFileSync(out[2], 'utf8'), fs.readFileSync(COOKIES_FILE, 'utf8'));
    fs.writeFileSync(out[2], 'rotated by yt-dlp');
    assert.match(fs.readFileSync(COOKIES_FILE, 'utf8'), /SID\tabc/);
    cleanup();
    return new Promise((resolve) => setTimeout(() => {
      assert.equal(fs.existsSync(out[2]), false);
      resolve();
    }, 50));
  } finally {
    if (existed) fs.writeFileSync(COOKIES_FILE, original);
    else fs.rmSync(COOKIES_FILE, { force: true });
  }
});

test('withPrivateCookies leaves args alone when no cookies are configured', () => {
  const { withPrivateCookies } = require('./ytdlp');
  const args = ['-J', 'https://example.com'];
  assert.equal(withPrivateCookies(args).args, args);
});

test('site cookies keep only their own domains and are merged into the private copy', () => {
  const { withPrivateCookies, COOKIES_FILE } = require('./ytdlp');
  const { cookieArgs, writeSiteCookies, clearSiteCookies, siteCookiesStatus, filterSiteCookies } = require('./ytdlpCookies');
  const exported = [
    '# Netscape HTTP Cookie File',
    '.reddit.com\tTRUE\t/\tTRUE\t0\treddit_session\tr1',
    '#HttpOnly_.x.com\tTRUE\t/\tTRUE\t0\tauth_token\tx1',
    '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tyt-from-export',
  ].join('\r\n');
  fs.rmSync(COOKIES_FILE, { force: true });
  try {
    assert.deepEqual(writeSiteCookies('reddit', exported), { cookieCount: 1 });
    assert.deepEqual(writeSiteCookies('twitter', exported), { cookieCount: 1 });
    assert.deepEqual(siteCookiesStatus('reddit'), { configured: true, cookieCount: 1 });
    assert.throws(() => filterSiteCookies('reddit', '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc'), /No Reddit cookies/);

    // Site files alone still enable --cookies, even with no shared cookies.txt saved.
    assert.deepEqual(cookieArgs(), ['--cookies', COOKIES_FILE]);
    fs.writeFileSync(COOKIES_FILE, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tyt\n');
    const { args: out, cleanup } = withPrivateCookies(['-J', '--cookies', COOKIES_FILE, 'https://x.com/a/status/1']);
    const merged = fs.readFileSync(out[2], 'utf8');
    cleanup();
    assert.match(merged, /SID\tyt\n/);
    assert.match(merged, /reddit_session\tr1/);
    assert.match(merged, /#HttpOnly_\.x\.com\tTRUE\t\/\tTRUE\t0\tauth_token\tx1/);
    assert.doesNotMatch(merged, /yt-from-export/);
    assert.match(fs.readFileSync(COOKIES_FILE, 'utf8'), /^# Netscape HTTP Cookie File\n\.youtube\.com[^\n]*\n$/, 'shared file untouched');
  } finally {
    clearSiteCookies('reddit');
    clearSiteCookies('twitter');
    fs.rmSync(COOKIES_FILE, { force: true });
  }
  assert.deepEqual(cookieArgs(), []);
  assert.deepEqual(siteCookiesStatus('twitter'), { configured: false, cookieCount: 0 });
});

test('sweepPrivateCookieDirs removes private cookie copies left behind by a crash', () => {
  const fs = require('fs');
  const path = require('path');
  const { sweepPrivateCookieDirs, PRIVATE_COOKIES_ROOT } = require('./ytdlp');
  const leftover = path.join(PRIVATE_COOKIES_ROOT, 'job-leftover');
  fs.mkdirSync(leftover, { recursive: true });
  fs.writeFileSync(path.join(leftover, 'cookies.txt'), 'secret');
  sweepPrivateCookieDirs();
  assert.equal(fs.existsSync(leftover), false);
});

test('summarizeErrorOutput collapses repeated lines with a count, keeping first-seen order', () => {
  const stderr = [
    'WARNING: Unknown codec unknown',
    'ERROR: Did not get any data blocks',
    'ERROR: Did not get any data blocks',
    '',
    'ERROR: Did not get any data blocks',
    'WARNING: Unknown codec unknown',
  ].join('\n');
  const { summarizeErrorOutput } = require('./ytdlp');
  assert.equal(
    summarizeErrorOutput(stderr),
    'WARNING: Unknown codec unknown (×2)\nERROR: Did not get any data blocks (×3)',
  );
});

test('readProcessGroupCpuTicks sums CPU time for only the matching process group', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { readProcessGroupCpuTicks } = require('./ytdlp');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'));
  const writeStat = (pid, comm, pgrp, utime, stime, cutime, cstime) => {
    fs.mkdirSync(path.join(root, String(pid)));
    // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime ...
    fs.writeFileSync(path.join(root, String(pid), 'stat'),
      `${pid} (${comm}) S 1 ${pgrp} ${pgrp} 0 -1 0 0 0 0 0 ${utime} ${stime} ${cutime} ${cstime} 20 0 1 0`);
  };
  try {
    writeStat(100, 'yt-dlp', 100, 10, 5, 3, 2);
    writeStat(101, 'ffmpeg (merge) x', 100, 40, 10, 0, 0);
    writeStat(200, 'other', 200, 999, 999, 0, 0);
    fs.mkdirSync(path.join(root, 'self'));
    assert.equal(readProcessGroupCpuTicks(100, root), 70);
    assert.equal(readProcessGroupCpuTicks(100, path.join(root, 'missing')), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isBusyCpuDelta requires a small but real share of CPU over the window', () => {
  const { isBusyCpuDelta } = require('./ytdlp');
  assert.equal(isBusyCpuDelta(0, 60000), false);
  assert.equal(isBusyCpuDelta(29, 60000), false);
  assert.equal(isBusyCpuDelta(30, 60000), true);
});

test('normalizeUrl adds https:// to pasted links that have no scheme', () => {
  assert.equal(normalizeUrl('www.tiktok.com/@cinnanako/live'), 'https://www.tiktok.com/@cinnanako/live');
  assert.equal(normalizeUrl('  tiktok.com/@user/live '), 'https://tiktok.com/@user/live');
  assert.equal(normalizeUrl('youtu.be/abc123'), 'https://youtu.be/abc123');
  assert.equal(normalizeUrl('//www.twitch.tv/somechannel'), 'https://www.twitch.tv/somechannel');
  assert.equal(normalizeUrl('https://www.tiktok.com/@user/live'), 'https://www.tiktok.com/@user/live');
  assert.equal(normalizeUrl('ytsearch5:lofi beats'), 'ytsearch5:lofi beats');
  assert.equal(normalizeUrl('not a url'), 'not a url');
});

test('isNotLiveError / parseNotLiveError recognize an offline channel', () => {
  const msg = 'ERROR: [tiktok:live] cinnanako: The channel is not currently live';
  assert.equal(isNotLiveError(msg), true);
  assert.deepEqual(parseNotLiveError(msg), { extractor: 'tiktok:live', channel: 'cinnanako' });
  assert.equal(isNotLiveError('ERROR: [tiktok:live] This livestream has ended'), false);
  assert.deepEqual(parseNotLiveError('The channel is not currently live'), { extractor: null, channel: null });
});

test('buildDownloadArgs un-silences the ffmpeg downloader so its failures say why', () => {
  const { buildDownloadArgs } = require('./ytdlp');
  // Every download, not only known-live ones: yt-dlp also hands non-live jobs (e.g.
  // --download-sections) to ffmpeg, and a live URL isn't always flagged isLive up front.
  for (const [url, options] of [
    ['https://www.tiktok.com/@user/live', { isLive: true }],
    ['https://example.com/video.mp4', { isLive: false, downloadSections: '*0-60' }],
  ]) {
    const args = buildDownloadArgs(url, options);
    const i = args.indexOf('--downloader-args');
    assert.notEqual(i, -1, url);
    assert.equal(args[i + 1], 'ffmpeg_i:-loglevel error', url);
  }
});

test('audio downloads prefer a source stream that avoids a lossy re-encode', () => {
  const { buildFormatSelector, buildDownloadArgs } = require('./ytdlp');
  assert.match(buildFormatSelector({ audioOnly: true, container: 'opus' }), /^bestaudio\[acodec\^=opus\]\//);
  assert.match(buildFormatSelector({ audioOnly: true, container: 'm4a', audioQuality: '0' }), /^bestaudio\[ext=m4a\]\//);
  // An explicit M4A bitrate means "re-encode the best stream", so no AAC preference.
  assert.match(buildFormatSelector({ audioOnly: true, container: 'm4a', audioQuality: '256k' }), /^bestaudio\/best/);
  assert.match(buildFormatSelector({ audioOnly: true, container: 'mp3', audioQuality: '320k' }), /^bestaudio\/best/);

  const args = buildDownloadArgs('https://www.youtube.com/watch?v=abc123', { audioOnly: true, container: 'opus', audioQuality: '0' });
  assert.equal(args[args.indexOf('-f') + 1].startsWith('bestaudio[acodec^=opus]'), true);
});

test('MP4 video downloads prefer AAC audio so the merged file stays in sync', () => {
  const { buildFormatSelector, buildDownloadArgs } = require('./ytdlp');
  assert.equal(buildFormatSelector({ container: 'mp4' }), 'bestvideo*+bestaudio[ext=m4a]/bestvideo*+bestaudio/best');
  assert.equal(
    buildFormatSelector({ quality: '1080', container: 'mp4' }),
    'bestvideo*[height<=1080]+bestaudio[ext=m4a]/bestvideo*[height<=1080]+bestaudio/best[height<=1080]',
  );
  // MKV handles Opus fine, so it keeps the best audio stream whatever its codec.
  assert.equal(buildFormatSelector({ container: 'mkv' }), 'bestvideo*+bestaudio/best');
  // A format the user picked by hand is passed through untouched.
  assert.equal(buildFormatSelector({ formatSelector: '137+251', container: 'mp4' }), '137+251');

  const args = buildDownloadArgs('https://www.youtube.com/watch?v=abc123', { container: 'mp4' });
  assert.equal(args[args.indexOf('-f') + 1], 'bestvideo*+bestaudio[ext=m4a]/bestvideo*+bestaudio/best');
});

test('cutting the file only forces keyframes (a full re-encode) when FORCE_KEYFRAMES_AT_CUTS is set', () => {
  const { buildDownloadArgs } = require('./ytdlp');
  const url = 'https://www.youtube.com/watch?v=abc123';
  const saved = process.env.FORCE_KEYFRAMES_AT_CUTS;
  try {
    delete process.env.FORCE_KEYFRAMES_AT_CUTS;
    assert.equal(buildDownloadArgs(url, { sponsorblockRemove: 'sponsor' }).includes('--force-keyframes-at-cuts'), false);
    assert.equal(buildDownloadArgs(url, { downloadSections: '*0-60' }).includes('--force-keyframes-at-cuts'), false);
    process.env.FORCE_KEYFRAMES_AT_CUTS = '1';
    assert.ok(buildDownloadArgs(url, { sponsorblockRemove: 'sponsor' }).includes('--force-keyframes-at-cuts'));
    assert.ok(buildDownloadArgs(url, { downloadSections: '*0-60' }).includes('--force-keyframes-at-cuts'));
    assert.equal(buildDownloadArgs(url, {}).includes('--force-keyframes-at-cuts'), false);
  } finally {
    if (saved === undefined) delete process.env.FORCE_KEYFRAMES_AT_CUTS;
    else process.env.FORCE_KEYFRAMES_AT_CUTS = saved;
  }
});

test('assertPublicUrl blocks loopback and private hosts in every spelling', () => {
  const { assertPublicUrl } = require('./ytdlp');
  for (const url of [
    'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:192.168.1.5]/', 'http://[fd00::1]/', 'http://localhost/', 'http://app.localhost/',
    'http://localhost./', 'http://app.localhost./',
  ]) {
    assert.throws(() => assertPublicUrl(url), /local\/private/, url);
  }
  for (const url of ['https://www.youtube.com/watch?v=x', 'http://[::ffff:8.8.8.8]/', 'http://8.8.8.8/']) {
    assert.doesNotThrow(() => assertPublicUrl(url), url);
  }
});

test('non-live downloads fetch fragments concurrently; live captures do not', () => {
  const { buildDownloadArgs } = require('./ytdlp');
  assert.ok(buildDownloadArgs('https://www.youtube.com/watch?v=abc123', {}).includes('--concurrent-fragments'));
  assert.equal(buildDownloadArgs('https://www.youtube.com/watch?v=abc123', { isLive: true }).includes('--concurrent-fragments'), false);
});

test('WebM video downloads prefer WebM/Opus streams and merge to webm', () => {
  const { buildFormatSelector, buildDownloadArgs } = require('./ytdlp');
  assert.equal(buildFormatSelector({ container: 'webm' }), 'bestvideo*[ext=webm]+bestaudio[ext=webm]/bestvideo*+bestaudio/best');
  assert.equal(
    buildFormatSelector({ quality: '1080', container: 'webm' }),
    'bestvideo*[height<=1080][ext=webm]+bestaudio[ext=webm]/bestvideo*[height<=1080]+bestaudio/best[height<=1080]',
  );
  const args = buildDownloadArgs('https://www.youtube.com/watch?v=abc123', { container: 'webm' });
  const mergeIdx = args.indexOf('--merge-output-format');
  assert.notEqual(mergeIdx, -1);
  assert.equal(args[mergeIdx + 1], 'webm');
});

test('cleanupPartialFiles from a format file also removes the other format and merge temp files', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { cleanupPartialFiles } = require('./ytdlp');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-partial-'));
  try {
    const video = path.join(dir, 'My Video [abc123].f137.mp4');
    const audio = path.join(dir, 'My Video [abc123].f251.webm');
    const mergeTemp = path.join(dir, 'My Video [abc123].temp.mp4');
    const unrelated = path.join(dir, 'My Video [abc123].nfo');
    for (const f of [video, audio, mergeTemp, unrelated]) fs.writeFileSync(f, 'x');

    cleanupPartialFiles(video);

    assert.equal(fs.existsSync(video), false);
    assert.equal(fs.existsSync(audio), false);
    assert.equal(fs.existsSync(mergeTemp), false);
    assert.equal(fs.existsSync(unrelated), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('looksLikeDiskFull matches disk-full errors and near-empty output folders', () => {
  const { looksLikeDiskFull } = require('./ytdlp');
  const roomy = () => ({ bavail: 10 * 1024 * 1024, bsize: 4096 });
  const full = () => ({ bavail: 10, bsize: 4096 });
  assert.equal(looksLikeDiskFull('ERROR: unable to write data: [Errno 28] No space left on device', '/x', { statfs: roomy }), true);
  assert.equal(looksLikeDiskFull('ERROR: Postprocessing: Conversion failed!', '/x', { statfs: full }), true);
  assert.equal(looksLikeDiskFull('ERROR: Postprocessing: Conversion failed!', '/x', { statfs: roomy }), false);
  assert.equal(looksLikeDiskFull('ERROR: Video unavailable', '/x', { statfs: () => { throw new Error('ENOENT'); } }), false);
});

test('cleanupPartialFiles removes .part, .ytdl, and stream fragment files next to destFile', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { cleanupPartialFiles } = require('./ytdlp');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-partial-'));
  try {
    const dest = path.join(dir, 'My Video [abc123].mp4');
    const part = `${dest}.part`;
    const ytdl = `${dest}.ytdl`;
    const frag = path.join(dir, 'My Video [abc123].f137.mp4.part');
    const unrelated = path.join(dir, 'Other Video [xyz].mp4');
    for (const f of [part, ytdl, frag, unrelated]) fs.writeFileSync(f, 'x');

    cleanupPartialFiles(dest);

    assert.equal(fs.existsSync(part), false);
    assert.equal(fs.existsSync(ytdl), false);
    assert.equal(fs.existsSync(frag), false);
    assert.equal(fs.existsSync(unrelated), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assertPublicUrlResolved blocks DNS rebinding to loopback/private IPs and allows public IPs', async () => {
  const { assertPublicUrlResolved } = require('./ytdlp');

  // Rebinding to 127.0.0.1
  await assert.rejects(
    () => assertPublicUrlResolved('http://127.0.0.1.nip.io/video.mp4', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
    /resolves to a local\/private network address/
  );

  // Rebinding to RFC1918 192.168.1.50
  await assert.rejects(
    () => assertPublicUrlResolved('https://internal.example.com/stream', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.50', family: 4 }],
    }),
    /resolves to a local\/private network address/
  );

  // Rebinding to IPv6 loopback ::1
  await assert.rejects(
    () => assertPublicUrlResolved('https://ipv6-rebind.example.com/watch', {
      lookup: async () => [{ address: '::1', family: 6 }],
    }),
    /resolves to a local\/private network address/
  );

  // Public IPv4 and IPv6 addresses pass
  await assert.doesNotReject(() => assertPublicUrlResolved('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
    lookup: async () => [{ address: '142.250.190.46', family: 4 }, { address: '2607:f8b0:4005:809::200e', family: 6 }],
  }));

  await assert.rejects(
    () => assertPublicUrlResolved('https://unresolved.example.com/video', {
      lookup: async () => { throw Object.assign(new Error('DNS unavailable'), { code: 'EAI_AGAIN' }); },
    }),
    /Could not validate URL hostname.*EAI_AGAIN/
  );
});

test('parseSha256ForAsset, computeFileSha256, and verifyExecutableHeader validate binary updates', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  const { parseSha256ForAsset, computeFileSha256, verifyExecutableHeader } = require('./ytdlp');

  const samplePayload = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(128, 0xaa)]);
  const expectedSha = crypto.createHash('sha256').update(samplePayload).digest('hex');

  const checksumsTxt = [
    `# FFmpeg build checksums`,
    `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  ffmpeg-master-latest-win64-gpl.zip`,
    `${expectedSha} *ffmpeg-master-latest-linux64-gpl.tar.xz`,
  ].join('\n');

  assert.equal(parseSha256ForAsset(checksumsTxt, 'ffmpeg-master-latest-linux64-gpl.tar.xz'), expectedSha);
  assert.equal(parseSha256ForAsset(checksumsTxt, 'missing-asset.tar.xz'), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-bincheck-'));
  try {
    const elfFile = path.join(dir, 'qjs-linux-x86_64');
    fs.writeFileSync(elfFile, samplePayload);
    assert.equal(await computeFileSha256(elfFile), expectedSha);
    assert.equal(verifyExecutableHeader(elfFile, 'linux'), true);

    const htmlErrorFile = path.join(dir, 'bad-binary');
    fs.writeFileSync(htmlErrorFile, '<!DOCTYPE html><html><body>Rate limit exceeded — please try again later padding to exceed 64 bytes</body></html>');
    assert.throws(() => verifyExecutableHeader(htmlErrorFile, 'linux'), /not a valid Linux ELF executable/);
    assert.throws(() => verifyExecutableHeader(htmlErrorFile, 'win32'), /not a valid Windows PE executable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('classifyFailure categorizes common download errors for retry guidance', () => {
  const { classifyFailure } = require('./ytdlp');
  assert.equal(classifyFailure("Sign in to confirm you're not a bot"), 'bot_check');
  assert.equal(classifyFailure('Sign in to confirm your age'), 'auth_required');
  assert.equal(classifyFailure('Private video'), 'auth_required');
  assert.equal(classifyFailure('This video has been removed by the uploader'), 'unavailable');
  assert.equal(classifyFailure('Video unavailable in your country'), 'unavailable');
  assert.equal(classifyFailure('Read timed out'), 'network_or_stalled');
  assert.equal(classifyFailure('HTTP Error 429: Too Many Requests'), 'network_or_stalled');
});

test('buildDownloadArgs supports rate controls and section trimming', () => {
  const { buildDownloadArgs } = require('./ytdlp');
  const args = buildDownloadArgs('https://www.youtube.com/watch?v=abc123', {
    limitRate: '10M',
    sleepInterval: 5,
    downloadSections: '*00:01:00-00:03:30',
  });
  const rateIdx = args.indexOf('--limit-rate');
  assert.notEqual(rateIdx, -1);
  assert.equal(args[rateIdx + 1], '10M');
  const sleepIdx = args.indexOf('--sleep-interval');
  assert.notEqual(sleepIdx, -1);
  assert.equal(args[sleepIdx + 1], '5');
  const maxSleepIdx = args.indexOf('--max-sleep-interval');
  assert.notEqual(maxSleepIdx, -1);
  assert.equal(args[maxSleepIdx + 1], '10');
  const sectionIdx = args.indexOf('--download-sections');
  assert.notEqual(sectionIdx, -1);
  assert.equal(args[sectionIdx + 1], '*00:01:00-00:03:30');
});

test('parseStageLine reads yt-dlp status lines and drops the video id', () => {
  const { parseStageLine } = require('./ytdlp');
  assert.deepEqual(parseStageLine('[youtube] dQw4w9WgXcQ: Downloading webpage'), { source: 'youtube', message: 'Downloading webpage' });
  assert.deepEqual(parseStageLine('[youtube] Extracting URL: https://youtu.be/x'), { source: 'youtube', message: 'Extracting URL: https://youtu.be/x' });
  assert.deepEqual(parseStageLine('[info] abc: Downloading 1 format(s): 22'), { source: 'info', message: 'Downloading 1 format(s): 22' });
  assert.deepEqual(parseStageLine('[youtube:tab] Downloading playlist PLx - add --no-playlist'), { source: 'youtube:tab', message: 'Downloading playlist PLx - add --no-playlist' });
  assert.equal(parseStageLine('{"id": "x"}'), null);
  assert.equal(parseStageLine(''), null);
});

test('impersonateArgs and commonArgs support browser TLS impersonation setting', () => {
  const db = require('../db');
  const { commonArgs, impersonateArgs } = require('./ytdlp');

  // When disabled
  db.prepare("INSERT INTO settings (key, value) VALUES ('impersonate_target', '') ON CONFLICT(key) DO UPDATE SET value = ''").run();
  assert.deepEqual(impersonateArgs(), []);
  assert.equal(commonArgs().includes('--impersonate'), false);

  // When enabled via settings
  db.prepare("INSERT INTO settings (key, value) VALUES ('impersonate_target', 'chrome') ON CONFLICT(key) DO UPDATE SET value = 'chrome'").run();
  assert.deepEqual(impersonateArgs(), ['--impersonate', 'chrome']);
  const cArgs = commonArgs();
  const idx = cArgs.indexOf('--impersonate');
  assert.notEqual(idx, -1);
  assert.equal(cArgs[idx + 1], 'chrome');

  // Override via options
  const overridden = commonArgs({ impersonate: 'firefox' });
  const oIdx = overridden.indexOf('--impersonate');
  assert.notEqual(oIdx, -1);
  assert.equal(overridden[oIdx + 1], 'firefox');

  // Cleanup
  db.prepare("INSERT INTO settings (key, value) VALUES ('impersonate_target', '') ON CONFLICT(key) DO UPDATE SET value = ''").run();
});

