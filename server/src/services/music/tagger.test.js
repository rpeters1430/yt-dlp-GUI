const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {writeVerifiedTags, inspectAudio} = require('./tagger');

for (const ext of ['mp3', 'm4a', 'flac', 'opus', 'ogg', 'wav']) {
  test(`review clears present and absent identifiers in ${ext}`, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-clear-'));
    t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
    const file = path.join(dir, `song.${ext}`);
    execFileSync('ffmpeg', ['-v','error','-y','-f','lavfi','-i','sine=duration=0.2',file]);
    await writeVerifiedTags(file, {title:'Song', musicbrainzRecordingId:'old-recording'}, null, {scrub:false});
    assert.equal((await inspectAudio(file)).tags.musicbrainzRecordingId, 'old-recording');
    const options = {scrub:false, clearFields:['musicbrainzRecordingId', 'musicbrainzReleaseId']};
    await writeVerifiedTags(file, {title:'Updated'}, null, options);
    const result = await inspectAudio(file);
    assert.equal(result.tags.title, 'Updated');
    assert.ok(!result.tags.musicbrainzRecordingId);
    await writeVerifiedTags(file, {title:'Updated'}, null, options);
  });
}
