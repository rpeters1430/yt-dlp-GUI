import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Key, Copy, Eye, ShieldCheck } from 'lucide-react';
import { api } from '../../api.js';
import { formatBytes } from '../../format.js';
import { useToast } from '../../context/ToastContext.jsx';

const KIND_LABELS = { video: 'Video file', audio: 'Audio file', archive: 'Archive', embed: 'Embed', link: 'Link' };
const TARGETS = [
  { id: 'queue', label: 'Download here (yt-dlp)' },
  { id: 'jdownloader', label: 'Send to JDownloader / pyLoad' },
  { id: 'aria2', label: 'Send to aria2' },
];
// unknown: the check ran but couldn't tell (an error, or a status that says nothing).
const CHECK_LABELS = { online: 'Online', offline: 'Offline', reachable: 'Reachable', unknown: "Couldn't check", unchecked: 'Not checked' };
const MAX_CHECK = 300;
const PREFS_KEY = 'linkgrabber:send';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Remembering the target is a convenience; private windows may refuse it.
  }
}

function checkState(link) {
  return link.check?.status || 'unchecked';
}

// [[value, count], ...], most common first.
function countBy(items, key) {
  const counts = new Map();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function CheckBadge({ check }) {
  if (!check) return null;
  const parts = [CHECK_LABELS[check.status] || check.status];
  if (check.size) parts.push(formatBytes(check.size));
  const title = [check.name, check.detail].filter(Boolean).join(' · ') || undefined;
  return <span className={`lg-badge lg-badge-${check.status}`} title={title}>{parts.join(' · ')}</span>;
}

// The links of one finished crawl: filters, per-post grouping, selection, link checks and
// hand-off. `onLinksChange(updater)` updates the crawl's links (seen flags, check results).
export default function LinkResults({ crawl, onLinksChange, onWatch }) {
  const showToast = useToast();
  const result = crawl.result;
  const links = result.links;
  const hasPosts = links.some((l) => l.postId);
  const prefs = useMemo(loadPrefs, []);

  const [selected, setSelected] = useState(() => new Set(
    links.filter((l) => (result.historyCount > 0 ? l.isNew : true)).map((l) => l.url),
  ));
  const [hostFilter, setHostFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [checkFilter, setCheckFilter] = useState('all');
  const [hostersOnly, setHostersOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [groupByPost, setGroupByPost] = useState(hasPosts);
  const [target, setTarget] = useState(prefs.target || 'queue');
  const [packagePerPage, setPackagePerPage] = useState(prefs.packagePerPage ?? true);
  const [onlySendFiltered, setOnlySendFiltered] = useState(true);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const lastClicked = useRef(null);

  useEffect(() => savePrefs({ target, packagePerPage }), [target, packagePerPage]);

  const hosts = useMemo(() => countBy(links, (l) => l.host), [links]);
  const kinds = useMemo(() => countBy(links, (l) => l.kind), [links]);
  const checks = useMemo(() => countBy(links, checkState), [links]);
  const anyChecked = links.some((l) => l.check);
  const hosterCount = links.filter((l) => l.hoster).length;

  const isFiltered = hostFilter !== 'all' || kindFilter !== 'all' || statusFilter !== 'all' || checkFilter !== 'all' || hostersOnly || Boolean(search.trim());

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return links.filter((l) =>
      (hostFilter === 'all' || l.host === hostFilter)
      && (kindFilter === 'all' || l.kind === kindFilter)
      && (statusFilter === 'all' || (statusFilter === 'new' ? l.isNew : !l.isNew))
      && (checkFilter === 'all' || checkState(l) === checkFilter)
      && (!hostersOnly || l.hoster)
      && (!q || l.url.toLowerCase().includes(q) || (l.author || '').toLowerCase().includes(q)));
  }, [links, hostFilter, kindFilter, statusFilter, checkFilter, hostersOnly, search]);

  const visibleSelected = useMemo(() => visible.filter((l) => selected.has(l.url)), [visible, selected]);
  const allVisibleSelected = visible.length > 0 && visibleSelected.length === visible.length;
  const urlsToSend = isFiltered && onlySendFiltered ? visibleSelected.map((l) => l.url) : [...selected];
  const sendSet = new Set(urlsToSend);
  const knownSize = links.reduce((sum, l) => sum + (sendSet.has(l.url) && l.check?.size ? l.check.size : 0), 0);

  // Rows, with a header row before each post's first link when grouping by post.
  const rows = useMemo(() => {
    if (!groupByPost) return visible.map((link, index) => ({ link, index }));
    // Links are listed in the order the crawl met them, so a post's links are contiguous.
    const out = [];
    let header = null;
    visible.forEach((link, index) => {
      const key = `${link.page}:${link.postId || ''}`;
      if (!header || header.key !== key) {
        header = { header: true, key, link, members: [] };
        out.push(header);
      }
      header.members.push(link);
      out.push({ link, index });
    });
    return out;
  }, [visible, groupByPost]);

  function setMany(urls, on) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const u of urls) {
        if (on) next.add(u);
        else next.delete(u);
      }
      return next;
    });
  }

  // Shift-click selects (or clears) the whole run between the last clicked row and this one.
  function toggleRow(index, shiftKey) {
    const link = visible[index];
    const on = !selected.has(link.url);
    if (shiftKey && lastClicked.current !== null && lastClicked.current < visible.length) {
      const [from, to] = [Math.min(lastClicked.current, index), Math.max(lastClicked.current, index)];
      setMany(visible.slice(from, to + 1).map((l) => l.url), on);
    } else {
      setMany([link.url], on);
    }
    lastClicked.current = index;
  }

  function markSeen(urls) {
    const seen = new Set(urls);
    if (seen.size) onLinksChange((prev) => prev.map((l) => (l.isNew && seen.has(l.url) ? { ...l, isNew: false } : l)));
  }

  async function handleSend() {
    if (urlsToSend.length === 0) return;
    setSending(true);
    try {
      const res = await api.sendLinks({ target, crawlId: crawl.id, urls: urlsToSend, packagePerPage });
      markSeen(res.seen || []);
      const failed = res.failed || [];
      showToast(`Sent ${res.sent} link${res.sent === 1 ? '' : 's'}${failed.length ? ` · ${failed.length} failed` : ''}`, { error: failed.length > 0 && res.sent === 0 });
      if (failed.length) showToast(failed.slice(0, 3).join('\n'), { error: true });
      setMany(res.seen || [], false);
    } catch (err) {
      showToast(err.message, { error: true });
    } finally {
      setSending(false);
    }
  }

  async function handleCopy() {
    if (urlsToSend.length === 0) return;
    try {
      await navigator.clipboard.writeText(urlsToSend.join('\n'));
      showToast(`Copied ${urlsToSend.length} link${urlsToSend.length === 1 ? '' : 's'}`);
    } catch {
      showToast('Clipboard is not available', { error: true });
      return;
    }
    try {
      await api.recordLinkGrabberHistory({ urls: urlsToSend, threadTitle: result.threadTitle || '', threadUrl: result.threadUrl || '' });
      markSeen(urlsToSend);
    } catch {
      // The copy itself worked; history is best-effort.
    }
  }

  async function copyPasswords(pws) {
    try {
      await navigator.clipboard.writeText(pws.join('\n'));
      showToast(`Copied archive password${pws.length > 1 ? 's' : ''}`);
    } catch {
      showToast('Clipboard is not available', { error: true });
    }
  }

  // Checks the selected links on screen, or everything on screen when none are selected.
  async function handleCheck() {
    const pool = visibleSelected.length ? visibleSelected : visible;
    const urls = pool.slice(0, MAX_CHECK).map((l) => l.url);
    if (urls.length === 0) return;
    setChecking(true);
    try {
      const { results } = await api.checkLinks({ urls, crawlId: crawl.id });
      const byUrl = new Map(results.map((r) => [r.url, r]));
      onLinksChange((prev) => prev.map((l) => {
        const r = byUrl.get(l.url);
        return r ? { ...l, check: { status: r.status, name: r.name, size: r.size, detail: r.detail } } : l;
      }));
      const offline = results.filter((r) => r.status === 'offline').length;
      showToast(`Checked ${results.length} link${results.length === 1 ? '' : 's'}${offline ? ` · ${offline} offline` : ''}${pool.length > MAX_CHECK ? ` (first ${MAX_CHECK})` : ''}`);
    } catch (err) {
      showToast(err.message, { error: true });
    } finally {
      setChecking(false);
    }
  }

  function deselectOffline() {
    setMany(links.filter((l) => checkState(l) === 'offline').map((l) => l.url), false);
  }

  const chip = (active, onClick, label, count) => (
    <button type="button" className={`chip${active ? ' active' : ''}`} onClick={onClick}>
      {label}{count !== undefined && <span className="chip-count">{count}</span>}
    </button>
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>
          {links.length} link{links.length === 1 ? '' : 's'} on {result.pages.length} page{result.pages.length === 1 ? '' : 's'}
          {result.maxPage > result.pages.length && <span className="muted small"> · thread has {result.maxPage} pages</span>}
        </h2>
        {onWatch && result.threadUrl && (
          <button type="button" className="btn-secondary small" onClick={() => onWatch(result.threadUrl, result.threadTitle)}>
            <Eye size={14} /> {result.threadUrl.includes('/threads/') ? 'Watch this thread' : 'Watch this page'}
          </button>
        )}
      </div>

      {result.threadTitle && <p className="panel-description"><strong>Thread:</strong> {result.threadTitle}</p>}

      {result.passwords?.length > 0 && (
        <div className="alert alert-success lg-password-bar">
          <span className="lg-inline">
            <Key size={16} />
            <strong>Archive password{result.passwords.length > 1 ? 's' : ''}:</strong>
            {result.passwords.map((pw) => <code key={pw}>{pw}</code>)}
          </span>
          <button type="button" className="btn-secondary small" onClick={() => copyPasswords(result.passwords)}>
            <Copy size={13} /> Copy
          </button>
        </div>
      )}

      {result.hasMorePages && (
        <div className="alert alert-warning">
          There are more pages than this crawl read{result.maxPage > result.pages.length ? ` (the thread has ${result.maxPage})` : ''}.
          Choose another mode or more pages to include them; one crawl reads at most 25.
        </div>
      )}
      {result.truncated && <div className="alert alert-warning">Stopped listing at 2,000 links.</div>}
      {result.error && <div className="alert alert-warning">Stopped early: {result.error}</div>}

      {links.length > 0 && (
        <>
          <div className="chip-row lg-filters">
            {chip(statusFilter === 'all', () => setStatusFilter('all'), 'All', links.length)}
            {chip(statusFilter === 'new', () => setStatusFilter('new'), 'New', result.newCount)}
            {result.historyCount > 0 && chip(statusFilter === 'history', () => setStatusFilter('history'), 'Previously sent', result.historyCount)}
            {hosterCount > 0 && hosterCount < links.length && chip(hostersOnly, () => setHostersOnly((v) => !v), 'File hosts only', hosterCount)}
          </div>
          <div className="chip-row lg-filters">
            {chip(hostFilter === 'all', () => setHostFilter('all'), 'All hosts', links.length)}
            {hosts.map(([host, count]) => <React.Fragment key={host}>{chip(hostFilter === host, () => setHostFilter(host), host, count)}</React.Fragment>)}
          </div>
          <div className="chip-row lg-filters">
            {chip(kindFilter === 'all', () => setKindFilter('all'), 'All types', links.length)}
            {kinds.map(([kind, count]) => <React.Fragment key={kind}>{chip(kindFilter === kind, () => setKindFilter(kind), KIND_LABELS[kind] || kind, count)}</React.Fragment>)}
          </div>
          {anyChecked && (
            <div className="chip-row lg-filters">
              {chip(checkFilter === 'all', () => setCheckFilter('all'), 'Any status', links.length)}
              {checks.map(([state, count]) => <React.Fragment key={state}>{chip(checkFilter === state, () => setCheckFilter(state), CHECK_LABELS[state] || state, count)}</React.Fragment>)}
            </div>
          )}

          <div className="toolbar lg-toolbar">
            <input type="search" placeholder="Filter by URL or poster" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter links" />
            {hasPosts && (
              <label className="checkbox-label">
                <input type="checkbox" checked={groupByPost} onChange={(e) => setGroupByPost(e.target.checked)} />
                Group by post
              </label>
            )}
            <button type="button" className="btn-secondary small" onClick={handleCheck} disabled={checking || visible.length === 0}
              title="Check whether links still work (the selected ones shown, or all shown when none are selected)">
              <ShieldCheck size={14} /> {checking ? 'Checking…' : `Check ${Math.min(MAX_CHECK, visibleSelected.length || visible.length)} link${(visibleSelected.length || visible.length) === 1 ? '' : 's'}`}
            </button>
            {checks.some(([state]) => state === 'offline') && (
              <button type="button" className="btn-ghost small" onClick={deselectOffline}>Deselect offline</button>
            )}
          </div>

          <ul className="lg-list">
            <li className="lg-row lg-row-head">
              <span className="lg-inline">
                <label className="checkbox-label">
                  <input type="checkbox" checked={allVisibleSelected} onChange={() => setMany(visible.map((l) => l.url), !allVisibleSelected)} />
                  Select all shown ({visible.length})
                </label>
                {isFiltered && (
                  <button type="button" className="btn-ghost small" onClick={() => setSelected(new Set(visible.map((l) => l.url)))}>Select only shown</button>
                )}
              </span>
              <span className="lg-inline muted small">
                <span><strong>{visibleSelected.length}</strong> of {visible.length} shown selected{selected.size !== visibleSelected.length ? ` (${selected.size} in total)` : ''}</span>
                {selected.size > 0 && <button type="button" className="btn-ghost small" onClick={() => setSelected(new Set())}>Clear</button>}
              </span>
            </li>
            {rows.map((row) => (row.header ? (
              <li key={`h:${row.key}`} className="lg-post-head">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={row.members.every((l) => selected.has(l.url))}
                    onChange={(e) => setMany(row.members.map((l) => l.url), e.target.checked)}
                    aria-label="Select this post's links"
                  />
                  <strong>{row.link.author || 'Page'}</strong>
                </label>
                <span className="muted">p.{row.link.page}</span>
                {row.link.postId && result.threadUrl && (
                  <a href={`${result.threadUrl}post-${row.link.postId}`} target="_blank" rel="noreferrer noopener">post #{row.link.postId}</a>
                )}
                {row.link.passwords?.length > 0 && (
                  <span className="lg-inline"><Key size={12} aria-label="Password" /><span className="lg-pw">{row.link.passwords.join(', ')}</span></span>
                )}
                <span className="muted">{row.members.length} link{row.members.length === 1 ? '' : 's'}</span>
              </li>
            ) : (
              <li key={row.link.url} className={`lg-row${checkState(row.link) === 'offline' ? ' lg-row-offline' : ''}`}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={selected.has(row.link.url)} onChange={(e) => toggleRow(row.index, e.nativeEvent.shiftKey)} />
                  <span className="lg-url mono">{row.link.url}</span>
                </label>
                <span className="lg-meta muted small">
                  <CheckBadge check={row.link.check} />
                  {row.link.source === 'base64' && <span className="lg-badge lg-badge-b64">Base64</span>}
                  {!row.link.isNew && <span className="lg-badge">Sent before</span>}
                  {!groupByPost && row.link.passwords?.length > 0 && (
                    <span title={`Password from this post: ${row.link.passwords.join(', ')}`}><Key size={12} aria-label="Has password" /></span>
                  )}
                  <span>{KIND_LABELS[row.link.kind] || row.link.kind}</span>
                  {!groupByPost && <span>p.{row.link.page}{row.link.author ? ` · ${row.link.author}` : ''}</span>}
                  {row.link.count > 1 && <span>×{row.link.count}</span>}
                </span>
              </li>
            )))}
          </ul>

          <div className="options-row lg-send">
            <span className="muted small"><strong>{urlsToSend.length}</strong> link{urlsToSend.length === 1 ? '' : 's'} to send{knownSize ? ` · ${formatBytes(knownSize)} known` : ''}</span>
            {isFiltered && selected.size !== visibleSelected.length && (
              <label className="checkbox-label small">
                <input type="checkbox" checked={onlySendFiltered} onChange={(e) => setOnlySendFiltered(e.target.checked)} />
                Only the filtered ones ({visibleSelected.length})
              </label>
            )}
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Send to">
              {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {target === 'jdownloader' && (
              <label className="checkbox-label small">
                <input type="checkbox" checked={packagePerPage} onChange={(e) => setPackagePerPage(e.target.checked)} />
                Package per page
              </label>
            )}
            <button type="button" onClick={handleSend} disabled={sending || urlsToSend.length === 0}>
              {sending ? 'Sending…' : `Send ${urlsToSend.length}`}
            </button>
            <button type="button" className="btn-secondary" onClick={handleCopy} disabled={urlsToSend.length === 0}>
              <Copy size={14} /> Copy
            </button>
          </div>
          {target === 'jdownloader' && result.passwords?.length > 0 && (
            <p className="muted small">The passwords found go with each package, so JDownloader can extract the archives.</p>
          )}
        </>
      )}
    </section>
  );
}
