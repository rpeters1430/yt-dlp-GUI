import React, { useState, useEffect } from 'react';
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
import { useModalA11y } from '../hooks/useModalA11y.js';

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

  // Limits
  const [downloadLimit, setDownloadLimit] = useState(5);
  const [maxScanEntries, setMaxScanEntries] = useState(30);

  // Inspect state
  const [inspecting, setInspecting] = useState(false);
  const [inspectData, setInspectData] = useState(null);
  const [inspectError, setInspectError] = useState('');

  // Submit state
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFormError('');
    setInspectError('');
    setActiveTab('general');

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
      setDownloadLimit(watch.download_limit || 5);
      setMaxScanEntries(watch.max_scan_entries || 30);
      setInspectData(null);
    } else {
      setUrl('');
      setName('');
      setCheckIntervalMins(30);
      setEnabled(true);
      setBackfillCount(0);
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
      setDownloadLimit(5);
      setMaxScanEntries(30);
      setInspectData(null);
    }
  }, [open, watch]);

  async function handleInspect(urlToInspect) {
    const target = (urlToInspect || url).trim();
    if (!target) return;
    setInspecting(true);
    setInspectError('');
    try {
      const data = await api.inspectWatch(target);
      setInspectData(data);
      if (!name.trim() && data.title) {
        setName(data.title);
      }
    } catch (err) {
      setInspectError(err.message);
    } finally {
      setInspecting(false);
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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) {
      setFormError('A valid URL is required.');
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
      thumbnail: inspectData?.thumbnail || watch?.thumbnail || null,
      channelName: inspectData?.channelName || watch?.channel_name || null,
      backfillCount: !isEdit ? Number(backfillCount) || 0 : undefined,
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
                      Control whether you only want new uploads going forward, or want to download recent uploads right now.
                    </span>
                    <div className="segmented" style={{ width: '100%', display: 'flex' }}>
                      {[
                        { count: 0, label: 'Seed only (Future uploads)' },
                        { count: 1, label: '1 latest video' },
                        { count: 3, label: '3 latest' },
                        { count: 5, label: '5 latest' },
                      ].map((b) => (
                        <button
                          key={b.count}
                          type="button"
                          style={{ flex: 1, fontSize: 12, padding: '6px 4px' }}
                          className={backfillCount === b.count ? 'active' : ''}
                          onClick={() => setBackfillCount(b.count)}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
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
                          <option value="mp3">MP3</option>
                          <option value="m4a">M4A (AAC)</option>
                          <option value="opus">Opus</option>
                          <option value="flac">FLAC (Lossless)</option>
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
              </div>
            )}

            {/* TAB 3: Smart Filters */}
            {activeTab === 'filters' && (
              <div className="watch-form-section">
                <p className="muted small" style={{ margin: 0 }}>
                  Smart filters allow you to selectively download only specific videos (e.g. only podcasts or full episodes) while skipping shorts or teasers.
                </p>

                <div>
                  <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
                    Title Must Contain (Keyword or Regex)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Podcast|Interview|Episode"
                    value={matchTitle}
                    onChange={(e) => setMatchTitle(e.target.value)}
                  />
                  <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                    Leave empty to download all uploads regardless of title.
                  </span>
                </div>

                <div>
                  <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
                    Title Must NOT Contain (Exclude Pattern)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. #shorts|trailer|teaser"
                    value={rejectTitle}
                    onChange={(e) => setRejectTitle(e.target.value)}
                  />
                  <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                    Videos matching this pattern will be marked as seen and skipped.
                  </span>
                </div>

                <div className="watch-fields-row">
                  <div>
                    <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
                      Minimum Duration (Seconds)
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 60 (Skips YouTube Shorts)"
                      value={minDuration}
                      onChange={(e) => setMinDuration(e.target.value)}
                      min={0}
                    />
                    <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                      Set to 60 to automatically skip YouTube Shorts under 1 min.
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
                      onChange={(e) => setMaxDuration(e.target.value)}
                      min={0}
                    />
                    <span className="muted small" style={{ marginTop: 2, display: 'block' }}>
                      Leave blank for no upper length limit.
                    </span>
                  </div>
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
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving || inspecting || !url.trim()}>
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
