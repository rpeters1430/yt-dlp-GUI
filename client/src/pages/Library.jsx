import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Film, Music2, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api.js';
import { useDownloads } from '../context/DownloadsContext.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useModalA11y } from '../hooks/useModalA11y.js';
import { Segmented } from '../components/DownloadOptionsFields.jsx';
import { siteName } from '../format.js';

const PAGE_SIZE = 24;

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
  return new Date(`${sqlDate}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

function PlayerOverlay({ item, onClose, onToggleProtect, onDelete }) {
  const containerRef = useModalA11y(!!item, onClose);
  const [errorFor, setErrorFor] = useState(null);
  const [partIndex, setPartIndex] = useState(0);

  if (!item) return null;
  const parts = Array.isArray(item.splitParts) && item.splitParts.length > 1 ? item.splitParts : null;
  const activePart = parts ? Math.min(partIndex, parts.length - 1) : null;
  const errorKey = activePart !== null ? `${item.id}:${activePart}` : item.id;
  const playError = errorFor === errorKey;
  const src = api.libraryStreamUrl(item.id, activePart);
  const fileUrl = api.libraryFileUrl(item.id, activePart);
  const activePath = parts ? parts[activePart] : item.filepath;
  const meta = [
    item.watchName || siteName(item.extractor) || 'Added by hand',
    formatDate(item.createdAt),
    item.size !== null ? formatBytes(item.size) : null,
    parts ? `${parts.length} parts` : null,
    item.ext?.toUpperCase(),
  ].filter(Boolean).join(' · ');

  const handleEnded = () => {
    if (parts && activePart < parts.length - 1) {
      setPartIndex(activePart + 1);
    }
  };

  return (
    <div className="player-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        tabIndex={-1}
        className="player"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="player-media">
          {!item.playable || playError ? (
            <div className="player-unplayable">
              Your browser can&apos;t play this file{item.ext ? ` (.${item.ext})` : ''}. Download it and open it in a
              media player such as VLC, or play it from your media server.
            </div>
          ) : item.kind === 'audio' ? (
            <div className="player-audio">
              <Artwork key={item.id} item={item} className="player-audio-art" />
              <audio
                key={errorKey}
                controls
                autoPlay
                src={src}
                onEnded={handleEnded}
                onError={() => setErrorFor(errorKey)}
              />
            </div>
          ) : (
            <video
              key={errorKey}
              controls
              autoPlay
              playsInline
              preload="metadata"
              src={src}
              poster={item.hasPoster ? api.libraryPosterUrl(item.id) : item.thumbnail || undefined}
              onEnded={handleEnded}
              onError={() => setErrorFor(errorKey)}
            />
          )}
        </div>
        <div className="player-info">
          <h2 className="player-title">{item.title}</h2>
          <div className="mono-meta">{meta}</div>
          {parts && (
            <div className="chip-row" role="tablist" aria-label="Recording parts" style={{ marginTop: 8 }}>
              {parts.map((partPath, idx) => (
                <button
                  key={partPath || idx}
                  type="button"
                  role="tab"
                  aria-selected={activePart === idx}
                  className={`chip${activePart === idx ? ' active' : ''}`}
                  onClick={() => setPartIndex(idx)}
                >
                  Part {idx + 1}
                </button>
              ))}
            </div>
          )}
          <div className="mono-meta player-path" title={activePath}>{activePath}</div>
          <div className="btn-row player-actions">
            {item.watchId && (
              <button type="button" className="btn-ghost" onClick={() => onToggleProtect(item)}>
                {item.protected ? 'Kept · allow auto-delete' : 'Keep forever'}
              </button>
            )}
            {item.url && (
              <a className="btn-ghost" href={item.url} target="_blank" rel="noreferrer noopener">Original page</a>
            )}
            <button type="button" className="btn-ghost" onClick={() => onDelete(item)}>Delete file</button>
            <span className="btn-row-spacer" />
            <a className="btn-primary" href={fileUrl} download>
              {parts ? `Download part ${activePart + 1}` : 'Download file'}
            </a>
            <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Library() {
  const { storage } = useDownloads();
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
  const [params, setParams] = useSearchParams();

  // Home's "Open" links here with ?play=<download id>.
  const playId = params.get('play');
  useEffect(() => {
    if (!playId) return;
    api.getLibraryItem(playId)
      .then((item) => { if (item.exists) setPlaying(item); })
      .catch(() => {})
      .finally(() => setParams({}, { replace: true }));
  }, [playId, setParams]);

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
      setData((prev) => (prev ? {
        ...prev,
        items: prev.items.map((i) => (i.id === item.id ? { ...i, protected: !item.protected } : i)),
      } : prev));
      setPlaying((p) => (p && p.id === item.id ? { ...p, protected: !item.protected } : p));
    } catch (err) {
      setError(err.message);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = !!debouncedQuery || source !== 'all' || kind !== 'all';

  return (
    <>
      <div className="page-title-row">
        <h1>Library</h1>
        <span className="mono-meta">
          {[
            data ? `${data.total.toLocaleString()} item${data.total === 1 ? '' : 's'}` : null,
            storage ? `${storage.freeGb} GB free (${Math.round(storage.usedPercent)}% used)` : null,
          ].filter(Boolean).join(' · ')}
        </span>
      </div>
      {storage && (storage.lowDiskWarning || storage.belowMinFreeDisk) && (
        <div className="notice notice-warning" style={{ marginBottom: 14 }}>
          Low disk space on media volume: <strong>{storage.freeGb} GB free</strong> ({storage.usedPercent}% used)
          {storage.belowMinFreeDisk ? ` — scheduled Watch downloads are paused below your ${storage.minFreeDiskGb} GB safety guard.` : '.'}
        </div>
      )}

      <div className="toolbar">
        <input
          className="toolbar-search"
          placeholder="Search title, channel, site, or filename"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search library"
        />
        <Segmented
          value={kind}
          onChange={(v) => { setKind(v); setPage(1); }}
          options={[{ value: 'all', label: 'All' }, { value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }]}
        />
        <Segmented
          value={sort}
          onChange={(v) => { setSort(v); setPage(1); }}
          options={[{ value: 'newest', label: 'Newest' }, { value: 'title', label: 'A–Z' }, { value: 'size', label: 'Largest' }]}
        />
        {(data?.sources || []).length > 0 && (
          <select className="toolbar-select" value={source} onChange={changeFilter(setSource)} aria-label="Source">
            <option value="all">All sources</option>
            <option value="manual">Added by hand</option>
            {(data?.sources || []).map((s) => (
              <option key={s.id} value={`watch:${s.id}`}>{s.name} ({s.count})</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="notice notice-danger">{error}</div>}

      {!data ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : data.items.length === 0 ? (
        <p className="empty-line">
          {hasFilters ? 'Nothing matches. Try a different search or filter.' : 'Your library is empty. Completed downloads show up here, ready to play.'}
        </p>
      ) : (
        <>
          <div className="library-tiles">
            {data.items.map((item) => (
              <article key={item.id} className={`tile${item.exists ? '' : ' missing'}`}>
                <button
                  type="button"
                  className="tile-art"
                  style={{ aspectRatio: item.kind === 'audio' ? '1' : '16 / 9' }}
                  onClick={() => item.exists && setPlaying(item)}
                  disabled={!item.exists}
                  aria-label={item.exists ? `Play ${item.title}` : `${item.title} (file missing)`}
                >
                  <Artwork item={item} className="tile-img" />
                  {item.exists ? (
                    <span className="tile-play"><Play size={18} fill="currentColor" /></span>
                  ) : (
                    <span className="badge badge-dark badge-tl">FILE MISSING</span>
                  )}
                  {item.exists && item.splitParts?.length > 1 && (
                    <span className="badge badge-dark badge-tl">{item.splitParts.length} PARTS</span>
                  )}
                  {item.ext && <span className="badge badge-dark badge-bl">{item.ext.toUpperCase()}</span>}
                  {item.protected && <span className="badge badge-success badge-tr">KEPT</span>}
                </button>
                <div className="tile-title" title={item.title}>{item.title}</div>
                <div className="tile-meta mono-meta">
                  {[
                    item.watchName ? `Watch · ${item.watchName}` : (siteName(item.extractor) || 'Added by hand'),
                    formatDate(item.createdAt),
                    item.splitParts?.length > 1 ? `${item.splitParts.length} parts` : null,
                    item.size !== null ? formatBytes(item.size) : null,
                  ].filter(Boolean).join(' · ')}
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="list-footer">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                <ChevronLeft size={15} /> Previous
              </button>
              <span className="mono-meta">Page {page} of {totalPages}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
                Next <ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      )}

      <PlayerOverlay
        key={playing?.id || 'none'}
        item={playing}
        onClose={() => setPlaying(null)}
        onToggleProtect={toggleProtect}
        onDelete={(item) => setPendingDelete(item)}
      />

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
