import React, { useState } from 'react';
import { Cookie, CheckCircle2, AlertCircle, Upload } from 'lucide-react';
import { api } from '../api.js';

// Upload/clear one site's own cookies file (Reddit, Twitter/X). Kept separate from the shared
// cookies.txt, so saving here never touches the YouTube session. `status` comes from
// api.getSiteCookies(); onChange refreshes it.
export default function SiteCookiesPanel({ site, status, description, onChange }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const label = status?.label || site;

  async function save(content) {
    setMessage('');
    setError('');
    setBusy(true);
    try {
      const res = await api.saveSiteCookies(site, content);
      setText('');
      setMessage(`${label} cookies saved (${res.cookieCount} cookies).`);
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setMessage('');
    setError('');
    try {
      await api.clearSiteCookies(site);
      setFileName('');
      setMessage(`${label} cookies removed.`);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.onerror = () => setError('Failed to read the selected file.');
    reader.readAsText(file);
  }

  return (
    <section className="panel" style={{ marginTop: '24px' }}>
      <div className="panel-header">
        <h2><Cookie size={16} /> {label} cookies</h2>
        {status && (
          <span className={`tag status-tag ${status.configured ? 'status-completed' : ''}`}>
            {status.configured ? `Active (${status.cookieCount} cookies)` : 'Not configured'}
          </span>
        )}
      </div>
      <p className="panel-description">
        {description} Only cookies for {status?.domains?.join(', ') || 'this site'} are kept, so a
        full-browser export is fine. Stored separately from the cookies.txt above.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); save(text); }} className="settings-form">
        <label className="file-input-label">
          <Upload size={14} />
          {fileName || `Upload ${label} cookies.txt…`}
          <input type="file" accept=".txt,text/plain" onChange={handleFile} hidden />
        </label>
        <textarea
          placeholder="…or paste cookies.txt contents here"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="options-row" style={{ marginTop: 0 }}>
          <button type="submit" disabled={busy || !text.trim()}>
            {busy ? 'Saving…' : `Save ${label} cookies`}
          </button>
          {status?.configured && (
            <button type="button" className="btn-secondary" onClick={handleClear}>
              Remove {label} cookies
            </button>
          )}
        </div>
        {message && <div className="alert alert-success"><CheckCircle2 size={15} />{message}</div>}
        {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
      </form>
    </section>
  );
}
