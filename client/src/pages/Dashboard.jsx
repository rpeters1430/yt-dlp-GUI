import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ListChecks, CheckCircle2, XCircle, AlertCircle,
  Inbox, PartyPopper, Sparkles, SlidersHorizontal, ChevronDown, Globe,
} from 'lucide-react';
import { api } from '../api.js';
import QueueItem from '../components/QueueItem.jsx';
import MediaPreviewModal from '../components/MediaPreviewModal.jsx';
import DownloadOptionsFields, { defaultDownloadOptions, isYouTubeUrl } from '../components/DownloadOptionsFields.jsx';
import { useDownloads } from '../context/DownloadsContext.jsx';

export default function Dashboard() {
  const [urlText, setUrlText] = useState('');
  const [options, setOptions] = useState(() => defaultDownloadOptions());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const {
    jobs,
    setJobs,
    activeJobs,
    downloadingJobs,
    queuedJobs,
    completedCount,
    failedCount,
  } = useDownloads();

  const {
    audioOnly, subtitles, embedThumbnail, embedMetadata, embedChapters, sponsorblock,
  } = options;

  const parsedUrls = useMemo(
    () => urlText.split(/[\r\n]+/).flatMap((line) => line.trim().split(/\s+/)).filter(Boolean),
    [urlText]
  );
  const validUrls = useMemo(
    () => parsedUrls.filter((u) => /^https?:\/\//i.test(u)),
    [parsedUrls]
  );

  const hasUrls = validUrls.length > 0;
  const allValidAreYouTube = useMemo(
    () => hasUrls && validUrls.every((u) => isYouTubeUrl(u)),
    [hasUrls, validUrls]
  );
  const hasNonYouTube = useMemo(
    () => hasUrls && validUrls.some((u) => !isYouTubeUrl(u)),
    [hasUrls, validUrls]
  );

  const advancedActiveCount = [subtitles, embedThumbnail, embedMetadata, embedChapters, sponsorblock]
    .filter(Boolean).length;

  const recentFinished = useMemo(
    () => jobs.filter((j) => j.status === 'completed' || j.status === 'failed').slice(0, 10),
    [jobs]
  );

  // Analyzes all entered URLs when the user clicks Analyze, allowing multiple links to be added first
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
          isLive: opts.isLive,
          liveFromStart: opts.liveFromStart,
          waitForLive: opts.isLive && opts.liveStatus === 'is_upcoming' ? opts.waitForLive : false,
          waitInterval: opts.waitInterval,
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
          {activeJobs.length > 0 && (
            <div className="stat-subtext" style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {downloadingJobs.length > 0
                ? `${downloadingJobs.length} active · ${queuedJobs.length} waiting`
                : `${activeJobs.length} waiting in line`}
            </div>
          )}
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
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2>Add downloads</h2>
            {validUrls.length > 0 && (
              <span className="count-badge accent">{validUrls.length} link{validUrls.length > 1 ? 's' : ''} ready</span>
            )}
          </div>
          <Link
            to="/sites"
            className="btn-ghost btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title="View supported sites and feature requirements"
          >
            <Globe size={13} /> Supported Sites Guide
          </Link>
        </div>
        <form onSubmit={handleAnalyze}>
          <textarea
            placeholder="Paste or enter one or more URLs (one per line). You can add as many links as you want, then click Analyze."
            rows={4}
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
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
                {submitting ? (
                  'Analyzing…'
                ) : (
                  <>
                    <Sparkles size={14} />
                    {validUrls.length > 1
                      ? `Analyze ${validUrls.length} videos`
                      : validUrls.length === 1
                        ? 'Analyze video'
                        : 'Analyze videos'}
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
              <DownloadOptionsFields
                values={options}
                onChange={setOptions}
                isYouTube={hasUrls ? allValidAreYouTube : true}
              />
              {hasNonYouTube && (
                <p className="muted small form-hint" style={{ color: 'var(--accent, #6366f1)', marginTop: '8px' }}>
                  Non-YouTube link detected: features specific to YouTube (such as SponsorBlock and broadcast start recording) will be automatically skipped.
                </p>
              )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2><ListChecks size={16} /> Queue</h2>
            {activeJobs.length > 0 && <span className="count-badge accent">{activeJobs.length}</span>}
          </div>
          {activeJobs.length > 0 && (
            <div className="queue-header-status-pill">
              <span className="queue-live-indicator-sm">
                <span className="queue-live-ping" />
                <span className="queue-live-dot" />
              </span>
              <span>
                {downloadingJobs.length > 0
                  ? `${downloadingJobs.length} downloading · ${queuedJobs.length} waiting`
                  : `${activeJobs.length} waiting in queue`}
              </span>
            </div>
          )}
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
