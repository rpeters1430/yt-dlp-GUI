import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Art from '../Art.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { relativeTime, shortPath } from '../../format.js';

export function FinishedRow({ job }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const failed = job.status === 'failed';

  function retry() {
    setBusy(true);
    api.retryDownload(job.id)
      .then(() => toast('Queued again'))
      .catch((err) => toast(err.message || 'Retry failed', { error: true }))
      .finally(() => setBusy(false));
  }

  return (
    <div className="row">
      <Art src={job.thumbnail} className="row-thumb" />
      <div className="row-main">
        <div className="row-title">{job.title || job.url}</div>
        <div className={`row-sub${failed ? ' text-accent' : ''}`}>
          {failed ? (job.error || 'Download failed') : (shortPath(job.filepath) || job.url)}
        </div>
      </div>
      <span className="row-time mono-meta">{relativeTime(job.updated_at || job.created_at)}</span>
      {failed ? (
        <button type="button" className="btn-danger btn-sm" onClick={retry} disabled={busy}>Retry</button>
      ) : (
        <button type="button" className="btn-ghost btn-sm" onClick={() => navigate(`/library?play=${encodeURIComponent(job.id)}`)}>Open</button>
      )}
    </div>
  );
}

export default function RecentlyFinished({ jobs, failedCount }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  function retryAll() {
    setBusy(true);
    api.retryFailedDownloads()
      .then(({ retried }) => toast(retried ? `Queued ${retried} again` : 'Nothing to retry'))
      .catch((err) => toast(err.message || 'Retry failed', { error: true }))
      .finally(() => setBusy(false));
  }

  return (
    <section>
      <div className="section-head">
        <h2>Recently finished</h2>
        <div className="section-head-actions">
          {failedCount > 0 && (
            <button type="button" className="text-btn text-accent" onClick={retryAll} disabled={busy}>
              Retry {failedCount} failed
            </button>
          )}
          <Link to="/history" className="text-btn">All history</Link>
        </div>
      </div>
      {jobs.length === 0 ? (
        <p className="empty-line">Finished downloads show up here.</p>
      ) : (
        <div className="rows">
          {jobs.map((job) => <FinishedRow key={job.id} job={job} />)}
        </div>
      )}
    </section>
  );
}
