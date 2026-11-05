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
  assert.ok(!args.includes('--impersonate'));
  assert.ok(!ytdlp.formatCommand('yt-dlp', args).includes(':pw@'), 'password redacted from logged command');

  setSetting('solverr_proxy_mode', 'off');
  assert.deepEqual(solverrProxy.proxyArgs(), []);
  assert.ok(ytdlp.commonArgs().includes('--impersonate'));
});

test('Link Grabber fetches tunnel through the proxy with credentials while it is active', async () => {
  const target = http.createServer((req, res) => res.end('from-target'));
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetPort = target.address().port;

  const tunnels = [];
  const proxy = http.createServer((req, res) => res.writeHead(405).end());
  proxy.on('connect', (req, clientSocket, head) => {
    tunnels.push({ target: req.url, auth: req.headers['proxy-authorization'] });
    const [host, p] = req.url.split(':');
    const upstream = net.connect(Number(p), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxy.address().port;
  const proxyUrl = `http://user:p%40ss@127.0.0.1:${proxyPort}`;

  try {
    fs.writeFileSync(process.env.SOLVERR_PROXY_CA_FILE, tls.rootCertificates[0]);
    setSetting('solverr_proxy_mode', 'auto');
    setSetting('solverr_proxy_url', proxyUrl);
    await solverrProxy.check();
    assert.equal(solverrProxy.isActive(), true);
    assert.deepEqual(solverrProxy.curlProxyOptions(), { url: proxyUrl, caFile: process.env.SOLVERR_PROXY_CA_FILE });

    const res = await solverrProxy.proxiedFetch(`http://127.0.0.1:${targetPort}/page`);
    assert.equal(await res.text(), 'from-target');
    assert.equal(tunnels.length, 1);
    assert.equal(tunnels[0].target, `127.0.0.1:${targetPort}`);
    assert.equal(tunnels[0].auth, `Basic ${Buffer.from('user:p@ss').toString('base64')}`);

    // Turned off in Settings: straight to the site, no tunnel.
    setSetting('solverr_proxy_mode', 'off');
    assert.equal(solverrProxy.curlProxyOptions(), null);
    const direct = await solverrProxy.proxiedFetch(`http://127.0.0.1:${targetPort}/page`);
    assert.equal(await direct.text(), 'from-target');
    assert.equal(tunnels.length, 1);
  } finally {
    solverrProxy.stop();
    proxy.closeAllConnections();
    target.closeAllConnections();
    proxy.close();
    target.close();
  }
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
