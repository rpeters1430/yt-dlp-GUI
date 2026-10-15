import React, { useEffect, useMemo, useState } from 'react';
import { Link2, Settings2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';

const KIND_LABELS = { video: 'Video file', audio: 'Audio file', archive: 'Archive', embed: 'Embed', link: 'Link' };
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

  useEffect(() => {
    api.getLinkGrabberSettings().then(setSettings).catch((err) => setError(err.message));
  }, []);

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
        <h2><Settings2 size={16} /> External downloaders</h2>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
      <p className="panel-description">
        JDownloader receives links through Click&apos;n&apos;Load on port 9666. If it runs on another machine, turn on
        remote Click&apos;n&apos;Load in JDownloader&apos;s advanced settings. aria2 needs <code>--enable-rpc</code>
        (and <code>--rpc-listen-all</code> to be reachable over the network). The download folder is a path on the
        aria2 machine.
      </p>
      {!settings ? (
        error ? <div className="alert alert-error"><AlertCircle size={15} />{error}</div> : <div className="empty-state"><div className="spinner" /></div>
      ) : (
        <form className="settings-form" onSubmit={handleSave}>
          <label className="field-label">
            JDownloader address
            <input type="text" placeholder="http://192.168.1.20:9666" value={settings.jdUrl || ''} onChange={update('jdUrl')} />
          </label>
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
  const [maxPages, setMaxPages] = useState(5);
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
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState('queue');
  const [sending, setSending] = useState(false);

  async function handleCrawl(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setCrawling(true);
    setError('');
    setResult(null);
    setSelected(new Set());
    setHostFilter('all');
    setKindFilter('all');
    try {
      const data = await api.crawlLinks({ url: url.trim(), maxPages, useSavedCookies, cookies: cookiesText || undefined });
      setResult(data);
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
      && (!q || l.url.toLowerCase().includes(q)));
  }, [result, hostFilter, kindFilter, search]);

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
      const res = await api.sendLinks({ target, urls, packageName: result?.pages?.[0]?.title || '' });
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

  return (
    <>
      <div className="page-title-row">
        <h1>Link grabber</h1>
        <div className="page-title-actions">
          <button type="button" className="btn-secondary" onClick={() => setShowSettings((v) => !v)}>
            <Settings2 size={15} /> Downloaders
          </button>
        </div>
      </div>

      {showSettings && <DownloaderSettings onClose={() => setShowSettings(false)} />}

      <section className="panel">
        <div className="panel-header">
          <h2><Link2 size={16} /> Find links on a page</h2>
        </div>
        <p className="panel-description">
          Paste a page and this collects the links, embedded players and media files on it, following its
          &ldquo;next page&rdquo; links up to the page limit. Pick what you want and download it here or send it to
          JDownloader or aria2. Only grab content you have the right to download.
        </p>
        <form className="settings-form" onSubmit={handleCrawl}>
          <label className="field-label">
            Page URL
            <input className="mono" type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </label>
          <div className="options-row" style={{ marginTop: 0 }}>
            <label className="field-label lg-pages">
              Pages to follow
              <input type="number" min={1} max={25} value={maxPages} onChange={(e) => setMaxPages(Math.min(25, Math.max(1, Number(e.target.value) || 1)))} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={useSavedCookies} onChange={(e) => setUseSavedCookies(e.target.checked)} />
              Use the cookies.txt saved in Settings
            </label>
            <button type="button" className="btn-link" onClick={() => setShowCookies((v) => !v)}>
              {showCookies ? 'Hide' : 'Paste'} cookies for this crawl
            </button>
          </div>
          {showCookies && (
            <label className="field-label">
              cookies.txt (Netscape format, used for this crawl only and not saved)
              <textarea className="mono" rows={5} value={cookiesText} onChange={(e) => setCookiesText(e.target.value)} spellCheck={false} />
            </label>
          )}
          <div className="options-row" style={{ marginTop: 0 }}>
            <button type="submit" disabled={crawling || !url.trim()}>{crawling ? 'Crawling…' : 'Find links'}</button>
            {crawling && <span className="muted small">Pages are fetched a second or two apart.</span>}
          </div>
          {error && <div className="alert alert-error" style={{ whiteSpace: 'pre-wrap' }}><AlertCircle size={15} />{error}</div>}
        </form>
      </section>

      {result && (
        <section className="panel">
          <div className="panel-header">
            <h2>{result.links.length} link{result.links.length === 1 ? '' : 's'} on {result.pages.length} page{result.pages.length === 1 ? '' : 's'}</h2>
          </div>
          {result.pages[0]?.title && <p className="panel-description">{result.pages[0].title}</p>}
          {result.hasMorePages && <div className="alert alert-warning">There are more pages — raise &ldquo;Pages to follow&rdquo; to include them.</div>}
          {result.truncated && <div className="alert alert-warning">Stopped listing at 2,000 links.</div>}
          {result.error && <div className="alert alert-warning">Stopped early: {result.error}</div>}

          {result.links.length > 0 && (
            <>
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
                </li>
                {visible.map((l) => (
                  <li key={l.url} className="lg-row">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={selected.has(l.url)} onChange={() => toggle(l.url)} />
                      <span className="lg-url mono">{l.url}</span>
                    </label>
                    <span className="lg-meta muted small">
                      {KIND_LABELS[l.kind] || l.kind} · page {l.page}{l.count > 1 ? ` · ×${l.count}` : ''}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="options-row lg-send">
                <span className="muted small">{selected.size} selected</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Send to">
                  {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <button type="button" onClick={handleSend} disabled={sending || selected.size === 0}>{sending ? 'Sending…' : 'Send'}</button>
                <button type="button" className="btn-secondary" onClick={copySelected} disabled={selected.size === 0}>Copy links</button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
