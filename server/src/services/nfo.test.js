const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nfo = require('./nfo');

const info = {
  title: 'Building a <Treehouse>',
  description: 'Plot & more',
  uploader: 'Example Channel',
  uploadDate: '20261002',
  duration: 754,
  tags: ['wood'],
  thumbnailUrl: 'https://img.example/thumb.jpg',
  videoId: 'abc123',
  sourceUrl: 'https://www.youtube.com/watch?v=abc123',
  channelUrl: 'https://www.youtube.com/channel/UC123',
  channelId: 'UC123',
};

const channelInfo = {
  channel: 'Example Channel',
  description: 'All about building',
  channel_id: 'UC123',
  thumbnails: [
    { id: '0', url: 'https://img.example/banner-small', width: 1060, height: 175 },
    { id: 'banner_uncropped', url: 'https://img.example/banner' },
    { id: '7', url: 'https://img.example/avatar-900', width: 900, height: 900 },
    { id: 'avatar_uncropped', url: 'https://img.example/avatar' },
  ],
};

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfo-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Serves a fixed body for every image URL and records which ones were fetched.
function stubFetch(t) {
  const fetched = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => Buffer.from(`image:${url}`) };
  };
  t.after(() => { global.fetch = original; });
  return fetched;
}

test('tvLayout recognizes only Season folders', () => {
  assert.deepEqual(nfo.tvLayout('/downloads/Chan/Season 2026/S2026E1002 - x.mp4'), {
    season: 2026, seasonDir: '/downloads/Chan/Season 2026', showDir: '/downloads/Chan',
  });
  assert.equal(nfo.tvLayout('/downloads/Chan/x.mp4'), null);
  assert.equal(nfo.tvLayout('/downloads/Chan/2026/x.mp4'), null);
});

test('episode NFO numbers the episode by month and day', () => {
  const xml = nfo.buildEpisodeNfoXml(info, { season: 2026 });
  assert.match(xml, /<episodedetails>/);
  assert.match(xml, /<season>2026<\/season>/);
  assert.match(xml, /<episode>1002<\/episode>/);
  assert.match(xml, /<aired>2026-10-02<\/aired>/);
  assert.match(xml, /<showtitle>Example Channel<\/showtitle>/);
  assert.match(xml, /<title>Building a &lt;Treehouse&gt;<\/title>/);
});

test('channelArtwork prefers the uncropped avatar and banner', () => {
  assert.deepEqual(nfo.channelArtwork(channelInfo), { posterUrl: 'https://img.example/avatar', fanartUrl: 'https://img.example/banner' });
  assert.deepEqual(nfo.channelArtwork({ thumbnails: channelInfo.thumbnails.filter((t) => !t.id.includes('uncropped')) }), {
    posterUrl: 'https://img.example/avatar-900', fanartUrl: 'https://img.example/banner-small',
  });
  assert.deepEqual(nfo.channelArtwork(null), { posterUrl: null, fanartUrl: null });
});

test('a download in a Season folder gets an episode NFO and the show gets tvshow.nfo, poster and fanart', async (t) => {
  const dir = tempDir(t);
  const fetched = stubFetch(t);
  const file = path.join(dir, 'Example Channel', 'Season 2026', 'S2026E1002 - Building [abc123].mp4');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  const channelCalls = [];
  await nfo.writeSidecarFiles(file, info, { fetchChannelInfo: async (url) => { channelCalls.push(url); return channelInfo; } });

  const show = path.join(dir, 'Example Channel');
  assert.match(fs.readFileSync(file.replace(/\.mp4$/, '.nfo'), 'utf8'), /<episodedetails>/);
  assert.ok(fs.existsSync(file.replace(/\.mp4$/, '.jpg')));
  const showNfo = fs.readFileSync(path.join(show, 'tvshow.nfo'), 'utf8');
  assert.match(showNfo, /<tvshow>/);
  assert.match(showNfo, /<plot>All about building<\/plot>/);
  assert.match(showNfo, /<uniqueid type="youtube" default="true">UC123<\/uniqueid>/);
  assert.equal(fs.readFileSync(path.join(show, 'poster.jpg'), 'utf8'), 'image:https://img.example/avatar');
  assert.equal(fs.readFileSync(path.join(show, 'fanart.jpg'), 'utf8'), 'image:https://img.example/banner');
  assert.deepEqual(channelCalls, ['https://www.youtube.com/channel/UC123']);

  // A second episode doesn't refetch the channel or overwrite files the user may have replaced.
  fs.writeFileSync(path.join(show, 'poster.jpg'), 'custom');
  const second = path.join(show, 'Season 2026', 'S2026E1003 - Next [def456].mp4');
  fs.writeFileSync(second, '');
  await nfo.writeSidecarFiles(second, { ...info, videoId: 'def456', uploadDate: '20261003' }, {
    fetchChannelInfo: async (url) => { channelCalls.push(url); return channelInfo; },
  });
  assert.equal(channelCalls.length, 1);
  assert.equal(fs.readFileSync(path.join(show, 'poster.jpg'), 'utf8'), 'custom');
  assert.equal(fetched.filter((u) => u === 'https://img.example/avatar').length, 1);
});

test('the default layout still writes a movie NFO and no show files', async (t) => {
  const dir = tempDir(t);
  stubFetch(t);
  const file = path.join(dir, 'Example Channel', 'Building [abc123].mp4');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  let channelCalls = 0;
  await nfo.writeSidecarFiles(file, info, { fetchChannelInfo: async () => { channelCalls++; return channelInfo; } });
  assert.match(fs.readFileSync(file.replace(/\.mp4$/, '.nfo'), 'utf8'), /<movie>/);
  assert.equal(fs.existsSync(path.join(dir, 'Example Channel', 'tvshow.nfo')), false);
  assert.equal(channelCalls, 0);
});

test('a failed channel lookup still writes tvshow.nfo from the video metadata', async (t) => {
  const dir = tempDir(t);
  stubFetch(t);
  const file = path.join(dir, 'Example Channel', 'Season 2026', 'x [abc123].mp4');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  await nfo.writeSidecarFiles(file, info, { fetchChannelInfo: async () => { throw new Error('bot check'); } });
  assert.match(fs.readFileSync(path.join(dir, 'Example Channel', 'tvshow.nfo'), 'utf8'), /<title>Example Channel<\/title>/);
  assert.equal(fs.existsSync(path.join(dir, 'Example Channel', 'poster.jpg')), false);
});
