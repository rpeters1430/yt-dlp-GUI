const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth } = require('../auth');
const cleanup = require('../services/cleanup');

const router = express.Router();
router.use(requireAuth);

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'flac', 'opus', 'ogg', 'oga', 'wav', 'alac', 'wma']);
// Containers browsers can generally play in a <video>/<audio> element. MKV plays in
// Chromium-based browsers for common codecs, so it's attempted; anything else (e.g. .ts)
// is offered as a download instead.
const PLAYABLE_EXTS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'mp3', 'm4a', 'aac', 'flac', 'opus', 'ogg', 'oga', 'wav']);

const SORTS = {
  newest: (a, b) => (b.created_at || '').localeCompare(a.created_at || ''),
  oldest: (a, b) => (a.created_at || '').localeCompare(b.created_at || ''),
  title: (a, b) => (a.title || a.url || '').localeCompare(b.title || b.url || '', undefined, { sensitivity: 'base' }),
  size: (a, b) => (b.size || 0) - (a.size || 0),
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

function withFileInfo(row) {
  const st = statFile(row.filepath);
  return {
    ...row,
    size: st ? st.size : null,
    exists: !!st,
    hasPoster: !!statFile(posterPath(row.filepath)),
  };
}

function toItem(row) {
  const ext = extOf(row.filepath);
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
    splitParts: row.split_parts ? (() => { try { return JSON.parse(row.split_parts); } catch (_) { return null; } })() : null,
  };
}

function getCompletedRow(id) {
  return db.prepare(`
    SELECT d.*, w.name AS watch_name, w.channel_name AS watch_channel_name
    FROM downloads d LEFT JOIN watches w ON w.id = d.watch_id
    WHERE d.id = ? AND d.status = 'completed' AND d.filepath IS NOT NULL
  `).get(id);
}

// Files are only ever served by download id, from the path yt-dlp reported when that job
// completed — never from a client-supplied path.
function resolveExistingFile(req, res) {
  const row = getCompletedRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Not found in library' });
    return null;
  }
  const abs = path.resolve(row.filepath);
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
  const sort = SORTS[req.query.sort] ? req.query.sort : 'newest';
  const pageSize = Math.min(100, Math.max(6, parseInt(req.query.pageSize, 10) || 24));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  let rows = db.prepare(`
    SELECT d.id, d.url, d.title, d.thumbnail, d.extractor, d.filepath, d.created_at,
      d.watch_id, d.protected, d.split_parts, w.name AS watch_name, w.channel_name AS watch_channel_name
    FROM downloads d LEFT JOIN watches w ON w.id = d.watch_id
    WHERE d.status = 'completed' AND d.filepath IS NOT NULL
  `).all();

  if (source === 'manual') rows = rows.filter((r) => !r.watch_id);
  else if (source.startsWith('watch:')) {
    const watchId = parseInt(source.slice(6), 10);
    rows = rows.filter((r) => r.watch_id === watchId);
  }
  if (kind !== 'all') {
    rows = rows.filter((r) => (AUDIO_EXTS.has(extOf(r.filepath)) ? 'audio' : 'video') === kind);
  }
  if (q) {
    rows = rows.filter((r) => [r.title, r.url, r.extractor, r.watch_name, r.watch_channel_name, path.basename(r.filepath)]
      .some((v) => v && String(v).toLowerCase().includes(q)));
  }

  // Sizes come from disk, so only stat the whole result set when sorting by size;
  // otherwise just the page being returned.
  if (sort === 'size') rows = rows.map(withFileInfo);
  rows.sort(SORTS[sort]);
  const total = rows.length;
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const items = pageRows.map((r) => toItem(sort === 'size' ? r : withFileInfo(r)));

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
