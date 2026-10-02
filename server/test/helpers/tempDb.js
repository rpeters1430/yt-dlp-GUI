const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = require.resolve('../../src/db');

// Loads src/db.js against a fresh CONFIG_DIR so each test gets its own SQLite file.
// `reopen()` closes and reloads the module on the same directory, like a server restart.
function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-watch-'));
  const previous = process.env.CONFIG_DIR;
  let db = null;

  function load() {
    process.env.CONFIG_DIR = dir;
    delete require.cache[dbPath];
    db = require(dbPath);
    if (previous === undefined) delete process.env.CONFIG_DIR;
    else process.env.CONFIG_DIR = previous;
    return db;
  }

  load();
  return {
    get db() { return db; },
    dir,
    reopen() {
      db.close();
      return load();
    },
    cleanup() {
      try { db.close(); } catch (_) {}
      delete require.cache[dbPath];
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { openTempDb };
