import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Shield, ShieldOff, X } from 'lucide-react';
import { api } from '../api.js';
import Art from '../components/Art.jsx';
import JobLog from '../components/JobLog.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useDownloads } from '../context/DownloadsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { parseUtc, shortPath, siteName } from '../format.js';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'queued', label: 'Queued' },
  { value: 'deleted', label: 'Auto-deleted' },
];
const VALID = new Set([...FILTERS.map((f) => f.value), 'downloading']);
const PAGE_SIZE = 50;

const BOT_CHECK_RE = /Sign in to confirm you(?:'|’)re not a bot|confirm you(?:'|’)re not a bot/i;
const AUTH_REQUIRED_RE = /Sign in to confirm your age|age[- ]restricted|inappropriate for some users|members-only content|Join this channel to get access|Private video|requires authentication|login required|HTTP Error 401/i;
const VIDEO_UNAVAILABLE_RE = /Video unavailable|This video (?:has been removed|is no longer available|is not available)|not (?:made this video )?available in your country|blocked it (?:in your country|on copyright grounds)|copyright claim|account associated with this video has been terminated/i;

export function classifyFailure(message) {
  const text = String(message || '');
  if (BOT_CHECK_RE.test(text)) return 'bot_check';
  if (AUTH_REQUIRED_RE.test(text)) return 'auth_required';
  if (VIDEO_UNAVAILABLE_RE.test(text)) return 'unavailable';
  return 'network_or_stalled';
}

const FAILURE_CATEGORY_LABELS = {
  all: 'All failures',
  network_or_stalled: 'Transient / Network',
  bot_check: 'Bot check',
  auth_required: 'Auth / Cookies',
  unavailable: 'Unavailable',
};

