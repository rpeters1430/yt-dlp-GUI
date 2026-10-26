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

test('field choices preserve existing identifiers and genre by default and reject arbitrary edits', async t=>{
  const {file,service}=setup(t);
  await require('./tagger').writeVerifiedTags(file,{title:'Old title',genre:'Folk Rock',musicbrainzRecordingId:'existing'},null,{scrub:false});
  const review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  assert.equal(review.changes.find(c=>c.field==='musicbrainzRecordingId').action,'keep');
  await assert.rejects(service.apply(review.id,{title:'invented'}),/choice/i);
  await service.apply(review.id,{title:'keep',musicbrainzRecordingId:'clear'});
  const tags=(await service.inspect('Album/Song.mp3')).tags;
  assert.equal(tags.title,'Old title');
  assert.equal(tags.genre,'Folk Rock');
  assert.ok(!tags.musicbrainzRecordingId);
});
test('keeping a field never rewrites it through artist defaults and numeric totals remain intact', async t=>{
  const {file,service}=setup(t);
  const tagger=require('./tagger');
  await tagger.writeVerifiedTags(file,{artist:'Original artist',albumArtist:'Original album artist',trackNumber:7,totalTracks:12,discNumber:2,totalDiscs:3},null,{scrub:false});
  const review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  const choices=Object.fromEntries(review.changes.map(change=>[change.field,'keep']));
  choices.artist='replace';choices.trackNumber='replace';
  await service.apply(review.id,choices);
  const tags=(await service.inspect('Album/Song.mp3')).tags;
  assert.equal(tags.artist,'Artist');
  assert.equal(tags.albumArtist,'Original album artist');
  assert.equal(tags.trackNumber,'1');assert.equal(tags.totalTracks,'12');
  assert.equal(tags.discNumber,'2');assert.equal(tags.totalDiscs,'3');
});
test('an unavailable catalog field cannot be replaced and unsupported choices are refused', async t=>{
  const {file,service}=setup(t);
  await require('./tagger').writeVerifiedTags(file,{genre:'Folk Rock'},null,{scrub:false});
  const review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  await assert.rejects(service.apply(review.id,{genre:'replace'}),/Invalid tag choice/);
  await assert.rejects(service.apply(review.id,{unknown:'clear'}),/Invalid tag choice/);
});

test('clearing a total preserves its number, and clearing a number requires clearing its total', async t=>{
  const {file,service}=setup(t);
  await require('./tagger').writeVerifiedTags(file,{trackNumber:7,totalTracks:12},null,{scrub:false});
  let review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  const keep=Object.fromEntries(review.changes.map(change=>[change.field,'keep']));
  await assert.rejects(service.apply(review.id,{...keep,trackNumber:'clear'}),/associated total/);
  await service.apply(review.id,{...keep,totalTracks:'clear'});
  let tags=(await service.inspect('Album/Song.mp3')).tags;
  assert.equal(tags.trackNumber,'7');assert.ok(!tags.totalTracks);
  review=await service.preview({path:'Album/Song.mp3',releaseId:'release-id',releaseTrackId:'track-id'});
  await service.apply(review.id,{...Object.fromEntries(review.changes.map(change=>[change.field,'keep'])),trackNumber:'clear',totalTracks:'clear'});
  tags=(await service.inspect('Album/Song.mp3')).tags;
  assert.ok(!tags.trackNumber);assert.ok(!tags.totalTracks);
});
