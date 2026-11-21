// "Is my YouTube cookies.txt any good?" — answers it with one real yt-dlp request instead of
// making the user burn a download (and a fresh export) to find out. Two separate questions,
// because they have different fixes:
//   cookies: does YouTube accept the login session in the file?  (fix: re-export)
//   ip:      does YouTube serve video data to this server at all? (fix: change IP / PO token)
// yt-dlp prints "The provided YouTube account cookies are no longer valid" when YouTube
// answers a request carrying auth cookies as logged-out; the bot check ("Sign in to confirm
// you're not a bot") comes from the player request and is about the IP/client, not the login.
const fs = require('fs');
const db = require('../db');
const ytdlp = require('./ytdlp');
const { COOKIES_FILE } = require('./ytdlpPaths');

// "Me at the zoo": public, not age-gated, and has been up since 2005, so a failure here is
// about the session or the IP, never the video.
const TEST_VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const CHECK_TIMEOUT_MS = 90 * 1000;
const RESULT_KEY = 'youtube_cookie_check';

// yt-dlp's own is_authenticated test looks for these on youtube.com; without one of them it
// never even tries to send a logged-in request.
const AUTH_COOKIE_NAMES = new Set(['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID']);
const SESSION_COOKIE_NAMES = new Set(['__Secure-1PSID', '__Secure-3PSID', 'SID', 'LOGIN_INFO']);

const COOKIES_REJECTED_RE = /provided YouTube account cookies are no longer valid/i;

function parseRow(line) {
  let l = String(line || '').replace(/\r$/, '');
  if (l.startsWith('#HttpOnly_')) l = l.slice('#HttpOnly_'.length);
  else if (!l || l.trim().startsWith('#')) return null;
  const parts = l.split('\t');
  if (parts.length < 7) return null;
  return { domain: parts[0].replace(/^\./, '').toLowerCase(), expiry: Number(parts[4]) || 0, name: parts[5] };
}

// Local inspection only — no network. Catches the "exported while signed out" and "file is
// past its expiry" cases before the request result is interpreted.
function inspectCookieFile(content, nowSec = Math.floor(Date.now() / 1000)) {
  const rows = String(content || '').split('\n').map(parseRow).filter(Boolean)
    .filter((r) => r.domain === 'youtube.com' || r.domain.endsWith('.youtube.com'));
  const relevant = rows.filter((r) => AUTH_COOKIE_NAMES.has(r.name) || SESSION_COOKIE_NAMES.has(r.name));
  const expired = relevant.filter((r) => r.expiry > 0 && r.expiry < nowSec);
  return {
    youtubeCookieCount: rows.length,
    hasLogin: rows.some((r) => AUTH_COOKIE_NAMES.has(r.name)),
    allLoginCookiesExpired: relevant.length > 0 && expired.length === relevant.length,
  };
}

function lastErrorLine(stderr) {
  const lines = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const err = [...lines].reverse().find((l) => l.startsWith('ERROR:'));
  return (err || lines[lines.length - 1] || '').slice(0, 500);
}

