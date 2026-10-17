import React, { useState } from 'react';
import { AlertCircle, Cookie, Trash2 } from 'lucide-react';

export default function CrawlerCookiesModal({ status, onClose, onSaved, onDeleted }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = String(evt.target.result || '').trim();
      setText(content);
      if (!content) return;
      setSaving(true);
      try {
        await onSaved(content);
        onClose();
      } catch (err) {
        setError(err.message);
      } finally {
        setSaving(false);
      }
    };
    reader.onerror = () => setError('Failed to read the selected file.');
    reader.readAsText(file);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSaved(text.trim());
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete the saved crawler cookie file?')) return;
    setDeleting(true);
    try {
      await onDeleted();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="panel lg-panel-accent">
      <div className="panel-header">
        <h2><Cookie size={16} /> Forum Crawler Cookies</h2>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
      <p className="panel-description">
        Save forum cookies so the crawler can access members-only content, attachments, and threads without asking every time.
        Export while logged into the forum using <em>Cookie-Editor</em> (JSON) or <em>Get cookies.txt LOCALLY</em> (Netscape format).
        Saved as <code>config/crawler_cookies.txt</code> and kept permanently.
      </p>

      {status?.configured && (
        <div className="alert alert-success lg-password-bar">
          <div>
            <strong>✓ Cookie file is currently saved and active:</strong> {status.cookieCount} cookies
            {status.domains?.length ? ` (${status.domains.join(', ')})` : ''}
          </div>
          <button type="button" className="btn-ghost small" onClick={handleDelete} disabled={deleting}>
            <Trash2 size={14} /> {deleting ? 'Removing…' : 'Delete saved cookies'}
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="settings-form">
        <label className="field-label">
          Choose a cookies file (.txt or .json)
          <input type="file" accept=".txt,.json" onChange={handleFileChange} />
          {fileName && <span className="muted small">Selected: {fileName}</span>}
        </label>
        <label className="field-label">
          …or paste cookies directly
          <textarea
            className="mono"
            rows={6}
            placeholder="# Netscape HTTP Cookie File or JSON array..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="options-row lg-options">
          <button type="submit" disabled={saving || !text.trim()}>
            {saving ? 'Saving…' : 'Save cookie file'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
        {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
      </form>
    </section>
  );
}
