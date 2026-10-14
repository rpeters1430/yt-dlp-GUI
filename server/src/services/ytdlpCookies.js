// cookies.txt handling: the saved file, the Twitch auth cookie kept inside it, and the
// private per-run copy handed to each yt-dlp process.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { COOKIES_FILE } = require('./ytdlpPaths');

// If a cookies.txt (Netscape format) has been saved via Settings, pass it to yt-dlp so
// age-restricted/members-only/private videos work. Absent by default.
function cookieArgs() {
  return fs.existsSync(COOKIES_FILE) ? ['--cookies', COOKIES_FILE] : [];
}

// The Twitch auth-token is stored as a real cookie in the shared cookies.txt rather than
// injected via --add-header, because yt-dlp's own Twitch extractor authenticates by reading
// self._get_cookies('https://gql.twitch.tv').get('auth-token') — confirmed by reading
// yt-dlp's installed twitch.py source. A header only happened to work before because of an
// incidental header-merge order, not because it's what the extractor actually reads. Storing
// it as a cookie also means it rides the same --cookies file every other site's cookies use,
// so cookieArgs()/commonArgs() cover it automatically with no Twitch-specific args needed.
const TWITCH_AUTH_COOKIE_DOMAIN = '.twitch.tv';
const TWITCH_AUTH_COOKIE_NAME = 'auth-token';

function readCookieLines() {
  if (!fs.existsSync(COOKIES_FILE)) return [];
  return fs.readFileSync(COOKIES_FILE, 'utf8').split('\n');
}

// Netscape cookie file fields are tab-separated: domain, includeSubdomains, path, secure,
// expiry, name, value. Returns null for comments/blank lines/malformed rows. A "#HttpOnly_"
// domain prefix marks a real (HttpOnly) cookie, not a comment — most YouTube auth cookies
// are exported that way.
function parseCookieLine(line) {
  if (!line) return null;
  line = line.replace(/\r$/, '');
  if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length);
  else if (line.trim().startsWith('#')) return null;
  const parts = line.split('\t');
  if (parts.length < 7) return null;
  return { domain: parts[0], name: parts[5], value: parts.slice(6).join('\t') };
}

function isTwitchAuthCookieLine(line) {
  const c = parseCookieLine(line);
  return !!c && c.name === TWITCH_AUTH_COOKIE_NAME && /(^|\.)twitch\.tv$/i.test(c.domain.replace(/^\./, ''));
}

// Replaces (or removes, if token is falsy) the auth-token cookie line for twitch.tv in the
// shared cookies.txt, leaving every other cookie (YouTube, etc.) untouched. Deletes the file
// entirely if that leaves it with no real cookie rows, so the YouTube cookies status check
// (which just does fs.existsSync) doesn't report "configured" for an empty file.
function setTwitchAuthCookie(token) {
  const kept = readCookieLines().filter((line) => line.trim() !== '' && !isTwitchAuthCookieLine(line));
  const hasOtherCookies = kept.some((line) => parseCookieLine(line));

  if (token) {
    if (!kept.some((line) => line.startsWith('# Netscape'))) {
      kept.unshift('# Netscape HTTP Cookie File');
    }
    const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 5; // 5 years out
    kept.push([TWITCH_AUTH_COOKIE_DOMAIN, 'TRUE', '/', 'TRUE', String(expiry), TWITCH_AUTH_COOKIE_NAME, token].join('\t'));
    fs.writeFileSync(COOKIES_FILE, kept.join('\n') + '\n', { mode: 0o600 });
    fs.chmodSync(COOKIES_FILE, 0o600);
  } else if (hasOtherCookies) {
    fs.writeFileSync(COOKIES_FILE, kept.join('\n') + '\n', { mode: 0o600 });
    fs.chmodSync(COOKIES_FILE, 0o600);
  } else if (fs.existsSync(COOKIES_FILE)) {
    fs.unlinkSync(COOKIES_FILE);
  }
}

function hasTwitchAuthCookie() {
  return readCookieLines().some(isTwitchAuthCookieLine);
}

function getTwitchAuthTokenRaw() {
  for (const line of readCookieLines()) {
    if (isTwitchAuthCookieLine(line)) return parseCookieLine(line).value;
  }
  return '';
}

