import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ListChecks, CheckCircle2, XCircle, AlertCircle,
  Music, Captions, Inbox, PartyPopper,
} from 'lucide-react';
import { api } from '../api.js';
import QueueItem from '../components/QueueItem.jsx';

const QUALITY_OPTIONS = [
  { value: '', label: 'Best available' },
  { value: '2160', label: 'Up to 4K (2160p)' },
  { value: '1440', label: 'Up to 1440p' },
  { value: '1080', label: 'Up to 1080p' },
  { value: '720', label: 'Up to 720p' },
  { value: '480', label: 'Up to 480p' },
  { value: '360', label: 'Up to 360p' },
];

const SUBTITLE_LANG_OPTIONS = [
  { value: 'en.*', label: 'English' },
  { value: 'es.*', label: 'Spanish' },
  { value: 'fr.*', label: 'French' },
  { value: 'de.*', label: 'German' },
  { value: 'it.*', label: 'Italian' },
  { value: 'pt.*', label: 'Portuguese' },
  { value: 'ja.*', label: 'Japanese' },
  { value: 'ko.*', label: 'Korean' },
  { value: 'zh.*', label: 'Chinese' },
  { value: 'ru.*', label: 'Russian' },
  { value: 'ar.*', label: 'Arabic' },
  { value: 'hi.*', label: 'Hindi' },
  { value: 'all', label: 'All available languages' },
];

export default function Dashboard() {
  const [urlText, setUrlText] = useState('');
  const [audioOnly, setAudioOnly] = useState(false);
  const [quality, setQuality] = useState('');
  const [container, setContainer] = useState('mp4');
  const [subtitles, setSubtitles] = useState(false);
  const [subLangs, setSubLangs] = useState('en.*');
  const [jobs, setJobs] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef(null);

  useEffect(() => {
    api.listDownloads().then(setJobs).catch(() => {});

    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('jobs:init', (initialJobs) => setJobs(initialJobs));
    socket.on('job:update', (job) => {
      setJobs((prev) => {
        const exists = prev.some((j) => j.id === job.id);
        if (exists) return prev.map((j) => (j.id === job.id ? job : j));
        return [job, ...prev];
      });
    });

    return () => socket.disconnect();
  }, []);

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === 'queued' || j.status === 'downloading'),
    [jobs]
  );
  const recentFinished = useMemo(
    () => jobs.filter((j) => j.status === 'completed' || j.status === 'failed').slice(0, 10),
    [jobs]
  );
  const completedCount = useMemo(() => jobs.filter((j) => j.status === 'completed').length, [jobs]);
  const failedCount = useMemo(() => jobs.filter((j) => j.status === 'failed').length, [jobs]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const urls = urlText.split('\n').map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) return;

    setSubmitting(true);
    try {
      await api.enqueue({ urls, audioOnly, quality, container, subtitles, subLangs });
      setUrlText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeleted(id) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Add downloads and track live progress.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent">
          <div className="stat-top">
            <span className="stat-label">In queue</span>
            <span className="stat-icon"><ListChecks size={16} /></span>
          </div>
          <span className="stat-value">{activeJobs.length}</span>
        </div>
        <div className="stat-card success">
          <div className="stat-top">
            <span className="stat-label">Completed</span>
            <span className="stat-icon"><CheckCircle2 size={16} /></span>
          </div>
          <span className="stat-value">{completedCount}</span>
        </div>
        <div className="stat-card danger">
          <div className="stat-top">
            <span className="stat-label">Failed</span>
            <span className="stat-icon"><XCircle size={16} /></span>
          </div>
          <span className="stat-value">{failedCount}</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Add downloads</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <textarea
            placeholder="Paste one or more URLs, one per line (any site yt-dlp supports)"
            rows={4}
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
          />
          <div className="options-row">
            <div className="segmented">
              <button type="button" className={!audioOnly ? 'active' : ''} onClick={() => setAudioOnly(false)}>Video</button>
              <button type="button" className={audioOnly ? 'active' : ''} onClick={() => setAudioOnly(true)}>
                <Music size={13} /> Audio only
              </button>
            </div>

            {!audioOnly && (
              <label className="field-inline">
                Quality
                <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                  {QUALITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            )}
            {!audioOnly && (
              <label className="field-inline">
                Format
                <select value={container} onChange={(e) => setContainer(e.target.value)}>
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                </select>
              </label>
            )}

            <label className="checkbox-label">
              <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
              <Captions size={14} /> Subtitles
            </label>
            {subtitles && (
              <label className="field-inline">
                <select value={subLangs} onChange={(e) => setSubLangs(e.target.value)}>
                  {SUBTITLE_LANG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="spacer">
              <button type="submit" disabled={submitting || !urlText.trim()}>
                {submitting ? 'Adding…' : 'Download'}
              </button>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            {audioOnly
              ? 'Quality and file type don’t apply to audio-only downloads.'
              : 'If a video isn’t available at the selected quality, the closest quality at or below it is used instead.'}
          </p>
          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2><ListChecks size={16} /> Queue</h2>
          {activeJobs.length > 0 && <span className="count-badge">{activeJobs.length}</span>}
        </div>
        {activeJobs.length === 0 ? (
          <div className="empty-state">
            <Inbox size={30} />
            <span className="empty-title">Nothing in progress</span>
            <span className="empty-subtitle">Paste a URL above to start a download.</span>
          </div>
        ) : (
          <div className="queue-list">
            {activeJobs.map((job) => (
              <QueueItem key={job.id} job={job} onDeleted={handleDeleted} />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recently finished</h2>
        </div>
        {recentFinished.length === 0 ? (
          <div className="empty-state">
            <PartyPopper size={30} />
            <span className="empty-title">No downloads yet</span>
            <span className="empty-subtitle">Finished downloads will show up here.</span>
          </div>
        ) : (
          <div className="queue-list">
            {recentFinished.map((job) => (
              <QueueItem key={job.id} job={job} onDeleted={handleDeleted} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
