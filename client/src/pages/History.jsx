import React, { useEffect, useRef, useState } from 'react';
import { Search, Film, X, Archive, Terminal, Copy, Check, Shield, ShieldOff } from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const STATUS_FILTERS = ['all', 'completed', 'downloading', 'queued', 'failed', 'deleted'];
const PAGE_SIZE = 50;

export default function History() {
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [hasAny, setHasAny] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { id, label }
  // The list arrives without logs; the expanded row's log is fetched on demand.
  const [expandedLog, setExpandedLog] = useState(null); // { id, log, command_args }
  const [logRetry, setLogRetry] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Bumped whenever the search criteria change, so a "Load more" still in flight for the
  // previous criteria is ignored instead of appending the wrong rows.
  const searchGeneration = useRef(0);

  // Search and filtering run on the server, a page at a time, so a long history stays fast.
  useEffect(() => {
    let cancelled = false;
    searchGeneration.current += 1;
    setLoading(true);
    setLoadError('');
    api.searchDownloads({ status: statusFilter, q: debouncedQuery, limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        setJobs(res.jobs);
        setTotal(res.total);
        if (statusFilter === 'all' && !debouncedQuery) setHasAny(res.total > 0);
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Failed to load history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [statusFilter, debouncedQuery]);

  async function handleLoadMore() {
    const generation = searchGeneration.current;
    setLoadingMore(true);
    try {
      const res = await api.searchDownloads({ status: statusFilter, q: debouncedQuery, limit: PAGE_SIZE, offset: jobs.length });
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

  useEffect(() => {
    if (!expandedId) return undefined;
    let cancelled = false;
    setExpandedLog(null);
    api.getDownloadLog(expandedId)
      .then((row) => { if (!cancelled) setExpandedLog({ id: expandedId, ...row }); })
      .catch((err) => { if (!cancelled) setExpandedLog({ id: expandedId, error: err.message || 'Failed to load log.' }); });
    return () => { cancelled = true; };
  }, [expandedId, logRetry]);

  const expandedDetails = expandedLog && expandedLog.id === expandedId ? expandedLog : null;

  function handleDelete(id, label) {
    setPendingDelete({ id, label });
  }

  async function confirmDelete() {
    const { id } = pendingDelete;
    setPendingDelete(null);
    await api.deleteDownload(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  }

  async function handleToggleProtect(job) {
    const updated = await api.toggleDownloadProtect(job.id, !job.protected);
    setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
  }

  function handleCopy(job) {
    const details = job.id === expandedId && expandedDetails ? expandedDetails : {};
    const text = `${details.command_args ? `Command:\n${details.command_args}\n\n` : ''}Log:\n${details.log || ''}`;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedId(job.id);
        setTimeout(() => setCopiedId(null), 2000);
      },
      () => {}
    );
  }


  return (
    <>
      <div className="page-header">
        <div>
          <h1>Download history</h1>
          <p>Everything you've downloaded, in one place.</p>
        </div>
      </div>

      <section className="panel">
        <div className="table-toolbar">
          <div className="search-input">
            <Search size={15} />
            <input placeholder="Search by title or site…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All statuses' : s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>

        {loadError && <div className="alert alert-error" style={{ marginBottom: 12 }}>{loadError}</div>}
        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : jobs.length === 0 ? (
          <div className="empty-state">
            <Archive size={30} />
            <span className="empty-title">{hasAny ? 'No matches' : 'No downloads yet'}</span>
            <span className="empty-subtitle">
              {hasAny ? 'Try a different search or filter.' : 'Downloads you queue will show up here.'}
            </span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="history-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Title</th>
                  <th>Site</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <React.Fragment key={job.id}>
                    <tr>
                      <td>
                        {job.thumbnail ? (
                          <img className="thumb-sm" src={job.thumbnail} alt="" />
                        ) : (
                          <div className="thumb-sm thumb-empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Film size={13} />
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="history-row-title">{job.title || job.url}</div>
                        {job.filepath && <div className="muted small">{job.filepath}</div>}
                        {job.error && <div className="muted small" style={{ color: 'var(--danger)' }}>{job.error}</div>}
                      </td>
                      <td className="muted">{job.extractor || '—'}</td>
                      <td><span className={`tag status-tag status-${job.status}`}>{job.status}</span></td>
                      <td className="muted small">{new Date(job.created_at + 'Z').toLocaleString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {job.watch_id && job.status === 'completed' && (
                            <button
                              className="icon-btn"
                              onClick={() => handleToggleProtect(job)}
                              title={job.protected ? 'Protected from auto-delete — click to allow it again' : 'Protect this video from auto-delete'}
                            >
                              {job.protected ? <Shield size={14} /> : <ShieldOff size={14} />}
                            </button>
                          )}
                          <button
                            className={`icon-btn ${expandedId === job.id ? 'active' : ''}`}
                            title="View command & logs"
                            onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                          >
                            <Terminal size={14} />
                          </button>
                          <button className="icon-btn" onClick={() => handleDelete(job.id, job.title || job.url)} title="Delete"><X size={15} /></button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === job.id && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0 10px 14px' }}>
                          <div className="log-panel" style={{ marginTop: 0 }}>
                            <div className="log-panel-header">
                              <span>Command &amp; Logs — {job.title || job.url}</span>
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: 4 }}
                                onClick={() => handleCopy(job)}
                                disabled={!expandedDetails || !!expandedDetails.error}
                              >
                                {copiedId === job.id ? <Check size={12} /> : <Copy size={12} />}
                                {copiedId === job.id ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            {expandedDetails?.command_args && (
                              <div className="command-box">
                                <div style={{ color: 'var(--text-tertiary)', fontSize: '10px', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                  Command &amp; Arguments
                                </div>
                                <code>{expandedDetails.command_args}</code>
                              </div>
                            )}
                            {expandedDetails?.error ? (
                              <div className="alert alert-error" style={{ marginTop: 8 }}>
                                <span>{expandedDetails.error}</span>
                                <button type="button" className="btn-ghost btn-sm" onClick={() => setLogRetry((attempt) => attempt + 1)}>Retry</button>
                              </div>
                            ) : (
                              <pre className="log-panel-content">
                                {expandedDetails ? (expandedDetails.log || 'No log output recorded.') : 'Loading log…'}
                              </pre>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <div className="history-footer muted small">
              <span>Showing {jobs.length} of {total}</span>
              {jobs.length < total && (
                <button type="button" className="btn-secondary btn-sm" onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete from history"
        message={`Delete "${pendingDelete?.label || 'this download'}" from history?`}
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
