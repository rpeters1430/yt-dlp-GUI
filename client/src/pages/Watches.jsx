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
  ListMusic,
  Activity,
  AlertTriangle,
  Hourglass,
} from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import WatchModal from '../components/WatchModal.jsx';
import WatchActivityModal from '../components/WatchActivityModal.jsx';

const TAB_LABELS = { videos: 'Videos', shorts: 'Shorts', streams: 'Streams' };

// The card badge describes the latest check: an initial baseline is never "new".
function runBadge(w) {
  if (!w.latest_run_status || w.latest_run_status === 'running') return null;
  if (w.latest_run_status === 'partial') return { label: 'Partial scan', kind: 'warning' };
  if (w.latest_run_status === 'failed') return { label: 'Check failed', kind: 'failed' };
  if (w.latest_run_trigger === 'initial') {
    const backfill = w.latest_backfill_count > 0 ? ` / ${w.latest_backfill_count} backfill` : '';
    if (w.latest_baseline_count > 0 || backfill) return { label: `${w.latest_baseline_count} baseline${backfill}`, kind: 'neutral' };
  }
  if (w.latest_new_count > 0) return { label: `${w.latest_new_count} new / ${w.latest_queued_count} queued`, kind: 'new' };
  if (w.latest_queued_count > 0) return { label: `${w.latest_queued_count} queued`, kind: 'new' };
  return { label: 'No new videos', kind: 'neutral' };
}

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
  const [jellyfinSyncBusyId, setJellyfinSyncBusyId] = useState(null);
  const [jellyfinSyncMsg, setJellyfinSyncMsg] = useState({}); // watchId -> { text, isError }
  const [plexConfigured, setPlexConfigured] = useState(false);
  const [plexSyncBusyId, setPlexSyncBusyId] = useState(null);

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [editingWatch, setEditingWatch] = useState(null);
  const [activityWatch, setActivityWatch] = useState(null); // { watch, tab }
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

  useEffect(() => {
    api.getPlexSettings().then((s) => setPlexConfigured(!!(s.url && s.tokenConfigured))).catch(() => {});
  }, []);

  // Shares the per-watch message slot with the Jellyfin button; only one runs at a time.
  async function handleSyncPlex(watch) {
    setPlexSyncBusyId(watch.id);
    setJellyfinSyncMsg((prev) => ({ ...prev, [watch.id]: null }));
    try {
      const result = await api.syncWatchPlex(watch.id);
      const text = result.added > 0
        ? `Added ${result.added} item(s) to "${result.playlistName}" in Plex.`
        : result.missingFromLibrary > 0
          ? `Playlist up to date — ${result.missingFromLibrary} item(s) not yet scanned by Plex.`
          : 'Plex playlist already up to date.';
      setJellyfinSyncMsg((prev) => ({ ...prev, [watch.id]: { text, isError: false } }));
    } catch (err) {
      setJellyfinSyncMsg((prev) => ({ ...prev, [watch.id]: { text: err.message, isError: true } }));
    } finally {
      setPlexSyncBusyId(null);
      setTimeout(() => setJellyfinSyncMsg((prev) => ({ ...prev, [watch.id]: null })), 7000);
    }
  }

  async function handleSyncJellyfin(watch) {
    setJellyfinSyncBusyId(watch.id);
    setJellyfinSyncMsg((prev) => ({ ...prev, [watch.id]: null }));
    try {
      const result = await api.syncWatchJellyfin(watch.id);
      const text = result.added > 0
        ? `Added ${result.added} video(s) to "${result.playlistName}" in Jellyfin.`
        : result.missingFromLibrary > 0
          ? `Playlist up to date — ${result.missingFromLibrary} video(s) not yet scanned by Jellyfin.`
          : 'Playlist already up to date.';
      setJellyfinSyncMsg((prev) => ({ ...prev, [watch.id]: { text, isError: false } }));
    } catch (err) {
      setJellyfinSyncMsg((prev) => ({ ...prev, [watch.id]: { text: err.message, isError: true } }));
    } finally {
      setJellyfinSyncBusyId(null);
      setTimeout(() => setJellyfinSyncMsg((prev) => ({ ...prev, [watch.id]: null })), 7000);
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
    const sum = (key) => watches.reduce((acc, w) => acc + (w[key] || 0), 0);
    return {
      total,
      active,
      paused,
      errors,
      cataloged: sum('cataloged_count'),
      pending: sum('pending_count'),
      queued: sum('queued_count'),
      completed: sum('completed_count'),
      failed: sum('failed_count'),
    };
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
            <span className="watch-stat-label">Cataloged</span>
            <span className="watch-stat-value">{stats.cataloged.toLocaleString()}</span>
            <span className="watch-stat-sub">{stats.pending} pending · {stats.queued} queued</span>
          </div>
        </div>

        <div className="watch-stat-card">
          <div className="watch-stat-icon success">
            <Download size={22} />
          </div>
          <div className="watch-stat-info">
            <span className="watch-stat-label">Completed</span>
            <span className="watch-stat-value">{stats.completed.toLocaleString()}</span>
            <span className="watch-stat-sub">{stats.failed > 0 ? `${stats.failed} failed` : 'Videos delivered to library'}</span>
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
            const badge = runBadge(w);
            const openActivity = (tab = 'items') => setActivityWatch({ watch: w, tab });

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

                  {w.content_types ? (
                    <span className="watch-chip" title="Channel tabs this watch follows">
                      {w.content_types.split(',').map((t) => TAB_LABELS[t] || t).join(' + ')}
                    </span>
                  ) : null}

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
                  <div className="alert alert-error watch-card-alert">
                    <AlertCircle size={14} />
                    <span>Last check error: {w.last_error}</span>
                    <span className="watch-card-alert-actions">
                      <button type="button" className="link-btn" onClick={() => handleCheckNow(w)} disabled={isChecking}>Retry check</button>
                      <button type="button" className="link-btn" onClick={() => { setEditingWatch(w); setModalOpen(true); }}>Edit filters</button>
                      <button type="button" className="link-btn" onClick={() => openActivity('runs')}>View runs</button>
                    </span>
                  </div>
                )}

                {!isError && !isChecking && w.latest_run_status === 'partial' && (
                  <div className="alert alert-warning watch-card-alert">
                    <AlertTriangle size={14} />
                    <span>
                      The last check scanned {w.latest_scanned_count} videos without reaching ones it already knew, so some
                      uploads may have been missed. Everything it found is kept.
                    </span>
                    <span className="watch-card-alert-actions">
                      <button type="button" className="link-btn" onClick={() => handleCheckNow(w)}>Check again</button>
                      <button type="button" className="link-btn" onClick={() => openActivity('runs')}>View runs</button>
                    </span>
                  </div>
                )}

                {w.failed_count > 0 && (
                  <div className="alert alert-error watch-card-alert">
                    <AlertCircle size={14} />
                    <span>{w.failed_count} download{w.failed_count === 1 ? '' : 's'} failed.</span>
                    <span className="watch-card-alert-actions">
                      <button type="button" className="link-btn" onClick={() => openActivity('items')}>Review and retry</button>
                    </span>
                  </div>
                )}

                {/* Meta Row & Action Buttons */}
                <div className="watch-meta-row">
                  <div className="watch-metrics-list">
                    <button type="button" className="watch-metric-item clickable" onClick={() => openActivity('items')} title="Every video this watch has discovered">
                      <Eye size={13} className="text-muted" />
                      <span><strong>{w.cataloged_count || 0}</strong> cataloged</span>
                    </button>
                    <button type="button" className="watch-metric-item clickable" onClick={() => openActivity('items')} title="Matching videos waiting for the next check to queue them">
                      <Hourglass size={13} className="text-muted" />
                      <span><strong>{w.pending_count || 0}</strong> pending</span>
                    </button>
                    <button type="button" className="watch-metric-item clickable" onClick={() => openActivity('items')} title="Queued or downloading now">
                      <Download size={13} className="text-muted" />
                      <span><strong>{w.queued_count || 0}</strong> queued</span>
                    </button>
                    <button type="button" className="watch-metric-item clickable" onClick={() => openActivity('downloads')} title="Downloaded successfully">
                      <CheckCircle2 size={13} />
                      <span><strong>{w.completed_count || 0}</strong> completed</span>
                    </button>
                    {w.failed_count > 0 && (
                      <button type="button" className="watch-metric-item clickable metric-failed" onClick={() => openActivity('items')} title="Failed downloads">
                        <AlertCircle size={13} />
                        <span><strong>{w.failed_count}</strong> failed</span>
                      </button>
                    )}

                    <div className="watch-metric-item">
                      <Clock size={13} className="text-muted" />
                      <span>Last check: {timeAgo(w.last_checked_at)}</span>
                      {badge && !isChecking && (
                        <span className={`tag watch-run-badge badge-${badge.kind}`}>
                          {badge.kind === 'warning' && <AlertTriangle size={10} />}
                          {badge.label}
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
                      onClick={() => openActivity('items')}
                      title="See discovered videos, checks, and downloads"
                    >
                      <Activity size={13} />
                      <span>Activity</span>
                    </button>

                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handleSyncJellyfin(w)}
                      disabled={jellyfinSyncBusyId === w.id || !w.completed_count}
                      title="Create/update a Jellyfin playlist with this watch's downloaded videos"
                    >
                      <ListMusic size={13} className={jellyfinSyncBusyId === w.id ? 'spin-icon' : ''} />
                      <span>{jellyfinSyncBusyId === w.id ? 'Syncing…' : 'Sync to Jellyfin'}</span>
                    </button>

                    {plexConfigured && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleSyncPlex(w)}
                        disabled={plexSyncBusyId === w.id || !w.completed_count}
                        title="Create/update a Plex playlist with this watch's downloads"
                      >
                        <ListMusic size={13} className={plexSyncBusyId === w.id ? 'spin-icon' : ''} />
                        <span>{plexSyncBusyId === w.id ? 'Syncing…' : 'Sync to Plex'}</span>
                      </button>
                    )}

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
                      title="Reset watch history (keeps completed downloads, rebaselines on the next check)"
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

                {jellyfinSyncMsg[w.id] && (
                  <div className={`alert ${jellyfinSyncMsg[w.id].isError ? 'alert-error' : 'alert-success'}`} style={{ margin: 0, padding: '8px 12px', fontSize: 12.5 }}>
                    {jellyfinSyncMsg[w.id].isError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                    <span>{jellyfinSyncMsg[w.id].text}</span>
                  </div>
                )}
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

      {/* Activity Modal: items, check runs, downloads */}
      <WatchActivityModal
        open={!!activityWatch}
        watch={activityWatch?.watch}
        initialTab={activityWatch?.tab}
        onClose={() => setActivityWatch(null)}
        onChanged={refresh}
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
        title="Reset Watch History"
        message={`Reset history for "${pendingReset?.label}"? Pending, filtered, and failed videos and past checks are forgotten, and the next check records the channel's current videos as a new baseline. Completed downloads are kept and won't be downloaded again; no files are deleted.`}
        confirmLabel="Reset History"
        danger={false}
        onCancel={() => setPendingReset(null)}
        onConfirm={confirmReset}
      />
    </>
  );
}

