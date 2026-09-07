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
  watch_id INTEGER,
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

module.exports = db;
