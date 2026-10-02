import React, { useCallback, useEffect, useState } from 'react';
import {
  X, Activity, Film, Loader2, Archive, AlertCircle, AlertTriangle, Shield, ShieldOff, RotateCcw,
} from 'lucide-react';
import { api } from '../api.js';
import { useModalA11y } from '../hooks/useModalA11y.js';

const ITEM_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'queued', label: 'Queued' },
  { key: 'completed', label: 'Completed' },
  { key: 'filtered', label: 'Filtered' },
  { key: 'failed', label: 'Failed' },
];

const PAGE_SIZE = 100;

function formatTime(value) {
  if (!value) return '—';
  return new Date(value.replace(' ', 'T') + 'Z').toLocaleString();
}

function itemState(item) {
  if (item.download_status !== 'none') return item.download_status;
  if (item.discovery_type === 'baseline') return 'baseline';
  return item.filter_status === 'excluded' ? 'filtered' : 'pending';
}

function retryNote(item) {
  if (item.download_status !== 'failed') return null;
  if (item.next_retry_at) return `Retries automatically after ${formatTime(item.next_retry_at)}`;
  return 'No more automatic retries';
}

function ItemsTab({ watch, onChanged }) {
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState({ items: [], total: 0, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(null);

  const load = useCallback((offset = 0) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ status: filter, limit: String(PAGE_SIZE), offset: String(offset) });
    return api.getWatchItems(watch.id, `?${params}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [watch.id, filter]);

  useEffect(() => { load(0); }, [load]);

  async function handleRetry(item) {
    setRetrying(item.id);
    try {
      await api.retryWatchItem(watch.id, item.id);
      await load(data.offset);
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="watch-activity-tab">
      <div className="watch-activity-filters" role="group" aria-label="Filter items by state">
        {ITEM_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={filter === f.key ? 'btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="empty-state">
          <Loader2 size={24} className="spin-icon text-accent" />
          <span className="empty-subtitle">Loading activity…</span>
        </div>
      ) : data.items.length === 0 ? (
        <div className="empty-state">
          <Archive size={32} />
          <span className="empty-title">Nothing here yet</span>
          <span className="empty-subtitle">Videos this watch discovers are listed here with what happened to them.</span>
        </div>
      ) : (
        <>
          <ul className="watch-activity-list">
            {data.items.map((item) => {
              const state = itemState(item);
              return (
                <li key={item.id} className="watch-activity-item">
                  {item.thumbnail ? (
                    <img className="thumb-sm" src={item.thumbnail} alt="" />
                  ) : (
                    <div className="thumb-sm thumb-empty watch-activity-thumb-empty"><Film size={12} /></div>
                  )}
                  <div className="watch-activity-body">
                    <a className="watch-activity-title" href={item.url || undefined} target="_blank" rel="noopener noreferrer" title={item.title || item.video_id}>
                      {item.title || item.video_id}
                    </a>
                    <div className="watch-activity-meta muted small">
                      <span className={`tag watch-state-badge state-${state}`}>{state}</span>
                      <span>{item.discovery_type}</span>
                      {item.filter_reason && <span>{item.filter_reason}</span>}
                      {item.attempt_count > 0 && <span>{item.attempt_count} attempt{item.attempt_count === 1 ? '' : 's'}</span>}
                      {retryNote(item) && <span>{retryNote(item)}</span>}
                    </div>
                    {item.last_error && item.download_status === 'failed' && (
                      <div className="watch-activity-error small">{item.last_error}</div>
                    )}
                  </div>
                  {item.download_status === 'failed' && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handleRetry(item)}
                      disabled={retrying === item.id}
                      title="Queue this video again now"
                    >
                      <RotateCcw size={13} className={retrying === item.id ? 'spin-icon' : ''} />
                      <span>Retry</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {data.total > PAGE_SIZE && (
            <div className="watch-activity-pager">
              <button type="button" className="btn-secondary btn-sm" disabled={data.offset === 0} onClick={() => load(Math.max(0, data.offset - PAGE_SIZE))}>
                Newer
              </button>
              <span className="muted small">
                {data.offset + 1}–{Math.min(data.offset + PAGE_SIZE, data.total)} of {data.total}
              </span>
              <button type="button" className="btn-secondary btn-sm" disabled={data.offset + PAGE_SIZE >= data.total} onClick={() => load(data.offset + PAGE_SIZE)}>
                Older
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const RUN_COUNTERS = [
  ['scanned_count', 'Scanned'],
  ['baseline_count', 'Baseline'],
  ['new_count', 'New'],
  ['backfill_count', 'Backfill'],
  ['matched_count', 'Matched'],
  ['excluded_count', 'Excluded'],
  ['queued_count', 'Queued'],
  ['pending_count', 'Pending'],
  ['failed_count', 'Failed'],
];

function RunsTab({ watch }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.getWatchRuns(watch.id)
      .then(setRuns)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [watch.id]);

  if (loading) {
    return (
      <div className="empty-state">
        <Loader2 size={24} className="spin-icon text-accent" />
        <span className="empty-subtitle">Loading checks…</span>
      </div>
    );
  }
  if (error) {
    return <div className="alert alert-error"><AlertCircle size={15} /><span>{error}</span></div>;
  }
  if (runs.length === 0) {
    return (
      <div className="empty-state">
        <Archive size={32} />
        <span className="empty-title">No checks yet</span>
      </div>
    );
  }
  return (
    <ul className="watch-activity-list">
      {runs.map((run) => (
        <li key={run.id} className="watch-run">
          <div className="watch-run-header">
            <span className={`tag watch-state-badge run-${run.status}`}>
              {run.status === 'partial' && <AlertTriangle size={11} />}
              {run.status}
            </span>
            <span className="watch-run-trigger">{run.trigger} check</span>
            <span className="muted small">{formatTime(run.started_at)}{run.finished_at ? ` → ${formatTime(run.finished_at)}` : ''}</span>
          </div>
          {run.status === 'partial' && (
            <div className="watch-activity-warning small">
              <AlertTriangle size={13} /> Scan limit reached before known content. Some newer uploads may have been missed.
            </div>
          )}
          {run.status === 'failed' && run.error && <div className="watch-activity-error small">{run.error}</div>}
          <div className="watch-run-counters">
            {RUN_COUNTERS.map(([key, label]) => (
              <span key={key} className="watch-run-counter"><strong>{run[key] || 0}</strong> {label}</span>
            ))}
            <span className="watch-run-counter">{run.scan_boundary_reached ? 'Reached known videos' : 'No known boundary'}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DownloadsTab({ watch }) {
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.getWatchDownloads(watch.id)
      .then(setDownloads)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [watch.id]);

  async function handleToggleProtect(download) {
    try {
      const updated = await api.toggleDownloadProtect(download.id, !download.protected);
      setDownloads((prev) => prev.map((d) => (d.id === download.id ? updated : d)));
    } catch (err) {
      console.error('Failed to toggle protection:', err);
    }
  }

  if (loading) {
    return (
      <div className="empty-state">
        <Loader2 size={24} className="spin-icon text-accent" />
        <span className="empty-subtitle">Loading download history…</span>
      </div>
    );
  }
  if (error) return <div className="alert alert-error"><AlertCircle size={15} /><span>{error}</span></div>;
  if (downloads.length === 0) {
    return (
      <div className="empty-state">
        <Archive size={32} />
        <span className="empty-title">No downloads yet</span>
        <span className="empty-subtitle">Videos auto-downloaded by this watch will be listed here.</span>
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="watch-downloads-table">
        <thead>
          <tr><th></th><th>Title</th><th>Status</th><th>Downloaded</th><th></th></tr>
        </thead>
        <tbody>
          {downloads.map((d) => (
            <tr key={d.id}>
              <td style={{ width: 48 }}>
                {d.thumbnail ? (
                  <img className="thumb-sm" src={d.thumbnail} alt="" />
                ) : (
                  <div className="thumb-sm thumb-empty watch-activity-thumb-empty"><Film size={12} /></div>
                )}
              </td>
              <td>
                <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{d.title || d.url}</div>
                {d.filepath && <div className="muted small" style={{ fontSize: 11, wordBreak: 'break-all' }}>{d.filepath}</div>}
                {d.error && <div className="muted small" style={{ color: 'var(--danger)', fontSize: 11 }}>{d.error}</div>}
              </td>
              <td><span className={`tag status-tag status-${d.status}`}>{d.status}</span></td>
              <td className="muted small" style={{ whiteSpace: 'nowrap' }}>{new Date(d.created_at + 'Z').toLocaleDateString()}</td>
              <td style={{ width: 40 }}>
                {d.status === 'completed' && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleToggleProtect(d)}
                    title={d.protected ? 'Protected from auto-delete — click to allow it again' : 'Protect this video from auto-delete'}
                  >
                    {d.protected ? <Shield size={14} /> : <ShieldOff size={14} />}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function WatchActivityModal({ open, onClose, watch, onChanged, initialTab = 'items' }) {
  const containerRef = useModalA11y(open, onClose);
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab, watch && watch.id]);

  if (!open || !watch) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        className="modal-container preview-modal watch-activity-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <Activity size={18} className="text-accent" />
            <span>Activity for "{watch.name || watch.channel_name || watch.url}"</span>
          </div>
          <button type="button" className="icon-btn-neutral" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="watch-activity-tabs" role="tablist">
          {[['items', 'Items'], ['runs', 'Runs'], ['downloads', 'Downloads']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`watch-activity-tab-btn ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab === 'items' && <ItemsTab watch={watch} onChanged={onChanged} />}
          {tab === 'runs' && <RunsTab watch={watch} />}
          {tab === 'downloads' && <DownloadsTab watch={watch} />}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
