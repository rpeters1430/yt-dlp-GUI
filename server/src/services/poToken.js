// Optional YouTube PO-token provider (bgutil-ytdlp-pot-provider). YouTube's player attaches a
// "proof of origin" token minted by its BotGuard script; without one, requests from some IPs
// get the "Sign in to confirm you're not a bot" wall or 403s on the media itself. The bgutil
// provider runs BotGuard in its own container and yt-dlp asks it for tokens over HTTP.
//
// The yt-dlp plugin is installed into its own directory (see Dockerfile) rather than
// site-packages, so it's only loaded when this setting is on: loaded with no reachable
// provider, it prints "Error reaching GET .../ping" on every YouTube request.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const PLUGIN_DIR = process.env.BGUTIL_PLUGIN_DIR || '/opt/yt-dlp-plugins/bgutil';
const DEFAULT_URL = process.env.BGUTIL_POT_URL || 'http://bgutil-provider:4416';
const MODES = new Set(['off', 'on']);
const PING_TIMEOUT_MS = 4000;

function readSetting(key) {
  try {
    const db = require('../db');
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

function getMode() {
  const mode = readSetting('pot_provider_mode');
  return MODES.has(mode) ? mode : 'off';
}

function getUrl() {
  const stored = (readSetting('pot_provider_url') || '').trim();
  return (stored || DEFAULT_URL).replace(/\/+$/, '');
}

function pluginInstalled() {
  return fs.existsSync(path.join(PLUGIN_DIR, 'yt_dlp_plugins'));
}

// Returns null for a usable provider URL, otherwise the reason it isn't one.
function validateUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw));
  } catch {
    return 'Provider URL must look like http://bgutil-provider:4416';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'Provider URL must start with http:// or https://';
  if (!parsed.hostname) return 'Provider URL needs a host';
  if (parsed.pathname && parsed.pathname !== '/') return 'Provider URL must not include a path';
  return null;
}

// yt-dlp drops its default plugin locations as soon as any --plugin-dirs is given, so
// 'default' is listed again; it de-duplicates paths, so repeating it alongside the NAS
// plugin's own --plugin-dirs flags is harmless.
function args() {
  if (getMode() !== 'on' || !pluginInstalled()) return [];
  return [
    '--plugin-dirs', 'default', '--plugin-dirs', PLUGIN_DIR,
    '--extractor-args', `youtubepot-bgutilhttp:base_url=${getUrl()}`,
  ];
}

function ping(url, timeoutMs = PING_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(`${url}/ping`);
    } catch {
      resolve({ reachable: false, error: 'Invalid provider URL' });
      return;
    }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.get(target, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 4096) body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({ reachable: false, error: `HTTP ${res.statusCode}` });
          return;
        }
        try {
          const json = JSON.parse(body);
          resolve({ reachable: true, version: json.version || null });
        } catch {
          resolve({ reachable: false, error: 'Not a bgutil provider (unexpected /ping response)' });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`no answer within ${Math.round(timeoutMs / 1000)}s`)));
    req.on('error', (e) => resolve({ reachable: false, error: e.code || e.message }));
  });
}

async function getStatus({ pingFn = ping } = {}) {
  const mode = getMode();
  const url = getUrl();
  const base = {
    mode,
    url,
    urlSource: (readSetting('pot_provider_url') || '').trim() ? 'setting' : (process.env.BGUTIL_POT_URL ? 'env' : 'default'),
    pluginInstalled: pluginInstalled(),
    checkedAt: new Date().toISOString(),
  };
  if (mode === 'off') return { ...base, reachable: null, version: null, error: null };
  return { ...base, version: null, error: null, ...(await pingFn(url)) };
}

module.exports = { args, getStatus, validateUrl, ping, getMode, getUrl, pluginInstalled, MODES, PLUGIN_DIR, DEFAULT_URL };
