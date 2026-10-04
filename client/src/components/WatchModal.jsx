import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Radar,
  Search,
  Loader2,
  AlertCircle,
  Film,
  Music,
  Clock,
  Filter,
  Sliders,
  Sparkles,
  ExternalLink,
  Layers,
  Check,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { api } from '../api.js';

// Mirrors server/src/services/watch/tabs.js: a bare YouTube channel page, which has tabs.
const CHANNEL_ROOT_RE = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:@[^/?#]+|channel\/[\w-]+|c\/[^/?#]+|user\/[^/?#]+)(?:\/(?:featured|home))?\/?(?:[?#].*)?$/i;
const CONTENT_TYPE_OPTIONS = [
  { value: 'videos', label: 'Videos' },
  { value: 'shorts', label: 'Shorts' },
  { value: 'streams', label: 'Live streams' },
];
const ALL_CONTENT_TYPES = CONTENT_TYPE_OPTIONS.map((o) => o.value);

function parseContentTypes(value) {
  if (!value) return null;
  const wanted = String(value).split(',').map((v) => v.trim());
  return ALL_CONTENT_TYPES.filter((t) => wanted.includes(t));
}

const IGN_TRAILER_EXAMPLE = '\\b(movie|video game|gameplay|official)\\s+trailer\\b';

// Syntax check only; the server also screens for unsafe (catastrophic-backtracking) patterns.
function regexSyntaxError(value, label) {
  const pattern = value.trim();
  if (!pattern) return '';
  if (pattern.length > 200) return `${label} regex must be 200 characters or fewer`;
  if (/^\/.*\/[a-z]*$/i.test(pattern)) return `${label} regex: enter the pattern without /…/ delimiters`;
  try {
    new RegExp(pattern, 'i');
  } catch (e) {
    return `${label} must be a valid regular expression (${e.message})`;
  }
  return '';
}
import { previewTemplate } from '../outputTemplatePreview.js';
import { useModalA11y } from '../hooks/useModalA11y.js';

// Matches FULL_BACKFILL_LIMIT on the server: the most videos an "All existing videos" backfill queues.
const FULL_BACKFILL_LIMIT = 5000;

const CHECK_INTERVAL_OPTIONS = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes (Standard)' },
  { value: 60, label: 'Every 1 hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Every 24 hours' },
];

const QUALITY_OPTIONS = [
  { value: '', label: 'Best Available' },
  { value: '2160', label: '4K (2160p)' },
  { value: '1440', label: '2K / QHD (1440p)' },
  { value: '1080', label: 'Full HD (1080p)' },
  { value: '720', label: 'HD (720p)' },
  { value: '480', label: 'SD (480p)' },
];