// Pure: turns what the local inspection and the yt-dlp run saw into the verdict the UI shows.
function classifyCheck({ inspection, exitCode, stderr, timedOut }) {
  const text = String(stderr || '');
  const botChecked = !timedOut && exitCode !== 0 && ytdlp.isBotCheckError(text);

  let cookies;
  if (!inspection.hasLogin) cookies = 'no_login';
  else if (inspection.allLoginCookiesExpired) cookies = 'expired';
  else if (COOKIES_REJECTED_RE.test(text)) cookies = 'rejected';
  else if (timedOut || (exitCode !== 0 && !botChecked)) cookies = 'unknown';
  else cookies = 'valid';

  let ip;
  if (timedOut) ip = 'unknown';
  else if (exitCode === 0) ip = 'ok';
  else if (botChecked) ip = 'blocked';
  else ip = 'unknown';

  let verdict;
  let message;
  if (cookies === 'no_login') {
    verdict = 'bad';
    message = 'This file has no YouTube login cookies. Export it while you are signed in to youtube.com.';
  } else if (cookies === 'expired') {
    verdict = 'bad';
    message = 'The YouTube login cookies in this file are past their expiry date. Export a fresh cookies.txt.';
  } else if (cookies === 'rejected' && ip === 'blocked') {
    verdict = 'bad';
    message = 'YouTube rejected this login, and it is also bot-checking this server\'s IP. A fresh export alone '
      + 'may not help: if the server uses a VPN or datacenter IP, YouTube may be killing new sessions from it.';
  } else if (cookies === 'rejected') {
    verdict = 'bad';
    message = 'YouTube rejected this login (the session was rotated or signed out). Downloads still work while '
      + 'logged out, but age-restricted or members-only videos won\'t. Export a fresh cookies.txt.';
  } else if (ip === 'blocked') {
    verdict = 'bad';
    message = 'YouTube accepted the login but is bot-checking this server\'s IP. New cookies won\'t fix this. '
      + 'Move the server off the VPN or datacenter IP, or turn on the PO-token provider in Settings → Downloads.';
  } else if (cookies === 'valid' && ip === 'ok') {
    verdict = 'good';
    message = 'YouTube accepted the login and served video data to this server.';
  } else {
    verdict = 'unknown';
    message = timedOut
      ? 'The check timed out before YouTube answered.'
      : `The check couldn't finish: ${lastErrorLine(text) || `yt-dlp exited with code ${exitCode}`}`;
  }
  return { verdict, cookies, ip, message };
}

function runYtdlpCheck({ spawn = ytdlp.spawnYtdlp, timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const args = ['--simulate', '--no-playlist', '--print', 'id', ...ytdlp.commonArgs(), TEST_VIDEO_URL];
    let proc;
    try {
      proc = spawn(args, { detached: process.platform !== 'win32' });
    } catch (e) {
      resolve({ exitCode: -1, stderr: `ERROR: ${e.message}`, timedOut: false });
      return;
    }
    let stderr = '';
    let timedOut = false;
    let done = false;
    let timer = null;
    const finish = (exitCode) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ exitCode, stderr, timedOut });
    };
    timer = setTimeout(() => {
      timedOut = true;
      ytdlp.killProcessTree(proc, 'SIGKILL');
      finish(-1);
    }, timeoutMs);
    if (proc.stdout) proc.stdout.on('data', () => {});
    if (proc.stderr) proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (e) => { stderr += `\nERROR: ${e.message}`; finish(-1); });
    proc.on('close', (code) => finish(code));
  });
}

function saveResult(result) {
  try {
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(RESULT_KEY, JSON.stringify(result));
  } catch (e) {
    console.error(`[cookies] Couldn't save cookie check result: ${e.message}`);
  }
}

function getLastResult() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(RESULT_KEY);
    return row && row.value ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function clearLastResult() {
  try {
    db.prepare('DELETE FROM settings WHERE key = ?').run(RESULT_KEY);
  } catch (_) {}
}

// One check at a time: a second click while one is running gets the same answer.
let inFlight = null;

function checkYoutubeCookies(options = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!fs.existsSync(COOKIES_FILE)) {
      return { verdict: 'bad', cookies: 'missing', ip: 'unknown', message: 'No cookies.txt is saved.', checkedAt: new Date().toISOString() };
    }
    const inspection = inspectCookieFile(fs.readFileSync(COOKIES_FILE, 'utf8'));
    // Run even without a login cookie: the IP half of the answer is still worth having.
    const run = await runYtdlpCheck(options);
    const result = {
      ...classifyCheck({ inspection, ...run }),
      youtubeCookieCount: inspection.youtubeCookieCount,
      fileUpdatedAt: fs.statSync(COOKIES_FILE).mtime.toISOString(),
      checkedAt: new Date().toISOString(),
    };
    saveResult(result);
    return result;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

module.exports = {
  checkYoutubeCookies, getLastResult, clearLastResult, inspectCookieFile, classifyCheck, runYtdlpCheck, TEST_VIDEO_URL,
};
