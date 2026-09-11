import React, { useState, useRef, useEffect } from 'react';
import { Clock, Loader2, CheckCircle2, XCircle, Film, X, Terminal, Copy, Check, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const STATUS_META = {
  queued: { label: 'Queued', icon: Clock },
  downloading: { label: 'Downloading', icon: Loader2 },
  completed: { label: 'Completed', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle },
  deleted: { label: 'Auto-deleted', icon: Trash2 },
};

export default function QueueItem({ job, onDeleted }) {
  const [showLogs, setShowLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const logRef = useRef(null);
  const meta = STATUS_META[job.status] || { label: job.status, icon: Clock };
  const StatusIcon = meta.icon;

  useEffect(() => {
    if (showLogs && logRef.current && job.status === 'downloading') {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [showLogs, job.log, job.status]);

  function handleCopy() {
    const text = `${job.command_args ? `Command:\n${job.command_args}\n\n` : ''}Log:\n${job.log || ''}`;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {} // clipboard permission denied / insecure context — no-op, button just doesn't flip to "Copied"
    );
  }

  return (
    <>
    <div className={`queue-item status-${job.status}`}>
      <div className="queue-item-main">
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
                <div
                  className="progress-fill"
                  style={{ width: `${Math.min(100, Math.max(0, job.percent || 0))}%` }}
                />
              </div>
              <div className="progress-meta">
                <span>{Math.round(job.percent || 0)}%</span>
                {job.stage && <span>· {job.stage}</span>}
                {job.speed && <span>· {job.speed}</span>}
                {job.eta && <span>· ETA {job.eta}</span>}
              </div>
            </div>
          )}
          {job.status === 'queued' && (
            <div className="muted small queue-item-status-line">
              <Clock size={12} />
              <span>{job.stage || 'Waiting in queue…'}</span>
            </div>
          )}
          {job.status === 'completed' && job.filepath && (
            <div className="muted small queue-item-status-line" title={job.filepath}>
              <CheckCircle2 size={13} className="success-icon" />
              <span className="queue-item-filename">{job.filepath.split(/[\\/]/).pop()}</span>
            </div>
          )}
          {job.status === 'deleted' && (
            <div className="muted small queue-item-status-line">
              <Trash2 size={12} />
              <span>File removed by auto-delete</span>
            </div>
          )}
          {job.status === 'failed' && (
            <div className="alert alert-error queue-item-failed-row">
              <div className="queue-item-failed-msg">
                <XCircle size={13} />
                <span>{job.error || 'Download failed'}</span>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm btn-link-sm"
                onClick={() => setShowLogs((prev) => !prev)}
              >
                {showLogs ? 'Hide details' : 'View error log'}
              </button>
            </div>
          )}
        </div>
        <div className="queue-item-actions">
          <button
            className={`icon-btn ${showLogs ? 'active' : ''}`}
            title="View command & logs"
            onClick={() => setShowLogs(!showLogs)}
          >
            <Terminal size={15} />
          </button>
          <button
            className="icon-btn"
            title="Remove"
            onClick={() => setConfirmRemove(true)}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {showLogs && (
        <div className="log-panel">
          <div className="log-panel-header">
            <span>Command &amp; Logs</span>
            <button
              type="button"
              className="btn-ghost btn-sm log-copy-btn"
              onClick={handleCopy}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {job.command_args && (
            <div className="command-box">
              <div className="command-box-label">
                Command &amp; Arguments
              </div>
              <code>{job.command_args}</code>
            </div>
          )}
          <pre ref={logRef} className="log-panel-content">
            {job.log || 'No log output recorded yet.'}
          </pre>
        </div>
      )}
    </div>
    <ConfirmDialog
      open={confirmRemove}
      title="Remove download"
      message={`Remove "${job.title || job.url}" from the list?`}
      confirmLabel="Remove"
      onCancel={() => setConfirmRemove(false)}
      onConfirm={() => {
        setConfirmRemove(false);
        api.deleteDownload(job.id).then(() => onDeleted(job.id));
      }}
    />
    </>
  );
}
