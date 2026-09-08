import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Sparkles,
  Clock,
  Download,
  Loader2,
  AlertCircle,
  ListVideo,
  Film,
  Tv,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { api } from '../api.js';
import { useModalA11y } from '../hooks/useModalA11y.js';
import DownloadOptionsFields, { defaultDownloadOptions } from './DownloadOptionsFields.jsx';

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

function toResolutionOptions(data) {
  if (!data || !data.resolutions) return null;
  return data.resolutions;
}

/**
 * Analyzes one or more URLs (fetches yt-dlp metadata for each) before enqueueing downloads.
 * With a single URL this shows the rich single-video/playlist detail view. With multiple URLs
 * it shows a batch list, letting the user either apply one shared set of download options to
 * every video, or expand each video to customize its own options individually.
 *
 * `onConfirmDownload` receives an array of { urls, options } groups to enqueue — one group
 * per shared batch, or one group per video when customized individually.
 */
export default function MediaPreviewModal({
  isOpen,
  urls = [],
  onClose,
  onConfirmDownload,
  initialSettings = {},
}) {
  const isBatch = urls.length > 1;

  const [items, setItems] = useState([]);
  const [applySameToAll, setApplySameToAll] = useState(true);
  const [sharedSettings, setSharedSettings] = useState(() => defaultDownloadOptions(initialSettings));
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || urls.length === 0) {
      setItems([]);
      setError('');
      return undefined;
    }

    setError('');
    setDownloading(false);
    setApplySameToAll(true);
    setExpandedIndex(null);
    setSharedSettings(defaultDownloadOptions(initialSettings));

    let active = true;
    setItems(
      urls.map((url) => ({
        url,
        loading: true,
        error: '',
        data: null,
        settings: defaultDownloadOptions(initialSettings),
      }))
    );

    urls.forEach((url, idx) => {
      api
        .getInfo(url.trim())
        .then((res) => {
          if (!active) return;
          setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, loading: false, data: res } : it)));
        })
        .catch((err) => {
          if (!active) return;
          setItems((prev) => prev.map((it, i) => (
            i === idx ? { ...it, loading: false, error: err.message || 'Failed to inspect media URL.' } : it
          )));
        });
    });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, urls.join('\n')]);

  const containerRef = useModalA11y(isOpen, onClose);

  const allDone = useMemo(() => items.length > 0 && items.every((it) => !it.loading), [items]);
  const anyLoaded = useMemo(() => items.some((it) => it.data), [items]);

  if (!isOpen) return null;

  function updateItemSettings(index, next) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, settings: next } : it)));
  }

  async function handleDownload() {
    setError('');
    setDownloading(true);
    try {
      let groups;
      if (!isBatch) {
        groups = [{ urls: [items[0].url.trim()], options: sharedSettings }];
      } else if (applySameToAll) {
        groups = [{ urls: items.map((it) => it.url.trim()), options: sharedSettings }];
      } else {
        groups = items.map((it) => ({ urls: [it.url.trim()], options: it.settings }));
      }
      await onConfirmDownload(groups);
      onClose();
    } catch (err) {
      setError(err.message || 'Download enqueue failed');
    } finally {
      setDownloading(false);
    }
  }

  const single = !isBatch ? items[0] : null;

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
            {isBatch ? (
              <>
                <ListVideo size={18} className="text-accent" />
                <span>Analyze {items.length} videos</span>
              </>
            ) : single?.data?.isPlaylist ? (
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
          {!isBatch && single?.loading && (
            <div className="modal-loading-state">
              <Loader2 size={32} className="spin-icon" />
              <div className="modal-loading-text">
                <p className="loading-title">Inspecting media…</p>
                <p className="muted small">Fetching formats, playlist info, and highest quality</p>
              </div>
            </div>
          )}

          {!isBatch && single?.error && !single?.loading && (
            <div className="alert alert-error preview-error">
              <AlertCircle size={18} />
              <div>
                <strong>Failed to load media info:</strong>
                <div>{single.error}</div>
              </div>
            </div>
          )}

          {!isBatch && single?.data && !single?.loading && (
            <SingleVideoDetails data={single.data} />
          )}

          {isBatch && (
            <>
              {!allDone && (
                <div className="modal-loading-state">
                  <Loader2 size={28} className="spin-icon" />
                  <p className="muted small">Analyzing {items.length} videos…</p>
                </div>
              )}

              {anyLoaded && (
                <div className="batch-toggle-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={applySameToAll}
                      onChange={(e) => setApplySameToAll(e.target.checked)}
                    />
                    Apply the same options to all videos
                  </label>
                </div>
              )}

              <div className="batch-video-list">
                {items.map((it, idx) => (
                  <div className="batch-video-card" key={`${it.url}-${idx}`}>
                    <button
                      type="button"
                      className="batch-video-card-header"
                      onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
                      aria-expanded={expandedIndex === idx}
                    >
                      {expandedIndex === idx ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {it.data?.thumbnail ? (
                        <img src={it.data.thumbnail} alt="" className="batch-video-thumb" />
                      ) : (
                        <div className="batch-video-thumb" />
                      )}
                      <div className="batch-video-info">
                        <div className="batch-video-title">
                          {it.loading ? 'Loading…' : it.error ? it.url : (it.data?.title || it.url)}
                        </div>
                        <div className="batch-video-meta">
                          {it.error ? (
                            <span className="text-danger">{it.error}</span>
                          ) : it.data ? (
                            [
                              it.data.isPlaylist ? `${it.data.videoCount || it.data.entries?.length || 0} videos` : null,
                              it.data.duration ? formatDuration(it.data.duration) : null,
                              it.data.highestQuality,
                            ].filter(Boolean).join(' · ')
                          ) : null}
                        </div>
                      </div>
                    </button>

                    {expandedIndex === idx && !applySameToAll && (
                      <div className="batch-video-options">
                        <DownloadOptionsFields
                          values={it.settings}
                          onChange={(next) => updateItemSettings(idx, next)}
                          resolutions={toResolutionOptions(it.data)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {(isBatch ? applySameToAll : !!single?.data) && (
            <div className="preview-options-panel">
              <h4 className="preview-options-title">Download Options</h4>
              <DownloadOptionsFields
                values={sharedSettings}
                onChange={setSharedSettings}
                resolutions={!isBatch ? toResolutionOptions(single?.data) : null}
              />
            </div>
          )}

          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={(!isBatch && single?.loading) || downloading || items.length === 0}
          >
            {downloading ? (
              <>
                <Loader2 size={15} className="spin-icon" /> Adding…
              </>
            ) : (
              <>
                <Download size={15} />
                {isBatch
                  ? `Download ${items.length} videos`
                  : single?.data?.isPlaylist
                    ? `Download Playlist (${single.data.videoCount || single.data.entries?.length || 0} videos)`
                    : 'Download Video'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function SingleVideoDetails({ data }) {
  return (
    <>
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
    </>
  );
}
