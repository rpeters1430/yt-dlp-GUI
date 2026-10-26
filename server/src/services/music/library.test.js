const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {libraryTemplate, importTrack} = require('./library');

test('release naming distinguishes editions and sanitizes literal yt-dlp template characters', () => {
  const file = libraryTemplate('/music', {albumArtist:'A', album:'100% Album', year:'2020', edition:'Deluxe', musicbrainzReleaseId:'12345678-abcd', title:'Song', trackNumber:1, discNumber:2, totalDiscs:2}, 'release');
  assert.equal(file, '/music/A/100%% Album (2020) [Deluxe] [12345678-abcd]/Disc 02/01 - Song.%(ext)s');
});
test('import never overwrites existing music, and a retry recognizes its own already-published file', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'music-import-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const staged = path.join(dir,'staged.mp3'), final = path.join(dir,'Album','01.mp3');
  fs.writeFileSync(staged,'audio');
  const result = await importTrack(staged, final, {sourceUrl:'https://example.com/music'});
  assert.equal(result.filepath,final);
  assert.equal(fs.readFileSync(final,'utf8'),'audio');
  assert.equal(JSON.parse(fs.readFileSync(final+'.source.json')).sourceUrl,'https://example.com/music');
  fs.writeFileSync(staged,'different audio');
  await assert.rejects(importTrack(staged,final,{}), /already exists/);
  assert.equal(fs.readFileSync(final,'utf8'),'audio');
});
