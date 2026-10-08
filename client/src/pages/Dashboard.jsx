import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ListChecks, CheckCircle2, XCircle, AlertCircle,
  Inbox, PartyPopper, Sparkles, SlidersHorizontal, ChevronDown, Globe,
  ClipboardPaste, Trash2, Video, Tv, Music2, Clock, Radar,
} from 'lucide-react';
import { api } from '../api.js';
import QueueItem from '../components/QueueItem.jsx';
import MediaPreviewModal from '../components/MediaPreviewModal.jsx';
import WatchModal from '../components/WatchModal.jsx';
import DownloadOptionsFields, { defaultDownloadOptions, isYouTubeUrl, isWatchableUrl, capsFromUrl, mergeCapabilities, normalizeUrl } from '../components/DownloadOptionsFields.jsx';
import { useDownloads } from '../context/DownloadsContext.jsx';

export default function Dashboard() {
  const [urlText, setUrlText] = useState('');
  const [options, setOptions] = useState(() => defaultDownloadOptions());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Playlist/channel link being set up as a Watch, and the confirmation shown afterwards.
  const [watchUrl, setWatchUrl] = useState(null);
  const [watchNotice, setWatchNotice] = useState(null);

  const {
    jobs,
    setJobs,
    loaded,
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
    () => parsedUrls.map(normalizeUrl).filter((u) => /^https?:\/\//i.test(u)),
    [parsedUrls]
  );

  const watchableUrls = useMemo(() => validUrls.filter(isWatchableUrl), [validUrls]);
  // A lone playlist or channel link goes straight to Watch setup instead of a one-off download.
  const singleWatchable = validUrls.length === 1 && watchableUrls.length === 1;

  const hasUrls = validUrls.length > 0;
  const pastedCaps = useMemo(
    () => (hasUrls ? mergeCapabilities(validUrls.map(capsFromUrl)) : null),
    [hasUrls, validUrls]
  );
  const hasNonYouTube = useMemo(
    () => hasUrls && validUrls.some((u) => !isYouTubeUrl(u)),
    [hasUrls, validUrls]
  );

  const platformCounts = useMemo(() => {
    let yt = 0;
    let twitch = 0;
    let audio = 0;
    let other = 0;
    for (const u of validUrls) {
      const lower = u.toLowerCase();
      if (lower.includes('youtube.com') || lower.includes('youtu.be')) yt++;
      else if (lower.includes('twitch.tv')) twitch++;
      else if (lower.includes('soundcloud.com') || lower.includes('bandcamp.com') || lower.includes('spotify.com')) audio++;
      else other++;
    }
    return { yt, twitch, audio, other };
  }, [validUrls]);

  async function handlePasteClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlText((prev) => (prev.trim() ? `${prev.trim()}\n${text.trim()}` : text.trim()));
      }
    } catch {
      // ignore clipboard permission error
    }
  }

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
    if (singleWatchable) {
      setWatchUrl(validUrls[0]);
      return;
    }
    openPreview();
  }

  function openPreview() {
    setPreviewUrls(validUrls);
    setPreviewModalOpen(true);
  }

  function handleWatchPlaylist(url) {
    setPreviewModalOpen(false);
    setWatchUrl(url);
  }

  async function handleSaveWatch(payload) {
    const created = await api.addWatch(payload);
    const watched = watchUrl;
    // Take the link out of the box so it isn't downloaded a second time by accident.
    setUrlText((prev) => prev.split(/[\r\n]+/)
      .flatMap((line) => line.trim().split(/\s+/))
      .filter((u) => u && normalizeUrl(u) !== watched)
      .join('\n'));
    setWatchNotice({
      name: created.name || created.channel_name || watched,
      all: payload.backfillCount === 'all',
    });
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
        onWatchPlaylist={handleWatchPlaylist}
      />
      <WatchModal
        open={!!watchUrl}
        initialUrl={watchUrl || ''}
        initialBackfill="all"
        onClose={() => setWatchUrl(null)}
        onSave={handleSaveWatch}
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
            <span className="stat-icon"><Clock size={16} /></span>
          </div>
          <span className="stat-value">{loaded ? activeJobs.length : '—'}</span>
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
          <span className="stat-value">{loaded ? completedCount : '—'}</span>
        </div>
        <div className="stat-card danger">
          <div className="stat-top">
            <span className="stat-label">Failed</span>
            <span className="stat-icon"><XCircle size={16} /></span>
          </div>
          <span className="stat-value">{loaded ? failedCount : '—'}</span>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={handlePasteClipboard}
              title="Paste link from clipboard"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <ClipboardPaste size={13} /> Paste
            </button>
            {urlText && (
              <button
                type="button"
                className="btn-ghost btn-sm text-danger"
                onClick={() => setUrlText('')}
                title="Clear input"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <Trash2 size={13} /> Clear
              </button>
            )}
            <Link
              to="/sites"
              className="btn-ghost btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="View supported sites and feature requirements"
            >
              <Globe size={13} /> Sites Guide
            </Link>
          </div>
        </div>
        <form onSubmit={handleAnalyze}>
          <div className="url-intake-wrapper">
            <textarea
              placeholder="Paste or enter one or more URLs (one per line). You can add as many links as you want, then click Analyze."
              rows={4}
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
            />
          </div>

          {watchableUrls.length > 0 && (
            <div className="alert alert-info watch-suggestion">
              <Radar size={15} />
              <div>
                {singleWatchable ? (
                  <>
                    This is a playlist or channel. Clicking <strong>Set up Watch</strong> downloads the videos already
                    in it (up to the newest 5,000 that match your filters) and keeps downloading new ones as they're added.{' '}
                    <button type="button" className="btn-link" onClick={openPreview}>Download once instead</button>
                  </>
                ) : (
                  <>
                    {watchableUrls.length === 1 ? 'One link is a playlist or channel' : `${watchableUrls.length} links are playlists or channels`}.
                    {' '}Watch to download everything and keep grabbing new videos:
                    {watchableUrls.map((u) => (
                      <button key={u} type="button" className="btn-link watch-suggestion-link" onClick={() => setWatchUrl(u)} title={u}>
                        Watch {u.replace(/^https?:\/\/(www\.)?/i, '')}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {watchNotice && (
            <div className="alert alert-success watch-suggestion">
              <CheckCircle2 size={15} />
              <div>
                Now watching <strong>{watchNotice.name}</strong>.{' '}
                {watchNotice.all ? 'Existing videos are being queued and new ones will download automatically.' : 'New videos will download automatically.'}{' '}
                <Link to="/watches">Open Watches</Link>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setWatchNotice(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          {validUrls.length > 0 && (
            <div className="detected-platforms-row">
              {platformCounts.yt > 0 && (
                <span className="detected-platform-pill yt">
                  <Video size={12} /> {platformCounts.yt} YouTube video{platformCounts.yt > 1 ? 's' : ''}
                </span>
              )}
              {platformCounts.twitch > 0 && (
                <span className="detected-platform-pill twitch">
                  <Tv size={12} /> {platformCounts.twitch} Twitch link{platformCounts.twitch > 1 ? 's' : ''}
                </span>
              )}
              {platformCounts.audio > 0 && (
                <span className="detected-platform-pill audio">
                  <Music2 size={12} /> {platformCounts.audio} Audio stream{platformCounts.audio > 1 ? 's' : ''}
                </span>
              )}
              {platformCounts.other > 0 && (
                <span className="detected-platform-pill other">
                  <Globe size={12} /> {platformCounts.other} Supported site{platformCounts.other > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

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
              <button type="submit" className="btn-primary-gradient" disabled={submitting || validUrls.length === 0}>
                {submitting ? (
                  'Analyzing…'
                ) : singleWatchable ? (
                  <>
                    <Radar size={14} /> Set up Watch
                  </>
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
                caps={pastedCaps}
              />
              {hasNonYouTube && (
                <p className="muted small form-hint" style={{ color: 'var(--accent, #6366f1)', marginTop: '8px' }}>
                  Non-YouTube link detected: each link is checked when you click Analyze, and options its site
                  doesn't support (such as SponsorBlock) are skipped automatically.
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
        {!loaded ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : activeJobs.length === 0 ? (
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
        {!loaded ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : recentFinished.length === 0 ? (
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