// The Settings page lets a user paste/upload a fresh cookies.txt (for YouTube, typically),
// which replaces the file outright. Without this, that upload would silently wipe out a
// separately-configured Twitch auth-token cookie merged into the same file. Re-merges it
// back in afterward so the two features don't clobber each other.
function writeCookiesFilePreservingTwitchAuth(content) {
  const existingToken = getTwitchAuthTokenRaw();
  fs.writeFileSync(COOKIES_FILE, content, { mode: 0o600 });
  fs.chmodSync(COOKIES_FILE, 0o600);
  if (existingToken) setTwitchAuthCookie(existingToken);
}

function getTwitchAuthTokenMasked() {
  for (const line of readCookieLines()) {
    const c = parseCookieLine(line);
    if (c && isTwitchAuthCookieLine(line)) {
      return c.value.length > 4 ? `••••${c.value.slice(-4)}` : '••••';
    }
  }
  return '';
}

// yt-dlp saves its cookie jar back to the --cookies file when it exits, and YouTube rotates
// session cookies (__Secure-*PSIDTS, SIDCC, ...) on nearly every response. With several
// yt-dlp processes sharing one cookies.txt (metadata probe + concurrent downloads + watch
// checks) each one writes back its own rotated copy, last writer wins, and the stored session
// ends up desynced/invalidated — YouTube then answers every request with "Sign in to confirm
// you're not a bot" even though cookies are configured. So the uploaded cookies.txt is treated
// as read-only: each process gets a private temp copy that it can rewrite freely and that is
// deleted when the process exits. The displayed command still shows the real cookies path.
// All copies live under one dedicated dir so anything a crash/SIGKILL left behind (the exit
// handlers never ran) can be swept at startup — see sweepPrivateCookieDirs below.
const PRIVATE_COOKIES_ROOT = path.join(os.tmpdir(), 'ytdlp-gui-cookies');

function removePrivateCookieDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (err) {
    console.error(`[ytdlp] Failed to remove private cookies copy ${dir}: ${err.message}`);
  }
}

// Runs once at module load, i.e. at server startup, before the queue resumes any job. Any
// yt-dlp process from a previous run is orphaned at that point (queue.init kills them by
// pid), so every leftover copy is stale and holds a live login session — remove them all.
function sweepPrivateCookieDirs() {
  let entries;
  try {
    entries = fs.readdirSync(PRIVATE_COOKIES_ROOT);
  } catch (_) {
    return; // nothing to sweep
  }
  for (const name of entries) {
    try {
      fs.rmSync(path.join(PRIVATE_COOKIES_ROOT, name), { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      console.error(`[ytdlp] Failed to remove stale private cookies copy ${name}: ${e.message}`);
    }
  }
}
sweepPrivateCookieDirs();

function withPrivateCookies(args) {
  const idx = args.indexOf('--cookies');
  if (idx === -1 || args[idx + 1] !== COOKIES_FILE || !fs.existsSync(COOKIES_FILE)) {
    return { args, cleanup: () => {} };
  }
  let tmpDir;
  try {
    fs.mkdirSync(PRIVATE_COOKIES_ROOT, { recursive: true, mode: 0o700 });
    tmpDir = fs.mkdtempSync(path.join(PRIVATE_COOKIES_ROOT, 'job-'));
    const tmpFile = path.join(tmpDir, 'cookies.txt');
    fs.copyFileSync(COOKIES_FILE, tmpFile);
    fs.chmodSync(tmpFile, 0o600);
    const copy = args.slice();
    copy[idx + 1] = tmpFile;
    let cleaned = false;
    return {
      args: copy,
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        removePrivateCookieDir(tmpDir);
      },
    };
  } catch (e) {
    console.error(`[ytdlp] Couldn't create private cookies copy, using shared file: ${e.message}`);
    if (tmpDir) removePrivateCookieDir(tmpDir);
    return { args, cleanup: () => {} };
  }
}

module.exports = {
  cookieArgs, setTwitchAuthCookie, hasTwitchAuthCookie, getTwitchAuthTokenRaw, getTwitchAuthTokenMasked,
  writeCookiesFilePreservingTwitchAuth, withPrivateCookies, sweepPrivateCookieDirs, PRIVATE_COOKIES_ROOT,
};
