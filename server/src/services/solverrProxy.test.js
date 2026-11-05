const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const tls = require('tls');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'solverr-proxy-'));
process.env.CONFIG_DIR = sandbox;
process.env.SOLVERR_PROXY_CA_FILE = path.join(sandbox, 'solverr-proxy-ca.crt');
delete process.env.SOLVERR_PROXY_URL;
const db = require('../db');
const solverrProxy = require('./solverrProxy');
const ytdlp = require('./ytdlp');

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

let server;
let port;
test.before(async () => {
  server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('validates proxy URLs', () => {
  assert.equal(solverrProxy.validateProxyUrl('http://u:p@solverr:8192'), null);
  assert.match(solverrProxy.validateProxyUrl('socks5://solverr:1080'), /http/);
  assert.match(solverrProxy.validateProxyUrl('not a url'), /must look like/);
  assert.match(solverrProxy.validateProxyUrl('http://solverr:8192/path'), /path/);
});

test('masks the password and restores it when the mask is saved back', () => {
  const stored = 'http://user:s3cret@solverr:8192';
  const masked = solverrProxy.maskProxyUrl(stored);
  assert.ok(!masked.includes('s3cret'));
  assert.equal(solverrProxy.unmaskProxyUrl(masked, stored), stored);
  assert.equal(solverrProxy.unmaskProxyUrl('http://user:new@solverr:8192', stored), 'http://user:new@solverr:8192');
});

test('only adds proxy args while reachable with the CA installed', async () => {
  const url = `http://user:pw@127.0.0.1:${port}`;
  setSetting('solverr_proxy_url', url);
  setSetting('solverr_proxy_mode', 'auto');

  await solverrProxy.check();
  assert.deepEqual(solverrProxy.proxyArgs(), [], 'CA missing');
  assert.equal(solverrProxy.getStatus().reachable, true);

  fs.writeFileSync(process.env.SOLVERR_PROXY_CA_FILE, 'pem');
  assert.deepEqual(solverrProxy.proxyArgs(), ['--proxy', url, '--compat-options', 'no-certifi']);

  // Impersonation is Solverr's job while the proxy is in use.
  setSetting('impersonate_target', 'chrome');
  const args = ytdlp.commonArgs();
  assert.ok(args.includes('--proxy'));
  const downloadArgs = ytdlp.buildDownloadArgs('https://forum.example/video', { impersonate: 'chrome' });
  assert.equal(downloadArgs[downloadArgs.indexOf('--proxy') + 1], url);
  assert.equal(downloadArgs[downloadArgs.indexOf('--compat-options') + 1], 'no-certifi');
  assert.ok(!downloadArgs.includes('--impersonate'));
  assert.ok(!downloadArgs.includes('--no-check-certificates'));
  assert.deepEqual(solverrProxy.curlProxyOptions(), { url, caFile: process.env.SOLVERR_PROXY_CA_FILE });
  assert.ok(!args.includes('--impersonate'));
  assert.ok(!ytdlp.formatCommand('yt-dlp', args).includes(':pw@'), 'password redacted from logged command');

  setSetting('solverr_proxy_mode', 'off');
  assert.deepEqual(solverrProxy.proxyArgs(), []);
  assert.ok(ytdlp.commonArgs().includes('--impersonate'));
});

// Test-only certificate/key: represents Solverr re-signing the target's HTTPS response.
const cert = fs.readFileSync(path.join(__dirname, '../../test/fixtures/solverr/cert.pem'));
const key = fs.readFileSync(path.join(__dirname, '../../test/fixtures/solverr/key.pem'));
const auth = `Basic ${Buffer.from('user:p@ss').toString('base64')}`;

async function startProxy(t) {
  const requests = [];
  const tunnels = [];
  const sockets = new Set();
  const respond = (req, res) => {
    requests.push({ url: req.url, auth: req.headers['proxy-authorization'], cookie: req.headers.cookie });
    if (req.url.includes('/missing.jpg')) return res.writeHead(404).end();
    if (req.url.includes('/share/') || req.url.includes('/s/')) {
      res.writeHead(302, { location: 'https://www.reddit.com/r/videos/comments/1abcde/title/' }).end();
    } else {
      res.setHeader('content-type', 'text/html');
      res.end('<html><a href="https://pixeldrain.com/u/testfile">file</a></html>');
    }
  };
  const secureHttp = http.createServer(respond);
  const proxy = http.createServer((req, res) => {
    // Match Solverr: HTTP uses absolute-form forwarding; CONNECT is HTTPS-only.
    if (!req.url.startsWith('http://')) return res.writeHead(400).end();
    if (req.headers['proxy-authorization'] !== auth) return res.writeHead(407).end();
    respond(req, res);
  });
  proxy.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  proxy.on('connect', (req, socket) => {
    tunnels.push({ target: req.url, auth: req.headers['proxy-authorization'] });
    if (!req.url.endsWith(':443')) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    if (req.headers['proxy-authorization'] !== auth) return socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\n\r\n');
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const secureSocket = new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext({ key, cert }) });
    secureSocket.on('error', () => socket.destroy());
    secureHttp.emit('connection', secureSocket);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    solverrProxy.stop();
    for (const socket of sockets) socket.destroy();
    proxy.close();
    secureHttp.close();
    setSetting('solverr_proxy_mode', 'off');
  });
  fs.writeFileSync(process.env.SOLVERR_PROXY_CA_FILE, cert);
  setSetting('solverr_proxy_mode', 'auto');
  setSetting('solverr_proxy_url', `http://user:p%40ss@127.0.0.1:${proxy.address().port}`);
  await solverrProxy.check();
  return { requests, tunnels };
}

