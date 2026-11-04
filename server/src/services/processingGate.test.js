const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createProcessingGate } = require('./processingGate');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('heavy tasks serialize and release their permit on failure', async () => {
  const gate = createProcessingGate(1);
  const release = await gate.acquire();
  let acquired = false;
  const second = gate.run(async () => { acquired = true; throw new Error('failed FFmpeg'); });
  await tick();
  assert.equal(acquired, false);
  release();
  await assert.rejects(second, /failed FFmpeg/);
  const third = await gate.acquire();
  third();
});

test('a disconnected Python process releases its permit; canceled waiters do not leak', async () => {
  const gate = createProcessingGate(1);
  const server = await gate.listen();
  const connect = () => net.connect({ host: '127.0.0.1', port: server.port });
  const first = connect();
  first.write(`${server.token}\n`);
  await new Promise(resolve => first.once('data', resolve));
  const canceled = connect();
  canceled.write(`${server.token}\n`);
  canceled.destroy();
  await tick();
  let granted = false;
  const next = gate.acquire().then(release => { granted = true; return release; });
  await tick();
  assert.equal(granted, false);
  first.destroy();
  const release = await next;
  release();
  await server.close();
});
