import React, { useEffect, useState } from 'react';
import { ListMusic, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api.js';

// Plex counterpart of the Jellyfin auto-delete + playlist sync panels, kept in one place
// since Plex has its own connection (URL + token) rather than sharing Jellyfin's.
export default function PlexSettings() {
  const [settings, setSettings] = useState(null);
  const [tokenInput, setTokenInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sections, setSections] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    api.getPlexSettings().then(setSettings).catch(() => {});
  }, []);

  function updateField(field, value) {
    setSettings((prev) => ({ ...prev, [field]: value }));
  }

  async function run(action) {
    setMessage('');
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleSave(e) {
    e.preventDefault();
    run(async () => {
      const payload = {
        url: settings.url || '',
        sectionIds: settings.sectionIds || '',
        syncEnabled: !!settings.syncEnabled,
        autoScanEnabled: settings.autoScanEnabled !== false,
        cleanupEnabled: !!settings.cleanupEnabled,
      };
      if (tokenInput) payload.token = tokenInput;
      setSettings(await api.updatePlexSettings(payload));
      setTokenInput('');
      setMessage('Plex settings saved.');
    });
  }

  function handleTest() {
    run(async () => {
      const payload = {};
      if (settings.url) payload.url = settings.url;
      if (tokenInput) payload.token = tokenInput;
      const result = await api.testPlexConnection(payload);
      setSections(result.sections || []);
      setMessage(`Connected to Plex${result.version ? ` ${result.version}` : ''} — ${result.sectionCount} librar${result.sectionCount === 1 ? 'y' : 'ies'} found.`);
    });
  }

  function handleRefresh() {
    run(async () => {
      const result = await api.refreshPlexLibrary();
      setMessage(result.message || 'Plex library refresh started.');
    });
  }

  function handleSyncNow() {
    setSyncResult(null);
    run(async () => {
      const result = await api.syncPlexPlaylists();
      if (result.skipped) throw new Error('Save a Plex URL and token first.');
      setSyncResult(result.results);
    });
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2><ListMusic size={16} /> Plex</h2>
      </div>
      <p className="panel-description">
        Tells a Plex server to scan new downloads, keeps a Plex playlist per Watch, and can
        delete downloads once they've been watched in Plex. Get a token from Plex Web: open any
        item, choose <em>Get Info → View XML</em>, and copy the <code>X-Plex-Token</code> value
        from the address bar. Watched status and playlists belong to the account that token
        is for. Plex doesn't read the <code>.nfo</code> files this app writes, so titles come
        from file names — an <em>Other Videos</em> library works best. If this app runs in
        Docker, use your machine's LAN IP for the URL, not <code>localhost</code>.
      </p>
      {!settings ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : (
        <form className="settings-form" onSubmit={handleSave}>
          <label className="field-label">
            Plex server URL
            <input
              type="text"
              placeholder="http://192.168.1.10:32400"
              value={settings.url || ''}
              onChange={(e) => updateField('url', e.target.value)}
            />
          </label>
          <label className="field-label">
            Plex token
            <input
              type="password"
              placeholder={settings.tokenConfigured ? '••••••••  (saved — enter a new token to replace)' : 'Paste your X-Plex-Token'}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field-label">
            Library IDs (optional)
            <input
              type="text"
              placeholder="Leave blank to use every video and music library"
              value={settings.sectionIds || ''}
              onChange={(e) => updateField('sectionIds', e.target.value)}
            />
            {sections && sections.length > 0 && (
              <span className="muted small">
                Found: {sections.map((s) => `${s.title} (${s.id}, ${s.type})`).join(' · ')}
              </span>
            )}
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.autoScanEnabled !== false}
              onChange={(e) => updateField('autoScanEnabled', e.target.checked)}
            />
            Scan Plex libraries when downloads complete
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={!!settings.syncEnabled}
              onChange={(e) => updateField('syncEnabled', e.target.checked)}
            />
            Automatically sync a Plex playlist per Watch (after each download, and every 15 minutes)
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={!!settings.cleanupEnabled}
              onChange={(e) => updateField('cleanupEnabled', e.target.checked)}
            />
            Delete Watch downloads once watched in Plex (uses the auto-delete safety guards above)
          </label>

          <div className="options-row" style={{ marginTop: 0 }}>
            <button type="submit" disabled={busy}>{busy ? 'Working…' : 'Save Plex settings'}</button>
            <button type="button" className="btn-secondary" onClick={handleTest} disabled={busy}>Test connection</button>
            <button type="button" className="btn-secondary" onClick={handleRefresh} disabled={busy}>Scan Plex library</button>
            <button type="button" className="btn-secondary" onClick={handleSyncNow} disabled={busy}>Sync all playlists now</button>
          </div>

          {message && <div className="alert alert-success"><CheckCircle2 size={15} />{message}</div>}
          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}

          {syncResult && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              {syncResult.length === 0 ? (
                <p className="muted small" style={{ margin: 0 }}>No watches have any completed downloads yet.</p>
              ) : (
                <ul className="cleanup-preview-list">
                  {syncResult.map((r) => (
                    <li key={r.watchId}>
                      <span className="cleanup-preview-title">{r.playlistName || `Watch #${r.watchId}`}</span>
                      <span className="muted small">
                        {r.error
                          ? r.error
                          : `+${r.added} added${r.alreadyPresent ? `, ${r.alreadyPresent} already present` : ''}${r.missingFromLibrary ? `, ${r.missingFromLibrary} not yet in Plex` : ''}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      )}
    </section>
  );
}
