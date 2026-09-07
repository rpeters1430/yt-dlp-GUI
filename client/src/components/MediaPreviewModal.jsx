import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Clock,
  Eye,
  Music,
  Captions,
  Download,
  Loader2,
  AlertCircle,
  ListVideo,
  Film,
  Tv,
  Check,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api.js';

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.floor(sec);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatViews(num) {
  if (!num) return null;
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B views`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M views`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K views`;
  return `${num.toLocaleString()} views`;
}

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

export default function MediaPreviewModal({
  isOpen,
  url,
  onClose,
  onConfirmDownload,
  initialSettings = {},
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  // Download options customized inside modal
  const [audioOnly, setAudioOnly] = useState(initialSettings.audioOnly || false);
  const [quality, setQuality] = useState(initialSettings.quality || '');
  const [container, setContainer] = useState(initialSettings.container || 'mp4');
  const [subtitles, setSubtitles] = useState(initialSettings.subtitles || false);
  const [subLangs, setSubLangs] = useState(initialSettings.subLangs || 'en.*');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!isOpen || !url) {
      setData(null);
      setError('');
      return;
    }

    let active = true;
    setLoading(true);
    setError('');
    setData(null);

    // Reset settings to initial
    setAudioOnly(initialSettings.audioOnly || false);
    setQuality(initialSettings.quality || '');
    setContainer(initialSettings.container || 'mp4');
    setSubtitles(initialSettings.subtitles || false);
    setSubLangs(initialSettings.subLangs || 'en.*');

    api
      .getInfo(url.trim())
      .then((res) => {
        if (!active) return;
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Failed to inspect media URL.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, url]);

  if (!isOpen) return null;

  async function handleDownload() {
    setDownloading(true);
    try {
      await onConfirmDownload({
        url: url.trim(),
        audioOnly,
        quality,
        container,
        subtitles,
        subLangs,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Download enqueue failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-container preview-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div className="modal-header-title">
            {data?.isPlaylist ? (
              <>
                <ListVideo size={18} className="text-accent" />
                <span>Playlist Details</span>
              </>
            ) : (
              <>
                <Tv size={18} className="text-accent" />
                <span>Media Details</span>
              </>
            )}
          </div>
          <button
            type="button"
            className="icon-btn-neutral modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {loading && (
            <div className="modal-loading-state">
              <Loader2 size={32} className="spin-icon" />
              <div className="modal-loading-text">
                <p className="loading-title">Inspecting media…</p>
                <p className="muted small">Fetching formats, playlist info, and highest quality</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="alert alert-error preview-error">
              <AlertCircle size={18} />
              <div>
                <strong>Failed to load media info:</strong>
                <div>{error}</div>
              </div>
            </div>
          )}

          {data && !loading && (
            <>
              {/* Media Banner / Overview */}
              <div className="preview-hero">
                {data.thumbnail ? (
                  <div className="preview-thumb-container">
                    <img
                      src={data.thumbnail}
                      alt={data.title}
                      className="preview-thumb-img"
                    />
                    {data.duration ? (
                      <span className="preview-duration-badge">
                        <Clock size={11} /> {formatDuration(data.duration)}
                      </span>
                    ) : null}
                    {data.isPlaylist ? (
                      <span className="preview-playlist-badge">
                        <ListVideo size={11} /> {data.videoCount} videos
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="preview-thumb-empty">
                    {data.isPlaylist ? <ListVideo size={36} /> : <Film size={36} />}
                  </div>
                )}

                <div className="preview-info-block">
                  <h3 className="preview-title" title={data.title}>
                    {data.title || 'Untitled'}
                  </h3>
                  {data.uploader && (
                    <div className="preview-uploader">{data.uploader}</div>
                  )}

                  <div className="preview-tags">
                    {data.viewCount != null && (
                      <span className="tag">{formatViews(data.viewCount)}</span>
                    )}
                    {data.extractor && (
                      <span className="tag text-capitalize">{data.extractor}</span>
                    )}
                  </div>

                  {!data.isPlaylist && data.highestQuality && (
                    <div className="preview-highest-quality-banner">
                      <Sparkles size={16} className="sparkle-icon" />
                      <div>
                        <span className="hq-label">Highest Quality Available:</span>{' '}
                        <strong className="hq-value">{data.highestQuality}</strong>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* If Playlist: Show video entries list */}
              {data.isPlaylist && data.entries && data.entries.length > 0 && (
                <div className="preview-playlist-section">
                  <div className="preview-playlist-header">
                    <h4>Videos in this playlist ({data.entries.length}{data.videoCount > data.entries.length ? ` of ${data.videoCount}` : ''})</h4>
                  </div>
                  <div className="preview-playlist-list">
                    {data.entries.map((item) => (
                      <div key={item.index} className="preview-playlist-item">
                        <span className="item-index">{item.index}</span>
                        {item.thumbnail ? (
                          <img
                            src={item.thumbnail}
                            alt=""
                            className="preview-item-thumb"
                          />
                        ) : (
                          <div className="preview-item-thumb empty" />
                        )}
                        <div className="item-info">
                          <div className="item-title" title={item.title}>
                            {item.title}
                          </div>
                          {item.duration ? (
                            <span className="item-duration muted small">
                              {formatDuration(item.duration)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Download Customization Settings */}
              <div className="preview-options-panel">
                <h4 className="preview-options-title">Download Options</h4>

                <div className="preview-options-grid">
                  <div className="segmented">
                    <button
                      type="button"
                      className={!audioOnly ? 'active' : ''}
                      onClick={() => setAudioOnly(false)}
                    >
                      <Film size={13} /> Video
                    </button>
                    <button
                      type="button"
                      className={audioOnly ? 'active' : ''}
                      onClick={() => setAudioOnly(true)}
                    >
                      <Music size={13} /> Audio only
                    </button>
                  </div>

                  {!audioOnly && (
                    <label className="field-inline">
                      Quality
                      <select
                        value={quality}
                        onChange={(e) => setQuality(e.target.value)}
                      >
                        <option value="">Best available ({data.highestQuality || 'Max'})</option>
                        {data.resolutions && data.resolutions.length > 0 ? (
                          data.resolutions.map((r) => (
                            <option key={r.height} value={String(r.height)}>
                              {r.label}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="2160">Up to 4K (2160p)</option>
                            <option value="1440">Up to 1440p</option>
                            <option value="1080">Up to 1080p</option>
                            <option value="720">Up to 720p</option>
                            <option value="480">Up to 480p</option>
                          </>
                        )}
                      </select>
                    </label>
                  )}

                  {!audioOnly && (
                    <label className="field-inline">
                      Container
                      <select
                        value={container}
                        onChange={(e) => setContainer(e.target.value)}
                      >
                        <option value="mp4">MP4</option>
                        <option value="mkv">MKV</option>
                      </select>
                    </label>
                  )}

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={subtitles}
                      onChange={(e) => setSubtitles(e.target.checked)}
                    />
                    <Captions size={14} /> Subtitles
                  </label>

                  {subtitles && (
                    <label className="field-inline">
                      <select
                        value={subLangs}
                        onChange={(e) => setSubLangs(e.target.value)}
                      >
                        {SUBTITLE_LANG_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={loading || downloading}
          >
            {downloading ? (
              <>
                <Loader2 size={15} className="spin-icon" /> Adding…
              </>
            ) : (
              <>
                <Download size={15} />
                {data?.isPlaylist
                  ? `Download Playlist (${data.videoCount || data.entries?.length || 0} videos)`
                  : 'Download Video'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}