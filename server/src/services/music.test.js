const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-music-test-'));
process.env.CONFIG_DIR = path.join(testDir, 'config');
process.env.DOWNLOAD_DIR = path.join(testDir, 'downloads');
process.env.MUSIC_DIR = path.join(testDir, 'music');
process.on('exit', () => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
});

const ytdlp = require('./ytdlp');
const {
  buildMusicTags,
  buildMetadataBlockPicture,
  searchAlbums,
  scoreCandidate,
  getAlbumDetails,
  resolveArtistChannel,
  getMatchCandidates,
  matchTrackToYouTube,
  tagMusicFile,
  enqueueMusicDownload,
  inspectUrl,
  sanitizeFilename,
} = require('./music');

test('buildMusicTags maps iTunes metadata to ffmpeg tag names and skips blanks', () => {
  assert.deepEqual(buildMusicTags({
    title: 'Song', artist: 'Artist', album: 'Album', trackNumber: 3, totalTracks: 12,
    discNumber: 1, totalDiscs: 2, year: '2020', genre: '',
  }), {
    title: 'Song', artist: 'Artist', album_artist: 'Artist', album: 'Album',
    track: '3/12', disc: '1/2', date: '2020',
  });
});

test('buildMetadataBlockPicture encodes a FLAC front-cover picture block', () => {
  const data = Buffer.from([1, 2, 3]);
  const block = Buffer.from(buildMetadataBlockPicture({ data, mime: 'image/jpeg' }), 'base64');
  assert.equal(block.readUInt32BE(0), 3);
  assert.equal(block.readUInt32BE(4), 'image/jpeg'.length);
  assert.deepEqual(block.subarray(block.length - 3), data);
  assert.equal(block.readUInt32BE(block.length - 7), 3);
});

test('searchAlbums can return keyword results without searching or enriching an artist', async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ results: [] }) };
  };

  try {
    const result = await searchAlbums('Incubus 8', 50, { includeArtist: false });
    assert.equal(urls.length, 1);
    assert.match(urls[0], /entity=album/);
    assert.equal(result.matchedArtist, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('scoreCandidate matches flag words whole and penalises other songs', () => {
  const studio = scoreCandidate({ title: 'Life Goes On', uploader: 'Oliver Tree - Topic', duration: 160 }, 'Oliver Tree', 'Life Goes On', 160);
  const live = scoreCandidate({ title: 'Life Goes On (Live)', uploader: 'Oliver Tree', duration: 160 }, 'Oliver Tree', 'Life Goes On', 160);
  assert.ok(studio > live);
  // "Discover" and "Alive" are not "cover" and "live".
  assert.ok(scoreCandidate({ title: 'Discover Alive', uploader: 'X - Topic', duration: 200 }, 'X', 'Alive', 200) >= 140);
  // Same artist's Topic channel, same length, different song.
  const right = scoreCandidate({ title: 'Wish You Were Here', uploader: 'Incubus - Topic', duration: 210 }, 'Incubus', 'Wish You Were Here', 210);
  const wrong = scoreCandidate({ title: 'Nice to Know You', uploader: 'Incubus - Topic', duration: 211 }, 'Incubus', 'Wish You Were Here', 210);
  assert.ok(right - wrong >= 80);
  // A featured artist in the iTunes title doesn't count as a different song.
  const feat = scoreCandidate({ title: 'Song Name', uploader: 'A - Topic', duration: 180 }, 'A', 'Song Name (feat. B)', 180);
  assert.ok(feat >= 115);
});

test('getAlbumDetails requests all multi-disc tracks and rejects truncated metadata', async (t) => {
  let count = 60;
  t.mock.method(global, 'fetch', async (url) => {
    assert.match(url, /entity=song&limit=200/);
    return { ok: true, json: async () => ({ results: [
      { wrapperType: 'collection', collectionName: 'Compilation', artistName: 'Artist', trackCount: 60, discCount: 2 },
      ...Array.from({ length: count }, (_, i) => ({
        wrapperType: 'track', trackName: `Song ${i + 1}`, trackNumber: i % 30 + 1, discNumber: i < 30 ? 1 : 2,
      })),
    ] }) };
  });
  const details = await getAlbumDetails(1);
  assert.equal(details.tracks.length, 60);
  assert.equal(details.tracks[30].discNumber, 2);
  count = 50;
  await assert.rejects(getAlbumDetails(1), /Album track list incomplete/);
});

test('resolveArtistChannel prefers Topic channel URL and falls back to @handle URL', async (t) => {
  t.mock.method(ytdlp, 'searchYouTube', async (query) => {
    if (query.includes('Topic')) {
      return [
        {
          id: 'v1',
          title: 'Drive',
          uploader: 'Incubus - Topic',
          channelId: 'UC123456',
          channelUrl: 'https://www.youtube.com/channel/UC123456',
        },
      ];
    }
    return [];
  });

  const resolved = await resolveArtistChannel('Incubus');
  assert.deepEqual(resolved, {
    url: 'https://www.youtube.com/channel/UC123456',
    uploader: 'Incubus - Topic',
    isTopic: true,
  });

  t.mock.method(ytdlp, 'searchYouTube', async () => []);
  const fallback = await resolveArtistChannel('Some Unknown Band!');
  assert.equal(fallback.url, 'https://www.youtube.com/@SomeUnknownBand');
  assert.equal(fallback.isTopic, false);
});

test('getMatchCandidates and matchTrackToYouTube rank Topic matches first and include fallbackUrls', async (t) => {
  t.mock.method(ytdlp, 'searchYouTube', async (query) => {
    if (query.includes('topic')) {
      return [
        { id: 'top1', url: 'https://www.youtube.com/watch?v=top1', title: 'Drive (Provided to YouTube)', uploader: 'Incubus - Topic', duration: 232 },
        { id: 'mv1', url: 'https://www.youtube.com/watch?v=mv1', title: 'Incubus - Drive (Official Music Video)', uploader: 'IncubusVEVO', duration: 235 },
      ];
    }
    return [
      { id: 'top1', url: 'https://www.youtube.com/watch?v=top1', title: 'Drive (Provided to YouTube)', uploader: 'Incubus - Topic', duration: 232 },
      { id: 'aud1', url: 'https://www.youtube.com/watch?v=aud1', title: 'Incubus - Drive (Official Audio)', uploader: 'Incubus', duration: 232 },
      { id: 'kara1', url: 'https://www.youtube.com/watch?v=kara1', title: 'Drive Karaoke Instrumental', uploader: 'SingKing', duration: 232 },
    ];
  });

  const candidates = await getMatchCandidates({ artist: 'Incubus', title: 'Drive', duration: 232 }, 5);
  assert.equal(candidates[0].videoId, 'top1');
  assert.equal(candidates[0].isTopic, true);
  assert.equal(candidates[0].durationDiff, 0);

  const match = await matchTrackToYouTube({ artist: 'Incubus', title: 'Drive', duration: 232 });
  assert.equal(match.videoId, 'top1');
  assert.ok(match.fallbackUrls.includes('https://www.youtube.com/watch?v=aud1'));
  assert.ok(!match.fallbackUrls.includes('https://www.youtube.com/watch?v=kara1'));
});

test('tagMusicFile writes ffmetadata tags into MP3 and Opus files via ffmpeg', async (t) => {
  const workDir = fs.mkdtempSync(path.join(testDir, 'tag-'));
  const mp3Path = path.join(workDir, 'sample.mp3');
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.2', '-q:a', '9', mp3Path,
  ], { stdio: 'ignore' });

  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 404 }));

  const res = await tagMusicFile(mp3Path, {
    title: 'Pardon Me',
    artist: 'Incubus',
    album: 'Make Yourself',
    trackNumber: 2,
    totalTracks: 13,
    year: '1999',
    genre: 'Alternative Rock',
  });
  assert.equal(res.tagged, true);

  const probeOut = execFileSync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_format', mp3Path,
  ], { encoding: 'utf8' });
  const tags = JSON.parse(probeOut).format.tags || {};
  assert.equal(tags.title || tags.TITLE, 'Pardon Me');
  assert.equal(tags.artist || tags.ARTIST, 'Incubus');
  assert.equal(tags.album || tags.ALBUM, 'Make Yourself');
});

