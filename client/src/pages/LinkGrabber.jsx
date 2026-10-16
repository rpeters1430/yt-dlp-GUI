import React, { useEffect, useMemo, useState } from 'react';
import { Link2, Settings2, CheckCircle2, AlertCircle, Key, Copy, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';

const KIND_LABELS = { video: 'Video file', audio: 'Audio file', archive: 'Archive', embed: 'Embed', link: 'Link', base64: 'Base64 link' };
const TARGETS = [
  { id: 'queue', label: 'Download here (yt-dlp)' },
  { id: 'jdownloader', label: 'Send to JDownloader' },
  { id: 'aria2', label: 'Send to aria2' },
];

function DownloaderSettings({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testingJd, setTestingJd] = useState(false);
  const [jdTestStatus, setJdTestStatus] = useState(null);
  const [historyStats, setHistoryStats] = useState(null);
  const [clearingHistory, setClearingHistory] = useState(false);

  useEffect(() => {
    api.getLinkGrabberSettings().then(setSettings).catch((err) => setError(err.message));
    loadHistoryStats();
  }, []);

  async function loadHistoryStats() {
    try {
      const stats = await api.getLinkGrabberHistoryStats();
      setHistoryStats(stats);
    } catch {
      // Non-fatal
    }
  }

  async function handleTestJd() {
    const jdUrl = settings?.jdUrl || '';
    if (!jdUrl.trim()) {
      setJdTestStatus({ ok: false, message: 'Please enter a JDownloader address first' });
      return;
    }
    setTestingJd(true);
    setJdTestStatus(null);
    try {
      // The server only tests the saved address, so save what's in the box first.
      await api.updateLinkGrabberSettings({ jdUrl: jdUrl.trim() });
      const res = await api.testJDownloader();
      setJdTestStatus(res);
    } catch (err) {
      setJdTestStatus({ ok: false, message: err.message });
    } finally {
      setTestingJd(false);
    }
  }

  async function handleClearHistory() {
    if (!window.confirm('Clear all recorded crawl history? Previously discovered links will be marked as new on next crawl.')) return;
    setClearingHistory(true);
    try {
      await api.clearLinkGrabberHistory();
      await loadHistoryStats();
      setMessage('Crawl history cleared.');
    } catch (err) {
      setError(err.message);
    } finally {
      setClearingHistory(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const payload = { jdUrl: settings.jdUrl || '', aria2Url: settings.aria2Url || '', aria2Dir: settings.aria2Dir || '' };
      if (secret) payload.aria2Secret = secret;
      await api.updateLinkGrabberSettings(payload);
      setSettings(await api.getLinkGrabberSettings());
      setSecret('');
      setMessage('Saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const update = (field) => (e) => setSettings((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <section className="panel">
      <div className="panel-header">
        <h2><Settings2 size={16} /> External downloaders &amp; history</h2>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
      <p className="panel-description">
        JDownloader receives links via Click&apos;n&apos;Load on port <strong>9666</strong>. If JDownloader is running in Docker
        on a NAS (e.g. at <code>192.168.50.114</code>), ensure port 9666 is mapped in Docker (port 5800 is only the web GUI), and
        disable <em>RemoteAPI: Extern Interface Localhost Only</em> in JDownloader Advanced Settings.
      </p>
      {!settings ? (
        error ? <div className="alert alert-error"><AlertCircle size={15} />{error}</div> : <div className="empty-state"><div className="spinner" /></div>
      ) : (
        <form className="settings-form" onSubmit={handleSave}>
          <div className="field-group">
            <label className="field-label">
              JDownloader Click&apos;n&apos;Load address
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                <input
                  type="text"
                  placeholder="http://192.168.50.114:9666"
                  value={settings.jdUrl || ''}
                  onChange={update('jdUrl')}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleTestJd}
                  disabled={testingJd || !settings.jdUrl}
                >
                  {testingJd ? 'Testing…' : 'Test connection'}
                </button>
              </div>
            </label>
            {jdTestStatus && (
              <div className={`alert ${jdTestStatus.ok ? 'alert-success' : jdTestStatus.isWebUi ? 'alert-warning' : 'alert-error'}`} style={{ marginTop: '8px' }}>
                {jdTestStatus.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                {jdTestStatus.message}
              </div>
            )}
          </div>

          <label className="field-label">
            aria2 RPC URL
            <input type="text" placeholder="http://192.168.1.20:6800/jsonrpc" value={settings.aria2Url || ''} onChange={update('aria2Url')} />
          </label>
          <label className="field-label">
            aria2 RPC secret
            <input
              type="password"
              autoComplete="off"
              placeholder={settings.hasAria2Secret ? '••••••••  (saved — enter a new one to replace)' : 'Optional'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
          <label className="field-label">
            aria2 download folder (optional)
            <input type="text" placeholder="/downloads" value={settings.aria2Dir || ''} onChange={update('aria2Dir')} />
          </label>

          {historyStats && (
            <div style={{ padding: '12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius, 8px)', margin: '8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span className="muted small">Crawl History Database:</span>
                <div><strong>{historyStats.totalLinks}</strong> links tracked across <strong>{historyStats.totalThreads}</strong> threads</div>
              </div>
              <button
                type="button"
                className="btn-ghost small"
                onClick={handleClearHistory}
                disabled={clearingHistory || historyStats.totalLinks === 0}
                title="Reset crawl history"
              >
                <Trash2 size={14} /> Clear history
              </button>
            </div>
          )}

          <div className="options-row" style={{ marginTop: 0 }}>
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
          {message && <div className="alert alert-success"><CheckCircle2 size={15} />{message}</div>}
          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
        </form>
      )}
    </section>
  );
}

export default function LinkGrabber() {
  const showToast = useToast();
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState('follow');
  const [maxPages, setMaxPages] = useState(5);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(10);
  const [lastN, setLastN] = useState(3);
  const [skipQuotes, setSkipQuotes] = useState(true);
  const [skipBots, setSkipBots] = useState(true);
  const [decodeBase64, setDecodeBase64] = useState(true);
  const [ignoreHistory, setIgnoreHistory] = useState(false);
  const [useSavedCookies, setUseSavedCookies] = useState(false);
  const [cookiesText, setCookiesText] = useState('');
  const [showCookies, setShowCookies] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [hostFilter, setHostFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState('queue');
  const [packagePerPage, setPackagePerPage] = useState(true);
  const [sending, setSending] = useState(false);

  // Auto-detect thread mode when a XenForo thread URL is typed/pasted
  useEffect(() => {
    if (/\/threads\/[^/]+/.test(url)) {
      setMode((m) => (m === 'follow' ? 'all' : m));
    }
  }, [url]);

  async function handleCrawl(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setCrawling(true);
    setError('');
    setResult(null);
    setSelected(new Set());
    setHostFilter('all');
    setKindFilter('all');
    setStatusFilter('all');

    try {
      const data = await api.crawlLinks({
        url: url.trim(),
        mode,
        maxPages,
        startPage,
        endPage,
        lastN,
        skipQuotes,
        skipBots,
        decodeBase64,
        ignoreHistory,
        useSavedCookies,
        cookies: cookiesText || undefined,
      });
      setResult(data);

      // Default selection to new unseen links if there is historical data
      const initialSelected = new Set();
      const linksToSelect = (data.links || []).filter((l) => (data.historyCount > 0 ? l.isNew : true));
      for (const l of linksToSelect) initialSelected.add(l.url);
      setSelected(initialSelected);
    } catch (err) {
      setError(err.message);
    } finally {
      setCrawling(false);
    }
  }

  const hosts = useMemo(() => {
    const counts = new Map();
    for (const l of result?.links || []) counts.set(l.host, (counts.get(l.host) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [result]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (result?.links || []).filter((l) =>
      (hostFilter === 'all' || l.host === hostFilter)
      && (kindFilter === 'all' || l.kind === kindFilter)
      && (statusFilter === 'all' || (statusFilter === 'new' ? l.isNew : !l.isNew))
      && (!q || l.url.toLowerCase().includes(q)));
  }, [result, hostFilter, kindFilter, statusFilter, search]);

  const allVisibleSelected = visible.length > 0 && visible.every((l) => selected.has(l.url));

  function toggle(linkUrl) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(linkUrl)) next.delete(linkUrl);
      else next.add(linkUrl);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const l of visible) {
        if (allVisibleSelected) next.delete(l.url);
        else next.add(l.url);
      }
      return next;
    });
  }

  async function handleSend() {
    const urls = [...selected];
    if (urls.length === 0) return;
    setSending(true);
    try {
      const res = await api.sendLinks({
        target,
        urls,
        packageName: result?.threadTitle || result?.pages?.[0]?.title || '',
        passwords: result?.passwords || [],
        packagePerPage,
        urlMetadata: result?.links || [],
        threadUrl: result?.threadUrl || '',
      });
      const failed = res.failed || [];
      showToast(`Sent ${res.sent} link${res.sent === 1 ? '' : 's'}${failed.length ? ` · ${failed.length} failed` : ''}`, { error: failed.length > 0 && res.sent === 0 });
      if (failed.length) setError(failed.slice(0, 5).join('\n'));
      setSelected(new Set());
    } catch (err) {
      showToast(err.message, { error: true });
    } finally {
      setSending(false);
    }
  }

  async function copySelected() {
    try {
      await navigator.clipboard.writeText([...selected].join('\n'));
      showToast(`Copied ${selected.size} link${selected.size === 1 ? '' : 's'}`);
    } catch {
      showToast('Clipboard is not available', { error: true });
    }
  }

  async function copyPasswords(pws) {
    try {
      await navigator.clipboard.writeText(pws.join('\n'));
      showToast(`Copied archive password${pws.length > 1 ? 's' : ''}`);
    } catch {
      showToast('Clipboard not available', { error: true });
    }
  }

  return (
    <>
      <div className="page-title-row">
        <h1>Link grabber &amp; forum crawler</h1>
        <div className="page-title-actions">
          <button type="button" className="btn-secondary" onClick={() => setShowSettings((v) => !v)}>
            <Settings2 size={15} /> Downloaders
          </button>
        </div>
      </div>

      {showSettings && <DownloaderSettings onClose={() => setShowSettings(false)} />}

      <section className="panel">
        <div className="panel-header">
          <h2><Link2 size={16} /> Crawl thread or page for download links</h2>
        </div>
        <p className="panel-description">
          Crawls web pages and forum threads for file hosters (Mega, Pixeldrain, Bunkr, etc.), strips quote spam &amp; repost bots,
          auto-decodes Base64 links, extracts archive passwords, tracks history to prevent duplicates, and sends to JDownloader LinkGrabber.
        </p>
        <form className="settings-form" onSubmit={handleCrawl}>
          <label className="field-label">
            Page or Forum Thread URL
            <input className="mono" type="url" placeholder="https://simpcity.cr/threads/name.123/ or https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </label>

          <div className="options-row" style={{ marginTop: 0, gap: '12px', flexWrap: 'wrap' }}>
            <label className="field-label" style={{ maxWidth: '180px' }}>
              Crawl Mode
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="follow">Follow &quot;Next&quot; links</option>
                <option value="all">Whole Thread (All Pages)</option>
                <option value="last">Last N Pages</option>
                <option value="range">Page Range</option>
                <option value="single">Single Page</option>
              </select>
            </label>

            {mode === 'follow' && (
              <label className="field-label lg-pages">
                Pages to follow
                <input type="number" min={1} max={25} value={maxPages} onChange={(e) => setMaxPages(Math.min(25, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
            )}

            {mode === 'last' && (
              <label className="field-label lg-pages">
                Last N pages
                <input type="number" min={1} max={25} value={lastN} onChange={(e) => setLastN(Math.min(25, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
            )}

            {mode === 'range' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <label className="field-label" style={{ width: '80px' }}>
                  From
                  <input type="number" min={1} value={startPage} onChange={(e) => setStartPage(Math.max(1, Number(e.target.value) || 1))} />
                </label>
                <label className="field-label" style={{ width: '80px' }}>
                  To
                  <input type="number" min={startPage} value={endPage} onChange={(e) => setEndPage(Math.max(startPage, Number(e.target.value) || 1))} />
                </label>
              </div>
            )}
          </div>

          <div className="options-row" style={{ marginTop: 0, gap: '16px', flexWrap: 'wrap' }}>
            <label className="checkbox-label">
              <input type="checkbox" checked={skipQuotes} onChange={(e) => setSkipQuotes(e.target.checked)} />
              Strip quote blocks (prevents duplicate links from user replies)
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={skipBots} onChange={(e) => setSkipBots(e.target.checked)} />
              Skip mirror bots (SussyBOT)
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={decodeBase64} onChange={(e) => setDecodeBase64(e.target.checked)} />
              Auto-decode Base64 links
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={ignoreHistory} onChange={(e) => setIgnoreHistory(e.target.checked)} />
              Ignore crawl history
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={useSavedCookies} onChange={(e) => setUseSavedCookies(e.target.checked)} />
              Use saved cookies.txt
            </label>
            <button type="button" className="btn-link" onClick={() => setShowCookies((v) => !v)}>
              {showCookies ? 'Hide' : 'Paste'} custom cookies
            </button>
          </div>

          {showCookies && (
            <label className="field-label">
              cookies.txt (Netscape format, used for this crawl only and not saved)
              <textarea className="mono" rows={5} value={cookiesText} onChange={(e) => setCookiesText(e.target.value)} spellCheck={false} />
            </label>
          )}

          <div className="options-row" style={{ marginTop: 0 }}>
            <button type="submit" disabled={crawling || !url.trim()}>{crawling ? 'Crawling…' : 'Start Crawl'}</button>
            {crawling && <span className="muted small">Fetching pages with gentle rate-limiting…</span>}
          </div>
          {error && <div className="alert alert-error" style={{ whiteSpace: 'pre-wrap' }}><AlertCircle size={15} />{error}</div>}
        </form>
      </section>

      {result && (
        <section className="panel">
          <div className="panel-header">
            <h2>
              {result.links.length} total link{result.links.length === 1 ? '' : 's'} on {result.pages.length} page{result.pages.length === 1 ? '' : 's'}
              {result.maxPage > result.pages.length && <span className="muted small" style={{ fontWeight: 'normal', marginLeft: '8px' }}>(Total in thread: {result.maxPage} pages)</span>}
            </h2>
          </div>

          {result.threadTitle && <p className="panel-description"><strong>Thread:</strong> {result.threadTitle}</p>}

          {result.passwords?.length > 0 && (
            <div className="alert alert-success" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', margin: '8px 0 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <Key size={16} />
                <strong>Discovered archive password{result.passwords.length > 1 ? 's' : ''}:</strong>
                {result.passwords.map((pw) => (
                  <code key={pw} style={{ padding: '2px 8px', background: 'rgba(0,0,0,0.1)', borderRadius: '4px', fontWeight: 'bold' }}>{pw}</code>
                ))}
              </div>
              <button type="button" className="btn-secondary small" onClick={() => copyPasswords(result.passwords)}>
                <Copy size={13} /> Copy password{result.passwords.length > 1 ? 's' : ''}
              </button>
            </div>
          )}

          {result.hasMorePages && <div className="alert alert-warning">There are more pages in this thread — adjust crawl mode or page count to include them.</div>}
          {result.truncated && <div className="alert alert-warning">Stopped listing at 2,000 links.</div>}
          {result.error && <div className="alert alert-warning">Stopped early: {result.error}</div>}

          {result.links.length > 0 && (
            <>
              <div className="chip-row lg-filters">
                <button type="button" className={`chip${statusFilter === 'all' ? ' active' : ''}`} onClick={() => setStatusFilter('all')}>
                  All ({result.links.length})
                </button>
                <button type="button" className={`chip${statusFilter === 'new' ? ' active' : ''}`} onClick={() => setStatusFilter('new')}>
                  New Unseen ({result.newCount})
                </button>
                {result.historyCount > 0 && (
                  <button type="button" className={`chip${statusFilter === 'history' ? ' active' : ''}`} onClick={() => setStatusFilter('history')}>
                    Previously Crawled ({result.historyCount})
                  </button>
                )}
              </div>

              <div className="chip-row lg-filters">
                <button type="button" className={`chip${hostFilter === 'all' ? ' active' : ''}`} onClick={() => setHostFilter('all')}>
                  All hosts <span className="chip-count">{result.links.length}</span>
                </button>
                {hosts.map(([host, count]) => (
                  <button key={host} type="button" className={`chip${hostFilter === host ? ' active' : ''}`} onClick={() => setHostFilter(host)}>
                    {host} <span className="chip-count">{count}</span>
                  </button>
                ))}
              </div>

              <div className="toolbar lg-toolbar">
                <input type="search" placeholder="Filter by text in the URL" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter links" />
                <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Link type">
                  <option value="all">All types</option>
                  {Object.entries(KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>

              <ul className="lg-list">
                <li className="lg-row lg-row-head">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                    Select {visible.length} shown
                  </label>
                  <span className="muted small">
                    {selected.size} of {result.links.length} selected
                  </span>
                </li>
                {visible.map((l) => (
                  <li key={l.url} className="lg-row">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={selected.has(l.url)} onChange={() => toggle(l.url)} />
                      <span className="lg-url mono">{l.url}</span>
                    </label>
                    <span className="lg-meta muted small" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {l.source === 'base64' && <span className="badge" style={{ background: '#7c3aed', color: '#fff', fontSize: '10px', padding: '1px 5px', borderRadius: '4px' }}>Base64</span>}
                      {!l.isNew && <span className="badge" style={{ background: '#475569', color: '#cbd5e1', fontSize: '10px', padding: '1px 5px', borderRadius: '4px' }}>Previously crawled</span>}
                      {KIND_LABELS[l.kind] || l.kind} · p.{l.page}{l.count > 1 ? ` · ×${l.count}` : ''}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="options-row lg-send" style={{ flexWrap: 'wrap', gap: '10px' }}>
                <span className="muted small">{selected.size} selected</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Send to">
                  {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>

                {target === 'jdownloader' && (
                  <label className="checkbox-label" style={{ fontSize: '13px' }}>
                    <input type="checkbox" checked={packagePerPage} onChange={(e) => setPackagePerPage(e.target.checked)} />
                    Package per page ([Page N] Title)
                  </label>
                )}

                <button type="button" onClick={handleSend} disabled={sending || selected.size === 0}>{sending ? 'Sending…' : 'Send links'}</button>
                <button type="button" className="btn-secondary" onClick={copySelected} disabled={selected.size === 0}>Copy selected links</button>
              </div>

              {target === 'jdownloader' && result.passwords?.length > 0 && (
                <p className="muted small" style={{ marginTop: '8px' }}>
                  ✓ Discovered passwords will be sent automatically with packages to JDownloader for automatic archive extraction.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
