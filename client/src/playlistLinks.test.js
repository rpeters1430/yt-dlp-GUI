import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPlaylistVideoUrl } from './playlistLinks.js';

test('splitPlaylistVideoUrl turns a video opened from a playlist into the video link', () => {
  assert.deepEqual(splitPlaylistVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4'), {
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    playlistUrl: 'https://www.youtube.com/playlist?list=PL123',
  });
  assert.deepEqual(splitPlaylistVideoUrl('https://m.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&t=42'), {
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
    playlistUrl: 'https://www.youtube.com/playlist?list=PL123',
  });
  assert.equal(splitPlaylistVideoUrl('https://youtu.be/dQw4w9WgXcQ?list=PL123').videoUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(splitPlaylistVideoUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=OLAK5uy_abc').playlistUrl, 'https://www.youtube.com/playlist?list=OLAK5uy_abc');
});

test('splitPlaylistVideoUrl offers no playlist for mixes and ignores other links', () => {
  assert.equal(splitPlaylistVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ').playlistUrl, null);
  assert.equal(splitPlaylistVideoUrl('https://www.youtube.com/playlist?list=PL123'), null);
  assert.equal(splitPlaylistVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(splitPlaylistVideoUrl('https://example.com/watch?v=dQw4w9WgXcQ&list=PL123'), null);
  assert.equal(splitPlaylistVideoUrl('not a url'), null);
});
