import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Settings2, AlertCircle, Cookie, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useDownloads } from '../context/DownloadsContext.jsx';
import DownloaderSettings from './linkgrabber/DownloaderSettings.jsx';
import CrawlerCookiesModal from './linkgrabber/CrawlerCookiesModal.jsx';
import LinkResults from './linkgrabber/LinkResults.jsx';
import RecentCrawls from './linkgrabber/RecentCrawls.jsx';
import ThreadWatches from './linkgrabber/ThreadWatches.jsx';

const POLL_MS = 2000;

function upsert(list, summary) {
  const i = list.findIndex((c) => c.id === summary.id);
  if (i === -1) return [summary, ...list];
  const next = list.slice();
  next[i] = { ...next[i], ...summary };
  return next;
}

export default function LinkGrabber() {
  const showToast = useToast();
  const { subscribeLinkGrabber, connected } = useDownloads();
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
  const [useSavedCookies, setUseSavedCookies] = useState(true);
  const [cookiesText, setCookiesText] = useState('');
  const [showCookies, setShowCookies] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCookiesModal, setShowCookiesModal] = useState(false);
  const [cookieStatus, setCookieStatus] = useState(null);
  const [error, setError] = useState('');
  const [crawls, setCrawls] = useState([]);
  // The crawl being shown: its id while it runs, then the full crawl (with result) once done.
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [watchDraft, setWatchDraft] = useState(null);
  const resultsRef = useRef(null);
  const activeIdRef = useRef(null);
  activeIdRef.current = activeId;

  const running = crawls.find((c) => c.id === activeId && c.status === 'running') || null;

  const openCrawl = useCallback(async (id, { scroll = true } = {}) => {
    try {
      const crawl = await api.getCrawl(id);
      setActiveId(id);
      if (crawl.status === 'running') return;
      setActive(crawl);
      if (crawl.status === 'failed') setError(crawl.error || 'The crawl failed');
      if (scroll) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }, [showToast]);

  useEffect(() => {
    loadCookieStatus();
    api.listCrawls().then(setCrawls).catch(() => {});
  }, []);

  // Progress and finished crawls arrive over the socket; a finished active crawl is opened.
  useEffect(() => subscribeLinkGrabber((event, payload) => {
    if (!payload?.id) return;
    if (event === 'linkgrabber:progress') {
      setCrawls((prev) => upsert(prev, { id: payload.id, status: 'running', progress: payload, threadTitle: payload.title || '' }));
    } else if (event === 'linkgrabber:crawl') {
      setCrawls((prev) => upsert(prev, payload));
      if (payload.id === activeIdRef.current && payload.status !== 'running') openCrawl(payload.id, { scroll: true });
    }
  }), [subscribeLinkGrabber, openCrawl]);

  // Without the socket, poll the running crawl instead.
  useEffect(() => {
    if (!running || connected) return undefined;
    const timer = setInterval(async () => {
      try {
        const crawl = await api.getCrawl(running.id);
        setCrawls((prev) => upsert(prev, crawl));
        if (crawl.status !== 'running') openCrawl(crawl.id);
      } catch {
        // Try again on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, connected, openCrawl]);

  async function loadCookieStatus() {
    try {
      setCookieStatus(await api.getLinkGrabberCookies());
    } catch {
      // Non-fatal
    }
  }

  async function handleSaveCrawlerCookies(content) {
    const res = await api.saveLinkGrabberCookies(content);
    showToast(`Saved crawler cookies (${res.cookieCount} cookies)`);
    await loadCookieStatus();
  }

  async function handleDeleteCrawlerCookies() {
    await api.deleteLinkGrabberCookies();
    showToast('Saved crawler cookies deleted');
    await loadCookieStatus();
  }

  function handleDirectCookieUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = String(evt.target.result || '').trim();
      if (!content) return;
      try {
        await handleSaveCrawlerCookies(content);
      } catch (err) {
        showToast(err.message, { error: true });
      }
    };
    reader.onerror = () => showToast('Failed to read selected cookie file', { error: true });
    reader.readAsText(file);
    e.target.value = '';
  }

  // A pasted XenForo thread URL defaults to crawling the whole thread.
  useEffect(() => {
    if (/\/threads\/[^/]+/.test(url)) setMode((m) => (m === 'follow' ? 'all' : m));
  }, [url]);

  async function handleCrawl(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setError('');
    setActive(null);
    try {
      const { id } = await api.crawlLinks({
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
      setActiveId(id);
      setCrawls((prev) => upsert(prev, { id, url: url.trim(), status: 'running', progress: null, threadTitle: '', createdAt: new Date().toISOString() }));
      // A crawl that fails at once can finish before this tab knew its id, missing the event.
      const now = await api.getCrawl(id);
      if (now.status !== 'running') {
        setCrawls((prev) => upsert(prev, now));
        openCrawl(id);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelCrawl(id) {
    try {
      await api.cancelCrawl(id);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }

  async function deleteCrawl(id) {
    try {
      await api.deleteCrawl(id);
      setCrawls((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActive(null);
        setActiveId(null);
      }
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }

  const onLinksChange = useCallback((updater) => {
    setActive((prev) => {
      if (!prev?.result) return prev;
      const links = updater(prev.result.links);
      const newCount = links.filter((l) => l.isNew).length;
      return { ...prev, result: { ...prev.result, links, newCount, historyCount: links.length - newCount } };
    });
  }, []);

  const onWatch = useCallback((threadUrl, title) => setWatchDraft({ url: threadUrl, title }), []);
  const clearWatchDraft = useCallback(() => setWatchDraft(null), []);
  const progress = running?.progress;

  return (
    <>
      <div className="page-title-row">
        <h1>Link grabber &amp; forum crawler</h1>
        <div className="page-title-actions">
          <button type="button" className="btn-secondary" onClick={() => setShowCookiesModal((v) => !v)}>
            <Cookie size={15} /> Crawler cookies {cookieStatus?.configured ? `(${cookieStatus.cookieCount})` : ''}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setShowSettings((v) => !v)}>
            <Settings2 size={15} /> Downloaders
          </button>
        </div>
      </div>

      {showCookiesModal && (
        <CrawlerCookiesModal
          status={cookieStatus}
          onClose={() => setShowCookiesModal(false)}
          onSaved={handleSaveCrawlerCookies}
          onDeleted={handleDeleteCrawlerCookies}
        />
      )}

      {showSettings && <DownloaderSettings onClose={() => setShowSettings(false)} />}

      <section className="panel">
        <div className="panel-header">
          <h2><Link2 size={16} /> Crawl a thread or page for download links</h2>
        </div>
        <p className="panel-description">
          Finds file host links (MEGA, Pixeldrain, Bunkr and the like) post by post, skipping quotes, signatures and repost bots,
          decodes Base64 links and picks up archive passwords. Links you&apos;ve sent before are marked, so you only grab what&apos;s new.
        </p>
        <form className="settings-form" onSubmit={handleCrawl}>
          <label className="field-label">
            Page or forum thread URL
            <input className="mono" type="url" placeholder="https://forum.example/threads/name.123/ or https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </label>

          <div className="options-row lg-options">
            <label className="field-label lg-mode">
              Crawl mode
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="follow">Follow &quot;Next&quot; links</option>
                <option value="all">Whole thread</option>
                <option value="last">Last N pages</option>
                <option value="range">Page range</option>
                <option value="single">Single page</option>
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
              <div className="lg-range">
                <label className="field-label">
                  From
                  <input type="number" min={1} value={startPage} onChange={(e) => setStartPage(Math.max(1, Number(e.target.value) || 1))} />
                </label>
                <label className="field-label">
                  To
                  <input type="number" min={startPage} value={endPage} onChange={(e) => setEndPage(Math.max(startPage, Number(e.target.value) || 1))} />
                </label>
              </div>
            )}
          </div>

          <div className="options-row lg-options">
            <label className="checkbox-label">
              <input type="checkbox" checked={skipQuotes} onChange={(e) => setSkipQuotes(e.target.checked)} />
              Skip quoted posts
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={skipBots} onChange={(e) => setSkipBots(e.target.checked)} />
              Skip mirror bots
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={decodeBase64} onChange={(e) => setDecodeBase64(e.target.checked)} />
              Decode Base64 links
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={ignoreHistory} onChange={(e) => setIgnoreHistory(e.target.checked)} />
              Treat every link as new
            </label>

            {cookieStatus?.configured ? (
              <span className="lg-inline">
                <label className="checkbox-label">
                  <input type="checkbox" checked={useSavedCookies} onChange={(e) => setUseSavedCookies(e.target.checked)} />
                  Use saved cookies
                </label>
                <span className="lg-badge lg-badge-online">{cookieStatus.cookieCount} saved</span>
                <label className="btn-secondary small lg-file-btn">
                  <Upload size={13} /> Replace
                  <input type="file" accept=".txt,.json" onChange={handleDirectCookieUpload} hidden />
                </label>
                <button type="button" className="btn-ghost small" onClick={() => setShowCookiesModal(true)}>Manage</button>
              </span>
            ) : (
              <span className="lg-inline">
                <label className="btn-secondary small lg-file-btn">
                  <Upload size={13} /> Upload cookies (kept for all crawls)
                  <input type="file" accept=".txt,.json" onChange={handleDirectCookieUpload} hidden />
                </label>
                <button type="button" className="btn-ghost small" onClick={() => setShowCookiesModal(true)}>
                  <Cookie size={13} /> Paste
                </button>
              </span>
            )}

            <button type="button" className="btn-link small" onClick={() => setShowCookies((v) => !v)}>
              {showCookies ? 'Hide' : 'Paste'} cookies for this crawl only
            </button>
          </div>

          {showCookies && (
            <label className="field-label">
              Cookies for this crawl only (Netscape or JSON). Used instead of the saved ones, and not stored.
              <textarea className="mono" rows={5} value={cookiesText} onChange={(e) => setCookiesText(e.target.value)} spellCheck={false} />
            </label>
          )}

          <div className="options-row">
            <button type="submit" disabled={Boolean(running) || !url.trim()}>{running ? 'Crawling…' : 'Start crawl'}</button>
          </div>

          {running && (
            <div className="lg-progress" aria-live="polite">
              <div className="lg-progress-line muted small">
                <span>
                  {progress
                    ? `Page ${progress.pagesDone} of ${progress.pagesPlanned}${progress.title ? ` · ${progress.title}` : ''} · ${progress.links} link${progress.links === 1 ? '' : 's'} so far`
                    : 'Fetching the first page…'}
                </span>
                <button type="button" className="btn-ghost small" onClick={() => cancelCrawl(running.id)}><X size={14} /> Cancel</button>
              </div>
              <div className="progress">
                <div style={{ width: `${progress ? Math.round((progress.pagesDone / Math.max(1, progress.pagesPlanned)) * 100) : 3}%` }} />
              </div>
            </div>
          )}
          {error && <div className="alert alert-error lg-prewrap"><AlertCircle size={15} />{error}</div>}
        </form>
      </section>

      <div ref={resultsRef}>
        {active?.result && (
          <LinkResults key={active.id} crawl={active} onLinksChange={onLinksChange} onWatch={onWatch} />
        )}
      </div>

      <ThreadWatches draft={watchDraft} onDraftUsed={clearWatchDraft} onOpenCrawl={(id) => openCrawl(id)} />

      <RecentCrawls crawls={crawls} activeId={activeId} onOpen={(id) => openCrawl(id)} onCancel={cancelCrawl} onDelete={deleteCrawl} />
    </>
  );
}
