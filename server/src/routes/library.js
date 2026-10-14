const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth } = require('../auth');
const cleanup = require('../services/cleanup');

const router = express.Router();
router.use(requireAuth);

const AUDIO_EXT_LIST = ['mp3', 'm4a', 'aac', 'flac', 'opus', 'ogg', 'oga', 'wav', 'alac', 'wma'];
const AUDIO_EXTS = new Set(AUDIO_EXT_LIST);
const AUDIO_EXT_SQL = `(${AUDIO_EXT_LIST.map((ext) => `lower(d.filepath) LIKE '%.${ext}'`).join(' OR ')})`;

// Containers browsers can generally play in a <video>/<audio> element. MKV plays in
// Chromium-based browsers for common codecs, so it's attempted; anything else (e.g. .ts)
// is offered as a download instead.
const PLAYABLE_EXTS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'mp3', 'm4a', 'aac', 'flac', 'opus', 'ogg', 'oga', 'wav']);

const ORDER_BY_SQL = {
  newest: 'd.created_at DESC, d.rowid DESC',
  oldest: 'd.created_at ASC, d.rowid ASC',
  title: "COALESCE(d.title, d.url, '') COLLATE NOCASE ASC, d.created_at DESC",
  size: 'COALESCE(d.filesize, 0) DESC, d.created_at DESC',
};

function extOf(filepath) {
  return path.extname(filepath || '').slice(1).toLowerCase();
}

function posterPath(filepath) {
  const ext = path.extname(filepath);
  return `${filepath.slice(0, filepath.length - ext.length)}.jpg`;
}

function statFile(filepath) {
  try {
    const st = fs.statSync(filepath);
    return st.isFile() ? st : null;
  } catch (_) {
    return null;
  }
}

function parseSplitParts(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (_) {
    return null;
  }
}

function withFileInfo(row) {
  const parts = parseSplitParts(row.split_parts);
  let size = null;
  let exists = false;
  if (parts && parts.length > 1) {
    let totalSize = 0;
    for (const partPath of parts) {
      const st = statFile(partPath);
      if (st) {
        totalSize += st.size;
        exists = true;
      }
    }
    if (exists) size = totalSize;
  } else {
    const st = statFile(row.filepath);
    if (st) {
      size = st.size;
      exists = true;
    }
  }
  const hasPoster = !!statFile(posterPath(row.filepath));

  // Keep persisted filesize / has_poster in sync when inspected on the current page.
  if (exists && (row.filesize !== size || Boolean(row.has_poster) !== hasPoster)) {
    try {
      db.prepare('UPDATE downloads SET filesize = ?, has_poster = ? WHERE id = ?')
        .run(size, hasPoster ? 1 : 0, row.id);
    } catch (_) {}
  }

  return {
    ...row,
    size,
    exists,
    hasPoster,
  };
}

// Backfills persisted filesize for any pre-existing completed rows that predated the column,
// so SQL sorting by size works accurately without scanning the disk on every request.
function backfillMissingFileSizes() {
  const missing = db.prepare(`
    SELECT id, filepath, split_parts, filesize, has_poster FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND filesize IS NULL
    LIMIT 500
  `).all();
  if (missing.length === 0) return;
  const update = db.prepare('UPDATE downloads SET filesize = ?, has_poster = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of missing) {
      const info = withFileInfo(row);
      if (info.exists) {
        update.run(info.size, info.hasPoster ? 1 : 0, row.id);
      }
    }
  })();
}

function toItem(row) {
  const ext = extOf(row.filepath);
  const splitParts = parseSplitParts(row.split_parts);
  return {
    id: row.id,
    title: row.title || path.basename(row.filepath),
    url: row.url,
    thumbnail: row.thumbnail,
    extractor: row.extractor,
    filepath: row.filepath,
    filename: path.basename(row.filepath),
    ext,
    kind: AUDIO_EXTS.has(ext) ? 'audio' : 'video',
    playable: PLAYABLE_EXTS.has(ext),
    createdAt: row.created_at,
    watchId: row.watch_id,
    watchName: row.watch_name || row.watch_channel_name || null,
    protected: !!row.protected,
    size: row.size,
    exists: row.exists,
    hasPoster: row.hasPoster,
    splitParts,
  };
}

function getCompletedRow(id) {
  return db.prepare(`
    SELECT d.id, d.url, d.title, d.thumbnail, d.extractor, d.filepath, d.created_at,
      d.watch_id, d.protected, d.split_parts, d.filesize, d.has_poster,
      w.name AS watch_name, w.channel_name AS watch_channel_name
    FROM downloads d LEFT JOIN watches w ON w.id = d.watch_id
    WHERE d.id = ? AND d.status = 'completed' AND d.filepath IS NOT NULL
  `).get(id);
}

