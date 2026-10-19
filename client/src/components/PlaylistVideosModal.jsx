import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, ListVideo, Film, Loader2, AlertCircle, Download, Trash2, RefreshCw, RotateCcw,
} from 'lucide-react';
import { api } from '../api.js';
import { useModalA11y } from '../hooks/useModalA11y.js';
import { useDownloads } from '../context/DownloadsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatDuration } from '../format.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'downloaded', label: 'Downloaded' },
  { key: 'missing', label: 'Not downloaded' },
  { key: 'active', label: 'In progress' },
];

const STATE_LABELS = {
  downloaded: 'Downloaded',
  queued: 'Queued',
  downloading: 'Downloading',
  failed: 'Failed',
  deleted: 'Deleted',
  missing: 'File missing',
  not_downloaded: 'Not downloaded',
};

// The badge colors the Activity view already uses for the same states.
const STATE_CLASSES = {
  downloaded: 'state-completed',
  queued: 'state-queued',
  downloading: 'state-downloading',
  failed: 'state-failed',
  deleted: 'state-baseline',
  missing: 'state-pending',
  not_downloaded: 'state-baseline',
};

const DOWNLOADABLE = new Set(['not_downloaded', 'failed', 'deleted', 'missing']);

function matchesFilter(video, filter) {
  if (filter === 'downloaded') return video.state === 'downloaded';
  if (filter === 'missing') return DOWNLOADABLE.has(video.state);
  if (filter === 'active') return video.state === 'queued' || video.state === 'downloading';
  return true;
}

// The listing is a snapshot from when it loaded; a job the queue is reporting on over the
// socket is the fresher answer for videos queued or downloading since.
function withLiveJob(video, jobsById) {
  const job = video.downloadId ? jobsById.get(video.downloadId) : null;
  if (!job) return video;
  if (job.status === 'queued' || job.status === 'downloading') return { ...video, state: job.status, percent: job.percent };
  if (job.status === 'completed') return { ...video, state: 'downloaded', filepath: job.filepath || video.filepath };
  if (job.status === 'failed') return { ...video, state: 'failed', error: job.error || video.error };
  if (job.status === 'deleted') return { ...video, state: 'deleted' };
  return video;
}

