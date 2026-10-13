import React, { useState } from 'react';
import { X } from 'lucide-react';
import Art from '../Art.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { api } from '../../api.js';
import { siteName } from '../../format.js';
import { isLiveJob, isRecording, isWaitingForLive, jobOptions, jobQualityLine, useLiveElapsed } from './NowDownloading.jsx';

function chunkLabel(job) {
  const o = jobOptions(job);
  const mins = job.live_chunk_mins || (o.splitLiveChunks ? parseInt(o.liveChunkDuration, 10) || 0 : 0);
  if (!mins) return null;
  return `${mins >= 60 ? `${mins / 60}h` : `${mins}m`} chunks`;
}

export function UpNextCard({ job, onRemoved }) {
  const [confirm, setConfirm] = useState(null);
  const [stopping, setStopping] = useState(false);
  const elapsed = useLiveElapsed(job);
  const live = isRecording(job);
  const waiting = isWaitingForLive(job);
  const running = job.status === 'downloading' && !isLiveJob(job);
  const pct = Math.min(100, Math.max(0, job.percent || 0));
  const site = siteName(job.extractor);
  const finalizing = live && (stopping || /finaliz|post-processing|merging|split/i.test(job.stage || ''));

  let meta;
  if (waiting) meta = ['Waiting for live', site, chunkLabel(job)].filter(Boolean).join(' · ');
  else if (live) meta = [site, jobQualityLine(job).split(' · ')[0], chunkLabel(job)].filter(Boolean).join(' · ');
  else if (running) meta = [`${Math.round(pct)}%`, job.speed].filter(Boolean).join(' · ');
  else meta = ['Queued', site, jobQualityLine(job).replace(' · ', ' ')].filter(Boolean).join(' · ');

  return (
    <div className="up-card">
      <Art src={job.thumbnail} className="up-art">
        {live && <span className="badge badge-live badge-tl">● LIVE {elapsed}</span>}
        <button type="button" className="art-x" onClick={() => setConfirm('remove')} aria-label="Remove">
          <X size={13} />
        </button>
        {running && <div className="art-progress"><div style={{ width: `${pct}%` }} /></div>}
      </Art>
      <div className="up-title">{job.title || job.url}</div>
      <div className="up-meta-row">
        <span className="mono-meta">{job.status === 'queued' && job.stage && job.stage !== 'Queued' ? job.stage : meta}</span>
        {live && (
          <button type="button" className="btn-danger btn-xs" disabled={finalizing} onClick={() => setConfirm('stop')}>
            {finalizing ? 'Finalizing…' : 'Stop'}
          </button>
        )}
      </div>
      <ConfirmDialog
        open={confirm === 'remove'}
        title="Remove download"
        message={`Remove "${job.title || job.url}" from the queue?`}
        confirmLabel="Remove"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          api.deleteDownload(job.id).then(() => onRemoved?.(job.id)).catch(() => {});
        }}
      />
      <ConfirmDialog
        open={confirm === 'stop'}
        title="Stop recording"
        message={`Stop recording and save the stream captured so far${elapsed ? ` (${elapsed})` : ''}?${chunkLabel(job) ? ` It will be split into ${chunkLabel(job)}.` : ''}`}
        confirmLabel="Stop recording"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          setStopping(true);
          api.stopDownload(job.id).catch(() => setStopping(false));
        }}
      />
    </div>
  );
}

export default function UpNext({ jobs, onRemoved }) {
  if (jobs.length === 0) return null;
  const running = jobs.filter((j) => j.status === 'downloading' && !isLiveJob(j)).length;
  const recording = jobs.filter(isRecording).length;
  const waiting = jobs.filter((j) => j.status === 'queued' || isWaitingForLive(j)).length;
  const summary = [
    running ? `${running} more running` : null,
    recording ? `${recording} recording` : null,
    waiting ? `${waiting} waiting` : null,
  ].filter(Boolean).join(' · ');

  return (
    <section>
      <div className="section-head">
        <h2>Up next</h2>
        <span className="mono-meta">{summary}</span>
      </div>
      <div className="up-grid">
        {jobs.slice(0, 24).map((job) => <UpNextCard key={job.id} job={job} onRemoved={onRemoved} />)}
      </div>
      {jobs.length > 24 && <p className="mono-meta" style={{ marginTop: 12 }}>+{jobs.length - 24} more queued</p>}
    </section>
  );
}