// Files are only ever served by download id, from the path yt-dlp reported when that job
// completed (or a validated index into its split_parts list) — never from a client-supplied path.
function resolveExistingFile(req, res) {
  const row = getCompletedRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Not found in library' });
    return null;
  }
  let targetPath = row.filepath;
  if (req.query.part !== undefined && req.query.part !== '') {
    const parts = parseSplitParts(row.split_parts);
    const partIndex = Number(req.query.part);
    if (!parts || !Number.isInteger(partIndex) || partIndex < 0 || partIndex >= parts.length) {
      res.status(404).json({ error: 'Part not found' });
      return null;
    }
    targetPath = parts[partIndex];
  }
  const abs = path.resolve(targetPath);
  if (!statFile(abs)) {
    res.status(404).json({ error: 'File is missing on disk' });
    return null;
  }
  return { row, abs };
}

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const source = String(req.query.source || 'all');
  const kind = ['video', 'audio'].includes(req.query.kind) ? req.query.kind : 'all';
  const sort = ORDER_BY_SQL[req.query.sort] ? req.query.sort : 'newest';
  const pageSize = Math.min(100, Math.max(6, parseInt(req.query.pageSize, 10) || 24));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  if (sort === 'size') {
    backfillMissingFileSizes();
  }

  const where = ["d.status = 'completed'", 'd.filepath IS NOT NULL'];
  const params = [];

  if (source === 'manual') {
    where.push('d.watch_id IS NULL');
  } else if (source.startsWith('watch:')) {
    const watchId = parseInt(source.slice(6), 10);
    where.push('d.watch_id = ?');
    params.push(Number.isFinite(watchId) ? watchId : -1);
  }

  if (kind === 'audio') {
    where.push(AUDIO_EXT_SQL);
  } else if (kind === 'video') {
    where.push(`NOT ${AUDIO_EXT_SQL}`);
  }

  if (q) {
    where.push(`(
      instr(lower(coalesce(d.title, '')), ?) > 0 OR
      instr(lower(coalesce(d.url, '')), ?) > 0 OR
      instr(lower(coalesce(d.extractor, '')), ?) > 0 OR
      instr(lower(coalesce(w.name, '')), ?) > 0 OR
      instr(lower(coalesce(w.channel_name, '')), ?) > 0 OR
      instr(lower(coalesce(d.filepath, '')), ?) > 0
    )`);
    params.push(q, q, q, q, q, q);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const orderSql = ORDER_BY_SQL[sort];
  const offset = (page - 1) * pageSize;

  const total = db.prepare(`
    SELECT COUNT(*) AS c
    FROM downloads d LEFT JOIN watches w ON w.id = d.watch_id
    ${whereSql}
  `).get(...params).c;

  const pageRows = db.prepare(`
    SELECT d.id, d.url, d.title, d.thumbnail, d.extractor, d.filepath, d.created_at,
      d.watch_id, d.protected, d.split_parts, d.filesize, d.has_poster,
      w.name AS watch_name, w.channel_name AS watch_channel_name
    FROM downloads d LEFT JOIN watches w ON w.id = d.watch_id
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  // Only stat the rows on the current page.
  const items = pageRows.map((r) => toItem(withFileInfo(r)));

  const sources = db.prepare(`
    SELECT w.id, COALESCE(w.name, w.channel_name, w.url) AS name, COUNT(d.id) AS count
    FROM watches w JOIN downloads d ON d.watch_id = w.id
    WHERE d.status = 'completed' AND d.filepath IS NOT NULL
    GROUP BY w.id ORDER BY name COLLATE NOCASE
  `).all();

  res.json({ items, total, page, pageSize, sources });
});

router.get('/:id', (req, res) => {
  const row = getCompletedRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found in library' });
  res.json(toItem(withFileInfo(row)));
});

// Streams the media file for in-browser playback; sendFile handles Range requests, so
// seeking works without downloading the whole file first.
router.get('/:id/stream', (req, res) => {
  const found = resolveExistingFile(req, res);
  if (!found) return;
  res.sendFile(found.abs, { dotfiles: 'allow', headers: { 'Cache-Control': 'private, max-age=3600' } });
});

router.get('/:id/file', (req, res) => {
  const found = resolveExistingFile(req, res);
  if (!found) return;
  res.download(found.abs, path.basename(found.abs), { dotfiles: 'allow' });
});

// The poster image written next to the file by the .nfo sidecar feature — stays available
// after the site's own thumbnail URL has expired.
router.get('/:id/poster', (req, res) => {
  const row = getCompletedRow(req.params.id);
  if (!row) return res.status(404).end();
  const poster = posterPath(path.resolve(row.filepath));
  if (!statFile(poster)) return res.status(404).end();
  res.sendFile(poster, { dotfiles: 'allow', headers: { 'Cache-Control': 'private, max-age=86400' } });
});

// Removes the media file plus the sidecars this app writes next to it (.nfo, poster,
// subtitles). The history row stays, marked 'deleted', like the auto-delete job does.
router.delete('/:id/file', (req, res) => {
  const row = getCompletedRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found in library' });

  if (!cleanup.deleteDownloadFile(row.id, path.resolve(row.filepath), row.title, 'deleted from Library')) {
    return res.status(500).json({ error: 'Failed to delete the file (see server logs)' });
  }
  res.json({ ok: true });
});

module.exports = router;
