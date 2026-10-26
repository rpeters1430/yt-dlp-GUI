const test = require('node:test');
const assert = require('node:assert/strict');
const {openFreshDb, insertJob} = require('../../../test/helpers/queueHarness');

test('an album cannot import while more tracks are being enqueued, downloading, or failed', t => {
  const tmp = openFreshDb(t);
  const batches = require('./batches');
  const id = batches.begin(2);
  insertJob(tmp.db,{id:'one',status:'completed'});
  tmp.db.prepare('UPDATE downloads SET options_json=? WHERE id=?').run(JSON.stringify({musicBatchId:id}),'one');
  assert.equal(batches.ready(id),null);
  insertJob(tmp.db,{id:'two',status:'downloading'});
  tmp.db.prepare('UPDATE downloads SET options_json=? WHERE id=?').run(JSON.stringify({musicBatchId:id}),'two');
  batches.seal(id,0);
  assert.equal(batches.ready(id),null);
  tmp.db.prepare("UPDATE downloads SET status='failed' WHERE id='two'").run();
  assert.equal(batches.ready(id),null);
  tmp.db.prepare("UPDATE downloads SET status='completed' WHERE id='two'").run();
  assert.equal(batches.ready(id).length,2);
});

test('startup recovery seals fully persisted requests and replays scans lost before timer dispatch', t => {
  const tmp = openFreshDb(t);
  const batches = require('./batches');
  const jellyfin = require('../jellyfinSync');
  t.mock.method(jellyfin,'getSyncConfig',()=>({url:'http://jellyfin',apiKey:'test'}));
  const scan = t.mock.method(jellyfin,'scheduleLibraryScan',()=>{});
  const id = batches.begin(1);
  insertJob(tmp.db,{id:'track',status:'completed'});
  tmp.db.prepare('UPDATE downloads SET options_json=? WHERE id=?').run(JSON.stringify({musicBatchId:id}),'track');
  assert.equal(batches.recover(),1);
  assert.equal(scan.mock.callCount(),1);
  assert.equal(tmp.db.prepare('SELECT enqueuing FROM music_batches WHERE id=?').get(id).enqueuing,0);
  // Simulate a process restart before the scheduled scanner's in-memory timer fired.
  assert.equal(batches.recover(),1);
  assert.equal(scan.mock.callCount(),2);
  const incomplete = batches.begin(2);
  batches.recover();
  assert.equal(batches.ready(incomplete),null);
});
