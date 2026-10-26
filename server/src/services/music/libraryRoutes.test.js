const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {openFreshDb}=require('../../../test/helpers/queueHarness');
async function setup(t,signedIn=true) {
  const tmp=openFreshDb(t);
  const id=tmp.db.prepare("INSERT INTO users (username,password_hash) VALUES ('admin','x')").run().lastInsertRowid;
  const app=express();
  app.use(express.json());
  app.use((req,res,next)=>{req.session=signedIn ? {userId:id,sessionVersion:1,destroy:callback=>callback?.()} : {destroy:callback=>callback?.()};next();});
  app.use('/library',require('../../routes/musicLibrary'));
  const server=await new Promise(resolve=>{const srv=app.listen(0,()=>resolve(srv));});
  t.after(()=>server.close());
  return {tmp,base:`http://127.0.0.1:${server.address().port}/library`};
}
test('existing-library operations require authentication',async t=>{
  const {base}=await setup(t,false);
  for(const [method,url] of [['GET','/files'],['POST','/inspect'],['POST','/preview'],['POST','/identify'],['GET','/reviews'],['POST','/reviews/no/apply'],['POST','/reviews/no/restore']]) {
    assert.equal((await fetch(base+url,{method})).status,401,url);
  }
});
test('fingerprint settings never return the application key and reject malformed input',async t=>{
  const {base}=await setup(t);
  const put=key=>fetch(base+'/fingerprint/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientKey:key})});
  const res=await put('my-secret-key');
  const body=await res.json();
  assert.equal(body.configured,true);
  assert.equal(JSON.stringify(body).includes('my-secret-key'),false);
  assert.equal((await put({bad:'type'})).status,400);
  assert.equal((await (await put('')).json()).configured,false);
});

test('authenticated inspect, preview, apply and restore round-trip the actual original file',async t=>{
  const {base,tmp}=await setup(t);
  const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
  const root=path.join(tmp.dir,'music');fs.mkdirSync(root);
  tmp.db.prepare("INSERT INTO settings (key,value) VALUES ('music_folder',?)").run(root);
  const file=path.join(root,'song.mp3');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=duration=0.2','-metadata','title=Old',file]);
  const original=fs.readFileSync(file);
  t.mock.method(require('../musicbrainz'),'getRelease',async()=>({tracks:[{title:'Correct title',artist:'Artist',musicbrainzReleaseTrackId:'track'}]}));
  const post=(route,body={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await (await post('/inspect',{path:'song.mp3'})).json()).tags.title,'Old');
  const preview=await (await post('/preview',{path:'song.mp3',releaseId:'release',releaseTrackId:'track'})).json();
  assert.ok(preview.id);
  assert.deepEqual(fs.readFileSync(file),original);
  assert.equal((await post(`/reviews/${preview.id}/apply`)).status,200);
  assert.equal((await (await post('/inspect',{path:'song.mp3'})).json()).tags.title,'Correct title');
  assert.equal((await post(`/reviews/${preview.id}/restore`)).status,200);
  assert.deepEqual(fs.readFileSync(file),original);
  assert.equal((await post('/inspect',{path:'../outside.mp3'})).status,400);
});
