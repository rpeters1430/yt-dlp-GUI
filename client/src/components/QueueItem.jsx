import React from 'react';
import { api } from '../api.js';

const STATUS_LABELS = {
  queued: 'Queued',
  downloading: 'Downloading',
  completed: 'Completed',
  failed: 'Failed',
};

export default function QueueItem({ job, onDeleted }) {
  return (
    <div className={`queue-item status-${job.status}`}>
      {job.thumbnail ? <img className="thumb" src={job.thumbnail} alt="" /> : <div className="thumb thumb-empty" />}
      <div className="queue-item-body">
        <div className="queue-item-title">{job.title || job.url}</div>
        <div className="queue-item-meta">
          {job.extractor && <span className="tag">{job.extractor}</span>}
          <span className={`tag status-tag status-${job.status}`}>{STATUS_LABELS[job.status] || job.status}</span>
        </div>
        {job.status === 'downloading' && (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${job.percent || 0}%` }} />
            <span className="progress-label">
              {Math.round(job.percent || 0)}% {job.speed ? `· ${job.speed}` : ''} {job.eta ? `· ETA ${job.eta}` : ''}
            </span>
          </div>
        )}
        {job.status === 'failed' && <div className="error-text">{job.error}</div>}
      </div>
      <button className="icon-btn" title="Remove" onClick={() => api.deleteDownload(job.id).then(() => onDeleted(job.id))}>
        ✕
      </button>
    </div>
  );
}
