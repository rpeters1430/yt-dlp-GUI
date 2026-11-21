const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'po-token-'));
process.env.CONFIG_DIR = sandbox;
process.env.BGUTIL_PLUGIN_DIR = path.join(sandbox, 'bgutil');
delete process.env.BGUTIL_POT_URL;
const db = require('../db');
const poToken = require('./poToken');

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function clearSettings() {
  db.prepare("DELETE FROM settings WHERE key IN ('pot_provider_mode', 'pot_provider_url')").run();
}

test('off by default: no yt-dlp args, even with the plugin installed', () => {
  clearSettings();
  fs.mkdirSync(path.join(process.env.BGUTIL_PLUGIN_DIR, 'yt_dlp_plugins'), { recursive: true });
  assert.equal(poToken.getMode(), 'off');
  assert.deepEqual(poToken.args(), []);
});

test('on: loads the plugin dir alongside the default dirs and points it at the provider', () => {
  clearSettings();
  setSetting('pot_provider_mode', 'on');
  assert.deepEqual(poToken.args(), [
    '--plugin-dirs', 'default', '--plugin-dirs', process.env.BGUTIL_PLUGIN_DIR,
    '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416',
  ]);
  setSetting('pot_provider_url', 'http://10.0.0.5:4416/');
  assert.equal(poToken.args().at(-1), 'youtubepot-bgutilhttp:base_url=http://10.0.0.5:4416');
});

test('on but plugin missing: no args, so yt-dlp is not told about a plugin it lacks', () => {
  clearSettings();
  setSetting('pot_provider_mode', 'on');
  fs.rmSync(process.env.BGUTIL_PLUGIN_DIR, { recursive: true, force: true });
  assert.deepEqual(poToken.args(), []);
  fs.mkdirSync(path.join(process.env.BGUTIL_PLUGIN_DIR, 'yt_dlp_plugins'), { recursive: true });
});

test('validateUrl accepts host:port URLs and rejects paths and other schemes', () => {
  assert.equal(poToken.validateUrl('http://bgutil-provider:4416'), null);
  assert.equal(poToken.validateUrl('https://pot.example.com'), null);
  assert.match(poToken.validateUrl('ftp://x:4416'), /http/);
  assert.match(poToken.validateUrl('http://x:4416/get_pot'), /path/);
  assert.match(poToken.validateUrl('not a url'), /look like/);
});

test('ping reads the provider version, and reports a down provider', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '2.0.2', server_uptime: 5 }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await poToken.ping(url), { reachable: true, version: '2.0.2' });
  } finally {
    await new Promise((r) => server.close(r));
  }
  const down = await poToken.ping(url, 1000);
  assert.equal(down.reachable, false);
  assert.ok(down.error);
});

test('getStatus skips the ping while off', async () => {
  clearSettings();
  let pinged = false;
  const s = await poToken.getStatus({ pingFn: async () => { pinged = true; return { reachable: true }; } });
  assert.equal(s.mode, 'off');
  assert.equal(s.reachable, null);
  assert.equal(pinged, false);
  setSetting('pot_provider_mode', 'on');
  const on = await poToken.getStatus({ pingFn: async () => ({ reachable: true, version: '2.0.2' }) });
  assert.deepEqual([on.reachable, on.version, on.pluginInstalled, on.urlSource], [true, '2.0.2', true, 'default']);
});
