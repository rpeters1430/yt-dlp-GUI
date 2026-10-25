import React, { useEffect, useRef, useState } from 'react';
import { Eye, RefreshCw, Trash2, AlertCircle } from 'lucide-react';
import { api } from '../../api.js';
import { relativeTime } from '../../format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDownloads } from '../../context/DownloadsContext.jsx';

const TARGETS = [
  { id: 'none', label: 'Just tell me (notification)' },
  { id: 'jdownloader', label: 'Send to JDownloader' },
  { id: 'queue', label: 'Download here (yt-dlp)' },
  { id: 'aria2', label: 'Send to aria2' },
];
const INTERVALS = [[30, 'Every 30 min'], [60, 'Every hour'], [180, 'Every 3 hours'], [360, 'Every 6 hours'], [720, 'Every 12 hours'], [1440, 'Daily']];
const COMMON_HOSTS = ['bunkr', 'gofile', 'pixeldrain', 'mega'];
const EMPTY = { url: '', title: '', lastN: 2, intervalMins: 360, target: 'jdownloader', hostersOnly: true, linkTypes: '', autostart: true, packagePerPage: true };

const targetLabel = (id) => TARGETS.find((t) => t.id === id)?.label || id;
const intervalLabel = (mins) => INTERVALS.find(([m]) => m === mins)?.[1] || `Every ${mins} min`;

