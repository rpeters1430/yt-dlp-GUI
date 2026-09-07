import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ListChecks, CheckCircle2, XCircle, AlertCircle,
  Music, Captions, Inbox, PartyPopper, Sparkles,
} from 'lucide-react';
import { api } from '../api.js';
import QueueItem from '../components/QueueItem.jsx';
import MediaPreviewModal from '../components/MediaPreviewModal.jsx';

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

const SPONSORBLOCK_CATEGORIES = [
  { value: 'sponsor', label: 'Sponsor' },
  { value: 'selfpromo', label: 'Unpaid/self promotion' },
  { value: 'interaction', label: 'Interaction reminder' },
  { value: 'intro', label: 'Intermission/intro' },
  { value: 'outro', label: 'Endcards/credits' },
  { value: 'preview', label: 'Preview/recap' },
  { value: 'music_offtopic', label: 'Non-music section' },
  { value: 'filler', label: 'Filler tangent' },
];

export default function Dashboard() {
  const [urlText, setUrlText] = useState('');
  const [audioOnly, setAudioOnly] = useState(false);
  const [quality, setQuality] = useState('');
  const [container, setContainer] = useState('mp4');
  const [subtitles, setSubtitles] = useState(false);
  const [subLangs, setSubLangs] = useState('en.*');
  const [embedThumbnail, setEmbedThumbnail] = useState(false);
  const [embedMetadata, setEmbedMetadata] = useState(false);
  const [embedChapters, setEmbedChapters] = useState(false);
  const [sponsorblock, setSponsorblock] = useState(false);
  const [sponsorblockCategories, setSponsorblockCategories] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
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
  const isSingleUrl = parsedUrls.length === 1 && /^https?:\/\//i.test(parsedUrls[0]);

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
      // Single URL pasted - populate and auto-open details popup
      setUrlText(trimmed);
      setPreviewUrl(trimmed);
      setPreviewModalOpen(true);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const urls = parsedUrls;
    if (urls.length === 0) return;

    if (urls.length === 1 && /^https?:\/\//i.test(urls[0])) {
      setPreviewUrl(urls[0]);
      setPreviewModalOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      await api.enqueue({
        urls,
        audioOnly,
        quality,
        container,
        subtitles,
        subLangs,
        embedThumbnail,
        embedMetadata,
        embedChapters,
        sponsorblockRemove: sponsorblock ? sponsorblockCategories : [],
      });
      setUrlText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDownload(payload) {
    await api.enqueue({
      urls: [payload.url],
      audioOnly: payload.audioOnly,
      quality: payload.quality,
      container: payload.container,
      subtitles: payload.subtitles,
      subLangs: payload.subLangs,
      embedThumbnail: payload.embedThumbnail,
      embedMetadata: payload.embedMetadata,
      embedChapters: payload.embedChapters,
      sponsorblockRemove: payload.sponsorblockRemove,
    });
    setUrlText('');
  }

  function toggleSponsorblockCategory(value) {
    setSponsorblockCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  }

  function handleDeleted(id) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  return (
    <>
      <MediaPreviewModal
        isOpen={previewModalOpen}
        url={previewUrl}
        onClose={() => setPreviewModalOpen(false)}
        onConfirmDownload={handleConfirmDownload}
        initialSettings={{
          audioOnly,
          quality,
          container,
          subtitles,
          subLangs,
          embedThumbnail,
          embedMetadata,
          embedChapters,
          sponsorblockCategories: sponsorblock ? sponsorblockCategories : [],
        }}
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
        <form onSubmit={handleSubmit}>
          <textarea
            placeholder="Paste one or more URLs, one per line (any site yt-dlp supports)"
            rows={4}
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            onPaste={handlePaste}
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

            <label className="checkbox-label">
              <input type="checkbox" checked={embedThumbnail} onChange={(e) => setEmbedThumbnail(e.target.checked)} />
              Embed thumbnail
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={embedMetadata} onChange={(e) => setEmbedMetadata(e.target.checked)} />
              Embed metadata
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={embedChapters} onChange={(e) => setEmbedChapters(e.target.checked)} />
              Embed chapters
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={sponsorblock} onChange={(e) => setSponsorblock(e.target.checked)} />
              Auto-remove sponsored segments (SponsorBlock)
            </label>

            <div className="spacer">
              {isSingleUrl && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setPreviewUrl(parsedUrls[0]);
                    setPreviewModalOpen(true);
                  }}
                  title="Inspect details, resolutions, and playlist info"
                >
                  <Sparkles size={14} /> Preview Details
                </button>
              )}
              <button type="submit" disabled={submitting || !urlText.trim()}>
                {submitting ? 'Adding…' : isSingleUrl ? 'Preview & Download' : 'Download'}
              </button>
            </div>
          </div>
          {sponsorblock && (
            <div className="sponsorblock-categories" style={{ marginTop: 10 }}>
              {SPONSORBLOCK_CATEGORIES.map((cat) => (
                <label key={cat.value} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={sponsorblockCategories.includes(cat.value)}
                    onChange={() => toggleSponsorblockCategory(cat.value)}
                  />
                  {cat.label}
                </label>
              ))}
            </div>
          )}
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
