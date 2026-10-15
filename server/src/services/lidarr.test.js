const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const lidarr = require('./lidarr');

describe('lidarr service', () => {
  it('bencodes basic types according to BitTorrent specification', () => {
    assert.equal(lidarr.bencode(42).toString('ascii'), 'i42e');
    assert.equal(lidarr.bencode('test').toString('ascii'), '4:test');
    assert.equal(lidarr.bencode(['a', 1]).toString('ascii'), 'l1:ai1ee');
    assert.equal(lidarr.bencode({ b: 2, a: 'hello' }).toString('ascii'), 'd1:a5:hello1:bi2ee');
  });

  it('generates a valid torrent buffer with deterministic infohash', () => {
    const buf = lidarr.generateTorrentBuffer({
      type: 'album',
      id: '12345',
      artist: 'Test Artist',
      album: 'Test Album',
      sizeBytes: 1048576,
    });
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 50);
    // Torrents start with 'd' in bencode
    assert.equal(buf[0], 'd'.charCodeAt(0));
    assert.ok(buf.toString('utf8').includes('yt-dlp-gui'));
  });

  it('escapes XML properly', () => {
    const raw = '<artist name="Tom & Jerry" title=\'Rock "N" Roll\'>';
    const escaped = lidarr.escapeXml(raw);
    assert.ok(!escaped.includes('<artist'));
    assert.ok(escaped.includes('&lt;artist'));
    assert.ok(escaped.includes('&amp;'));
    assert.ok(escaped.includes('&quot;'));
  });

  it('generates Torznab caps XML with music capabilities', () => {
    const caps = lidarr.getCapsXml();
    assert.ok(caps.includes('<caps>'));
    assert.ok(caps.includes('<audio-search available="yes"'));
    assert.ok(caps.includes('id="3000" name="Audio"'));
  });

  it('generates deterministic SHA-1 hashes for releases', () => {
    const hash1 = lidarr.getDeterministicHash('album', '12345');
    const hash2 = lidarr.getDeterministicHash('album', '12345');
    assert.equal(hash1.length, 40);
    assert.equal(hash1, hash2);
  });

  it('bdecodes buffers and parses generated torrent metadata', () => {
    const buf = lidarr.generateTorrentBuffer({
      type: 'album',
      id: 'album-987',
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
    });
    const parsed = lidarr.parseTorrentBuffer(buf);
    assert.ok(parsed);
    assert.equal(parsed.id, 'album-987');
    assert.equal(parsed.type, 'album');
    assert.equal(parsed.artist, 'Pink Floyd');
    assert.equal(parsed.album, 'The Dark Side of the Moon');
  });

  it('computes the BitTorrent infohash Lidarr uses as the download ID', () => {
    const crypto = require('crypto');
    const buf = lidarr.generateTorrentBuffer({ type: 'album', id: '42', artist: 'Incubus', album: 'Morning View' });
    const info = lidarr.bdecode(buf).info;
    const expected = crypto.createHash('sha1').update(lidarr.bencode(info)).digest('hex');
    assert.equal(lidarr.getInfoHash(buf), expected);
    assert.equal(lidarr.parseTorrentBuffer(buf).infoHash, expected);
    // The URL path (no file upload) must land on the same hash as the served .torrent.
    assert.equal(lidarr.computeReleaseHash({ type: 'album', id: '42', artist: 'Incubus', album: 'Morning View' }), expected);
    assert.equal(lidarr.getInfoHash(Buffer.from('not a torrent')), null);
  });

  it('labels releases with the configured format and sizes them by bitrate', () => {
    assert.equal(lidarr.describeReleaseFormat('mp3', '320k').label, 'MP3 320');
    assert.equal(lidarr.describeReleaseFormat('mp3', '320k').category, 3010);
    assert.equal(lidarr.describeReleaseFormat('m4a', '256k').label, 'AAC 256');
    assert.equal(lidarr.describeReleaseFormat('flac', 'best').label, 'FLAC');
    assert.equal(lidarr.describeReleaseFormat('flac', '320k').category, 3040);
    // 10 tracks * 2 min at 320 kbps = 48 MB
    assert.equal(lidarr.estimateReleaseSize(10, 'mp3', '320k'), 48000000);
  });

  it('manages qBittorrent categories dynamically', () => {
    const initial = lidarr.getQbitCategories();
    assert.ok(initial.music);

    lidarr.addQbitCategory('rock', '/music/rock');
    const updated = lidarr.getQbitCategories();
    assert.ok(updated.rock);
    assert.equal(updated.rock.name, 'rock');

    lidarr.removeQbitCategories('rock');
    const afterDelete = lidarr.getQbitCategories();
    assert.equal(afterDelete.rock, undefined);
  });

  it('normalizes musicFolder to absolute Linux paths for Alpine/Docker compatibility', () => {
    assert.ok(lidarr.normalizeMusicFolder('Music').startsWith('/'));
    assert.ok(lidarr.normalizeMusicFolder('Music').endsWith('/Music'));
    assert.equal(lidarr.normalizeMusicFolder('/custom/music'), '/custom/music');
    assert.ok(lidarr.normalizeMusicFolder('C:\\Music').startsWith('/'));
    assert.ok(lidarr.normalizeMusicFolder('').startsWith('/'));
  });
});