const SPONSORBLOCK_CATEGORIES = [
  { value: 'sponsor', label: 'Sponsor' },
  { value: 'selfpromo', label: 'Self Promotion' },
  { value: 'interaction', label: 'Interaction Reminder' },
  { value: 'intro', label: 'Intro / Animation' },
  { value: 'outro', label: 'Outro / Credits' },
  { value: 'preview', label: 'Recap / Preview' },
  { value: 'filler', label: 'Filler / Tangent' },
];

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.floor(sec);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function WatchModal({
  open,
  watch = null, // if set, edit mode; if null, create mode
  initialUrl = '', // create mode: prefill the URL (e.g. a playlist pasted on the dashboard)
  initialBackfill = 0, // create mode: preselected first-check behavior (a count, or 'all')
  onClose,
  onSave,
}) {
  const containerRef = useModalA11y(open, onClose);

  const isEdit = !!watch;
  const [activeTab, setActiveTab] = useState('general'); // 'general' | 'format' | 'filters' | 'limits'

  // Fields
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [checkIntervalMins, setCheckIntervalMins] = useState(30);
  const [enabled, setEnabled] = useState(true);
  const [backfillCount, setBackfillCount] = useState(0);

  // Quality & Format
  const [audioOnly, setAudioOnly] = useState(false);
  const [quality, setQuality] = useState('');
  const [container, setContainer] = useState('mp4');
  const [subtitles, setSubtitles] = useState(false);
  const [subLangs, setSubLangs] = useState('en.*');
  const [embedThumbnail, setEmbedThumbnail] = useState(false);
  const [embedMetadata, setEmbedMetadata] = useState(false);
  const [embedChapters, setEmbedChapters] = useState(false);
  const [sponsorblock, setSponsorblock] = useState(false);
  const [sponsorCats, setSponsorCats] = useState(['sponsor']);

  // Filters
  const [matchTitle, setMatchTitle] = useState('');
  const [rejectTitle, setRejectTitle] = useState('');
  const [minDuration, setMinDuration] = useState('');
  const [maxDuration, setMaxDuration] = useState('');
  const [contentTypes, setContentTypes] = useState(['videos']);

  // Limits
  const [downloadLimit, setDownloadLimit] = useState(5);
  const [maxScanEntries, setMaxScanEntries] = useState(30);
  const [cleanupExempt, setCleanupExempt] = useState(false);
  const [outputTemplate, setOutputTemplate] = useState('');
  const [globalTemplate, setGlobalTemplate] = useState('');

  // Inspect state
  const [inspecting, setInspecting] = useState(false);
  const [inspectData, setInspectData] = useState(null);
  const [inspectError, setInspectError] = useState('');
  // Bumped on every inspect and every open/close, so a slow response for an earlier URL can't
  // overwrite the form after the modal moved on.
  const inspectSeq = useRef(0);

  // Submit state
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Filter preview state
  const [previewing, setPreviewing] = useState(false);
  const [previewRows, setPreviewRows] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const filterErrors = {
    matchTitle: regexSyntaxError(matchTitle, 'Include title'),
    rejectTitle: regexSyntaxError(rejectTitle, 'Exclude title'),
  };
  const hasFilterErrors = !!(filterErrors.matchTitle || filterErrors.rejectTitle);

  useEffect(() => {
    if (!open) return;
    setFormError('');
    setInspectError('');
    setInspecting(false);
    setActiveTab('general');
    setPreviewRows(null);
    setPreviewError('');

    if (watch) {
      setUrl(watch.url || '');
      setName(watch.name || '');
      setCheckIntervalMins(watch.check_interval_mins || 30);
      setEnabled(watch.enabled !== 0);
      setAudioOnly(!!watch.audio_only);
      setQuality(watch.quality || '');
      setContainer(watch.container || 'mp4');
      setSubtitles(!!watch.subtitles);
      setSubLangs(watch.sub_langs || 'en.*');
      setEmbedThumbnail(!!watch.embed_thumbnail);
      setEmbedMetadata(!!watch.embed_metadata);
      setEmbedChapters(!!watch.embed_chapters);
      setSponsorblock(!!watch.sponsorblock);
      setSponsorCats(
        watch.sponsorblock_categories
          ? watch.sponsorblock_categories.split(',').filter(Boolean)
          : ['sponsor']
      );
      setMatchTitle(watch.match_title || '');
      setRejectTitle(watch.reject_title || '');
      setMinDuration(watch.min_duration ? String(watch.min_duration) : '');
      setMaxDuration(watch.max_duration ? String(watch.max_duration) : '');
      // Watches saved before tabs existed follow every tab.
      setContentTypes(parseContentTypes(watch.content_types) || ALL_CONTENT_TYPES);
      setDownloadLimit(watch.download_limit || 5);
      setMaxScanEntries(watch.max_scan_entries || 30);
      setCleanupExempt(!!watch.cleanup_exempt);
      setOutputTemplate(watch.output_template || '');
      setInspectData(null);
    } else {
      setUrl(initialUrl || '');
      setName('');
      setCheckIntervalMins(30);
      setEnabled(true);
      setBackfillCount(initialBackfill);
      setAudioOnly(false);
      setQuality('');
      setContainer('mp4');
      setSubtitles(false);
      setSubLangs('en.*');
      setEmbedThumbnail(false);
      setEmbedMetadata(false);
      setEmbedChapters(false);
      setSponsorblock(false);
      setSponsorCats(['sponsor']);
      setMatchTitle('');
      setRejectTitle('');
      setMinDuration('');
      setMaxDuration('');
      setContentTypes(['videos']);
      setDownloadLimit(5);
      setMaxScanEntries(30);
      setCleanupExempt(false);
      setOutputTemplate('');
      setInspectData(null);
    }
    if (!watch && initialUrl) handleInspect(initialUrl, { fillName: true });
    return () => { inspectSeq.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, watch]);

  useEffect(() => {
    if (!open) return;
    api.getOutputTemplate().then((data) => setGlobalTemplate(data.template)).catch(() => {});
  }, [open]);

  async function handleInspect(urlToInspect, { fillName = false } = {}) {
    const target = (urlToInspect || url).trim();
    if (!target) return;
    const seq = ++inspectSeq.current;
    setInspecting(true);
    setInspectError('');
    try {
      const data = await api.inspectWatch(target);
      if (seq !== inspectSeq.current) return;
      setInspectData(data);
      if ((fillName || !name.trim()) && data.title) {
        setName(data.title);
      }
    } catch (err) {
      if (seq === inspectSeq.current) setInspectError(err.message);
    } finally {
      if (seq === inspectSeq.current) setInspecting(false);
    }
  }

  function handleUrlBlur() {
    if (!isEdit && url.trim() && !inspectData && !inspecting) {
      handleInspect(url.trim());
    }
  }

  function toggleSponsorCat(cat) {
    if (sponsorCats.includes(cat)) {
      setSponsorCats(sponsorCats.filter((c) => c !== cat));
    } else {
      setSponsorCats([...sponsorCats, cat]);
    }
  }

  async function handlePreview() {
    if (!url.trim() || hasFilterErrors) return;
    setPreviewing(true);
    setPreviewError('');
    try {
      const result = await api.previewWatchFilters({
        url: url.trim(),
        matchTitle: matchTitle.trim() || null,
        rejectTitle: rejectTitle.trim() || null,
        minDuration: minDuration ? parseInt(minDuration, 10) : null,
        maxDuration: maxDuration ? parseInt(maxDuration, 10) : null,
      });
      setPreviewRows(result.entries || []);
    } catch (err) {
      setPreviewRows(null);
      setPreviewError(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) {
      setFormError('A valid URL is required.');
      return;
    }
    if (hasFilterErrors) {
      setActiveTab('filters');
      setFormError(filterErrors.matchTitle || filterErrors.rejectTitle);
      return;
    }

    const isChannel = CHANNEL_ROOT_RE.test(url.trim());
    if (isChannel && contentTypes.length === 0) {
      setActiveTab('general');
      setFormError('Pick at least one of Videos, Shorts, or Live streams to follow.');
      return;
    }

    setSaving(true);
    setFormError('');

    const payload = {
      url: url.trim(),
      name: name.trim() || (inspectData?.title || null),
      checkIntervalMins: Number(checkIntervalMins) || 30,
      enabled: !!enabled,
      audioOnly: !!audioOnly,
      quality: quality || null,
      container: container || (audioOnly ? 'mp3' : 'mp4'),
      subtitles: !!subtitles,
      subLangs: subtitles ? (subLangs || 'en.*') : null,
      embedThumbnail: !!embedThumbnail,
      embedMetadata: !!embedMetadata,
      embedChapters: !!embedChapters,
      sponsorblock: !!sponsorblock,
      sponsorblockCategories: sponsorblock ? sponsorCats : [],
      matchTitle: matchTitle.trim() || null,
      rejectTitle: rejectTitle.trim() || null,
      minDuration: minDuration ? parseInt(minDuration, 10) : null,
      maxDuration: maxDuration ? parseInt(maxDuration, 10) : null,
      downloadLimit: Number(downloadLimit) || 5,
      maxScanEntries: Number(maxScanEntries) || 30,
      cleanupExempt: !!cleanupExempt,
      outputTemplate: outputTemplate.trim(),
      contentTypes: isChannel ? contentTypes : undefined,
      thumbnail: inspectData?.thumbnail || watch?.thumbnail || null,
      channelName: inspectData?.channelName || watch?.channel_name || null,
      backfillCount: !isEdit ? (backfillCount === 'all' ? 'all' : Number(backfillCount) || 0) : undefined,
    };

    try {
      await onSave(payload);
      onClose();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        className="modal-container preview-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <Radar size={18} className="text-accent" />
            <span>{isEdit ? `Edit Watch — ${watch?.name || 'Channel / Playlist'}` : 'Add YouTube Watch'}</span>
          </div>
          <button type="button" className="icon-btn-neutral" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
          <div className="modal-body">
            {/* Navigation Tabs */}
            <div className="watch-modal-tabs">
              <button
                type="button"
                className={`watch-modal-tab-btn ${activeTab === 'general' ? 'active' : ''}`}
                onClick={() => setActiveTab('general')}
              >
                <Radar size={13} /> General &amp; Schedule
              </button>
              <button
                type="button"
                className={`watch-modal-tab-btn ${activeTab === 'format' ? 'active' : ''}`}
                onClick={() => setActiveTab('format')}
              >
                <Sliders size={13} /> Quality &amp; Format
              </button>
              <button
                type="button"
                className={`watch-modal-tab-btn ${activeTab === 'filters' ? 'active' : ''}`}
                onClick={() => setActiveTab('filters')}
              >
                <Filter size={13} /> Smart Filters
              </button>
              <button
                type="button"
                className={`watch-modal-tab-btn ${activeTab === 'limits' ? 'active' : ''}`}
                onClick={() => setActiveTab('limits')}
              >
                <ShieldCheck size={13} /> Safety &amp; Limits
              </button>
            </div>

            {formError && (
              <div className="alert alert-error">
                <AlertCircle size={15} />
                <span>{formError}</span>
              </div>
            )}

            {/* TAB 1: General & Schedule */}
            {activeTab === 'general' && (
              <div className="watch-form-section">
                <div>
                  <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>
                    Channel or Playlist URL
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="url"
                      placeholder="e.g. https://www.youtube.com/@Veritasium or playlist URL"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onBlur={handleUrlBlur}
                      disabled={isEdit}
                      style={{ flex: 1 }}
                      required
                    />
                    {!isEdit && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleInspect(url)}
                        disabled={inspecting || !url.trim()}
                        style={{ padding: '0 14px' }}
                      >
                        {inspecting ? <Loader2 size={14} className="spin-icon" /> : <Search size={14} />}
                        {inspecting ? 'Inspecting…' : 'Inspect'}
                      </button>
                    )}
                  </div>
                  <span className="muted small" style={{ marginTop: 4, display: 'block' }}>
                    Supports YouTube channels (@handles, channel IDs), user uploads, and public or unlisted playlists.
                  </span>
                </div>

                {inspectError && (
                  <div className="alert alert-warning" style={{ margin: 0 }}>
                    <AlertCircle size={14} />
                    <span>Failed to inspect URL info: {inspectError}. You can still save the watch manually.</span>
                  </div>
                )}

                {inspectData && (
                  <div className="watch-preview-card">
                    <div className="watch-preview-header">
                      {inspectData.thumbnail ? (
                        <img
                          src={inspectData.thumbnail}
                          alt=""
                          className="watch-preview-avatar"
                        />
                      ) : (
                        <div className="watch-avatar">
                          <Radar size={22} />
                        </div>
                      )}
                      <div className="watch-preview-info">
                        <h4 className="watch-preview-title">{inspectData.title || 'Untitled Source'}</h4>
                        {inspectData.channelName && (
                          <span className="muted small" style={{ fontWeight: 600 }}>
                            {inspectData.channelName}
                          </span>
                        )}
                        {inspectData.description && (
                          <p className="watch-preview-desc">{inspectData.description}</p>
                        )}
                      </div>
                    </div>

                    {inspectData.recentVideos && inspectData.recentVideos.length > 0 && (
                      <div>
                        <div className="muted small" style={{ fontWeight: 600, marginBottom: 6 }}>
                          Recent Uploads Preview ({inspectData.recentVideos.length})
                        </div>
                        <div className="watch-preview-videos">
                          {inspectData.recentVideos.map((v) => (
                            <div key={v.id} className="watch-preview-video-item">
                              {v.thumbnail ? (
                                <img src={v.thumbnail} alt="" className="watch-preview-video-thumb" />
                              ) : (
                                <div className="watch-preview-video-thumb" />
                              )}
                              <span className="watch-preview-video-title" title={v.title}>
                                {v.title}
                              </span>
                              {v.duration ? (
                                <span className="muted small">{formatDuration(v.duration)}</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {CHANNEL_ROOT_RE.test(url.trim()) && (
                  <fieldset className="watch-content-types">
                    <legend className="field-label">Follow these channel tabs</legend>
                    <div className="watch-content-type-options">
                      {CONTENT_TYPE_OPTIONS.map((opt) => {
                        const missing = inspectData?.isChannel && Array.isArray(inspectData.availableTabs)
                          && !inspectData.availableTabs.includes(opt.value);
                        return (
                          <label key={opt.value} className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={contentTypes.includes(opt.value)}
                              onChange={(e) => setContentTypes(e.target.checked
                                ? ALL_CONTENT_TYPES.filter((t) => t === opt.value || contentTypes.includes(t))
                                : contentTypes.filter((t) => t !== opt.value))}
                            />
                            <span>{opt.label}</span>
                            {missing && <span className="muted small">(none yet)</span>}
                          </label>
                        );
                      })}
                    </div>
                    <span className="muted small" style={{ display: 'block', marginTop: 4 }}>
                      Each tab is checked separately. Turning a tab on later only records what's already
                      there; its uploads from then on are downloaded.
                    </span>
                  </fieldset>
                )}

                <div className="watch-fields-row">
                  <div>
                    <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>
                      Display Name (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Veritasium Tech"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>
                      Check Frequency
                    </label>
                    <select
                      value={checkIntervalMins}
                      onChange={(e) => setCheckIntervalMins(Number(e.target.value))}
                    >
                      {CHECK_INTERVAL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {!isEdit && (
                  <div style={{ background: 'var(--bg-elevated)', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <label className="field-label" style={{ display: 'block', marginBottom: 4, fontWeight: 700 }}>
                      First Check Behavior (Backfill Option)
                    </label>
                    <span className="muted small" style={{ display: 'block', marginBottom: 10 }}>
                      Control whether you only want new uploads going forward, or want to download what's already there right now.
                      New uploads are downloaded automatically either way.
                    </span>
                    <div className="segmented backfill-segmented">
                      {[
                        { count: 0, label: 'Seed only (Future uploads)' },
                        { count: 1, label: '1 latest video' },
                        { count: 3, label: '3 latest' },
                        { count: 5, label: '5 latest' },
                        { count: 'all', label: 'All existing videos' },
                      ].map((b) => (
                        <button
                          key={b.count}
                          type="button"
                          className={backfillCount === b.count ? 'active' : ''}
                          onClick={() => setBackfillCount(b.count)}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                    {backfillCount === 'all' && (
                      <span className="muted small" style={{ display: 'block', marginTop: 8 }}>
                        {inspectData?.entryCount > FULL_BACKFILL_LIMIT
                          ? `This source has ${inspectData.entryCount.toLocaleString()} videos; the newest ${FULL_BACKFILL_LIMIT.toLocaleString()} that match your filters are downloaded and older ones are skipped. New uploads keep downloading.`
                          : inspectData?.entryCount > 6
                            ? `Downloads all ${inspectData.entryCount} videos that match your filters, then keeps watching for new ones.`
                            : `Downloads every video that matches your filters (up to ${FULL_BACKFILL_LIMIT.toLocaleString()}), then keeps watching for new ones.`}
                        {' '}Large channels can take a long time.
                      </span>
                    )}
                  </div>
                )}

                <label className="checkbox-label" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  <span>Active &amp; Monitoring (Uncheck to pause scheduled checks)</span>
                </label>
              </div>
            )}

            {/* TAB 2: Format & Quality */}
            {activeTab === 'format' && (
              <div className="watch-form-section">
                <div>
                  <label className="field-label" style={{ display: 'block', marginBottom: 8 }}>
                    Media Type
                  </label>
                  <div className="segmented">
                    <button
                      type="button"
                      className={!audioOnly ? 'active' : ''}
                      onClick={() => setAudioOnly(false)}
                    >
                      <Film size={13} /> Video &amp; Audio
                    </button>
                    <button
                      type="button"
                      className={audioOnly ? 'active' : ''}
                      onClick={() => setAudioOnly(true)}
                    >
                      <Music size={13} /> Audio Only
                    </button>
                  </div>
                </div>

                <div className="watch-fields-row">
                  {!audioOnly && (
                    <div>
                      <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>
                        Max Video Resolution
                      </label>
                      <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                        {QUALITY_OPTIONS.map((q) => (
                          <option key={q.value} value={q.value}>
                            {q.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>
                      File Container
                    </label>
                    <select value={container} onChange={(e) => setContainer(e.target.value)}>
                      {!audioOnly ? (
                        <>
                          <option value="mp4">MP4 (Default, widest compatibility)</option>
                          <option value="mkv">MKV (Matroska)</option>
                          <option value="webm">WebM</option>
                        </>
                      ) : (
                        <>
                          <option value="opus">Opus (Highest Quality - YouTube Native)</option>
                          <option value="mp3">MP3 (Universal, 320k)</option>
                          <option value="m4a">M4A (AAC)</option>
                          <option value="flac">FLAC (Transcoded)</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label className="field-label" style={{ fontWeight: 700 }}>
                    Embeddings &amp; Enrichment
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={embedThumbnail}
                      onChange={(e) => setEmbedThumbnail(e.target.checked)}
                    />
                    Embed cover thumbnail into the media file
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={embedMetadata}
                      onChange={(e) => setEmbedMetadata(e.target.checked)}
                    />
                    Embed metadata &amp; tags (title, artist/uploader, description)
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={embedChapters}
                      onChange={(e) => setEmbedChapters(e.target.checked)}
                    />
                    Embed video chapters (if available)
                  </label>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                  <label className="checkbox-label" style={{ marginBottom: 8, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={subtitles}
                      onChange={(e) => setSubtitles(e.target.checked)}
                    />
                    Download Subtitles
                  </label>
                  {subtitles && (
                    <div style={{ paddingLeft: 24 }}>
                      <label className="field-label" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                        Subtitle Languages (regex or comma list, e.g. en.*, es)
                      </label>
                      <input
                        type="text"
                        value={subLangs}
                        onChange={(e) => setSubLangs(e.target.value)}
                        placeholder="en.*"
                      />
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                  <label className="checkbox-label" style={{ marginBottom: 8, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={sponsorblock}
                      onChange={(e) => setSponsorblock(e.target.checked)}
                    />
                    Auto-remove sponsor segments (SponsorBlock)
                  </label>
                  {sponsorblock && (
                    <div className="preview-sponsorblock-categories" style={{ marginTop: 8 }}>
                      {SPONSORBLOCK_CATEGORIES.map((cat) => (
                        <label key={cat.value} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={sponsorCats.includes(cat.value)}
                            onChange={() => toggleSponsorCat(cat.value)}
                          />
                          <span>{cat.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                  <label className="field-label" htmlFor="watch-output-template" style={{ display: 'block', marginBottom: 6 }}>
                    Filename template (optional)
                  </label>
                  <input
                    id="watch-output-template"
                    className="mono-input"
                    value={outputTemplate}
                    onChange={(e) => setOutputTemplate(e.target.value)}
                    placeholder={globalTemplate || 'Uses the template from Settings'}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  <span className="muted small" style={{ marginTop: 4, display: 'block' }}>
                    Leave blank to use the global template from Settings → File naming. Relative to the
                    downloads folder, e.g. <code>Kids/%(uploader)s/%(title)s [%(id)s].%(ext)s</code> to
                    keep this channel in its own library folder.
                  </span>
                  {outputTemplate.trim() && (
                    <div className="template-preview" style={{ marginTop: 8 }}>
                      <span className="muted small">Example result (approximate):</span>
                      <code>downloads/{previewTemplate(outputTemplate.trim())}</code>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: Smart Filters */}
            {activeTab === 'filters' && (
              <div className="watch-form-section">
                <p className="muted small" style={{ margin: 0 }}>
                  Only new uploads that pass every rule are downloaded. Patterns are regular expressions matched
                  case-insensitively against the title; enter them without <code>/…/</code> delimiters. If a title
                  matches both, the exclude rule wins. Rules apply to new videos and to ones not yet downloaded.
                </p>

                <div>
                  <label className="field-label" htmlFor="watch-include-regex" style={{ display: 'block', marginBottom: 4 }}>
                    Include title regex
                  </label>
                  <input
                    id="watch-include-regex"
                    type="text"
                    className={filterErrors.matchTitle ? 'input-invalid' : undefined}
                    placeholder="e.g. podcast|interview|full episode"
                    value={matchTitle}
                    onChange={(e) => { setMatchTitle(e.target.value); setPreviewRows(null); }}
                    aria-invalid={!!filterErrors.matchTitle}
                  />
                  {filterErrors.matchTitle ? (
                    <span className="field-error">{filterErrors.matchTitle}</span>
                  ) : (
                    <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                      Leave empty to consider every upload.{' '}
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => { setMatchTitle(IGN_TRAILER_EXAMPLE); setPreviewRows(null); }}
                        title="Use this example as the include pattern"
                      >
                        Example: <code>{IGN_TRAILER_EXAMPLE}</code>
                      </button>
                    </span>
                  )}
                </div>

                <div>
                  <label className="field-label" htmlFor="watch-exclude-regex" style={{ display: 'block', marginBottom: 4 }}>
                    Exclude title regex
                  </label>
                  <input
                    id="watch-exclude-regex"
                    type="text"
                    className={filterErrors.rejectTitle ? 'input-invalid' : undefined}
                    placeholder="e.g. #shorts|reaction|teaser"
                    value={rejectTitle}
                    onChange={(e) => { setRejectTitle(e.target.value); setPreviewRows(null); }}
                    aria-invalid={!!filterErrors.rejectTitle}
                  />
                  {filterErrors.rejectTitle ? (
                    <span className="field-error">{filterErrors.rejectTitle}</span>
                  ) : (
                    <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                      Matching videos are recorded as filtered (with the reason) and not downloaded.
                    </span>
                  )}
                </div>

                <div className="watch-fields-row">
                  <div>
                    <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
                      Minimum Duration (Seconds)
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 60"
                      value={minDuration}
                      onChange={(e) => { setMinDuration(e.target.value); setPreviewRows(null); }}
                      min={0}
                    />
                    <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                      Skips videos shorter than this. To skip Shorts on a channel, untick Shorts under General instead; channel listings don't include a Short's length.
                    </span>
                  </div>

                  <div>
                    <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
                      Maximum Duration (Seconds)
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 7200 (2 hours)"
                      value={maxDuration}
                      onChange={(e) => { setMaxDuration(e.target.value); setPreviewRows(null); }}
                      min={0}
                    />
                    <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                      Leave blank for no upper length limit.
                    </span>
                  </div>
                </div>

                <div className="filter-preview">
                  <div className="filter-preview-toolbar">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={handlePreview}
                      disabled={previewing || !url.trim() || hasFilterErrors}
                    >
                      {previewing ? <Loader2 size={14} className="spin-icon" /> : <Search size={14} />}
                      Preview against recent videos
                    </button>
                    <span className="muted small">Checks the 20 most recent uploads. Nothing is saved.</span>
                  </div>
                  {previewError && (
                    <div className="alert alert-error">
                      <AlertCircle size={15} />
                      <span>{previewError}</span>
                    </div>
                  )}
                  {previewRows && previewRows.length === 0 && (
                    <div className="muted small">No recent videos were found for this URL.</div>
                  )}
                  {previewRows && previewRows.length > 0 && (
                    <ul className="filter-preview-list">
                      {previewRows.map((row) => (
                        <li key={row.id} className="filter-preview-row">
                          <span className={`filter-chip ${row.eligible ? 'filter-chip-match' : 'filter-chip-excluded'}`}>
                            {row.eligible ? 'Matches' : 'Excluded'}
                          </span>
                          <span className="filter-preview-title" title={row.title || row.id}>{row.title || row.id}</span>
                          {row.reason && <span className="filter-preview-reason muted small">{row.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: Limits & Safety */}
            {activeTab === 'limits' && (
              <div className="watch-form-section">
                <p className="muted small" style={{ margin: 0 }}>
                  Safety limits prevent overloading your download queue or disk space if a channel uploads a large batch of videos at once.
                </p>

                <div className="watch-fields-row">
                  <div>
                    <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
                      Max Downloads Per Check
                    </label>
                    <input
                      type="number"
                      value={downloadLimit}
                      onChange={(e) => setDownloadLimit(e.target.value)}
                      min={1}
                      max={50}
                    />
                    <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                      Limits the number of new videos queued in a single check cycle (Default: 5).
                    </span>
                  </div>

                  <div>
                    <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
                      Scan Depth (Entries to inspect)
                    </label>
                    <input
                      type="number"
                      value={maxScanEntries}
                      onChange={(e) => setMaxScanEntries(e.target.value)}
                      min={10}
                      max={100}
                    />
                    <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                      How many recent uploads to check per tick (Default: 30).
                    </span>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={cleanupExempt}
                      onChange={(e) => setCleanupExempt(e.target.checked)}
                    />
                    Exclude this watch's downloads from auto-delete
                  </label>
                  <span className="muted small" style={{ marginTop: 2, display: 'block', paddingLeft: 26 }}>
                    Overrides the age/Jellyfin-watched auto-delete rules in Settings — videos
                    from this watch are never removed automatically.
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving || inspecting || !url.trim() || hasFilterErrors}>
              {saving ? (
                <>
                  <Loader2 size={15} className="spin-icon" /> Saving…
                </>
              ) : (
                <>
                  <Check size={15} /> {isEdit ? 'Save Changes' : 'Add Watch'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
