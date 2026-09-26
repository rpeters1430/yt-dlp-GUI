const test = require('node:test');
const assert = require('node:assert/strict');
const { isPlaylistUrl, getDownloadIdleTimeoutMs, clearRecentCaches } = require('./ytdlp');

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
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 301,
    headers: { location: 'https://www.reddit.com/r/videos/comments/1abcde/some_title/?share_id=xyz&utm_medium=android_app' },
  }));
  assert.equal(
    await resolveShareUrl('https://www.reddit.com/r/videos/s/eawAD6BLAE'),
    'https://www.reddit.com/r/videos/comments/1abcde/some_title/'
  );
});

test('resolveShareUrl falls back to the original URL when resolution fails', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  t.mock.method(globalThis, 'fetch', async () => new Response('Blocked', { status: 403 }));
  const share = 'https://www.reddit.com/r/videos/s/eawAD6BLAE';
  assert.equal(await resolveShareUrl(share), share);
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
  const hops = [
    'https://www.reddit.com/r/videos/s/eawAD6BLAE',
    'https://www.reddit.com/r/videos/comments/1abcde/some_title/?share_id=xyz',
  ];
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 301, headers: { location: hops[call++] } }));
  assert.equal(
    await resolveShareUrl('https://reddit.com/r/videos/s/eawAD6BLAE'),
    'https://www.reddit.com/r/videos/comments/1abcde/some_title/'
  );
});

test('resolveShareUrl does not follow redirects off Reddit', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 302,
    headers: { location: 'http://169.254.169.254/latest/meta-data/' },
  }));
  const share = 'https://www.reddit.com/r/videos/s/eawAD6BLAE';
  assert.equal(await resolveShareUrl(share), share);
  // One request per user agent; the off-site hop is never fetched.
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('resolveShareUrl caches a resolved link so enqueue after Analyze does not refetch', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 301,
    headers: { location: 'https://www.reddit.com/r/videos/comments/1abcde/some_title/' },
  }));
  const share = 'https://www.reddit.com/r/videos/s/eawAD6BLAE';
  const first = await resolveShareUrl(share);
  const callsAfterFirst = fetchMock.mock.callCount();
  assert.equal(await resolveShareUrl(share), first);
  assert.equal(fetchMock.mock.callCount(), callsAfterFirst);
});

test('resolveShareUrl uses whichever user agent Reddit answers', async (t) => {
  const { resolveShareUrl } = require('./ytdlp');
  t.mock.method(globalThis, 'fetch', async (_url, opts) => (
    /Chrome/.test(opts.headers['User-Agent'])
      ? new Response(null, { status: 301, headers: { location: 'https://www.reddit.com/r/videos/comments/1abcde/t/' } })
      : new Response('Blocked', { status: 403 })
  ));
  assert.equal(
    await resolveShareUrl('https://www.reddit.com/r/videos/s/eawAD6BLAE'),
    'https://www.reddit.com/r/videos/comments/1abcde/t/'
  );
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
