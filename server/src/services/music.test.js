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

test('tagMusicFile writes and verifies MP3 tags with Mutagen', async (t) => {
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
  assert.match(enqueued[0].opts.optionsJson.musicImport.finalTemplate, /Incubus\/Morning View\/2-03 - Wish You Were Here\.%\(ext\)s$/);
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

  const dns = require('dns').promises;
  t.mock.method(dns, 'lookup', async () => [{address:'8.8.8.8', family:4}]);
  const inspected = await inspectUrl('https://www.youtube.com/playlist?list=PL999');
  assert.equal(inspected.isPlaylist, true);
  assert.equal(inspected.trackCount, 2);
  assert.equal(inspected.entries[0].title, 'Track 1');
});

test('Mutagen round-trips MusicBrainz identifiers and credits in every supported container without changing audio', async () => {
  for (const [ext, codec] of [['mp3','libmp3lame'],['m4a','aac'],['flac','flac'],['opus','libopus'],['ogg','libvorbis'],['wav','pcm_s16le']]) {
    const file = path.join(testDir, `rich.${ext}`);
    execFileSync('ffmpeg', ['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=0.2','-c:a',codec,file]);
    const audioHash = () => execFileSync('ffmpeg', ['-v','error','-i',file,'-map','0:a','-c','copy','-f','hash','-'], {encoding:'utf8'}).trim();
    const before = audioHash();
    const result = await tagMusicFile(file, {title:'Guest Song', artist:'A feat. B', artists:['A','B'], albumArtist:'A', album:'Album',
      trackNumber:1, totalTracks:2, discNumber:2, totalDiscs:2, date:'2020-05-02', originalDate:'1999-01-01',
      musicbrainzReleaseId:'release-id', musicbrainzRecordingId:'recording-id', musicbrainzReleaseTrackId:'release-track-id',
      musicbrainzArtistIds:['a-id','b-id'], isrc:'USAAA0000001'});
    assert.equal(result.verified, true, ext);
    assert.equal(result.tags.musicbrainzRecordingId, 'recording-id', ext);
    assert.equal(result.tags.musicbrainzReleaseTrackId, 'release-track-id', ext);
    assert.deepEqual(result.tags.musicbrainzArtistIds, ['a-id','b-id'], ext);
    assert.equal(result.tags.originalDate, '1999-01-01', ext);
    assert.equal(audioHash(), before, `${ext} audio packets unchanged`);
  }
});

test('automatic matching rejects unrelated or incompatible versions instead of tagging the best bad result', async t => {
  t.mock.method(ytdlp, 'searchYouTube', async () => [{id:'bad', url:'https://youtube.com/watch?v=bad', title:'Other Song', uploader:'Other - Topic', duration:200}]);
  await assert.rejects(matchTrackToYouTube({artist:'Wanted',title:'Song',duration:200}), /review|confident/i);
});

