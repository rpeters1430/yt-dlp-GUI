import React, { useEffect, useMemo, useState } from 'react';
import { Search, Film, X, Archive, Terminal, Copy, Check } from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const STATUS_FILTERS = ['all', 'completed', 'downloading', 'queued', 'failed', 'deleted'];

export default function History() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { id, label }

  useEffect(() => {
    api.listDownloads().then(setJobs).finally(() => setLoading(false));
  }, []);

  function handleDelete(id, label) {
    setPendingDelete({ id, label });
  }

  async function confirmDelete() {
    const { id } = pendingDelete;
    setPendingDelete(null);
    await api.deleteDownload(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  function handleCopy(job) {
    const text = `${job.command_args ? `Command:\n${job.command_args}\n\n` : ''}Log:\n${job.log || ''}`;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedId(job.id);
        setTimeout(() => setCopiedId(null), 2000);
      },
      () => {}
    );
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (statusFilter !== 'all' && job.status !== statusFilter) return false;
      if (!q) return true;
      return (job.title || job.url || '').toLowerCase().includes(q) || (job.extractor || '').toLowerCase().includes(q);
    });
  }, [jobs, query, statusFilter]);

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

        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Archive size={30} />
            <span className="empty-title">{jobs.length === 0 ? 'No downloads yet' : 'No matches'}</span>
            <span className="empty-subtitle">
              {jobs.length === 0 ? 'Downloads you queue will show up here.' : 'Try a different search or filter.'}
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
                {filtered.map((job) => (
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
                              >
                                {copiedId === job.id ? <Check size={12} /> : <Copy size={12} />}
                                {copiedId === job.id ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            {job.command_args && (
                              <div className="command-box">
                                <div style={{ color: 'var(--text-tertiary)', fontSize: '10px', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                  Command &amp; Arguments
                                </div>
                                <code>{job.command_args}</code>
                              </div>
                            )}
                            <pre className="log-panel-content">
                              {job.log || 'No log output recorded.'}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
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
