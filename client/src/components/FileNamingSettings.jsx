import React, { useEffect, useState } from 'react';
import { FolderTree, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api.js';
import { previewTemplate } from '../outputTemplatePreview.js';

const CUSTOM = 'custom';

export default function FileNamingSettings() {
  const [info, setInfo] = useState(null);
  const [template, setTemplate] = useState('');
  const [videoFolder, setVideoFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getOutputTemplate()
      .then((data) => {
        setInfo(data);
        setTemplate(data.template);
        setVideoFolder(data.videoFolder || '');
      })
      .catch((err) => setError(err.message));
  }, []);

  const presetId = info?.presets.find((p) => p.template === template)?.id || CUSTOM;

  async function handleSave(e) {
    e.preventDefault();
    setMessage('');
    setError('');
    setBusy(true);
    try {
      // Saving the default stores a blank value, so a future change to the built-in
      // default still applies to anyone who never customized it.
      const value = template.trim() === info.defaultTemplate ? '' : template.trim();
      await api.updateSettings({ output_template: value, video_folder: videoFolder.trim() });
      // Re-read so the resolved folder shown below reflects what was saved.
      const fresh = await api.getOutputTemplate();
      setInfo(fresh);
      setTemplate(fresh.template);
      setVideoFolder(fresh.videoFolder || '');
      setMessage('Saved — new downloads will use this layout. Existing files are not moved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2><FolderTree size={16} /> File naming</h2>
      </div>
      <p className="panel-description">
        Where new video downloads are saved: a base video folder, then a{' '}
        <a href="https://github.com/yt-dlp/yt-dlp#output-template" target="_blank" rel="noreferrer noopener">yt-dlp output template</a>.
        Each Watch can override this in its <em>Format</em> tab. Music downloads keep their own
        Artist/Album layout.
      </p>
      {!info ? (
        error ? <div className="alert alert-error"><AlertCircle size={15} />{error}</div> : <div className="empty-state"><div className="spinner" /></div>
      ) : (
        <form className="settings-form template-form" onSubmit={handleSave}>
          <label className="field-label" htmlFor="video-folder-input">Video folder</label>
          <input
            id="video-folder-input"
            className="mono-input"
            value={videoFolder}
            onChange={(e) => setVideoFolder(e.target.value)}
            placeholder={info.defaultVideoDir}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <span className="muted small">
            Absolute path inside the container (e.g. <code>/videos</code>), or relative to the downloads folder.
            Leave blank to use the default (<code>{info.defaultVideoDir}</code>, set by the <code>VIDEO_DIR</code> mount).
            Videos currently go to <code>{info.videoDir}</code>.
          </span>

          <label className="field-label" htmlFor="template-preset">Layout</label>
          <select
            id="template-preset"
            value={presetId}
            onChange={(e) => {
              const preset = info.presets.find((p) => p.id === e.target.value);
              if (preset) setTemplate(preset.template);
            }}
          >
            {info.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            <option value={CUSTOM}>Custom…</option>
          </select>

          <label className="field-label" htmlFor="template-input">Template</label>
          <input
            id="template-input"
            className="mono-input"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />

          <div className="template-preview">
            <span className="muted small">Example result (approximate):</span>
            <code>{info.videoDir.replace(/[\\/]+$/, '')}/{previewTemplate(template.trim() || info.defaultTemplate)}</code>
          </div>

          <div className="options-row" style={{ marginTop: 0 }}>
            <button type="submit" disabled={busy || !template.trim() || (template.trim() === info.template && videoFolder.trim() === (info.videoFolder || ''))}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {template.trim() !== info.defaultTemplate && (
              <button type="button" className="btn-ghost" onClick={() => setTemplate(info.defaultTemplate)} disabled={busy}>
                Reset to default
              </button>
            )}
          </div>

          {message && <div className="alert alert-success"><CheckCircle2 size={15} />{message}</div>}
          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
        </form>
      )}
    </section>
  );
}
