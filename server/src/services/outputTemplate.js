const path = require('path');

// Same default as ytdlp.js; not imported from there so this module (and its tests) stay
// free of the database and binary lookups that module pulls in.
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '..', '..', 'downloads');

// Relative to DOWNLOAD_DIR. Titles are capped in bytes: some sites use very long (often
// multi-byte) titles that push the name past the 255-byte filesystem limit once yt-dlp's
// post-processing adds suffixes like ".temp" / ".f137".
const DEFAULT_TEMPLATE = '%(uploader,extractor).80B/%(title).150B [%(id)s].%(ext)s';

const PRESETS = [
  { id: 'channel', label: 'Channel folder (default)', template: DEFAULT_TEMPLATE },
  { id: 'flat', label: 'Flat — everything in one folder', template: '%(title).150B [%(id)s].%(ext)s' },
  { id: 'channel-year', label: 'Channel / Year', template: '%(uploader,extractor).80B/%(upload_date>%Y|Unknown)s/%(title).150B [%(id)s].%(ext)s' },
  { id: 'channel-dated', label: 'Channel / date-prefixed title (sorts by date)', template: '%(uploader,extractor).80B/%(upload_date>%Y-%m-%d|)s %(title).140B [%(id)s].%(ext)s' },
  { id: 'site-channel', label: 'Site / Channel', template: '%(extractor_key)s/%(uploader,extractor).80B/%(title).150B [%(id)s].%(ext)s' },
];

const MAX_TEMPLATE_LENGTH = 500;

// Returns an error message, or null when the template is usable. Templates are always
// resolved under DOWNLOAD_DIR, so absolute paths and `..` segments are rejected to keep
// every download inside the mounted volume. Field values yt-dlp substitutes are sanitized
// by yt-dlp itself (path separators are replaced), so only the literal text needs checking.
function validateTemplate(template) {
  if (typeof template !== 'string' || !template.trim()) return 'Template is required';
  const t = template.trim();
  if (t.length > MAX_TEMPLATE_LENGTH) return `Template is too long (max ${MAX_TEMPLATE_LENGTH} characters)`;
  if (/[\0\r\n]/.test(t)) return 'Template must be a single line';
  if (t.startsWith('/') || t.startsWith('\\') || /^[a-zA-Z]:/.test(t)) {
    return 'Template must be relative to the downloads folder (no leading / or drive letter)';
  }
  const literal = t.replace(/%\([^)]*\)[-#0 +]*\d*(?:\.\d+)?[a-zA-Z]/g, 'X');
  if (literal.split(/[/\\]/).some((segment) => segment.trim() === '..')) {
    return 'Template must not contain ".." path segments';
  }
  if (!/%\(ext\)s$/.test(t)) return 'Template must end with .%(ext)s so files keep their extension';
  if (!/%\((?:[^)]*[,(])?(?:id|title)[^)]*\)/.test(t)) {
    return 'Template should include %(title)s or %(id)s, otherwise every download would get the same name';
  }
  return null;
}

function getGlobalTemplate() {
  const db = require('../db');
  const row = db.prepare("SELECT value FROM settings WHERE key = 'output_template'").get();
  const value = row && row.value ? row.value.trim() : '';
  return value && !validateTemplate(value) ? value : DEFAULT_TEMPLATE;
}

function toAbsolute(template) {
  return `${DOWNLOAD_DIR}/${template}`;
}

// The absolute yt-dlp -o template for a download: the Watch's own template when it has a
// valid one, else the global setting, else the built-in default.
function resolveTemplate({ watchTemplate = null } = {}) {
  const own = watchTemplate ? String(watchTemplate).trim() : '';
  if (own && !validateTemplate(own)) return toAbsolute(own);
  return toAbsolute(getGlobalTemplate());
}

module.exports = { DEFAULT_TEMPLATE, PRESETS, validateTemplate, getGlobalTemplate, resolveTemplate };
