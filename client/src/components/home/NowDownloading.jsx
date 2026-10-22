import React, { useEffect, useRef, useState } from 'react';
import Art from '../Art.jsx';
import JobLog from '../JobLog.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { api } from '../../api.js';
import { formatDuration, parseUtc, siteName } from '../../format.js';
import { useNow } from '../../hooks/useNow.js';
import { smoothDownloadStats } from './downloadStats.js';

export function jobOptions(job) {
  try {
    return JSON.parse(job.options_json || '{}') || {};
  } catch {
    return {};
  }
}

export function isLiveJob(job) {
  return job.is_live === 1 || job.is_live === true;
}

// "2160p · MKV · SponsorBlock" for a queued or running job.
export function jobQualityLine(job) {
  const o = jobOptions(job);
  const audio = job.audio_only === 1 || job.audio_only === true || o.audioOnly;
  const parts = [];
  if (audio) parts.push('Audio');
  else parts.push(job.quality ? `${job.quality}p` : 'Best');
  parts.push(String(job.container || o.container || 'mp4').toUpperCase());
  if (Array.isArray(o.sponsorblockRemove) && o.sponsorblockRemove.length) parts.push('SponsorBlock');
  return parts.join(' · ');
}

// A live job started early to wait for a scheduled or offline stream: yt-dlp is polling,
// nothing is being recorded yet (see queue.js, 'Waiting for stream to go live…').
export function isWaitingForLive(job) {
  return isLiveJob(job) && /^waiting for stream/i.test(job.stage || '');
}

export function isRecording(job) {
  return isLiveJob(job) && job.status === 'downloading' && !isWaitingForLive(job);
}

export function useLiveElapsed(job) {
  const live = isRecording(job);
  const now = useNow(live);
  const since = parseUtc(job.created_at);
  return live && since ? formatDuration((now - since.getTime()) / 1000) : null;
}

function useSmoothedStats(job) {
  const previous = useRef(null);
  const [stats, setStats] = useState(() => ({
    jobId: job?.id,
    speed: job?.speed || null,
    eta: job?.eta || null,
  }));

  useEffect(() => {
    const next = smoothDownloadStats(previous.current, job);
    previous.current = next;
    setStats(next);
  }, [job?.id, job?.percent, job?.speed, job?.eta]);

  // Avoid showing the prior download's stats for the one render before the effect runs.
  return stats.jobId === job?.id ? stats : { speed: job?.speed || null, eta: job?.eta || null };
}

// The big "Now downloading" panel for the first running download.
export default function NowDownloading({ job, onRemoved }) {
  const [showLog, setShowLog] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const elapsed = useLiveElapsed(job || {});
  const smoothedStats = useSmoothedStats(job);

  if (!job) {
    return (
      <section className="hero hero-empty">
        <div className="hero-art hero-art-empty">
          <div>
            <div className="hero-empty-title">Nothing downloading</div>
            <div className="hero-empty-sub">Paste a link above, or press ⌘V anywhere on this page.</div>
          </div>
        </div>
      </section>
    );
  }

  const live = isRecording(job);
  const pct = Math.min(100, Math.max(0, job.percent || 0));
  const finalizing = live && /finaliz|post-processing|merging|split/i.test(job.stage || '');
  const meta = [job.extractor ? siteName(job.extractor) : null, jobQualityLine(job)].filter(Boolean).join(' · ');
  const stats = live
    ? [job.stage, job.speed].filter(Boolean).join(' · ')
    : [job.stage, smoothedStats.speed, smoothedStats.eta ? `ETA ${smoothedStats.eta}` : null].filter(Boolean).join(' · ');

  return (
    <section className="hero">
      <div className="hero-row">
        <Art src={job.thumbnail} className="hero-art" label="video thumbnail">
          {live && <span className="badge badge-live badge-tl">● LIVE {elapsed}</span>}
          {!live && <div className="art-progress"><div style={{ width: `${pct}%` }} /></div>}
        </Art>
        <div className="hero-info">
          <div className="eyebrow">{live ? 'NOW RECORDING' : 'NOW DOWNLOADING'}</div>
          <h2 className="hero-title">{job.title || job.url}</h2>
          <div className="hero-meta">{meta}</div>
          <div className="hero-stats">
            <span className="hero-pct">{live ? (elapsed || '0:00') : `${Math.round(pct)}%`}</span>
            <span className="mono-meta">{stats}</span>
          </div>
          {!live && <div className="progress"><div style={{ width: `${pct}%` }} /></div>}
          <div className="btn-row">
            <button type="button" className="btn-ghost" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
              Command &amp; log
            </button>
            {live && (
              <button type="button" className="btn-danger" disabled={finalizing} onClick={() => setConfirm('stop')}>
                {finalizing ? 'Finalizing…' : 'Stop'}
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => setConfirm('remove')}>Remove</button>
          </div>
        </div>
      </div>
      {showLog && <JobLog job={job} />}
      <ConfirmDialog
        open={confirm === 'remove'}
        title="Remove download"
        message={`Stop and remove "${job.title || job.url}"?`}
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
        message="Stop recording and save the stream captured so far? The finished file stays in your downloads."
        confirmLabel="Stop recording"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          api.stopDownload(job.id).catch(() => {});
        }}
      />
    </section>
  );
}
