import React from 'react';
import { Clock, Loader2, CheckCircle2, XCircle, Film, X } from 'lucide-react';
import { api } from '../api.js';

const STATUS_META = {
  queued: { label: 'Queued', icon: Clock },
  downloading: { label: 'Downloading', icon: Loader2 },
  completed: { label: 'Completed', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle },
};

export default function QueueItem({ job, onDeleted }) {
  const meta = STATUS_META[job.status] || { label: job.status, icon: Clock };
  const StatusIcon = meta.icon;

  return (
    <div className={`queue-item status-${job.status}`}>
      {job.thumbnail ? (
        <img className="thumb" src={job.thumbnail} alt="" />
      ) : (
        <div className="thumb thumb-empty"><Film size={16} /></div>
      )}
      <div className="queue-item-body">
        <div className="queue-item-title">{job.title || job.url}</div>
        <div className="queue-item-meta">
          {job.extractor && <span className="tag">{job.extractor}</span>}
          <span className={`tag status-tag status-${job.status}`}>
            <StatusIcon size={11} className={job.status === 'downloading' ? 'spin-icon' : undefined} />
            {meta.label}
          </span>
        </div>
        {job.status === 'downloading' && (
          <div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${job.percent || 0}%` }} />
            </div>
            <div className="progress-meta">
              <span>{Math.round(job.percent || 0)}%</span>
              {job.speed && <span>· {job.speed}</span>}
              {job.eta && <span>· ETA {job.eta}</span>}
            </div>
          </div>
        )}
        {job.status === 'failed' && <div className="alert alert-error"><XCircle size={13} />{job.error}</div>}
      </div>
      <button className="icon-btn" title="Remove" onClick={() => api.deleteDownload(job.id).then(() => onDeleted(job.id))}>
        <X size={16} />
      </button>
    </div>
  );
}
