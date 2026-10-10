import React, { useState, useRef, useEffect } from 'react';
import { Clock, Loader2, CheckCircle2, XCircle, Film, X, Terminal, Copy, Check, Trash2, Square, Video, Tv, Music, Globe, Scissors } from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const STATUS_META = {
  queued: { label: 'Queued', icon: Clock },
  downloading: { label: 'Downloading', icon: Loader2 },
  completed: { label: 'Completed', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle },
  deleted: { label: 'Auto-deleted', icon: Trash2 },
};

function getExtractorInfo(extractor) {
  if (!extractor) return null;
  const lower = extractor.toLowerCase();
  if (lower.includes('youtube')) return { name: 'YouTube', className: 'tag-extractor-youtube', icon: Video };
  if (lower.includes('twitch')) return { name: 'Twitch', className: 'tag-extractor-twitch', icon: Tv };
  if (lower.includes('sound') || lower.includes('bandcamp') || lower.includes('spotify') || lower.includes('music')) return { name: extractor, className: 'tag-extractor-music', icon: Music };
  if (lower.includes('twitter') || lower.includes('x.com') || lower.includes('tiktok')) return { name: extractor, className: 'tag-extractor-social', icon: Globe };
  return { name: extractor, className: 'tag-extractor-generic', icon: Film };
}

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
  // Job lists arrive without logs; fetched here when the log panel opens. Live socket
  // updates carry job.log, which takes over once present.
  const [fetchedLog, setFetchedLog] = useState(null);
  const [logRetry, setLogRetry] = useState(0);
  const logRef = useRef(null);
  const meta = STATUS_META[job.status] || { label: job.status, icon: Clock };
  const StatusIcon = meta.icon;

  const isLive = job.is_live === 1 || job.is_live === true;
  const chunkMins = job.live_chunk_mins || (() => {
    try {
      const parsed = JSON.parse(job.options_json || '{}');
      return parsed.splitLiveChunks ? (parseInt(parsed.liveChunkDuration, 10) || 0) : 0;
    } catch (_) {
      return 0;
    }
  })();
  const hasSplitChunks = isLive && chunkMins > 0;
  const chunkLabel = chunkMins >= 60 ? `${chunkMins / 60}h` : `${chunkMins}m`;

  const splitParts = (() => {
    if (!job.split_parts) return null;
    try {
      const arr = JSON.parse(job.split_parts);
      return Array.isArray(arr) && arr.length > 1 ? arr : null;
    } catch (_) {
      return null;
    }
  })();
  const [showSplitParts, setShowSplitParts] = useState(false);

  const isRecording = isLive && job.status === 'downloading';
  const elapsed = useElapsed(isRecording, parseUtc(job.created_at));
  // Show a separate progress panel while yt-dlp finalizes an early-stopped capture.
  const isFinalizing = isLive && job.status === 'downloading' && (
    stopping || /finaliz|split|post-processing recording|merging formats|extracting audio|embedding thumbnail|applying sponsorblock/i.test(job.stage || '')
  );
  const isStopping = stopping && !/post-processing recording|merging formats|extracting audio|applying sponsorblock|split/i.test(job.stage || '');

  useEffect(() => {
    if (job.status !== 'downloading' || !isLive) setStopping(false);
    else if (/post-processing recording|merging formats|extracting audio|applying sponsorblock|split/i.test(job.stage || '')) setStopping(false);
  }, [job.status, job.stage, isLive]);

  async function handleStop() {
    setStopping(true);
    setStopError('');
    try {
      await api.stopDownload(job.id);
      // Left true: the recording isn't actually stopped yet, just requested. job.status/stage
      // updates (via socket) will move this row out of the "recording" view once it really is.
    } catch (err) {
      setStopError(err.message || 'Failed to stop recording');
      setStopping(false);
    }
  }

  const hasInlineLog = job.log !== undefined;
  useEffect(() => {
    if (!showLogs || hasInlineLog) return undefined;
    let cancelled = false;
    setFetchedLog(null);
    api.getDownloadLog(job.id)
      .then((row) => { if (!cancelled) setFetchedLog(row); })
      .catch((err) => { if (!cancelled) setFetchedLog({ error: err.message || 'Failed to load log.' }); });
    return () => { cancelled = true; };
  }, [showLogs, hasInlineLog, job.id, logRetry]);

  const logText = hasInlineLog ? job.log : fetchedLog?.log;
  const commandArgs = hasInlineLog ? job.command_args : fetchedLog?.command_args;
  const logLoading = showLogs && !hasInlineLog && !fetchedLog;
  const logError = !hasInlineLog && fetchedLog?.error;

  useEffect(() => {
    if (showLogs && logRef.current && job.status === 'downloading') {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [showLogs, logText, job.status]);

  function handleCopy() {
    const text = `${commandArgs ? `Command:\n${commandArgs}\n\n` : ''}Log:\n${logText || ''}`;
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
            {(() => {
              const extInfo = getExtractorInfo(job.extractor);
              if (!extInfo) return null;
              const ExtIcon = extInfo.icon;
              return (
                <span className={`tag ${extInfo.className}`}>
                  <ExtIcon size={11} />
                  {extInfo.name}
                </span>
              );
            })()}
            <span className={`tag status-tag status-${job.status}`}>
              <StatusIcon size={11} className={job.status === 'downloading' ? 'spin-icon' : undefined} />
              {meta.label}
            </span>
            {isLive && (
              <span className={`live-pulsing-badge-sm${isFinalizing ? ' finalizing-badge' : ''}`}>
                {isFinalizing ? <><Loader2 size={11} className="spin-icon" /> FINALIZING</> : <><span className="pulsing-dot" /> LIVE</>}
              </span>
            )}
            {hasSplitChunks && (
              <span className="tag tag-split-chunks" title={`Configured to automatically split into ${chunkLabel} chunks when finished`}>
                <Scissors size={11} /> Split: {chunkLabel}
              </span>
            )}
          </div>
          {isRecording ? (
            isFinalizing ? (
              <div className="live-finalize-panel" aria-live="polite">
                <div className="live-finalize-heading">
                  <Loader2 size={14} className="spin-icon" />
                  <strong>{job.stage || 'Finalizing recording…'}</strong>
                  {job.eta ? <span>ETA {job.eta}</span> : <span className="muted">Estimating time remaining…</span>}
                </div>
                <div className="progress-bar">
                  <div className="progress-fill progress-fill-active" style={{ width: `${Math.min(99, Math.max(0, job.percent || 0))}%` }} />
                </div>
                <div className="progress-meta">
                  <span>{Math.round(job.percent || 0)}%</span>
                  {job.speed && <span>· {job.speed}</span>}
                </div>
              </div>
            ) : (
              <div className="queue-item-live-row">
                <span className="queue-item-live-elapsed"><Clock size={12} /> {elapsed || '0:00'} recorded</span>
                {hasSplitChunks && (
                  <span className="queue-item-live-split-note" title={`Will automatically split into ${chunkLabel} chunks on stop`}>
                    <Scissors size={11} /> {chunkLabel} chunks
                  </span>
                )}
                {job.stage && <span className="muted small">· {job.stage}</span>}
                {job.speed && <span className="muted small">· {job.speed}</span>}
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={() => setConfirmStop(true)}
                  disabled={isStopping || isFinalizing}
                  title="Stop recording and save the file captured so far"
                >
                  <Square size={12} /> {isStopping ? 'Finalizing…' : 'Stop Recording'}
                </button>
              </div>
            )
          ) : job.status === 'downloading' && (
            <div>
              <div className="progress-bar">
                <div
                  className="progress-fill progress-fill-active"
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
          {job.status === 'completed' && splitParts ? (
            <div className="queue-item-split-completed">
              <div className="muted small queue-item-status-line">
                <CheckCircle2 size={13} className="success-icon" />
                <span>
                  Split into <strong>{splitParts.length} parts</strong> ({chunkLabel} chunks)
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-sm btn-link-sm"
                  style={{ marginLeft: 6, fontSize: '0.8rem', padding: '1px 6px' }}
                  onClick={() => setShowSplitParts((prev) => !prev)}
                >
                  {showSplitParts ? 'Hide parts' : `View ${splitParts.length} parts`}
                </button>
              </div>
              {showSplitParts && (
                <div className="queue-item-split-parts-list">
                  {splitParts.map((partPath, idx) => (
                    <div key={partPath} className="queue-item-part-row muted small" title={partPath}>
                      <Film size={11} />
                      <span>Part {idx + 1}: {partPath.split(/[\\/]/).pop()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : job.status === 'completed' && job.filepath ? (
            <div className="muted small queue-item-status-line" title={job.filepath}>
              <CheckCircle2 size={13} className="success-icon" />
              <span className="queue-item-filename">{job.filepath.split(/[\\/]/).pop()}</span>
            </div>
          ) : null}
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
              disabled={logLoading || !!logError}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {commandArgs && (
            <div className="command-box">
              <div className="command-box-label">
                Command &amp; Arguments
              </div>
              <code>{commandArgs}</code>
            </div>
          )}
          {logError ? (
            <div className="alert alert-error" style={{ marginTop: 8 }}>
              <XCircle size={14} />
              <span>{logError}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setLogRetry((attempt) => attempt + 1)}>Retry</button>
            </div>
          ) : (
            <pre ref={logRef} className="log-panel-content">
              {logLoading ? 'Loading log…' : (logText || 'No log output recorded yet.')}
            </pre>
          )}
        </div>
      )}
    </div>
    <ConfirmDialog
      open={confirmStop}
      title="Stop recording"
      message={
        hasSplitChunks
          ? `Stop recording and save the stream captured so far (${elapsed || 'in progress'})? It will be automatically split into ${chunkLabel} chunks and saved to your downloads.`
          : 'Stop recording and save the stream captured so far? The finished file will remain in your downloads.'
      }
      confirmLabel={hasSplitChunks ? `Stop & Split (${chunkLabel})` : 'Stop recording'}
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