test('album artwork embeds in all containers and invalid artwork cannot alter the audio file', async t => {
  const pngPath = path.join(testDir,'cover.png');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=blue:s=16x16','-frames:v','1',pngPath]);
  const image = fs.readFileSync(pngPath);
  t.mock.method(require('dns').promises,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  t.mock.method(global,'fetch',async()=>new Response(image,{headers:{'content-type':'image/png'}}));
  for (const [ext,codec] of [['mp3','libmp3lame'],['m4a','aac'],['flac','flac'],['opus','libopus'],['ogg','libvorbis'],['wav','pcm_s16le']]) {
    const file = path.join(testDir,`art.${ext}`);
    execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=duration=0.1','-c:a',codec,file]);
    const result = await tagMusicFile(file,{title:'Artwork Song',artworkUrl:'https://art.example.org/cover.png'});
    assert.equal(result.artwork,true,ext);
  }
  const file = path.join(testDir,'art.mp3'), original = fs.readFileSync(file);
  const {writeVerifiedTags} = require('./music/tagger');
  await assert.rejects(writeVerifiedTags(file,{title:'Changed'},{data:Buffer.from('not an image')}),/Artwork must be/);
  assert.deepEqual(fs.readFileSync(file),original);
});

test('inspection is read-only, preservation keeps unrelated tags, and a stale revision blocks writes', async () => {
  const file = path.join(testDir,'inspect.mp3');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=duration=0.2','-metadata','title=Original','-metadata','comment=Keep me',file]);
  const {inspectAudio,writeVerifiedTags} = require('./music/tagger');
  const before = fs.readFileSync(file);
  const inspection = await inspectAudio(file,{title:'New Title'});
  assert.equal(inspection.tags.title,'Original');
  assert.equal(inspection.proposed.title,'New Title');
  assert.deepEqual(fs.readFileSync(file),before);
  await assert.rejects(writeVerifiedTags(file,{title:'Wrong'},null,{expectedSha256:'0'.repeat(64),scrub:false}),/changed/i);
  assert.deepEqual(fs.readFileSync(file),before);
  await writeVerifiedTags(file,{title:'New Title'},null,{scrub:false});
  const raw = JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_format','-of','json',file],{encoding:'utf8'}));
  assert.equal(raw.format.tags.comment,'Keep me');
});

test('standard MusicBrainz UFID recording IDs are inspected and explicitly cleared',async()=>{
  const file=path.join(testDir,'ufid.mp3');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=duration=0.2',file]);
  execFileSync(process.env.PYTHON_BIN || 'python3',['-c',"import sys; from mutagen.mp3 import MP3; from mutagen.id3 import UFID; a=MP3(sys.argv[1]); a.add_tags() if a.tags is None else None; a.tags.add(UFID(owner='http://musicbrainz.org',data=b'old-recording-id')); a.save()",file]);
  const {inspectAudio,writeVerifiedTags}=require('./music/tagger');
  assert.equal((await inspectAudio(file)).tags.musicbrainzRecordingId,'old-recording-id');
  await writeVerifiedTags(file,{title:'New title'},null,{scrub:false,clearFields:['musicbrainzRecordingId']});
  assert.equal((await inspectAudio(file)).tags.musicbrainzRecordingId,undefined);
});

test('preservation mode keeps comments and embedded artwork across all supported containers',async()=>{
  const png=path.join(testDir,'preserve-cover.png');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=green:s=16x16','-frames:v','1',png]);
  const artwork={data:fs.readFileSync(png)}, {inspectAudio,writeVerifiedTags}=require('./music/tagger');
  for(const [ext,codec] of [['mp3','libmp3lame'],['m4a','aac'],['flac','flac'],['opus','libopus'],['ogg','libvorbis'],['wav','pcm_s16le']]) {
    const file=path.join(testDir,`preserve.${ext}`);
    execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=duration=0.2','-c:a',codec,'-metadata','comment=Keep this comment',file]);
    await writeVerifiedTags(file,{title:'Original'},artwork,{scrub:false});
    await writeVerifiedTags(file,{title:'Changed'},null,{scrub:false});
    const info=await inspectAudio(file);
    assert.equal(info.tags.title,'Changed',ext);
    assert.equal(info.artwork,true,ext);
    const raw=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_format','-show_streams','-of','json',file],{encoding:'utf8'}));
    const comments=[raw.format?.tags,...(raw.streams || []).filter(stream=>stream.codec_type==='audio').map(stream=>stream.tags)].flatMap(tags=>Object.entries(tags || {}).filter(([key])=>key.toLowerCase()==='comment').map(([,value])=>value));
    assert.ok(comments.includes('Keep this comment'),ext);
  }
});

test('the final revision check catches an external edit during output hashing',async()=>{
  const file=path.join(testDir,'hash-window.mp3');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=duration=0.2',file]);
  const revision=require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const helper=path.join(__dirname,'music','tag_audio.py');
  const script=`import importlib.util,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('tag_audio',sys.argv[1])
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
source=sys.argv[2]
original=m.digest_file
def digest(filename):
    result=original(filename)
    if filename!=source:
        with open(source,'ab') as f: f.write(b'external edit during hashing')
    return result
m.digest_file=digest
try:
    m.main({'filepath':source,'metadata':{'title':'Changed'},'expectedSha256':sys.argv[3],'scrub':False})
except ValueError as error:
    assert 'changed' in str(error).lower()
else:
    raise AssertionError('External edit was overwritten')
`;
  execFileSync(process.env.PYTHON_BIN || 'python3',['-c',script,helper,file,revision]);
  assert.ok(fs.readFileSync(file).includes(Buffer.from('external edit during hashing')));
});