export default function PlaylistVideosModal({ open, onClose, watch, onChanged }) {
  const { jobs } = useDownloads();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(new Set());
  const [pendingDelete, setPendingDelete] = useState(null);
  // The delete confirmation handles Escape and focus while it's open.
  const containerRef = useModalA11y(open && !pendingDelete, onClose);
  const watchId = watch && watch.id;

  const load = useCallback(() => {
    if (!watchId) return Promise.resolve();
    setLoading(true);
    setError('');
    return api.getWatchPlaylist(watchId)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [watchId]);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setFilter('all');
    load();
  }, [open, load]);

  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const videos = useMemo(() => (data?.videos || []).map((v) => withLiveJob(v, jobsById)), [data, jobsById]);
  const shown = videos.filter((v) => matchesFilter(v, filter));
  const downloadedCount = videos.filter((v) => v.state === 'downloaded').length;
  const downloadable = videos.filter((v) => DOWNLOADABLE.has(v.state));

  function setVideoBusy(ids, on) {
    setBusy((prev) => {
      const next = new Set(prev);
      for (const id of ids) (on ? next.add(id) : next.delete(id));
      return next;
    });
  }

  async function download(ids) {
    setVideoBusy(ids, true);
    try {
      const result = await api.downloadWatchPlaylistVideos(watchId, ids);
      const byVideo = new Map(result.queued.map((q) => [q.videoId, q.downloadId]));
      setData((prev) => prev && {
        ...prev,
        videos: prev.videos.map((v) => (byVideo.has(v.id) ? { ...v, state: 'queued', downloadId: byVideo.get(v.id), error: null } : v)),
      });
      toast(result.queued.length
        ? `Queued ${result.queued.length} video${result.queued.length === 1 ? '' : 's'}`
        : 'Those videos are already downloaded or on their way');
      if (onChanged) onChanged();
    } catch (err) {
      toast(err.message || 'Could not queue the download', { error: true });
    } finally {
      setVideoBusy(ids, false);
    }
  }

  async function confirmDelete() {
    const video = pendingDelete;
    setPendingDelete(null);
    if (!video) return;
    setVideoBusy([video.id], true);
    try {
      await api.deleteLibraryFile(video.downloadId);
      setData((prev) => prev && {
        ...prev,
        videos: prev.videos.map((v) => (v.id === video.id ? { ...v, state: 'deleted', filepath: null } : v)),
      });
      toast(`Deleted "${video.title || video.id}"`);
      if (onChanged) onChanged();
    } catch (err) {
      toast(err.message || 'Could not delete the file', { error: true });
    } finally {
      setVideoBusy([video.id], false);
    }
  }

  if (!open || !watch) return null;

  // The confirm dialog sits outside this modal's backdrop, so a click on its own backdrop
  // doesn't also close the playlist.
  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          ref={containerRef}
          className="modal-container preview-modal watch-activity-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div className="modal-header">
            <div className="modal-header-title">
              <ListVideo size={18} className="text-accent" />
              <span>{data?.title || watch.name || 'Playlist'}</span>
            </div>
            <button type="button" className="icon-btn-neutral" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div className="modal-body">
            <div className="watch-activity-tab">
              <div className="playlist-videos-toolbar">
                <span className="muted small">
                  {data ? `${downloadedCount} of ${videos.length} downloaded` : 'Listing the playlist…'}
                </span>
                <div className="playlist-videos-actions">
                  <button type="button" className="btn-secondary btn-sm" onClick={load} disabled={loading} title="List the playlist again">
                    <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
                    <span>Refresh</span>
                  </button>
                  <button
                    type="button"
                    className="btn-sm"
                    disabled={loading || downloadable.length === 0}
                    onClick={() => download(downloadable.map((v) => v.id))}
                  >
                    <Download size={13} />
                    <span>Download {downloadable.length ? `all missing (${downloadable.length})` : 'all missing'}</span>
                  </button>
                </div>
              </div>

              <div className="watch-activity-filters" role="group" aria-label="Filter videos">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={filter === f.key ? 'btn-sm' : 'btn-secondary btn-sm'}
                    onClick={() => setFilter(f.key)}
                    aria-pressed={filter === f.key}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {error && (
                <div className="alert alert-error">
                  <AlertCircle size={15} />
                  <span>{error}</span>
                </div>
              )}
              {data?.truncated && (
                <div className="watch-activity-warning small">Only the first {videos.length} videos of this playlist are listed.</div>
              )}

              {loading && !data ? (
                <div className="empty-state">
                  <Loader2 size={24} className="spin-icon text-accent" />
                  <span className="empty-subtitle">Listing the playlist from YouTube…</span>
                </div>
              ) : data && shown.length === 0 ? (
                <div className="empty-state">
                  <Film size={32} />
                  <span className="empty-title">No videos here</span>
                </div>
              ) : (
                <ul className="watch-activity-list">
                  {shown.map((v) => {
                    const isBusy = busy.has(v.id);
                    const label = v.state === 'downloading' && v.percent ? `Downloading ${Math.round(v.percent)}%` : STATE_LABELS[v.state];
                    return (
                      <li key={v.id} className="watch-activity-item">
                        {v.thumbnail ? (
                          <img className="thumb-sm" src={v.thumbnail} alt="" loading="lazy" />
                        ) : (
                          <div className="thumb-sm thumb-empty watch-activity-thumb-empty"><Film size={12} /></div>
                        )}
                        <div className="watch-activity-body">
                          <a className="watch-activity-title" href={v.url} target="_blank" rel="noopener noreferrer" title={v.title || v.id}>
                            {v.index}. {v.title || v.id}
                          </a>
                          <div className="watch-activity-meta muted small">
                            <span className={`tag watch-state-badge ${STATE_CLASSES[v.state]}`}>{label}</span>
                            {v.duration ? <span>{formatDuration(v.duration)}</span> : null}
                          </div>
                          {v.state === 'failed' && v.error && <div className="watch-activity-error small">{v.error}</div>}
                        </div>
                        {v.state === 'downloaded' && v.downloadId ? (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => setPendingDelete(v)}
                            disabled={isBusy}
                            title="Delete the downloaded file"
                          >
                            <Trash2 size={13} />
                            <span>Delete</span>
                          </button>
                        ) : DOWNLOADABLE.has(v.state) ? (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => download([v.id])}
                            disabled={isBusy}
                            title="Download this video with the watch's settings"
                          >
                            {v.state === 'failed' ? <RotateCcw size={13} /> : <Download size={13} className={isBusy ? 'spin-icon' : ''} />}
                            <span>{v.state === 'failed' ? 'Retry' : 'Download'}</span>
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete video"
        message={`Delete "${pendingDelete?.title || pendingDelete?.id}" from disk? The watch won't download it again on its own; you can download it again here.`}
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
