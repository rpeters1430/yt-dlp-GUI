import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ListChecks, CheckCircle2, XCircle, AlertCircle,
  Inbox, PartyPopper, Sparkles, SlidersHorizontal, ChevronDown,
} from 'lucide-react';
import { api } from '../api.js';
import QueueItem from '../components/QueueItem.jsx';
import MediaPreviewModal from '../components/MediaPreviewModal.jsx';
import DownloadOptionsFields, { defaultDownloadOptions } from '../components/DownloadOptionsFields.jsx';

export default function Dashboard() {
  const [urlText, setUrlText] = useState('');
  const [options, setOptions] = useState(() => defaultDownloadOptions());
  const [jobs, setJobs] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const socketRef = useRef(null);

  const {
    audioOnly, subtitles, embedThumbnail, embedMetadata, embedChapters, sponsorblock,
  } = options;

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

  // Polling fallback to guarantee continuous updates even if socket drops
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'downloading');
    if (!hasActive) return;

    const interval = setInterval(() => {
      api.listDownloads().then(setJobs).catch(() => {});
    }, 2000);

    return () => clearInterval(interval);
  }, [jobs]);

  const parsedUrls = useMemo(
    () => urlText.split('\n').map((u) => u.trim()).filter(Boolean),
    [urlText]
  );
  const validUrls = useMemo(
    () => parsedUrls.filter((u) => /^https?:\/\//i.test(u)),
    [parsedUrls]
  );

  const advancedActiveCount = [subtitles, embedThumbnail, embedMetadata, embedChapters, sponsorblock]
    .filter(Boolean).length;

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

  function handlePaste(e) {
    const text = e.clipboardData?.getData('text') || '';
    const trimmed = text.trim();
    if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
      // Single URL pasted - populate and auto-open the analyze popup
      setUrlText(trimmed);
      setPreviewUrls([trimmed]);
      setPreviewModalOpen(true);
    }
  }

  // Always analyzes every entered URL (one or many) before enqueueing, so the user can review
  // details and choose shared or per-video options first instead of downloading blind.
  function handleAnalyze(e) {
    e.preventDefault();
    setError('');
    if (validUrls.length === 0) return;
    setPreviewUrls(validUrls);
    setPreviewModalOpen(true);
  }

  // Enqueues one or more groups of { urls, options } produced by the analyze modal — a single
  // group when the same options apply to every video, or one group per video when customized
  // individually.
  async function handleConfirmDownload(groups) {
    setSubmitting(true);
    try {
      for (const group of groups) {
        const opts = group.options;
        await api.enqueue({
          urls: group.urls,
          audioOnly: opts.audioOnly,
          quality: opts.quality,
          container: opts.container,
          subtitles: opts.subtitles,
          subLangs: opts.subLangs,
          embedThumbnail: opts.embedThumbnail,
          embedMetadata: opts.embedMetadata,
          embedChapters: opts.embedChapters,
          sponsorblockRemove: opts.sponsorblock ? opts.sponsorblockCategories : [],
        });
      }
      setUrlText('');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeleted(id) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  return (
    <>
      <MediaPreviewModal
        isOpen={previewModalOpen}
        urls={previewUrls}
        onClose={() => setPreviewModalOpen(false)}
        onConfirmDownload={handleConfirmDownload}
        initialSettings={options}
      />
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
        <form onSubmit={handleAnalyze}>
          <textarea
            placeholder="Paste one or more URLs, one per line (any site yt-dlp supports)"
            rows={4}
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            onPaste={handlePaste}
          />
          <div className="options-row">
            <button
              type="button"
              className={`btn-ghost btn-sm advanced-toggle${advancedOpen ? ' active' : ''}`}
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
            >
              <SlidersHorizontal size={13} />
              Default options
              {advancedActiveCount > 0 && <span className="count-badge">{advancedActiveCount}</span>}
              <ChevronDown size={13} className={`advanced-toggle-chevron${advancedOpen ? ' open' : ''}`} />
            </button>

            <div className="spacer">
              <button type="submit" disabled={submitting || validUrls.length === 0}>
                {submitting
                  ? 'Adding…'
                  : (
                    <>
                      <Sparkles size={14} />
                      {validUrls.length > 1 ? `Analyze ${validUrls.length} videos` : 'Analyze & Download'}
                    </>
                  )}
              </button>
            </div>
          </div>

          {advancedOpen && (
            <div className="advanced-panel">
              <p className="muted small" style={{ width: '100%' }}>
                These are the default options used when you click Analyze — you can still review
                or change them (and apply them to all videos or individually) before downloading.
              </p>
              <DownloadOptionsFields values={options} onChange={setOptions} />
            </div>
          )}

          <p className="muted small form-hint">
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
