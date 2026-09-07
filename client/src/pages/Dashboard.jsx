import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
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
    <div>
      <section className="panel">
        <h2>Add downloads</h2>
        <form onSubmit={handleSubmit}>
          <textarea
            placeholder="Paste one or more URLs, one per line (any site yt-dlp supports)"
            rows={4}
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
          />
          <div className="options-row">
            <label>
              <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} />
              Audio only (MP3)
            </label>
            {!audioOnly && (
              <label>
                Quality
                <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                  {QUALITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            )}
            {!audioOnly && (
              <label>
                File type
                <select value={container} onChange={(e) => setContainer(e.target.value)}>
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                </select>
              </label>
            )}
            <label>
              <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
              Download subtitles
            </label>
            {subtitles && (
              <label>
                Language
                <select value={subLangs} onChange={(e) => setSubLangs(e.target.value)}>
                  {SUBTITLE_LANG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="submit" disabled={submitting || !urlText.trim()}>
              {submitting ? 'Adding…' : 'Download'}
            </button>
          </div>
          <p className="muted small">
            {audioOnly
              ? 'Quality and file type don’t apply to audio-only downloads.'
              : 'If a video isn’t available at the selected quality, the closest quality at or below it is used instead.'}
          </p>
          {error && <div className="error-text">{error}</div>}
        </form>
      </section>

      <section className="panel">
        <h2>Queue ({activeJobs.length})</h2>
        {activeJobs.length === 0 && <p className="muted">Nothing in progress.</p>}
        {activeJobs.map((job) => (
          <QueueItem key={job.id} job={job} onDeleted={handleDeleted} />
        ))}
      </section>

      <section className="panel">
        <h2>Recently finished</h2>
        {recentFinished.length === 0 && <p className="muted">No downloads yet.</p>}
        {recentFinished.map((job) => (
          <QueueItem key={job.id} job={job} onDeleted={handleDeleted} />
        ))}
      </section>
    </div>
  );
}