test('enqueueMusicDownload sanitizes path traversal and formats disc-track output templates', async () => {
  assert.equal(sanitizeFilename('..'), 'Unknown');
  assert.equal(sanitizeFilename('AC/DC: Live*'), 'AC_DC_ Live_');

  const enqueued = [];
  const fakeQueue = {
    enqueue: (url, opts) => {
      enqueued.push({ url, opts });
      return 'job-music-1';
    },
  };

  const result = await enqueueMusicDownload({
    track: {
      title: 'Wish You Were Here',
      artist: 'Incubus',
      albumArtist: 'Incubus',
      album: 'Morning View',
      trackNumber: 3,
      totalTracks: 13,
      discNumber: 2,
      totalDiscs: 2,
      year: '2001',
      youtubeUrl: 'https://www.youtube.com/watch?v=wish123',
    },
    audioFormat: 'opus',
    audioQuality: '160k',
    musicFolder: '',
    saveCover: false,
    queueImpl: fakeQueue,
  });

  assert.equal(result.jobId, 'job-music-1');
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].url, 'https://www.youtube.com/watch?v=wish123');
  assert.equal(enqueued[0].opts.audioOnly, true);
  assert.equal(enqueued[0].opts.container, 'opus');
  assert.match(enqueued[0].opts.optionsJson.outputTemplate, /Incubus\/Morning View\/2-03 - Wish You Were Here\.%\(ext\)s$/);
  assert.equal(enqueued[0].opts.optionsJson.isMusicDownload, true);
  assert.equal(enqueued[0].opts.optionsJson.musicMetadata.title, 'Wish You Were Here');
});

test('inspectUrl rejects private/loopback URLs and flattens playlist entries', async (t) => {
  await assert.rejects(() => inspectUrl('http://127.0.0.1:8080/playlist'), /local\/private/);

  t.mock.method(ytdlp, 'getInfo', async () => ({
    id: 'PL999',
    title: 'Test Album Playlist',
    uploader: 'Artist Channel',
    entries: [
      { id: 't1', title: 'Track 1', duration: 180, url: 'https://www.youtube.com/watch?v=t1' },
      { id: 't2', title: 'Track 2', duration: 200, url: 'https://www.youtube.com/watch?v=t2' },
    ],
  }));

  const inspected = await inspectUrl('https://www.youtube.com/playlist?list=PL999');
  assert.equal(inspected.isPlaylist, true);
  assert.equal(inspected.trackCount, 2);
  assert.equal(inspected.entries[0].title, 'Track 1');
});
