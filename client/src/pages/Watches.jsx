import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import WatchModal from '../components/WatchModal.jsx';
import WatchActivityModal from '../components/WatchActivityModal.jsx';
import AddWatchDrawer from '../components/AddWatchDrawer.jsx';
import Art from '../components/Art.jsx';
import { Switch } from '../components/DownloadOptionsFields.jsx';
import { useDownloads } from '../context/DownloadsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { relativeTime } from '../format.js';

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
  const [addOpen, setAddOpen] = useState(false);
  const [advancedUrl, setAdvancedUrl] = useState('');
  const toast = useToast();
  const { subscribeWatchUpdates } = useDownloads();
  const [editingWatch, setEditingWatch] = useState(null);
  const [activityWatch, setActivityWatch] = useState(null); // { watch, tab }
  const [pendingDelete, setPendingDelete] = useState(null); // { id, label }
  const [pendingReset, setPendingReset] = useState(null); // { id, label }

  const refresh = useCallback(() => {
    api.listWatches()
      .then(setWatches)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();

    // Subscribe to real-time watch:update events on the shared Socket.IO connection
    return subscribeWatchUpdates((updated) => {
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
  }, [refresh, subscribeWatchUpdates]);

  // Polling fallback while any watch is actively checking
  useEffect(() => {
    const hasChecking = watches.some((w) => w.last_status === 'checking' || busyId === w.id);
    if (!hasChecking) return undefined;
    const interval = setInterval(refresh, 2500);
    return () => clearInterval(interval);
  }, [watches, busyId, refresh]);

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
      <div className="page-title-row">
        <h1>Watches</h1>
        <span className="page-subtitle">Channels and playlists that download new videos automatically</span>
        <div className="page-title-actions">
          {watches.length > 1 && (
            <button type="button" className="btn-ghost" onClick={handleCheckAll} disabled={checkingAll}>
              {checkingAll ? 'Checking all…' : 'Check all'}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>Add watch</button>
        </div>
      </div>

      {watches.length > 3 && (
        <div className="toolbar">
          <input
            className="toolbar-search"
            placeholder="Search by channel, title, or URL"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search watches"
          />
          <div className="chip-row">
            {[
              { value: 'all', label: `All ${stats.total}` },
              { value: 'active', label: `Active ${stats.active}` },
              { value: 'paused', label: `Paused ${stats.paused}` },
              ...(stats.errors > 0 ? [{ value: 'error', label: `Errors ${stats.errors}` }] : []),
            ].map((f) => (
              <button key={f.value} type="button" className={`chip${statusFilter === f.value ? ' active' : ''}`} onClick={() => setStatusFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : filteredWatches.length === 0 ? (
        <div className="watch-empty">
          <p className="empty-line">
            {watches.length === 0
              ? 'No watches yet. Add a YouTube channel or playlist and new uploads download on their own.'
              : 'Nothing matches. Try a different search or filter.'}
          </p>
          {watches.length === 0 && (
            <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>Add your first watch</button>
          )}
        </div>
      ) : (
        <div className="watch-grid">
          {filteredWatches.map((w) => {
            const isChecking = busyId === w.id || w.last_status === 'checking';
            const isPaused = w.enabled === 0;
            const isError = w.last_status === 'error';
            const badge = runBadge(w);
            const openActivity = (tab = 'items') => setActivityWatch({ watch: w, tab });
            const label = w.name || w.channel_name || 'YouTube watch';
            const statLine = [
              <span key="d"><strong>{(w.completed_count || 0).toLocaleString()}</strong> downloaded</span>,
              <span key="i">{intervalLabel(w.check_interval_mins)}</span>,
              <span key="c">{isPaused ? 'paused' : isChecking ? 'checking now' : w.last_checked_at ? `checked ${relativeTime(w.last_checked_at)}` : 'not checked yet'}</span>,
            ];

            return (
              <article key={w.id} className={`watch-tile${isPaused ? ' paused' : ''}`}>
                <Art src={w.thumbnail} className="watch-banner" ratio="auto">
                  <span className="badge badge-dark badge-tr">{isPlaylistUrl(w.url) ? 'PLAYLIST' : 'CHANNEL'}</span>
                </Art>
                <div className="watch-tile-body">
                  <div className="watch-head">
                    <Art src={w.thumbnail} className="watch-avatar-round" ratio="1" />
                    <div className="watch-head-text">
                      <h3 className="watch-name" title={label}>{label}</h3>
                    </div>
                    <WatchMenu
                      watch={w}
                      plexConfigured={plexConfigured}
                      onActivity={() => openActivity('items')}
                      onEdit={() => { setEditingWatch(w); setModalOpen(true); }}
                      onSyncJellyfin={() => handleSyncJellyfin(w)}
                      onSyncPlex={() => handleSyncPlex(w)}
                      onToggleCleanup={() => handleToggleCleanupExempt(w)}
                      onReset={() => setPendingReset({ id: w.id, label })}
                      onDelete={() => setPendingDelete({ id: w.id, label })}
                      busy={jellyfinSyncBusyId === w.id || plexSyncBusyId === w.id}
                    />
                  </div>
                  <div className="watch-stats mono-meta">{statLine}</div>
                  <div className="watch-rules">{rulesLine(w)}</div>

                  {badge && !isChecking && badge.kind !== 'neutral' && (
                    <button type="button" className="watch-run-line" onClick={() => openActivity('runs')}>
                      Last check: {badge.label}
                    </button>
                  )}
                  {isError && w.last_error && (
                    <div className="notice notice-danger">
                      Last check failed: {w.last_error}{' '}
                      <button type="button" className="btn-link" onClick={() => handleCheckNow(w)} disabled={isChecking}>Retry</button>{' · '}
                      <button type="button" className="btn-link" onClick={() => openActivity('runs')}>View runs</button>
                    </div>
                  )}
                  {!isError && w.last_error && !isChecking && (
                    <div className="notice notice-warning">{w.last_error}</div>
                  )}
                  {!isError && !isChecking && w.latest_run_status === 'partial' && (
                    <div className="notice notice-warning">
                      The last check scanned {w.latest_scanned_count} videos without reaching ones it already knew, so some uploads may have been missed.{' '}
                      <button type="button" className="btn-link" onClick={() => handleCheckNow(w)}>Check again</button>
                    </div>
                  )}
                  {w.failed_count > 0 && (
                    <div className="notice notice-danger">
                      {w.failed_count} download{w.failed_count === 1 ? '' : 's'} failed.{' '}
                      <button type="button" className="btn-link" onClick={() => openActivity('items')}>Review and retry</button>
                    </div>
                  )}
                  {jellyfinSyncMsg[w.id] && (
                    <div className={`notice ${jellyfinSyncMsg[w.id].isError ? 'notice-danger' : 'notice-info'}`}>{jellyfinSyncMsg[w.id].text}</div>
                  )}

                  <div className="watch-foot">
                    <label className="switch-label">
                      <Switch checked={!isPaused} onChange={() => handleToggle(w)} label={isPaused ? 'Resume watch' : 'Pause watch'} size="lg" />
                      <span>{isPaused ? 'Paused' : 'Active'}</span>
                    </label>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => handleCheckNow(w)} disabled={isChecking}>
                      {isChecking ? 'Checking…' : 'Check now'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <AddWatchDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(created) => {
          setWatches((prev) => [created, ...prev.filter((w) => w.id !== created.id)]);
          toast(`Now watching ${created.name || created.channel_name || 'it'}`);
        }}
        onAdvanced={(url) => {
          setAddOpen(false);
          setEditingWatch(null);
          setAdvancedUrl(url);
          setModalOpen(true);
        }}
      />

      {/* Full add / edit form */}
      <WatchModal
        open={modalOpen}
        watch={editingWatch}
        initialUrl={advancedUrl}
        onClose={() => {
          setModalOpen(false);
          setEditingWatch(null);
          setAdvancedUrl('');
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

      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove watch"
        message={`Remove "${pendingDelete?.label}"? Videos already downloaded stay in your library.`}
        confirmLabel="Remove watch"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={!!pendingReset}
        title="Reset watch history"
        message={`Reset history for "${pendingReset?.label}"? Pending, filtered, and failed videos and past checks are forgotten, and the next check records the channel's current videos as a new baseline. Completed downloads are kept and won't be downloaded again; no files are deleted.`}
        confirmLabel="Reset history"
        danger={false}
        onCancel={() => setPendingReset(null)}
        onConfirm={confirmReset}
      />
    </>
  );
}

function isPlaylistUrl(url) {
  return /[?&]list=/.test(url || '') || /\/playlist\b/.test(url || '');
}

function intervalLabel(mins) {
  const m = Number(mins) || 30;
  if (m === 1440) return 'daily';
  if (m % 60 === 0) return `every ${m / 60} h`;
  return `every ${m} min`;
}

// "All videos · 1080p MP4 · delete 3 days after watched" style summary of a watch's rules.
function rulesLine(w) {
  const parts = [];
  if (w.content_types) parts.push(w.content_types.split(',').map((t) => TAB_LABELS[t] || t).join(' + '));
  else if (!w.match_title && !w.reject_title && !w.min_duration && !w.max_duration) parts.push('All videos');
  if (w.match_title) parts.push(`title matches “${w.match_title}”`);
  if (w.reject_title) parts.push(`skips “${w.reject_title}”`);
  if (w.min_duration) parts.push(`longer than ${Math.round(w.min_duration / 60)} min`);
  if (w.max_duration) parts.push(`shorter than ${Math.round(w.max_duration / 60)} min`);
  parts.push(w.audio_only
    ? `Audio only · ${(w.container || 'mp3').toUpperCase()}`
    : `${w.quality ? `${w.quality}p` : 'Best'} ${(w.container || 'mp4').toUpperCase()}`);
  if (w.sponsorblock) parts.push('SponsorBlock');
  if (w.split_live_chunks) parts.push(`${w.live_chunk_mins || 30}m chunks`);
  if (w.cleanup_exempt) parts.push('kept forever');
  return parts.join(' · ');
}

function WatchMenu({ watch, plexConfigured, onActivity, onEdit, onSyncJellyfin, onSyncPlex, onToggleCleanup, onReset, onDelete, busy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function run(fn) {
    setOpen(false);
    fn();
  }

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-plain" onClick={() => setOpen((v) => !v)} aria-label="More actions" aria-expanded={open}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => run(onActivity)}>Activity</button>
          <button type="button" role="menuitem" onClick={() => run(onEdit)}>Edit settings</button>
          <a role="menuitem" href={watch.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Open on YouTube</a>
          <button type="button" role="menuitem" disabled={busy || !watch.completed_count} onClick={() => run(onSyncJellyfin)}>Sync to Jellyfin</button>
          {plexConfigured && (
            <button type="button" role="menuitem" disabled={busy || !watch.completed_count} onClick={() => run(onSyncPlex)}>Sync to Plex</button>
          )}
          <button type="button" role="menuitem" onClick={() => run(onToggleCleanup)}>
            {watch.cleanup_exempt ? 'Allow auto-delete' : 'Keep forever (skip auto-delete)'}
          </button>
          <button type="button" role="menuitem" onClick={() => run(onReset)}>Reset history</button>
          <button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}>Remove watch</button>
        </div>
      )}
    </div>
  );
}
