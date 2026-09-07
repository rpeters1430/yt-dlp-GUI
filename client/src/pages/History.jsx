import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function History() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listDownloads().then(setJobs).finally(() => setLoading(false));
  }, []);

  async function handleDelete(id) {
    await api.deleteDownload(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <section className="panel">
      <h2>Download history</h2>
      {jobs.length === 0 && <p className="muted">No downloads yet.</p>}
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
            <tr key={job.id}>
              <td>{job.thumbnail && <img className="thumb-sm" src={job.thumbnail} alt="" />}</td>
              <td>
                <div>{job.title || job.url}</div>
                {job.filepath && <div className="muted small">{job.filepath}</div>}
              </td>
              <td>{job.extractor || '—'}</td>
              <td><span className={`tag status-tag status-${job.status}`}>{job.status}</span></td>
              <td className="muted small">{new Date(job.created_at + 'Z').toLocaleString()}</td>
              <td><button className="icon-btn" onClick={() => handleDelete(job.id)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
