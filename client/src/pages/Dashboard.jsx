import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api.js';
import QueueItem from '../components/QueueItem.jsx';

export default function Dashboard() {
  const [urlText, setUrlText] = useState('');
  const [audioOnly, setAudioOnly] = useState(false);
  const [subtitles, setSubtitles] = useState(false);
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
      await api.enqueue({ urls, audioOnly, subtitles });
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
            <label>
              <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
              Download subtitles
            </label>
            <button type="submit" disabled={submitting || !urlText.trim()}>
              {submitting ? 'Adding…' : 'Download'}
            </button>
          </div>
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