// Threads re-crawled on a schedule. `draft` ({ url, title }) opens the form pre-filled, from a
// crawl's "Watch this thread"; `onOpenCrawl` shows a watch's latest crawl.
export default function ThreadWatches({ draft, onDraftUsed, onOpenCrawl }) {
  const showToast = useToast();
  const { subscribeLinkGrabber } = useDownloads();
  const [watches, setWatches] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef(null);

  useEffect(() => {
    api.listThreadWatches().then(setWatches).catch((err) => setError(err.message));
    return subscribeLinkGrabber((event, watch) => {
      if (event !== 'linkgrabber:watch' || !watch) return;
      setWatches((prev) => (prev ? prev.map((w) => (w.id === watch.id ? watch : w)) : prev));
    });
  }, [subscribeLinkGrabber]);

  useEffect(() => {
    if (!draft) return;
    setForm({ ...EMPTY, url: draft.url, title: draft.title || '' });
    onDraftUsed();
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [draft, onDraftUsed]);

  const update = (field, parse = (v) => v) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : parse(e.target.value);
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  function toggleHostChip(host) {
    setForm((prev) => {
      const current = (prev?.linkTypes || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const next = current.includes(host)
        ? current.filter((h) => h !== host)
        : [...current, host];
      return { ...prev, linkTypes: next.join(', ') };
    });
  }

  async function handleAdd(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api.addThreadWatch(form);
      setWatches((prev) => [created, ...(prev || [])]);
      setForm(null);
      showToast('Watching the thread; the first check runs within 5 minutes');
    } catch (err) {
      showToast(err.message, { error: true });
    } finally {
      setSaving(false);
    }
  }

  async function patch(watch, changes) {
    try {
      const updated = await api.updateThreadWatch(watch.id, changes);
      setWatches((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }

  async function checkNow(watch) {
    try {
      await api.checkThreadWatch(watch.id);
      setWatches((prev) => prev.map((w) => (w.id === watch.id ? { ...w, checking: true } : w)));
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }

  async function remove(watch) {
    if (!window.confirm(`Stop watching ${watch.title || watch.url}?`)) return;
    try {
      await api.deleteThreadWatch(watch.id);
      setWatches((prev) => prev.filter((w) => w.id !== watch.id));
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }

  return (
    <section className="panel" ref={panelRef}>
      <div className="panel-header">
        <h2><Eye size={16} /> Thread watches</h2>
        {!form && <button type="button" className="btn-secondary small" onClick={() => setForm({ ...EMPTY })}>Add watch</button>}
      </div>
      <p className="panel-description">
        Re-crawls a thread&apos;s last couple of pages on a schedule and crawls new pages automatically as they appear.
        Links matching your chosen link types are sent directly to your download client with auto-downloading enabled.
      </p>

      {form && (
        <form className="lg-watch-form" onSubmit={handleAdd}>
          <label className="field-label lg-watch-url">
            Thread URL
            <input className="mono" type="url" required value={form.url} onChange={update('url')} placeholder="https://forum.example/threads/name.123/" />
          </label>
          <label className="field-label lg-watch-full">
            Link types to auto-send
            <input
              type="text"
              value={form.linkTypes}
              onChange={update('linkTypes')}
              placeholder="e.g. bunkr, gofile (leave blank for all)"
            />
            <span className="lg-inline small muted" style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>Quick add:</span>
              {COMMON_HOSTS.map((h) => {
                const active = (form.linkTypes || '').toLowerCase().split(',').map((s) => s.trim()).includes(h);
                return (
                  <button
                    key={h}
                    type="button"
                    className={`chip small${active ? ' active' : ''}`}
                    onClick={() => toggleHostChip(h)}
                  >
                    {h}
                  </button>
                );
              })}
            </span>
          </label>
          <label className="field-label">
            Pages to check (last couple)
            <input
              type="number"
              min={1}
              max={10}
              value={form.lastN}
              onChange={update('lastN', Number)}
              title="Checks the last N pages, plus automatically crawls new pages as the thread grows"
            />
          </label>
          <label className="field-label">
            How often
            <select value={form.intervalMins} onChange={update('intervalMins', Number)}>
              {INTERVALS.map(([mins, label]) => <option key={mins} value={mins}>{label}</option>)}
            </select>
          </label>
          <label className="field-label">
            New links
            <select value={form.target} onChange={update('target')}>
              {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="checkbox-label" title="Automatically start downloading links in JDownloader, aria2, or yt-dlp queue">
            <input type="checkbox" checked={form.autostart} onChange={update('autostart')} />
            Auto-download in client
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.hostersOnly} onChange={update('hostersOnly')} />
            File hosts only
          </label>
          {form.target === 'jdownloader' && (
            <label className="checkbox-label">
              <input type="checkbox" checked={form.packagePerPage} onChange={update('packagePerPage')} />
              Package per page
            </label>
          )}
          <span className="lg-card-actions">
            <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Watch'}</button>
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
          </span>
        </form>
      )}

      {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
      {watches && watches.length === 0 && !form && <p className="muted small">No threads watched yet. Crawl one and choose &quot;Watch this thread&quot;, or add one here.</p>}

      {watches && watches.length > 0 && (
        <ul className="lg-cards">
          {watches.map((w) => (
            <li key={w.id} className="lg-card">
              <button type="button" className="lg-card-open lg-card-main" onClick={() => w.lastCrawlId && onOpenCrawl(w.lastCrawlId)} disabled={!w.lastCrawlId}
                title={w.lastCrawlId ? 'Show the latest check\'s links' : undefined}>
                <span className="lg-card-title">{w.title || w.url}</span>
                <span className="muted small">
                  {intervalLabel(w.intervalMins)}, last {w.lastN} page{w.lastN === 1 ? '' : 's'} + new pages · {targetLabel(w.target)}
                  {w.linkTypes ? ` · types: ${w.linkTypes}` : (w.hostersOnly ? ' · file hosts only' : '')}
                  {w.autostart ? ' · auto-download' : ''}
                </span>
                <span className="muted small">
                  {w.checking ? 'Checking now…' : w.lastCheckedAt ? `Checked ${relativeTime(w.lastCheckedAt)}: ${w.lastNewCount ?? 0} new` : 'Not checked yet'}
                  {!w.enabled ? ' · paused' : ''}
                </span>
                {w.lastError && <span className="small lg-error">{w.lastError}</span>}
              </button>
              <span className="lg-card-actions">
                <label className="checkbox-label small">
                  <input type="checkbox" checked={w.enabled} onChange={(e) => patch(w, { enabled: e.target.checked })} />
                  On
                </label>
                <select value={w.target} onChange={(e) => patch(w, { target: e.target.value })} aria-label="Where new links go">
                  {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <button type="button" className="btn-ghost small" onClick={() => checkNow(w)} disabled={w.checking}>
                  <RefreshCw size={14} /> Check now
                </button>
                <button type="button" className="btn-ghost small" onClick={() => remove(w)} aria-label="Stop watching">
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
