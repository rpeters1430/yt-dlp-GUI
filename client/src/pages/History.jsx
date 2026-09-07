import React, { useEffect, useMemo, useState } from 'react';
import { Search, Film, X, Archive } from 'lucide-react';
import { api } from '../api.js';

const STATUS_FILTERS = ['all', 'completed', 'downloading', 'queued', 'failed'];

export default function History() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    api.listDownloads().then(setJobs).finally(() => setLoading(false));
  }, []);

  async function handleDelete(id) {
    await api.deleteDownload(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
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
                  <tr key={job.id}>
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
                    </td>
                    <td className="muted">{job.extractor || '—'}</td>
                    <td><span className={`tag status-tag status-${job.status}`}>{job.status}</span></td>
                    <td className="muted small">{new Date(job.created_at + 'Z').toLocaleString()}</td>
                    <td><button className="icon-btn" onClick={() => handleDelete(job.id)} title="Delete"><X size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
