const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-check-'));
process.env.CONFIG_DIR = sandbox;
const cookieCheck = require('./cookieCheck');
const { COOKIES_FILE } = require('./ytdlpPaths');

const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 365;
const PAST = Math.floor(Date.now() / 1000) - 86400;
const row = (domain, name, expiry = FUTURE) => [domain, 'TRUE', '/', 'TRUE', String(expiry), name, 'x'].join('\t');

const LOGGED_IN = ['# Netscape HTTP Cookie File', row('.youtube.com', 'SAPISID'), `#HttpOnly_${row('.youtube.com', '__Secure-3PSID')}`, row('.youtube.com', 'PREF')].join('\n');
const REJECTED = 'WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated';
const BOT = 'ERROR: [youtube] AR4TUrUkkzo: Sign in to confirm you’re not a bot. This helps protect our community.';

function fakeSpawn({ code = 0, stderr = '' } = {}) {
  return () => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      if (stderr) proc.stderr.emit('data', stderr);
      proc.emit('close', code);
    });
    return proc;
  };
}

test('inspectCookieFile finds login cookies, including #HttpOnly_ rows', () => {
  const r = cookieCheck.inspectCookieFile(LOGGED_IN);
  assert.equal(r.hasLogin, true);
  assert.equal(r.youtubeCookieCount, 3);
  assert.equal(r.allLoginCookiesExpired, false);
});

test('inspectCookieFile flags a signed-out export and an expired one', () => {
  assert.equal(cookieCheck.inspectCookieFile(row('.youtube.com', 'PREF')).hasLogin, false);
  assert.equal(cookieCheck.inspectCookieFile(row('.google.com', 'SAPISID')).hasLogin, false);
  const old = [row('.youtube.com', 'SAPISID', PAST), row('.youtube.com', 'SID', PAST)].join('\n');
  assert.equal(cookieCheck.inspectCookieFile(old).allLoginCookiesExpired, true);
});

const login = { hasLogin: true, allLoginCookiesExpired: false };

test('classifyCheck: success with no warning is good', () => {
  const r = cookieCheck.classifyCheck({ inspection: login, exitCode: 0, stderr: '', timedOut: false });
  assert.deepEqual([r.verdict, r.cookies, r.ip], ['good', 'valid', 'ok']);
});

test('classifyCheck: rotated cookies but the IP is fine', () => {
  const r = cookieCheck.classifyCheck({ inspection: login, exitCode: 0, stderr: REJECTED, timedOut: false });
  assert.deepEqual([r.verdict, r.cookies, r.ip], ['bad', 'rejected', 'ok']);
});

test('classifyCheck: rejected cookies plus bot check (the failing-download case)', () => {
  const r = cookieCheck.classifyCheck({ inspection: login, exitCode: 1, stderr: `${REJECTED}\n${BOT}`, timedOut: false });
  assert.deepEqual([r.verdict, r.cookies, r.ip], ['bad', 'rejected', 'blocked']);
});

test('classifyCheck: accepted login but IP bot-checked', () => {
  const r = cookieCheck.classifyCheck({ inspection: login, exitCode: 1, stderr: BOT, timedOut: false });
  assert.deepEqual([r.verdict, r.cookies, r.ip], ['bad', 'valid', 'blocked']);
  assert.match(r.message, /New cookies won't fix this/);
});

test('classifyCheck: unrelated failure or timeout is unknown, not blamed on cookies', () => {
  const r = cookieCheck.classifyCheck({ inspection: login, exitCode: 1, stderr: 'ERROR: Unable to download webpage: timed out', timedOut: false });
  assert.deepEqual([r.verdict, r.cookies, r.ip], ['unknown', 'unknown', 'unknown']);
  assert.match(r.message, /Unable to download webpage/);
  const t = cookieCheck.classifyCheck({ inspection: login, exitCode: -1, stderr: '', timedOut: true });
  assert.equal(t.verdict, 'unknown');
});

test('checkYoutubeCookies reports missing file, then stores and clears a result', async () => {
  if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
  assert.equal((await cookieCheck.checkYoutubeCookies({ spawn: fakeSpawn() })).cookies, 'missing');

  fs.writeFileSync(COOKIES_FILE, LOGGED_IN);
  const r = await cookieCheck.checkYoutubeCookies({ spawn: fakeSpawn({ code: 1, stderr: `${REJECTED}\n${BOT}` }) });
  assert.deepEqual([r.cookies, r.ip], ['rejected', 'blocked']);
  assert.equal(r.youtubeCookieCount, 3);
  assert.equal(cookieCheck.getLastResult().cookies, 'rejected');

  cookieCheck.clearLastResult();
  assert.equal(cookieCheck.getLastResult(), null);
});

test('runYtdlpCheck kills a hung process and reports a timeout', async () => {
  const hung = () => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
  };
  const r = await cookieCheck.runYtdlpCheck({ spawn: hung, timeoutMs: 20 });
  assert.equal(r.timedOut, true);
});