function rowDate(job) {
  if (job.status === 'queued' || job.status === 'downloading') return 'Now';
  const d = parseUtc(job.updated_at || job.created_at);
  if (!d) return '';
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function subLine(job) {
  if (job.status === 'failed') return job.error || 'Download failed';
  if (job.status === 'deleted') return 'Removed by auto-delete';
  if (job.filepath) return shortPath(job.filepath);
  if (job.status === 'queued') return job.stage && job.stage !== 'Queued' ? job.stage : 'Waiting in queue';
  if (job.status === 'downloading') return job.stage || `${Math.round(job.percent || 0)}%`;
  return job.url;
}

export default function History() {
  // The filter lives in the URL (?status=failed), so nav links and back/forward change it.
  const [params, setParams] = useSearchParams();
  const statusFilter = VALID.has(params.get('status')) ? params.get('status') : 'all';
  const [failureCategory, setFailureCategory] = useState('all');
  const [failureStats, setFailureStats] = useState({ all: 0, network_or_stalled: 0, bot_check: 0, auth_required: 0, unavailable: 0 });
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { id, label, hasFile }
  const [deleteDiskFile, setDeleteDiskFile] = useState(false);
  const [reload, setReload] = useState(0);
  const [retryingAll, setRetryingAll] = useState(false);
  const { failedCount } = useDownloads();
  const toast = useToast();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  function chooseFilter(value) {
    setExpandedId(null);
    setFailureCategory('all');
    setParams(value === 'all' ? {} : { status: value }, { replace: true });
  }

  // Bumped whenever the search criteria change, so a "Load more" still in flight for the
  // previous criteria is ignored instead of appending the wrong rows.
  const searchGeneration = useRef(0);

  // Search and filtering run on the server, a page at a time, so a long history stays fast.
  useEffect(() => {
    let cancelled = false;
    searchGeneration.current += 1;
    setLoading(true);
    setLoadError('');
    api.searchDownloads({ status: statusFilter, q: debouncedQuery, limit: PAGE_SIZE, offset: 0, category: failureCategory })
      .then((res) => {
        if (cancelled) return;
        setJobs(res.jobs);
        setTotal(res.total);
        if (res.failureCounts) setFailureStats(res.failureCounts);
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Failed to load history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [statusFilter, debouncedQuery, reload, failureCategory]);

  async function handleLoadMore() {
    const generation = searchGeneration.current;
    setLoadingMore(true);
    try {
      const res = await api.searchDownloads({ status: statusFilter, q: debouncedQuery, limit: PAGE_SIZE, offset: jobs.length, category: failureCategory });
      if (generation !== searchGeneration.current) return;
      setJobs((prev) => {
        const seen = new Set(prev.map((j) => j.id));
        return prev.concat(res.jobs.filter((j) => !seen.has(j.id)));
      });
      setTotal(res.total);
    } catch (err) {
      if (generation === searchGeneration.current) setLoadError(err.message || 'Failed to load more.');
    } finally {
      if (generation === searchGeneration.current) setLoadingMore(false);
    }
  }

  async function confirmDelete() {
    const { id, hasFile } = pendingDelete;
    const shouldDeleteFile = !!(hasFile && deleteDiskFile);
    setPendingDelete(null);
    setDeleteDiskFile(false);
    await api.deleteDownload(id, { deleteFile: shouldDeleteFile });
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  }

  async function handleToggleProtect(job) {
    const updated = await api.toggleDownloadProtect(job.id, !job.protected);
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...updated } : j)));
  }

  async function handleRetry(job) {
    try {
      const updated = await api.retryDownload(job.id);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...updated } : j)));
      toast('Queued again');
    } catch (err) {
      toast(err.message || 'Retry failed', { error: true });
    }
  }

  async function handleRetryAll({ transientOnly = false } = {}) {
    setRetryingAll(true);
    try {
      const { retried } = await api.retryFailedDownloads({
        transientOnly,
        category: failureCategory !== 'all' ? failureCategory : null,
      });
      toast(retried ? `Queued ${retried} again` : 'Nothing matching to retry');
      setReload((n) => n + 1);
    } catch (err) {
      toast(err.message || 'Retry failed', { error: true });
    } finally {
      setRetryingAll(false);
    }
  }

  const displayedJobs = jobs;

  return (
    <>
      <div className="page-title-row">
        <h1>History</h1>
        <span className="mono-meta">{loading ? '' : `${total.toLocaleString()} ${statusFilter === 'all' && !debouncedQuery ? 'total' : 'shown'}`}</span>
      </div>

      <div className="toolbar">
        <input
          className="toolbar-search"
          placeholder="Search by title or site"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search history"
        />
        <div className="chip-row" role="radiogroup" aria-label="Status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={statusFilter === f.value}
              className={`chip${statusFilter === f.value ? ' active' : ''}`}
              onClick={() => chooseFilter(f.value)}
            >
              {f.label}{f.value === 'failed' && failedCount > 0 ? ` ${failedCount}` : ''}
            </button>
          ))}
        </div>
        {statusFilter === 'failed' && total > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {failureStats.unavailable > 0 && failureCategory === 'all' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleRetryAll({ transientOnly: true })}
                disabled={retryingAll}
                title="Retries network/bot/cookie failures while skipping removed or deleted videos"
              >
                {retryingAll ? 'Retrying…' : 'Retry recoverable'}
              </button>
            )}
            <button type="button" className="btn-danger" onClick={() => handleRetryAll({ transientOnly: false })} disabled={retryingAll}>
              {retryingAll ? 'Retrying…' : (failureCategory === 'all' ? 'Retry all failed' : `Retry ${FAILURE_CATEGORY_LABELS[failureCategory]}`)}
            </button>
          </div>
        )}
      </div>

      {statusFilter === 'failed' && failureStats.all > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {failureStats.bot_check > 0 && (
            <div className="notice notice-warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span>
                YouTube rejected cookies or IP on <strong>{failureStats.bot_check}</strong> download{failureStats.bot_check === 1 ? '' : 's'} — export a fresh <code>cookies.txt</code> in Settings, then click Retry.
              </span>
              <Link to="/settings?section=cookies" className="btn-secondary btn-sm">Update Cookies</Link>
            </div>
          )}
          <div className="chip-row" role="radiogroup" aria-label="Failure category">
            {Object.entries(FAILURE_CATEGORY_LABELS).map(([cat, label]) => {
              const count = failureStats[cat] || 0;
              if (cat !== 'all' && count === 0) return null;
              return (
                <button
                  key={cat}
                  type="button"
                  role="radio"
                  aria-checked={failureCategory === cat}
                  className={`chip${failureCategory === cat ? ' active' : ''}`}
                  onClick={() => setFailureCategory(cat)}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loadError && <div className="notice notice-danger">{loadError}</div>}
      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : displayedJobs.length === 0 ? (
        <p className="empty-line">
          {debouncedQuery || statusFilter !== 'all' ? 'Nothing matches. Try a different search or filter.' : 'Downloads you queue will show up here.'}
        </p>
      ) : (
        <div className="rows">
          {displayedJobs.map((job) => (
            <div key={job.id} className="history-item">
              <div className="row">
                <Art src={job.thumbnail} className="row-thumb history-thumb" />
                <div className="row-main">
                  <div className="row-title">{job.title || job.url}</div>
                  <div className={`row-sub${job.status === 'failed' ? ' text-accent' : ''}`} title={job.filepath || undefined}>{subLine(job)}</div>
                </div>
                <div className="history-cells">
                  <span className="history-site">{siteName(job.extractor) || '—'}</span>
                  <span className={`status-pill status-${job.status}`}>
                    {job.status === 'deleted'
                      ? 'deleted'
                      : job.status === 'failed'
                        ? FAILURE_CATEGORY_LABELS[classifyFailure(job.error)] || 'failed'
                        : job.status}
                  </span>
                  <span className="history-date mono-meta">{rowDate(job)}</span>
                  <div className="history-actions">
                    {job.status === 'failed' && (
                      <button type="button" className="btn-danger btn-sm" onClick={() => handleRetry(job)}>Retry</button>
                    )}
                    {job.watch_id && job.status === 'completed' && (
                      <button
                        type="button"
                        className="icon-plain"
                        onClick={() => handleToggleProtect(job)}
                        title={job.protected ? 'Kept forever · click to allow auto-delete' : 'Keep forever (skip auto-delete)'}
                        aria-label={job.protected ? 'Allow auto-delete' : 'Keep forever'}
                      >
                        {job.protected ? <Shield size={15} /> : <ShieldOff size={15} />}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`btn-ghost btn-sm${expandedId === job.id ? ' active' : ''}`}
                      onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                      aria-expanded={expandedId === job.id}
                    >
                      Log
                    </button>
                    <button
                      type="button"
                      className="icon-plain"
                      onClick={() => {
                        setDeleteDiskFile(false);
                        setPendingDelete({
                          id: job.id,
                          label: job.title || job.url,
                          hasFile: job.status === 'completed' && !!job.filepath,
                        });
                      }}
                      aria-label="Delete from history"
                      title="Delete from history"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              </div>
              {expandedId === job.id && <div className="history-log"><JobLog job={job} /></div>}
            </div>
          ))}
        </div>
      )}
      {!loading && jobs.length > 0 && (
        <div className="list-footer">
          <span className="mono-meta">Showing {displayedJobs.length} of {total}</span>
          {jobs.length < total && (
            <button type="button" className="btn-ghost btn-sm" onClick={handleLoadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete from history"
        message={`Delete "${pendingDelete?.label || 'this download'}" from history?`}
        confirmLabel={pendingDelete?.hasFile && deleteDiskFile ? 'Delete row & file' : 'Delete'}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteDiskFile(false);
        }}
        onConfirm={confirmDelete}
      >
        {pendingDelete?.hasFile && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: '0.88rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={deleteDiskFile}
              onChange={(e) => setDeleteDiskFile(e.target.checked)}
            />
            <span>Also delete downloaded file and sidecars from disk</span>
          </label>
        )}
      </ConfirmDialog>
    </>
  );
}
