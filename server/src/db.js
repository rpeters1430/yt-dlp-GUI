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
ensureColumn('downloads', 'live_chunk_mins', 'INTEGER DEFAULT 0');
ensureColumn('downloads', 'split_parts', 'TEXT');
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
ensureColumn('watches', 'jellyfin_playlist_id', 'TEXT');
ensureColumn('watches', 'plex_playlist_id', 'TEXT');
ensureColumn('watches', 'is_music', 'INTEGER DEFAULT 0');
ensureColumn('watches', 'music_folder', 'TEXT');
ensureColumn('watches', 'audio_quality', "TEXT DEFAULT '320k'");
ensureColumn('watches', 'output_template', 'TEXT');
ensureColumn('watches', 'split_live_chunks', 'INTEGER DEFAULT 0');
ensureColumn('watches', 'live_chunk_mins', 'INTEGER DEFAULT 0');
ensureColumn('downloads', 'protected', 'INTEGER DEFAULT 0');
ensureColumn('watch_seen_ids', 'title', 'TEXT');
ensureColumn('watch_seen_ids', 'created_at', "TEXT DEFAULT (datetime('now'))");

ensureColumn('downloads', 'watch_item_id', 'INTEGER');

// Which YouTube channel tabs a watch follows (see services/watch/tabs.js), and which of them
// already have their existing videos recorded as baseline. NULL baselined_tabs on a watch
// that has been checked means it predates tabs, when the bare channel URL covered them all.
ensureColumn('watches', 'content_types', 'TEXT');
ensureColumn('watches', 'baselined_tabs', 'TEXT');

// The watch ledger: one row per video a watch has discovered (watch_items) and one row per
// check (watch_runs). An item being discovered is separate from it being eligible, and being
// eligible is separate from its download succeeding — so a failed or over-the-limit video is
// never silently lost the way it was when discovery alone marked it "seen".
db.exec(`
CREATE TABLE IF NOT EXISTS watch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  url TEXT,
  title TEXT,
  duration REAL,
  thumbnail TEXT,
  published_at TEXT,
  discovery_type TEXT NOT NULL CHECK (discovery_type IN ('baseline', 'new', 'backfill')),
  filter_status TEXT NOT NULL DEFAULT 'eligible' CHECK (filter_status IN ('eligible', 'excluded')),
  filter_reason TEXT,
  download_status TEXT NOT NULL DEFAULT 'none'
    CHECK (download_status IN ('none', 'queued', 'downloading', 'completed', 'failed')),
  download_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE (watch_id, video_id)
);

CREATE TABLE IF NOT EXISTS watch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('initial', 'scheduled', 'manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  scanned_count INTEGER NOT NULL DEFAULT 0,
  baseline_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  backfill_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  scan_boundary_reached INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_watch_items_state ON watch_items (watch_id, download_status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_watch_runs_watch ON watch_runs (watch_id, started_at);
CREATE INDEX IF NOT EXISTS idx_downloads_watch_item ON downloads (watch_item_id);
CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads (created_at);
`);

// The channel tab a watch item was found on (NULL for playlists and older items), so a tab
// switched off stops downloading its backlog too.
ensureColumn('watch_items', 'source_tab', 'TEXT');

// One-time move of the old seen-ID list into the ledger. Every seen ID becomes a baseline
// item (so upgrading never triggers a mass download); where a download for that video can be
// found, its state carries over and the two are linked. Unmatched IDs stay plain baseline
// rather than being guessed as completed.
function migrateSeenIds() {
  const done = db.prepare("SELECT value FROM settings WHERE key = 'watch_items_migrated'").get();
  if (done && done.value === '1') return;
  db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO watch_items
        (watch_id, video_id, title, discovery_type, filter_status, filter_reason, download_status)
      SELECT s.watch_id, s.video_id, s.title, 'baseline', 'eligible', 'Migrated from seen history', 'none'
      FROM watch_seen_ids s
      JOIN watches w ON w.id = s.watch_id
      ORDER BY s.watch_id, s.created_at
    `);
    const unlinked = db.prepare(
      "SELECT id, watch_id, video_id FROM watch_items WHERE download_id IS NULL AND filter_reason = 'Migrated from seen history'"
    ).all();
    const findDownload = db.prepare(`
      SELECT id, status, error, updated_at FROM downloads
      WHERE watch_id = ? AND watch_item_id IS NULL
        AND (video_id = ? OR (video_id IS NULL AND instr(url, ?) > 0))
      ORDER BY created_at DESC LIMIT 1
    `);
    const linkItem = db.prepare(`
      UPDATE watch_items SET
        download_id = ?, download_status = ?, last_error = ?,
        attempt_count = CASE WHEN ? IN ('completed', 'failed') THEN 1 ELSE 0 END,
        completed_at = CASE WHEN ? = 'completed' THEN ? ELSE NULL END
      WHERE id = ?
    `);
    const linkDownload = db.prepare('UPDATE downloads SET watch_item_id = ? WHERE id = ?');
    for (const item of unlinked) {
      const d = findDownload.get(item.watch_id, item.video_id, item.video_id);
      if (!d || !['queued', 'downloading', 'completed', 'failed'].includes(d.status)) continue;
      linkItem.run(d.id, d.status, d.status === 'failed' ? d.error : null, d.status, d.status, d.updated_at, item.id);
      linkDownload.run(item.id, d.id);
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('watch_items_migrated', '1')").run();
  })();
}
migrateSeenIds();

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
