import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search, Film, Music2, Play, Download, Trash2, Shield, ShieldOff, X, AlertCircle,
  ChevronLeft, ChevronRight, Library as LibraryIcon, ExternalLink,
} from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useModalA11y } from '../hooks/useModalA11y.js';

const PAGE_SIZE = 24;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'size', label: 'Largest first' },
];

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(sqlDate) {
  if (!sqlDate) return '';
  return new Date(`${sqlDate}Z`).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// Prefers the poster saved next to the file (it outlives the site's thumbnail URL, which
// some sites expire), falling back to the remote thumbnail, then to an icon.
function Artwork({ item, className }) {
  const sources = [item.hasPoster ? api.libraryPosterUrl(item.id) : null, item.thumbnail].filter(Boolean);
  const [index, setIndex] = useState(0);
  const Icon = item.kind === 'audio' ? Music2 : Film;
  if (index >= sources.length) {
    return <div className={`${className} library-art-empty`}><Icon size={26} /></div>;
  }
  return <img className={className} src={sources[index]} alt="" loading="lazy" onError={() => setIndex(index + 1)} />;
}

function PlayerModal({ item, onClose }) {
  const containerRef = useModalA11y(!!item, onClose);
  const [playError, setPlayError] = useState(false);

  useEffect(() => setPlayError(false), [item]);

  if (!item) return null;
  const src = api.libraryStreamUrl(item.id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        tabIndex={-1}
        className="modal-container library-player-modal"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-title library-player-title">
            {item.kind === 'audio' ? <Music2 size={16} /> : <Film size={16} />}
            <span>{item.title}</span>
          </div>
          <button type="button" className="icon-btn-neutral" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body library-player-body">
          {!item.playable || playError ? (
            <div className="alert alert-warning">
              <AlertCircle size={15} />
              <div>
                Your browser can't play this file{item.ext ? ` (.${item.ext})` : ''}. Download it and open it in a
                media player such as VLC, or play it from your media server.
              </div>
            </div>
          ) : item.kind === 'audio' ? (
            <div className="library-audio-wrap">
              <Artwork key={item.id} item={item} className="library-audio-art" />
              <audio controls autoPlay src={src} onError={() => setPlayError(true)} style={{ width: '100%' }} />
            </div>
          ) : (
            <video
              className="library-video"
              controls
              autoPlay
              playsInline
              preload="metadata"
              src={src}
              poster={item.hasPoster ? api.libraryPosterUrl(item.id) : item.thumbnail || undefined}
              onError={() => setPlayError(true)}
            />
          )}
          <div className="library-player-meta muted small">
            {item.watchName && <span>{item.watchName}</span>}
            {item.extractor && <span>{item.extractor}</span>}
            <span>{formatDate(item.createdAt)}</span>
            {item.size !== null && <span>{formatBytes(item.size)}</span>}
            <span className="library-player-path" title={item.filepath}>{item.filepath}</span>
          </div>
        </div>
        <div className="modal-footer">
          {item.url && (
            <a className="library-footer-link" href={item.url} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={14} /> Original page
            </a>
          )}
          <a className="library-download-btn" href={api.libraryFileUrl(item.id)} download>
            <Download size={15} /> Download file
          </a>
        </div>
      </div>
    </div>
  );
}

export default function Library() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [source, setSource] = useState('all');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const requestSeq = useRef(0);

  // Any filter change starts over from the first page.
  function changeFilter(setter) {
    return (e) => {
      setter(e.target.value);
      setPage(1);
    };
  }

  useEffect(() => {
    const next = query.trim();
    if (next === debouncedQuery) return undefined;
    const t = setTimeout(() => {
      setDebouncedQuery(next);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [query, debouncedQuery]);

  const load = useCallback(() => {
    // Only the latest request may update the page, so a slow response for an old filter
    // can't overwrite the results of a newer one.
    const seq = ++requestSeq.current;
    setError('');
    return api.listLibrary({ q: debouncedQuery, source, kind, sort, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (seq === requestSeq.current) setData(result);
      })
      .catch((err) => {
        if (seq === requestSeq.current) setError(err.message);
      });
  }, [debouncedQuery, source, kind, sort, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmDelete() {
    const item = pendingDelete;
    setPendingDelete(null);
    try {
      await api.deleteLibraryFile(item.id);
      if (playing && playing.id === item.id) setPlaying(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleProtect(item) {
    try {
      await api.toggleDownloadProtect(item.id, !item.protected);
      setData((prev) => ({
        ...prev,
        items: prev.items.map((i) => (i.id === item.id ? { ...i, protected: !item.protected } : i)),
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = !!debouncedQuery || source !== 'all' || kind !== 'all';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Library</h1>
          <p>Browse and play everything you've downloaded.</p>
        </div>
      </div>

      <section className="panel">
        <div className="table-toolbar">
          <div className="search-input">
            <Search size={15} />
            <input placeholder="Search title, channel, site, or filename…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select value={source} onChange={changeFilter(setSource)} aria-label="Source">
            <option value="all">All sources</option>
            <option value="manual">Added by hand</option>
            {(data?.sources || []).map((s) => (
              <option key={s.id} value={`watch:${s.id}`}>{s.name} ({s.count})</option>
            ))}
          </select>
          <select value={kind} onChange={changeFilter(setKind)} aria-label="Type">
            <option value="all">Video &amp; audio</option>
            <option value="video">Video only</option>
            <option value="audio">Audio only</option>
          </select>
          <select value={sort} onChange={changeFilter(setSort)} aria-label="Sort">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><AlertCircle size={15} />{error}</div>}

        {!data ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : data.items.length === 0 ? (
          <div className="empty-state">
            <LibraryIcon size={30} />
            <span className="empty-title">{hasFilters ? 'No matches' : 'Your library is empty'}</span>
            <span className="empty-subtitle">
              {hasFilters ? 'Try a different search or filter.' : 'Completed downloads show up here, ready to play.'}
            </span>
          </div>
        ) : (
          <>
            <div className="muted small" style={{ marginBottom: 10 }}>
              {data.total} item{data.total === 1 ? '' : 's'}
            </div>
            <div className="library-grid">
              {data.items.map((item) => (
                <article key={item.id} className={`library-card${item.exists ? '' : ' missing'}`}>
                  <button
                    type="button"
                    className="library-card-art"
                    onClick={() => item.exists && setPlaying(item)}
                    disabled={!item.exists}
                    aria-label={item.exists ? `Play ${item.title}` : `${item.title} (file missing)`}
                  >
                    <Artwork item={item} className="library-card-img" />
                    {item.exists ? (
                      <span className="library-card-play"><Play size={22} /></span>
                    ) : (
                      <span className="library-card-missing"><AlertCircle size={13} /> File missing</span>
                    )}
                    <span className="library-card-ext">{item.ext}</span>
                  </button>
                  <div className="library-card-body">
                    <div className="library-card-title" title={item.title}>{item.title}</div>
                    <div className="library-card-meta muted small">
                      <span>{item.watchName || item.extractor || 'Added by hand'}</span>
                      <span>{formatDate(item.createdAt)}{item.size !== null ? ` · ${formatBytes(item.size)}` : ''}</span>
                    </div>
                    <div className="library-card-actions">
                      {item.exists && (
                        <a className="library-icon-link" href={api.libraryFileUrl(item.id)} download title="Download file" aria-label="Download file">
                          <Download size={14} />
                        </a>
                      )}
                      {item.watchId && (
                        <button
                          type="button"
                          className="icon-btn-neutral"
                          onClick={() => toggleProtect(item)}
                          title={item.protected ? 'Protected from auto-delete — click to allow it again' : 'Protect from auto-delete'}
                          aria-label={item.protected ? 'Unprotect' : 'Protect'}
                        >
                          {item.protected ? <Shield size={14} /> : <ShieldOff size={14} />}
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setPendingDelete(item)}
                        title="Delete file from disk"
                        aria-label="Delete file"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="library-pagination">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                  <ChevronLeft size={15} /> Previous
                </button>
                <span className="muted small">Page {page} of {totalPages}</span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
                  Next <ChevronRight size={15} />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <PlayerModal item={playing} onClose={() => setPlaying(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete file"
        message={`Permanently delete "${pendingDelete?.title || 'this file'}" from disk? Its .nfo, poster, and subtitle files are removed too. The entry stays in History marked as deleted.`}
        confirmLabel="Delete file"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
