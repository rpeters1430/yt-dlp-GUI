const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-cookies-'));
process.env.CONFIG_DIR = sandbox;
const { removeYoutubeCookies, hasTwitchAuthCookie } = require('./ytdlpCookies');
const { COOKIES_FILE } = require('./ytdlpPaths');

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const row = (domain, name, value) => [domain, 'TRUE', '/', 'TRUE', '9999999999', name, value].join('\t');

test('removeYoutubeCookies keeps other sites and the Twitch auth-token', () => {
  fs.writeFileSync(COOKIES_FILE, [
    '# Netscape HTTP Cookie File',
    row('.youtube.com', 'SAPISID', 'a'),
    `#HttpOnly_${row('.youtube.com', '__Secure-3PSID', 'b')}`,
    row('.google.com', 'SID', 'c'),
    row('.google.co.uk', 'NID', 'd'),
    row('.twitch.tv', 'auth-token', 'e'),
    row('.vimeo.com', 'vuid', 'f'),
    row('.notgoogle.example', 'x', 'g'),
  ].join('\n') + '\n');

  assert.deepEqual(removeYoutubeCookies(), { removed: 4, remaining: true });
  const left = fs.readFileSync(COOKIES_FILE, 'utf8');
  assert.match(left, /^# Netscape HTTP Cookie File\n/);
  for (const name of ['SAPISID', '__Secure-3PSID', '\tSID\t', '\tNID\t']) assert.ok(!left.includes(name), name);
  for (const name of ['auth-token', 'vuid', 'notgoogle']) assert.ok(left.includes(name), name);
  assert.ok(hasTwitchAuthCookie());
  assert.equal(fs.statSync(COOKIES_FILE).mode & 0o777, 0o600);
});

test('removeYoutubeCookies deletes the file when only YouTube cookies were in it', () => {
  fs.writeFileSync(COOKIES_FILE, `# Netscape HTTP Cookie File\n${row('.youtube.com', 'SAPISID', 'a')}\n`);
  assert.deepEqual(removeYoutubeCookies(), { removed: 1, remaining: false });
  assert.equal(fs.existsSync(COOKIES_FILE), false);
  assert.deepEqual(removeYoutubeCookies(), { removed: 0, remaining: false });
});
