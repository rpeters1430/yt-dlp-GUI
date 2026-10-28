const fs = require('fs');
const net = require('net');

// Optional Solverr HTTP/HTTPS forward proxy. Solverr decrypts HTTPS so its challenge solver can
// handle Cloudflare and friends, which means yt-dlp must trust Solverr's CA: the container
// entrypoint installs it at start (scripts/solverr/install_proxy_ca.sh) and --compat-options
// no-certifi makes yt-dlp read the system store instead of its bundled certifi list.
//
// The proxy is only used while it's reachable and the CA is installed, so a stopped Solverr
// container never breaks downloads; they just go direct again.

const CA_FILE = process.env.SOLVERR_PROXY_CA_FILE || '/usr/local/share/ca-certificates/solverr-proxy-ca.crt';
const CHECK_INTERVAL_MS = 60 * 1000;
const CONNECT_TIMEOUT_MS = 3000;
const PASSWORD_MASK = '********';
const MODES = new Set(['auto', 'off']);

const state = {
  reachable: false,
  checkedAt: null,
  error: null,
  checkedUrl: null,
};
let timer = null;
let checking = null;

function readSetting(key) {
  try {
    const db = require('../db');
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

// Returns null for a usable proxy URL, otherwise the reason it isn't one.
function validateProxyUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw));
  } catch {
    return 'Proxy URL must look like http://USER:PASSWORD@solverr:8192';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'Proxy URL must start with http:// or https://';
  if (!parsed.hostname) return 'Proxy URL needs a host';
  if (parsed.pathname && parsed.pathname !== '/') return 'Proxy URL must not include a path';
  return null;
}

function maskProxyUrl(raw) {
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.password) parsed.password = PASSWORD_MASK;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

// The Settings page only ever sees the masked URL, so saving it back unchanged must keep the
// stored password rather than replace it with the mask.
function unmaskProxyUrl(submitted, stored) {
  if (!submitted || !stored) return submitted;
  try {
    const next = new URL(submitted);
    const prev = new URL(stored);
    if (decodeURIComponent(next.password) === PASSWORD_MASK) next.password = prev.password;
    return next.toString().replace(/\/$/, '');
  } catch {
    return submitted;
  }
}

function getMode() {
  const mode = readSetting('solverr_proxy_mode');
  return MODES.has(mode) ? mode : 'auto';
}

// A URL saved in Settings wins over the SOLVERR_PROXY_URL env var.
function getProxyUrl() {
  const saved = (readSetting('solverr_proxy_url') || '').trim();
  return saved || (process.env.SOLVERR_PROXY_URL || '').trim();
}

function isCaInstalled() {
  return fs.existsSync(CA_FILE);
}

function isActive() {
  const url = getProxyUrl();
  return getMode() === 'auto' && !!url && state.reachable && state.checkedUrl === url && isCaInstalled();
}

function proxyArgs() {
  if (!isActive()) return [];
  return ['--proxy', getProxyUrl(), '--compat-options', 'no-certifi'];
}

function probe(url) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ reachable: false, error: 'Invalid proxy URL' });
      return;
    }
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    const socket = net.connect({ host: parsed.hostname, port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish({ reachable: false, error: `No answer from ${parsed.hostname}:${port}` }));
    socket.once('connect', () => finish({ reachable: true, error: null }));
    socket.once('error', (err) => finish({ reachable: false, error: err.code || err.message }));
  });
}

async function runCheck() {
  const url = getProxyUrl();
  const wasActive = isActive();
  const result = getMode() === 'auto' && url ? await probe(url) : { reachable: false, error: null };
  state.reachable = result.reachable;
  state.error = result.error;
  state.checkedUrl = url;
  state.checkedAt = new Date().toISOString();
  const nowActive = isActive();
  if (wasActive !== nowActive) {
    console.log(nowActive
      ? `[solverr] Routing yt-dlp through Solverr proxy ${maskProxyUrl(url)}`
      : '[solverr] Solverr proxy unavailable; yt-dlp connects directly');
  }
  return getStatus();
}

// Concurrent callers share one in-flight probe.
function check() {
  if (!checking) checking = runCheck().finally(() => { checking = null; });
  return checking;
}

function getStatus() {
  const url = getProxyUrl();
  return {
    mode: getMode(),
    url: maskProxyUrl(url),
    urlSource: (readSetting('solverr_proxy_url') || '').trim() ? 'settings' : (url ? 'env' : null),
    caInstalled: isCaInstalled(),
    reachable: state.checkedUrl === url ? state.reachable : false,
    error: state.checkedUrl === url ? state.error : null,
    checkedAt: state.checkedAt,
    active: isActive(),
  };
}

function start() {
  if (timer) return;
  check();
  timer = setInterval(check, CHECK_INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  CA_FILE,
  PASSWORD_MASK,
  MODES,
  validateProxyUrl,
  maskProxyUrl,
  unmaskProxyUrl,
  getProxyUrl,
  isActive,
  proxyArgs,
  check,
  getStatus,
  start,
  stop,
  _state: state,
};
