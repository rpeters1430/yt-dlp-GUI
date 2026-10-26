const test=require('node:test');
const assert=require('node:assert/strict');
const {createFingerprintService}=require('./fingerprint');
test('lookup sends only fingerprint metadata and returns suggestions without audio or credentials',async()=>{
  const service=createFingerprintService({loadKey:()=> 'application-key',runFpcalc:async()=>({duration:180.2,fingerprint:'fingerprint-data'}),fetchImpl:async(url,opts)=>{
    assert.equal(url,'https://api.acoustid.org/v2/lookup');
    const body=new URLSearchParams(opts.body);
    assert.equal(body.get('client'),'application-key');
    assert.equal(body.get('duration'),'180');
    assert.equal(body.get('fingerprint'),'fingerprint-data');
    assert.equal(body.has('file'),false);
    return {ok:true,json:async()=>({status:'ok',results:[{id:'acoustid',score:0.98,recordings:[{id:'recording',title:'Song',artists:[{id:'artist',name:'Band'}],releases:[{id:'release',title:'Album'}]}]}]})};
  }});
  const result=await service.lookup('/music/local.mp3');
  assert.equal(result.matches[0].recordingId,'recording');
  assert.equal(result.matches[0].releases[0].id,'release');
  assert.equal(JSON.stringify(result).includes('application-key'),false);
});
test('a missing free application key and API errors never fabricate a music match',async()=>{
  const missing=createFingerprintService({loadKey:()=>'',runFpcalc:async()=>{throw new Error('must not run');}});
  await assert.rejects(missing.lookup('/file.mp3'),/application key/i);
  const bad=createFingerprintService({loadKey:()=> 'key',runFpcalc:async()=>({duration:100,fingerprint:'fp'}),fetchImpl:async()=>({ok:true,json:async()=>({status:'error',error:{message:'invalid client'}})})});
  await assert.rejects(bad.lookup('/file.mp3'),/AcoustID lookup failed/);
});

test('the packaged Chromaprint binary fingerprints actual audio',async t=>{
  const fs=require('fs'), os=require('os'), path=require('path');
  const {execFileSync}=require('child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-fpcalc-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'tone.wav');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=8',file]);
  const result=await require('./fingerprint').runFpcalc(file);
  assert.equal(Math.round(result.duration),8);
  assert.ok(result.fingerprint.length>20);
});
