const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {openFreshDb} = require('../../../test/helpers/queueHarness');
function setup(t) {
  const tmp = openFreshDb(t), root = path.join(tmp.dir,'music');
  fs.mkdirSync(path.join(root,'Album'),{recursive:true});
  const file = path.join(root,'Album','Song.mp3');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=duration=0.2','-metadata','title=Old title','-metadata','comment=Keep me',file]);
  const getRelease = async()=>({tracks:[{title:'Catalog title',artist:'Artist',albumArtist:'Artist',album:'Album',trackNumber:1,discNumber:1,totalTracks:1,musicbrainzReleaseTrackId:'track-id',musicbrainzRecordingId:'recording-id'}]});
  return {root,file,tmp,service:require('./reviews').createReviews({db:tmp.db,root:()=>root,getRelease})};
}
test('browsing confines paths and excludes staging, backups and symlinks',async t=>{
  const {root,service}=setup(t);
  fs.mkdirSync(path.join(root,'.staging'));
  fs.writeFileSync(path.join(root,'.staging','hidden.mp3'),'hidden');
  fs.symlinkSync(path.join(root,'Album','Song.mp3'),path.join(root,'link.mp3'));
  assert.deepEqual((await service.list('')).files.map(x=>x.path),['Album/Song.mp3']);
  await assert.rejects(service.inspect('../escape.mp3'),/path|directory/i);
  await assert.rejects(service.inspect('link.mp3'),/symlink/i);
  await assert.rejects(service.inspect('.staging/hidden.mp3'),/path|reserved/i);
});
test('preview does not write, apply backs up original tags, restore exactly restores the file',async t=>{
  const {file,service}=setup(t), before=fs.readFileSync(file);
  const review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  assert.ok(review.changes.some(c=>c.field==='title' && c.before==='Old title' && c.after==='Catalog title'));
  assert.deepEqual(fs.readFileSync(file),before);
  await service.apply(review.id);
  assert.equal((await service.inspect('Album/Song.mp3')).tags.title,'Catalog title');
  await service.restore(review.id);
  assert.deepEqual(fs.readFileSync(file),before);
});
test('changed files and replayed requests cannot overwrite newer user edits',async t=>{
  const {file,service}=setup(t);
  const review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  fs.appendFileSync(file,'changed');
  await assert.rejects(service.apply(review.id),/changed/i);
  assert.ok(fs.readFileSync(file).includes(Buffer.from('changed')));
});
test('restore refuses to replace music modified after apply',async t=>{
  const {file,service}=setup(t);
  const review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  await service.apply(review.id);
  fs.appendFileSync(file,'new edit');
  await assert.rejects(service.restore(review.id),/changed/i);
  await assert.rejects(service.apply(review.id),/applied|status|ready/i);
});

test('a symlink backup directory is refused before writing outside the music root',async t=>{
  const {root,file,tmp,service}=setup(t);
  const outside=path.join(tmp.dir,'outside');fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(root,'.tag-backups'));
  const before=fs.readFileSync(file);
  const review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  await assert.rejects(service.apply(review.id),/symlink/i);
  assert.deepEqual(fs.readdirSync(outside),[]);
  assert.deepEqual(fs.readFileSync(file),before);
});
test('an external edit immediately after helper publication is never trusted for restore',async t=>{
  const {file,service}=setup(t), tagger=require('./tagger');
  const original=tagger.writeVerifiedTags;
  t.mock.method(tagger,'writeVerifiedTags',async(...args)=>{
    const result=await original(...args);
    fs.appendFileSync(file,'external edit after publication');
    return result;
  });
  const review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  await assert.rejects(service.apply(review.id),/changed after tagging/i);
  await assert.rejects(service.restore(review.id),/Interrupted review/i);
  assert.ok(fs.readFileSync(file).includes(Buffer.from('external edit after publication')));
});
