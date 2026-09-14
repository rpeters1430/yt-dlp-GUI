import React, { useState, useRef, useEffect } from 'react';
import { Clock, Loader2, CheckCircle2, XCircle, Film, X, Terminal, Copy, Check, Trash2, Square } from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const STATUS_META = {
  queued: { label: 'Queued', icon: Clock },
  downloading: { label: 'Downloading', icon: Loader2 },
  completed: { label: 'Completed', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle },
  deleted: { label: 'Auto-deleted', icon: Trash2 },
};

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
}

// SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC without a timezone suffix (see db.js/queue.js
// use of datetime('now')) — Date.parse treats that as local time unless 'Z' is appended.
function parseUtc(ts) {
  if (!ts) return null;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Ticks every second while a live recording is in progress so the elapsed-time readout stays
// live without polling the server — percent/ETA are meaningless for an indefinite stream, so
// this is the only progress signal worth showing.
function useElapsed(active, since) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active || !since) return null;
  return formatElapsed(now - since.getTime());
}

export default function QueueItem({ job, onDeleted }) {
  const [showLogs, setShowLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  const logRef = useRef(null);
  const meta = STATUS_META[job.status] || { label: job.status, icon: Clock };
  const StatusIcon = meta.icon;

  const isLive = job.is_live === 1 || job.is_live === true;
  const isRecording = isLive && job.status === 'downloading';
  const elapsed = useElapsed(isRecording, parseUtc(job.created_at));

  async function handleStop() {
    setStopping(true);
    setStopError('');
    try {
      await api.stopDownload(job.id);
    } catch (err) {
      setStopError(err.message || 'Failed to stop recording');
    } finally {
      setStopping(false);
    }
  }

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
            {isLive && (
              <span className="live-pulsing-badge-sm">
                <span className="pulsing-dot" /> LIVE
              </span>
            )}
          </div>
          {isRecording ? (
            <div className="queue-item-live-row">
              <span className="queue-item-live-elapsed"><Clock size={12} /> {elapsed || '0:00'} recorded</span>
              {job.stage && <span className="muted small">· {job.stage}</span>}
              {job.speed && <span className="muted small">· {job.speed}</span>}
              <button
                type="button"
                className="btn-danger btn-sm"
                onClick={() => setConfirmStop(true)}
                disabled={stopping}
                title="Stop recording and save the file captured so far"
              >
                <Square size={12} /> {stopping ? 'Stopping…' : 'Stop Recording'}
              </button>
            </div>
          ) : job.status === 'downloading' && (
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
          {stopError && (
            <div className="alert alert-error queue-item-failed-row" style={{ marginTop: 6 }}>
              <XCircle size={13} />
              <span>{stopError}</span>
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
      open={confirmStop}
      title="Stop recording"
      message="Stop recording and save the stream captured so far? The finished file will remain in your downloads."
      confirmLabel="Stop recording"
      onCancel={() => setConfirmStop(false)}
      onConfirm={() => {
        setConfirmStop(false);
        handleStop();
      }}
    />
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
