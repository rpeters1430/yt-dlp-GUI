import React, { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Radar,
  RefreshCw,
  X,
  AlertCircle,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Film,
  Music,
  ExternalLink,
  Edit3,
  RotateCcw,
  Download,
  Eye,
  ShieldCheck,
  Filter,
  Play,
  Pause,
  Sparkles,
  Shield,
  ShieldOff,
} from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import WatchModal from '../components/WatchModal.jsx';
import WatchDownloadsModal from '../components/WatchDownloadsModal.jsx';

function timeAgo(dateStr) {
  if (!dateStr) return 'Never checked';
  const past = new Date(dateStr + 'Z').getTime();
  const diffSec = Math.floor((Date.now() - past) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export default function Watches() {
  const [watches, setWatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'paused' | 'error'

  const [busyId, setBusyId] = useState(null);
  const [checkingAll, setCheckingAll] = useState(false);

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [editingWatch, setEditingWatch] = useState(null);
  const [downloadsWatch, setDownloadsWatch] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { id, label }
  const [pendingReset, setPendingReset] = useState(null); // { id, label }

  function refresh() {
    api.listWatches()
      .then(setWatches)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();

    // Socket.IO for real-time updates from scheduler
    const socket = io({ withCredentials: true });
    socket.on('watch:update', (updated) => {
      setWatches((prev) => {
        const idx = prev.findIndex((w) => w.id === updated.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...updated };
          return next;
        }
        return [updated, ...prev];
      });
    });

    return () => socket.disconnect();
  }, []);

  // Polling fallback while any watch is actively checking
  useEffect(() => {
    const hasChecking = watches.some((w) => w.last_status === 'checking' || busyId === w.id);
    if (!hasChecking) return;
    const interval = setInterval(refresh, 2500);
    return () => clearInterval(interval);
  }, [watches, busyId]);

  async function handleToggle(watch) {
    try {
      const updated = await api.toggleWatch(watch.id);
      setWatches((prev) => prev.map((w) => (w.id === watch.id ? updated : w)));
    } catch (err) {
      console.error('Failed to toggle watch:', err);
    }
  }

  async function handleToggleCleanupExempt(watch) {
    try {
      const updated = await api.toggleWatchCleanupExempt(watch.id);
      setWatches((prev) => prev.map((w) => (w.id === watch.id ? updated : w)));
    } catch (err) {
      console.error('Failed to toggle cleanup exemption:', err);
    }
  }

  async function handleCheckNow(watch) {
    setBusyId(watch.id);
    try {
      await api.checkWatch(watch.id);
      refresh();
    } catch (err) {
      console.error('Failed to check watch:', err);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCheckAll() {
    setCheckingAll(true);
    try {
      await api.checkAllWatches();
      refresh();
    } catch (err) {
      console.error('Failed to trigger check all:', err);
    } finally {
      setTimeout(() => setCheckingAll(false), 1200);
    }
  }

  async function handleSaveWatch(payload) {
    if (editingWatch) {
      const updated = await api.updateWatch(editingWatch.id, payload);
      setWatches((prev) => prev.map((w) => (w.id === editingWatch.id ? updated : w)));
    } else {
      const created = await api.addWatch(payload);
      setWatches((prev) => [created, ...prev]);
    }
  }

  async function confirmDelete() {
    const { id } = pendingDelete;
    setPendingDelete(null);
    await api.deleteWatch(id);
    setWatches((prev) => prev.filter((w) => w.id !== id));
  }

  async function confirmReset() {
    const { id } = pendingReset;
    setPendingReset(null);
    const updated = await api.resetWatchSeen(id);
    setWatches((prev) => prev.map((w) => (w.id === id ? updated : w)));
  }

  // Statistics
  const stats = useMemo(() => {
    const total = watches.length;
    const active = watches.filter((w) => w.enabled !== 0).length;
    const paused = total - active;
    const errors = watches.filter((w) => w.last_status === 'error').length;
    const totalSeen = watches.reduce((acc, w) => acc + (w.seen_count || 0), 0);
    const totalDownloads = watches.reduce((acc, w) => acc + (w.download_count || 0), 0);
    return { total, active, paused, errors, totalSeen, totalDownloads };
  }, [watches]);

  // Filtered Watches
  const filteredWatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return watches.filter((w) => {
      // Status filter
      if (statusFilter === 'active' && w.enabled === 0) return false;
      if (statusFilter === 'paused' && w.enabled !== 0) return false;
      if (statusFilter === 'error' && w.last_status !== 'error') return false;

      // Text search
      if (!q) return true;
      return (
        (w.name || '').toLowerCase().includes(q) ||
        (w.channel_name || '').toLowerCase().includes(q) ||
        (w.url || '').toLowerCase().includes(q)
      );
    });
  }, [watches, query, statusFilter]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>YouTube Channel &amp; Playlist Watches</h1>
          <p>Auto-monitor channels and playlists for new video uploads with customizable quality, filters, and sponsor skips.</p>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="watch-stats-grid">
        <div className="watch-stat-card">
          <div className="watch-stat-icon primary">
            <Radar size={22} />
          </div>
          <div className="watch-stat-info">
            <span className="watch-stat-label">Watched Sources</span>
            <span className="watch-stat-value">{stats.total}</span>
            <span className="watch-stat-sub">
              {stats.active} active · {stats.paused} paused
            </span>
          </div>
        </div>

        <div className="watch-stat-card">
          <div className="watch-stat-icon info">
            <Eye size={22} />
          </div>
          <div className="watch-stat-info">
            <span className="watch-stat-label">Catalog Scanned</span>
            <span className="watch-stat-value">{stats.totalSeen.toLocaleString()}</span>
            <span className="watch-stat-sub">Tracked video entries</span>
          </div>
        </div>

        <div className="watch-stat-card">
          <div className="watch-stat-icon success">
            <Download size={22} />
          </div>
          <div className="watch-stat-info">
            <span className="watch-stat-label">Auto-Downloaded</span>
            <span className="watch-stat-value">{stats.totalDownloads.toLocaleString()}</span>
            <span className="watch-stat-sub">Videos delivered to library</span>
          </div>
        </div>

        <div className="watch-stat-card">
          <div className={`watch-stat-icon ${stats.errors > 0 ? 'warning' : 'primary'}`}>
            <Clock size={22} />
          </div>
          <div className="watch-stat-info">
            <span className="watch-stat-label">Scheduler Status</span>
            <span className="watch-stat-value" style={{ fontSize: 18, paddingTop: 3 }}>
              {stats.errors > 0 ? `${stats.errors} Attention` : 'Running Healthy'}
            </span>
            <span className="watch-stat-sub">Evaluates every 5 mins</span>
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="watch-toolbar">
        <div className="watch-toolbar-left">
          <div className="watch-search-input">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search watches by channel, title, or URL…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="segmented">
            <button
              type="button"
              className={statusFilter === 'all' ? 'active' : ''}
              onClick={() => setStatusFilter('all')}
            >
              All ({stats.total})
            </button>
            <button
              type="button"
              className={statusFilter === 'active' ? 'active' : ''}
              onClick={() => setStatusFilter('active')}
            >
              Active ({stats.active})
            </button>
            <button
              type="button"
              className={statusFilter === 'paused' ? 'active' : ''}
              onClick={() => setStatusFilter('paused')}
            >
              Paused ({stats.paused})
            </button>
            {stats.errors > 0 && (
              <button
                type="button"
                className={statusFilter === 'error' ? 'active' : ''}
                onClick={() => setStatusFilter('error')}
              >
                Errors ({stats.errors})
              </button>
            )}
          </div>
        </div>

        <div className="watch-toolbar-right">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleCheckAll}
            disabled={checkingAll || watches.length === 0}
            title="Force run check on all active watches"
          >
            <RefreshCw size={14} className={checkingAll ? 'spin-icon' : ''} />
            <span>{checkingAll ? 'Checking all…' : 'Check All Active'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingWatch(null);
              setModalOpen(true);
            }}
          >
            <Plus size={16} />
            <span>Add YouTube Watch</span>
          </button>
        </div>
      </div>

      {/* Watches List */}
      {loading ? (
        <div className="watch-list" aria-busy="true" aria-label="Loading watched sources">
          {[0, 1, 2].map((i) => (
            <div key={i} className="watch-card watch-card-skeleton">
              <div className="watch-card-header">
                <div className="watch-card-main">
                  <div className="skeleton-block skeleton-avatar" />
                  <div className="skeleton-title-group">
                    <div className="skeleton-block skeleton-line" style={{ width: '45%' }} />
                    <div className="skeleton-block skeleton-line" style={{ width: '70%' }} />
                  </div>
                </div>
              </div>
              <div className="skeleton-block skeleton-line" style={{ width: '30%' }} />
            </div>
          ))}
        </div>
      ) : filteredWatches.length === 0 ? (
        <div className="panel empty-state">
          <Radar size={36} />
          <span className="empty-title">
            {watches.length === 0 ? 'No YouTube watches configured' : 'No matching watches found'}
          </span>
          <span className="empty-subtitle">
            {watches.length === 0
              ? 'Add your favorite YouTube channels or playlists to automatically download new uploads as soon as they drop.'
              : 'Try clearing your search query or switching your status filter.'}
          </span>
          {watches.length === 0 && (
            <button
              type="button"
              style={{ marginTop: 12 }}
              onClick={() => {
                setEditingWatch(null);
                setModalOpen(true);
              }}
            >
              <Plus size={15} /> Add your first watch
            </button>
          )}
        </div>
      ) : (
        <div className="watch-list">
          {filteredWatches.map((w) => {
            const isChecking = busyId === w.id || w.last_status === 'checking';
            const isPaused = w.enabled === 0;
            const isError = w.last_status === 'error';

            return (
              <div key={w.id} className={`watch-card ${isPaused ? 'paused' : ''}`}>
                <div className="watch-card-header">
                  <div className="watch-card-main">
                    <div className="watch-avatar">
                      {w.thumbnail ? (
                        <img src={w.thumbnail} alt="" />
                      ) : (
                        <Radar size={22} />
                      )}
                    </div>

                    <div className="watch-title-group">
                      <div className="watch-title-row">
                        <h3 className="watch-title">{w.name || w.channel_name || 'YouTube Watch'}</h3>
                        {w.channel_name && w.name !== w.channel_name && (
                          <span className="tag">{w.channel_name}</span>
                        )}
                        <a
                          href={w.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="watch-channel-link"
                          title="Open on YouTube"
                        >
                          YouTube <ExternalLink size={11} />
                        </a>
                      </div>
                      <div className="watch-url" title={w.url}>
                        {w.url}
                      </div>
                    </div>
                  </div>

                  <div className="watch-status-group">
                    {isChecking ? (
                      <span className="tag" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                        <RefreshCw size={11} className="spin-icon" /> Checking…
                      </span>
                    ) : isError ? (
                      <span className="tag status-tag status-failed">
                        <AlertCircle size={11} /> Error
                      </span>
                    ) : isPaused ? (
                      <span className="tag" style={{ background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' }}>
                        Paused
                      </span>
                    ) : (
                      <span className="tag status-tag status-completed">
                        <span className="pulse-dot" /> Active
                      </span>
                    )}

                    {/* Quick Pause / Resume Switch */}
                    <button
                      type="button"
                      className={`theme-toggle-switch ${!isPaused ? 'active' : ''}`}
                      onClick={() => handleToggle(w)}
                      title={isPaused ? 'Resume watch' : 'Pause watch'}
                      style={{ height: 26, width: 48, padding: 3 }}
                    >
                      <div
                        className="toggle-thumb"
                        style={{
                          width: 20,
                          height: 20,
                          transform: !isPaused ? 'translateX(22px)' : 'translateX(0)',
                        }}
                      >
                        {!isPaused ? (
                          <Play size={10} style={{ color: 'var(--accent)' }} />
                        ) : (
                          <Pause size={10} style={{ color: 'var(--text-tertiary)' }} />
                        )}
                      </div>
                    </button>
                  </div>
                </div>

                {/* Configuration Chips */}
                <div className="watch-chips-row">
                  <span className="watch-chip">
                    <Clock size={11} /> Every {w.check_interval_mins || 30}m
                  </span>

                  <span className="watch-chip accent">
                    {w.audio_only ? <Music size={11} /> : <Film size={11} />}
                    {w.audio_only
                      ? `Audio Only (${(w.container || 'mp3').toUpperCase()})`
                      : `${w.quality ? `${w.quality}p` : 'Best Quality'} ${(w.container || 'mp4').toUpperCase()}`}
                  </span>

                  {w.subtitles ? (
                    <span className="watch-chip">
                      Captions ({w.sub_langs || 'en.*'})
                    </span>
                  ) : null}

                  {w.sponsorblock ? (
                    <span className="watch-chip">
                      <Sparkles size={11} /> SponsorBlock
                    </span>
                  ) : null}

                  {w.embed_thumbnail || w.embed_metadata || w.embed_chapters ? (
                    <span className="watch-chip">
                      Embedded Tags
                    </span>
                  ) : null}

                  {w.match_title ? (
                    <span className="watch-chip filter" title={`Must match: ${w.match_title}`}>
                      <Filter size={11} /> Match: "{w.match_title}"
                    </span>
                  ) : null}

                  {w.reject_title ? (
                    <span className="watch-chip filter" title={`Excludes: ${w.reject_title}`}>
                      Exclude: "{w.reject_title}"
                    </span>
                  ) : null}

                  {w.min_duration ? (
                    <span className="watch-chip filter">
                      &gt; {w.min_duration}s
                    </span>
                  ) : null}

                  {w.cleanup_exempt ? (
                    <span className="watch-chip filter" title="This watch's downloads are never auto-deleted">
                      <Shield size={11} /> Auto-delete exempt
                    </span>
                  ) : null}
                </div>

                {/* Error Banner if last check failed */}
                {isError && w.last_error && (
                  <div className="alert alert-error" style={{ margin: 0, padding: '8px 12px', fontSize: 12.5 }}>
                    <AlertCircle size={14} />
                    <span>Last check error: {w.last_error}</span>
                  </div>
                )}

                {/* Meta Row & Action Buttons */}
                <div className="watch-meta-row">
                  <div className="watch-metrics-list">
                    <div className="watch-metric-item">
                      <Eye size={13} className="text-muted" />
                      <span><strong>{w.seen_count || 0}</strong> seen</span>
                    </div>

                    <div
                      className="watch-metric-item clickable"
                      onClick={() => setDownloadsWatch(w)}
                      title="View videos downloaded by this watch"
                    >
                      <Download size={13} />
                      <span><strong>{w.download_count || 0}</strong> downloaded</span>
                    </div>

                    <div className="watch-metric-item">
                      <Clock size={13} className="text-muted" />
                      <span>Last check: {timeAgo(w.last_checked_at)}</span>
                      {w.last_new_count > 0 && (
                        <span className="tag" style={{ background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e', fontSize: 11, padding: '1px 6px' }}>
                          +{w.last_new_count} new
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="watch-actions">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handleCheckNow(w)}
                      disabled={isChecking}
                      title="Check for new uploads right now"
                    >
                      <RefreshCw size={13} className={isChecking ? 'spin-icon' : ''} />
                      <span>{isChecking ? 'Checking…' : 'Check now'}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setDownloadsWatch(w)}
                      title="View downloads history"
                    >
                      <Download size={13} />
                      <span>Downloads</span>
                    </button>

                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => {
                        setEditingWatch(w);
                        setModalOpen(true);
                      }}
                      title="Edit watch settings"
                    >
                      <Edit3 size={14} />
                    </button>

                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleToggleCleanupExempt(w)}
                      title={w.cleanup_exempt ? 'Allow auto-delete for this watch again' : 'Exclude this watch from auto-delete'}
                    >
                      {w.cleanup_exempt ? <Shield size={14} /> : <ShieldOff size={14} />}
                    </button>

                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setPendingReset({ id: w.id, label: w.name || w.channel_name || w.url })}
                      title="Reset seen history (allows re-scanning back catalog)"
                    >
                      <RotateCcw size={14} />
                    </button>

                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setPendingDelete({ id: w.id, label: w.name || w.channel_name || w.url })}
                      title="Delete watch"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Watch Modal */}
      <WatchModal
        open={modalOpen}
        watch={editingWatch}
        onClose={() => {
          setModalOpen(false);
          setEditingWatch(null);
        }}
        onSave={handleSaveWatch}
      />

      {/* View Downloads Modal */}
      <WatchDownloadsModal
        open={!!downloadsWatch}
        watch={downloadsWatch}
        onClose={() => setDownloadsWatch(null)}
      />

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove YouTube Watch"
        message={`Are you sure you want to remove "${pendingDelete?.label}"? Any videos already downloaded will remain in your library.`}
        confirmLabel="Remove Watch"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      {/* Confirm Reset Seen Dialog */}
      <ConfirmDialog
        open={!!pendingReset}
        title="Reset Watched Seen History"
        message={`Reset seen history for "${pendingReset?.label}"? This clears the list of tracked video IDs and re-arms the watch. Already downloaded video files will not be deleted.`}
        confirmLabel="Reset History"
        danger={false}
        onCancel={() => setPendingReset(null)}
        onConfirm={confirmReset}
      />
    </>
  );
}

