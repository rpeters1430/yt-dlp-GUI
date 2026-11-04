const net = require('node:net');
const { randomBytes } = require('node:crypto');

// The socket lives for exactly one Python processing operation. Killing the child closes
// it and frees the permit, even if no cleanup handler ran in Python.
function createProcessingGate(limit = 1) {
  let active = 0;
  const pending = [];
  let listener;
  function drain() {
    while (active < limit && pending.length) {
      const next = pending.shift();
      next.signal?.removeEventListener('abort', next.abort);
      if (next.signal?.aborted) continue;
      active++;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        active--;
        drain();
      });
    }
  }
  function acquire({ signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Processing canceled'));
      const entry = { resolve, signal };
      entry.abort = () => {
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
        reject(new Error('Processing canceled'));
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      pending.push(entry);
      drain();
    });
  }
  async function run(task, { onWait, onStart, onFinish, signal } = {}) {
    onWait?.();
    const release = await acquire({ signal });
    const started = Date.now();
    try { onStart?.(); return await task(); } finally { release(); onFinish?.((Date.now() - started) / 1000); }
  }
  function listen() {
    if (listener) return listener;
    listener = new Promise((resolve, reject) => {
      const token = randomBytes(32).toString('hex');
      const sockets = new Set();
      const server = net.createServer(socket => {
        sockets.add(socket);
        const abort = new AbortController();
        let release;
        socket.on('error', () => {});
        socket.once('close', () => {
          sockets.delete(socket);
          abort.abort();
          release?.();
        });
        socket.setTimeout(10000, () => socket.destroy());
        let handshake = '';
        function read(data) {
          handshake += data.toString();
          if (handshake.length > 128) return socket.destroy();
          if (!handshake.includes('\n')) return;
          socket.removeListener('data', read);
          if (handshake.trim() !== token) return socket.destroy();
          socket.setTimeout(0);
          acquire({ signal: abort.signal }).then(unlock => {
            release = unlock;
            if (socket.destroyed) return release();
            socket.write('go\n');
          }).catch(() => socket.destroy());
        }
        socket.on('data', read);
      });
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.unref();
        resolve({
          port: server.address().port, token,
          close: () => new Promise(done => {
            for (const socket of sockets) socket.destroy();
            server.close(done);
          }),
        });
      });
    });
    return listener;
  }
  return { acquire, run, listen };
}

const requested = Number.parseInt(process.env.MAX_CONCURRENT_POSTPROCESSORS || '1', 10);
const processingGate = createProcessingGate(Math.max(1, Math.min(4, requested || 1)));
module.exports = { createProcessingGate, processingGate };