test('HTTP forum pages use authenticated absolute-form forwarding, not CONNECT', async t => {
  const { requests, tunnels } = await startProxy(t);
  const { crawl } = require('./linkGrabber');
  const result = await crawl({ url: 'http://forum.example/thread', maxPages: 1, assertUrl: async () => {} });
  assert.equal(result.links.length, 1);
  assert.equal(requests[0].url, 'http://forum.example/thread');
  assert.equal(requests[0].auth, auth);
  assert.equal(tunnels.length, 0);
});

test('HTTPS forum pages trust the Solverr CA and authenticate CONNECT without leaking credentials to the target', async t => {
  const { requests, tunnels } = await startProxy(t);
  const { crawl } = require('./linkGrabber');
  const result = await crawl({ url: 'https://forum.example/thread', maxPages: 1, assertUrl: async () => {} });
  assert.equal(result.links.length, 1);
  assert.deepEqual(tunnels, [{ target: 'forum.example:443', auth }]);
  assert.equal(requests[0].url, '/thread');
  assert.equal(requests[0].auth, undefined);
});

test('extracted-link checks use the active Solverr proxy by default', async t => {
  const { requests } = await startProxy(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected direct request'); });
  const { checkLinks } = require('./linkCheck');
  const [result] = await checkLinks(['http://forum.example/file-page'], { assertUrl: async () => {} });
  assert.equal(result.status, 'reachable');
  assert.equal(requests[0]?.url, 'http://forum.example/file-page');
});

test('Reddit share links are resolved through the active Solverr proxy before yt-dlp analysis', async t => {
  const { tunnels } = await startProxy(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected direct request'); });
  const resolved = await ytdlp.resolveShareUrl('https://www.reddit.com/r/videos/s/proxytest', { validateUrl: async () => {} });
  assert.equal(resolved, 'https://www.reddit.com/r/videos/comments/1abcde/title/');
  assert.ok(tunnels.some(tunnel => tunnel.target === 'www.reddit.com:443'));
});

test('fallback artwork requests use the same active proxy as the video download', async t => {
  const { requests } = await startProxy(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected direct request'); });
  t.mock.method(require('dns').promises, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  await assert.rejects(ytdlp.embedThumbnailFromUrl(path.join(sandbox, 'video.mp4'), 'http://forum.example/missing.jpg'), /HTTP 404 fetching thumbnail/);
  assert.equal(requests[0]?.url, 'http://forum.example/missing.jpg');
});

test('proxy authentication errors remain visible instead of retrying directly', async t => {
  await startProxy(t);
  setSetting('solverr_proxy_url', solverrProxy.getProxyUrl().replace('p%40ss', 'wrong'));
  await solverrProxy.check();
  await assert.rejects(solverrProxy.proxiedFetch('http://forum.example/thread'), err => /407/.test(err.cause?.message));
});

test('HTTPS rejects an untrusted Solverr certificate instead of disabling verification', async t => {
  await startProxy(t);
  fs.writeFileSync(process.env.SOLVERR_PROXY_CA_FILE, tls.rootCertificates[0]);
  await assert.rejects(solverrProxy.proxiedFetch('https://forum.example/thread'), /fetch failed/);
});

test('turning the proxy off makes forum requests go directly again', async t => {
  const { requests, tunnels } = await startProxy(t);
  const target = http.createServer((_req, res) => res.end('direct'));
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(() => { target.closeAllConnections(); target.close(); });
  setSetting('solverr_proxy_mode', 'off');
  const res = await solverrProxy.proxiedFetch(`http://127.0.0.1:${target.address().port}/thread`);
  assert.equal(await res.text(), 'direct');
  assert.equal(requests.length, 0);
  assert.equal(tunnels.length, 0);
  assert.equal(solverrProxy.curlProxyOptions(), null);
});

test('falls back to a direct connection when the proxy is unreachable', async () => {
  const closed = net.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const deadPort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));

  setSetting('solverr_proxy_mode', 'auto');
  setSetting('solverr_proxy_url', `http://127.0.0.1:${deadPort}`);
  const status = await solverrProxy.check();
  assert.equal(status.reachable, false);
  assert.equal(status.active, false);
  assert.deepEqual(solverrProxy.proxyArgs(), []);
});
