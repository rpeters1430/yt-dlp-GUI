import React, { useEffect, useState } from 'react';
import { Settings2, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { api } from '../../api.js';

export default function DownloaderSettings({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testingJd, setTestingJd] = useState(false);
  const [jdTestStatus, setJdTestStatus] = useState(null);
  const [testingSolver, setTestingSolver] = useState(false);
  const [solverTestStatus, setSolverTestStatus] = useState(null);
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

  async function handleTestSolver() {
    const solverUrl = settings?.solverUrl || '';
    if (!solverUrl.trim()) {
      setSolverTestStatus({ ok: false, message: 'Please enter a Challenge Solver address first' });
      return;
    }
    setTestingSolver(true);
    setSolverTestStatus(null);
    try {
      await api.updateLinkGrabberSettings({ solverUrl: solverUrl.trim() });
      const res = await api.testSolver(solverUrl.trim());
      setSolverTestStatus(res);
    } catch (err) {
      setSolverTestStatus({ ok: false, message: err.message });
    } finally {
      setTestingSolver(false);
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
      const payload = {
        jdUrl: settings.jdUrl || '',
        aria2Url: settings.aria2Url || '',
        aria2Dir: settings.aria2Dir || '',
        userAgent: settings.userAgent || '',
        solverUrl: settings.solverUrl || '',
      };
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
        JDownloader and pyLoad receive links via Click&apos;n&apos;Load on port <strong>9666</strong>. If running in Docker
        on a NAS (e.g. <code>jlesage/docker-jdownloader-2</code> or <code>linuxserver/pyload-ng</code>), ensure port 9666 is mapped in Docker (port 5800/8000 is only the web GUI), and
        ensure external connections are permitted.
      </p>
      {!settings ? (
        error ? <div className="alert alert-error"><AlertCircle size={15} />{error}</div> : <div className="empty-state"><div className="spinner" /></div>
      ) : (
        <form className="settings-form" onSubmit={handleSave}>
          <div className="field-group">
            <label className="field-label">
              JDownloader Click&apos;n&apos;Load address
              <div className="lg-input-row">
                <input
                  type="text"
                  placeholder="http://192.168.50.114:9666"
                  value={settings.jdUrl || ''}
                  onChange={update('jdUrl')}
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
              <div className={`alert ${jdTestStatus.ok ? 'alert-success' : jdTestStatus.isWebUi ? 'alert-warning' : 'alert-error'}`}>
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
          <label className="field-label">
            Crawler User-Agent (optional)
            <input type="text" className="mono" placeholder="Leave blank for the built-in Chrome User-Agent" value={settings.userAgent || ''} onChange={update('userAgent')} />
            <span className="muted small">
              For Cloudflare-protected forums, paste the exact User-Agent of the browser you exported cookies from
              (search &quot;my user agent&quot; in it). Cloudflare only accepts its <code>cf_clearance</code> cookie from that browser.
            </span>
          </label>

          <div className="field-group">
            <label className="field-label">
              Challenge Solver (Solverr / FlareSolverr) address (optional)
              <div className="lg-input-row">
                <input
                  type="text"
                  placeholder="http://192.168.50.114:8191"
                  value={settings.solverUrl || ''}
                  onChange={update('solverUrl')}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleTestSolver}
                  disabled={testingSolver || !settings.solverUrl}
                >
                  {testingSolver ? 'Testing…' : 'Test connection'}
                </button>
              </div>
            </label>
            {solverTestStatus && (
              <div className={`alert ${solverTestStatus.ok ? 'alert-success' : 'alert-error'}`}>
                {solverTestStatus.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                {solverTestStatus.message}
              </div>
            )}
            <span className="muted small">
              Optional local Solverr or FlareSolverr service (e.g. on your NAS or Docker). Automatically bypasses Cloudflare and DDoS-Guard challenges and shares solved clearance cookies with the crawler.
            </span>
          </div>

          {historyStats && (
            <div className="lg-history-box">
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

          <div className="options-row lg-options">
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
          {message && <div className="alert alert-success"><CheckCircle2 size={15} />{message}</div>}
          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
        </form>
      )}
    </section>
  );
}
