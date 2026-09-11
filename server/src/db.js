const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  extractor TEXT,
  video_id TEXT,
  title TEXT,
  thumbnail TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  percent REAL DEFAULT 0,
  speed TEXT,
  eta TEXT,
  error TEXT,
  filepath TEXT,
  format_selector TEXT,
  audio_only INTEGER DEFAULT 0,
  subtitles INTEGER DEFAULT 0,
  quality TEXT,
  container TEXT DEFAULT 'mp4',
  sub_langs TEXT,
  watch_id INTEGER,
  command_args TEXT,
  log TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  name TEXT,
  format_selector TEXT,
  audio_only INTEGER DEFAULT 0,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watch_seen_ids (
  watch_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  PRIMARY KEY (watch_id, video_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// CREATE TABLE IF NOT EXISTS above only applies to brand-new databases, so upgrades of an
// existing /config/app.db need these columns added by hand.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('downloads', 'quality', 'TEXT');
ensureColumn('downloads', 'container', "TEXT DEFAULT 'mp4'");
ensureColumn('downloads', 'sub_langs', 'TEXT');
ensureColumn('downloads', 'command_args', 'TEXT');
ensureColumn('downloads', 'log', 'TEXT');
ensureColumn('downloads', 'is_live', 'INTEGER DEFAULT 0');
ensureColumn('downloads', 'options_json', 'TEXT');
ensureColumn('downloads', 'pid', 'INTEGER');
ensureColumn('downloads', 'stage', 'TEXT');
ensureColumn('users', 'session_version', 'INTEGER DEFAULT 1');
ensureColumn('watches', 'last_status', "TEXT DEFAULT 'ok'");
ensureColumn('watches', 'last_error', 'TEXT');
ensureColumn('watches', 'enabled', 'INTEGER DEFAULT 1');
ensureColumn('watches', 'check_interval_mins', 'INTEGER DEFAULT 30');
ensureColumn('watches', 'quality', 'TEXT');
ensureColumn('watches', 'container', "TEXT DEFAULT 'mp4'");
ensureColumn('watches', 'subtitles', 'INTEGER DEFAULT 0');
ensureColumn('watches', 'sub_langs', "TEXT DEFAULT 'en.*'");
ensureColumn('watches', 'embed_thumbnail', 'INTEGER DEFAULT 0');
ensureColumn('watches', 'embed_metadata', 'INTEGER DEFAULT 0');
ensureColumn('watches', 'embed_chapters', 'INTEGER DEFAULT 0');
ensureColumn('watches', 'sponsorblock', 'INTEGER DEFAULT 0');
ensureColumn('watches', 'sponsorblock_categories', 'TEXT');
ensureColumn('watches', 'match_title', 'TEXT');
ensureColumn('watches', 'reject_title', 'TEXT');
ensureColumn('watches', 'min_duration', 'INTEGER');
ensureColumn('watches', 'max_duration', 'INTEGER');
ensureColumn('watches', 'download_limit', 'INTEGER DEFAULT 5');
ensureColumn('watches', 'max_scan_entries', 'INTEGER DEFAULT 30');
ensureColumn('watches', 'thumbnail', 'TEXT');
ensureColumn('watches', 'channel_name', 'TEXT');
ensureColumn('watches', 'last_new_count', 'INTEGER DEFAULT 0');
ensureColumn('watches', 'cleanup_exempt', 'INTEGER DEFAULT 0');
ensureColumn('downloads', 'protected', 'INTEGER DEFAULT 0');
ensureColumn('watch_seen_ids', 'title', 'TEXT');
ensureColumn('watch_seen_ids', 'created_at', "TEXT DEFAULT (datetime('now'))");

// The session store used to be `better-sqlite3-session-store`, which created a `sessions`
// table with (sid, sess, expire) columns. The current store (connect-sqlite3) expects
// (sid, expired, sess) and only ever runs `CREATE TABLE IF NOT EXISTS`, so a table left
// over from the old store keeps its incompatible schema and every session query then
// fails with "no such column: expired". Drop it so the new store recreates it with the
// columns it expects; sessions are ephemeral, so this just signs everyone out once.
const sessionsTableInfo = db.prepare("PRAGMA table_info(sessions)").all();
if (sessionsTableInfo.length > 0 && !sessionsTableInfo.some((c) => c.name === 'expired')) {
  db.exec('DROP TABLE IF EXISTS sessions');
}

// Persists a random session-signing secret across restarts when SESSION_SECRET isn't set
// via env, so cookies aren't signed with a predictable value and existing sessions survive
// a container restart instead of being invalidated by a freshly-generated one each boot.
function getOrCreateSessionSecret() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('session_secret');
  if (row && row.value) return row.value;
  const secret = require('crypto').randomBytes(32).toString('hex');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('session_secret', secret);
  return secret;
}

module.exports = db;
module.exports.getOrCreateSessionSecret = getOrCreateSessionSecret;
