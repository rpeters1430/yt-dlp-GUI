const test=require('node:test');
const assert=require('node:assert/strict');
const {createMetadataClient}=require('./musicbrainzClient');
function setup(responses) {
  let now=10000;
  const calls=[];
  const client=createMetadataClient({now:()=>now,sleep:async ms=>{now+=ms;},fetchImpl:async()=>{calls.push(now);return responses.shift();}});
  return {client,calls,advance:ms=>{now+=ms;}};
}
const response=(status,retryAfter)=>({ok:status===200,status,headers:{get:()=>retryAfter || null},body:{cancel:async()=>{}},json:async()=>({ok:true})});
test('a temporary 503 retries with Retry-After and shares the request with concurrent callers',async()=>{
  const {client,calls}=setup([response(503,'3'),response(200)]);
  const [one,two]=await Promise.all([client.request('release',{query:'same'}),client.request('release',{query:'same'})]);
  assert.deepEqual(one,two);assert.equal(calls.length,2);assert.ok(calls[1]-calls[0]>=3000);
});
test('retries are bounded, errors remain useful and a failed cache entry can be tried again',async()=>{
  const {client,calls}=setup([response(503),response(503),response(503),response(200)]);
  await assert.rejects(client.request('release'),/busy|throttling/i);
  assert.equal(calls.length,3);
  assert.deepEqual(await client.request('release'),{ok:true});
});
test('long server cooldown is honored by subsequent requests without an early retry',async()=>{
  const {client,calls,advance}=setup([response(429,'120'),response(200)]);
  await assert.rejects(client.request('release',{query:'a'}),/120 seconds/);
  assert.equal(calls.length,1);
  await assert.rejects(client.request('release',{query:'b'}),/seconds/);
  assert.equal(calls.length,1);
  advance(120000);
  await client.request('release',{query:'b'});
  assert.ok(calls[1]-calls[0]>=120000);
});
test('permanent errors are not retried and distinct requests retain rate spacing',async()=>{
  const {client,calls}=setup([response(400),response(200)]);
  await assert.rejects(client.request('release',{query:'bad'}),/HTTP 400/);
  await client.request('release',{query:'good'});
  assert.equal(calls.length,2);assert.ok(calls[1]-calls[0]>=1100);
});

test('a connection failure while reading a successful response body is retried',async()=>{
  const broken=response(200);broken.json=async()=>{throw new TypeError('terminated');};
  const {client,calls}=setup([broken,response(200)]);
  assert.deepEqual(await client.request('release'),{ok:true});
  assert.equal(calls.length,2);
});
