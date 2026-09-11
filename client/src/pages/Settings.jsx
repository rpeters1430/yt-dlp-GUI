import React, { useEffect, useState } from 'react';
import { KeyRound, Cookie, PackageCheck, CheckCircle2, AlertCircle, Upload, Trash2 } from 'lucide-react';
import { api } from '../api.js';

export default function Settings() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [cookiesConfigured, setCookiesConfigured] = useState(null);
  const [cookiesText, setCookiesText] = useState('');
  const [cookiesMessage, setCookiesMessage] = useState('');
  const [cookiesError, setCookiesError] = useState('');
  const [cookiesBusy, setCookiesBusy] = useState(false);
  const [cookiesFileName, setCookiesFileName] = useState('');

  const [versions, setVersions] = useState(null);
  const [channel, setChannel] = useState('stable');
  const [ytdlpBusy, setYtdlpBusy] = useState(false);
  const [ytdlpMessage, setYtdlpMessage] = useState('');
  const [ytdlpError, setYtdlpError] = useState('');

  const [ffmpegBusy, setFfmpegBusy] = useState(false);
  const [ffmpegMessage, setFfmpegMessage] = useState('');
  const [ffmpegError, setFfmpegError] = useState('');

  const [cleanupSettings, setCleanupSettings] = useState(null);
  const [jellyfinApiKeyInput, setJellyfinApiKeyInput] = useState('');
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState('');
  const [cleanupError, setCleanupError] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testError, setTestError] = useState('');
  const [runNowBusy, setRunNowBusy] = useState(false);
  const [runNowMessage, setRunNowMessage] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);
  const [previewError, setPreviewError] = useState('');

  const [nfoEnabled, setNfoEnabled] = useState(true);
  const [nfoBusy, setNfoBusy] = useState(false);
  const [nfoMessage, setNfoMessage] = useState('');

  function refreshCookiesStatus() {
    api.getCookiesStatus().then((s) => setCookiesConfigured(s.configured)).catch(() => {});
  }

  function refreshVersions() {
    api.getYtdlpVersions().then(setVersions).catch(() => {});
  }

  useEffect(refreshCookiesStatus, []);
  useEffect(refreshVersions, []);
  useEffect(() => {
    api.getSettings().then((s) => {
      if (s.ytdlpChannel) setChannel(s.ytdlpChannel);
      setNfoEnabled(s.nfo_enabled !== '0');
    }).catch(() => {});
  }, []);
  useEffect(() => {
    api.getCleanupSettings().then(setCleanupSettings).catch(() => {});
  }, []);

  async function handleChangePassword(e) {
    e.preventDefault();
    setMessage('');
    setError('');
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    try {
      await api.changePassword(newPassword);
      setMessage('Password updated.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveCookies(e) {
    e.preventDefault();
    setCookiesMessage('');
    setCookiesError('');
    setCookiesBusy(true);
    try {
      await api.saveCookies(cookiesText);
      setCookiesText('');
      setCookiesMessage('Cookies saved.');
      refreshCookiesStatus();
    } catch (err) {
      setCookiesError(err.message);
    } finally {
      setCookiesBusy(false);
    }
  }

  async function handleClearCookies() {
    setCookiesMessage('');
    setCookiesError('');
    try {
      await api.clearCookies();
      setCookiesMessage('Cookies removed.');
      refreshCookiesStatus();
    } catch (err) {
      setCookiesError(err.message);
    }
  }

  function handleCookiesFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setCookiesFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCookiesText(String(reader.result || ''));
    reader.onerror = () => setCookiesError('Failed to read the selected file.');
    reader.readAsText(file);
  }

  async function handleChannelChange(value) {
    setChannel(value);
    try {
      await api.updateSettings({ ytdlpChannel: value });
    } catch (err) {
      setYtdlpError(err.message);
    }
  }

  async function handleUpdateYtdlp() {
    setYtdlpMessage('');
    setYtdlpError('');
    setYtdlpBusy(true);
    try {
      const result = await api.updateYtdlp(channel);
      setVersions(result);
      setYtdlpMessage(`yt-dlp is now ${result.ytdlp || 'updated'}.`);
    } catch (err) {
      setYtdlpError(err.message);
    } finally {
      setYtdlpBusy(false);
    }
  }

  async function handleUpdateFfmpeg() {
    setFfmpegMessage('');
    setFfmpegError('');
    setFfmpegBusy(true);
    try {
      const result = await api.updateFfmpeg();
      setVersions(result);
      setFfmpegMessage(`FFmpeg is now updated (${result.ffmpeg || 'latest'}).`);
    } catch (err) {
      setFfmpegError(err.message);
    } finally {
      setFfmpegBusy(false);
    }
  }

  function updateCleanupField(field, value) {
    setCleanupSettings((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSaveCleanup(e) {
    e.preventDefault();
    setCleanupMessage('');
    setCleanupError('');
    setCleanupBusy(true);
    try {
      const payload = {
        ageEnabled: !!cleanupSettings.ageEnabled,
        ageDays: parseInt(cleanupSettings.ageDays, 10) || 30,
        jellyfinEnabled: !!cleanupSettings.jellyfinEnabled,
        jellyfinUrl: cleanupSettings.jellyfinUrl || '',
        jellyfinUserId: cleanupSettings.jellyfinUserId || '',
      };
      if (jellyfinApiKeyInput) payload.jellyfinApiKey = jellyfinApiKeyInput;
      const updated = await api.updateCleanupSettings(payload);
      setCleanupSettings(updated);
      setJellyfinApiKeyInput('');
      setCleanupMessage('Auto-delete settings saved.');
    } catch (err) {
      setCleanupError(err.message);
    } finally {
      setCleanupBusy(false);
    }
  }

  async function handleTestJellyfin() {
    setTestMessage('');
    setTestError('');
    setTestBusy(true);
    try {
      const payload = {};
      if (cleanupSettings?.jellyfinUrl) payload.url = cleanupSettings.jellyfinUrl;
      if (jellyfinApiKeyInput) payload.apiKey = jellyfinApiKeyInput;
      const result = await api.testJellyfinConnection(payload);
      setTestMessage(`Connected to ${result.serverName}${result.version ? ` (v${result.version})` : ''}.`);
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTestBusy(false);
    }
  }

  async function handleRunCleanupNow() {
    setRunNowMessage('');
    setRunNowBusy(true);
    try {
      const result = await api.runCleanupNow();
      setRunNowMessage(`Checked ${result.checked} video(s), deleted ${result.deleted}, kept ${result.kept || 0} protected.`);
    } catch (err) {
      setRunNowMessage(err.message);
    } finally {
      setRunNowBusy(false);
    }
  }

  async function handlePreviewCleanup() {
    setPreviewError('');
    setPreviewBusy(true);
    try {
      const result = await api.previewCleanup();
      setPreviewResult(result);
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleToggleNfo(checked) {
    setNfoEnabled(checked);
    setNfoMessage('');
    setNfoBusy(true);
    try {
      await api.updateSettings({ nfo_enabled: checked ? '1' : '0' });
      setNfoMessage(checked ? 'Enabled — new downloads will get a .nfo + poster.' : 'Disabled — new downloads will skip .nfo/poster generation.');
    } catch (err) {
      setNfoMessage(err.message);
      setNfoEnabled(!checked);
    } finally {
      setNfoBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Account, YouTube cookies, and yt-dlp dependencies.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2><KeyRound size={16} /> Account</h2>
        </div>
        <form onSubmit={handleChangePassword} className="settings-form">
          <label className="field-label">
            New password
            <input
              type="password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="field-label">
            Confirm new password
            <input
              type="password"
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <div>
            <button type="submit" disabled={!newPassword || !confirmPassword}>Update password</button>
          </div>
          {message && <div className="alert alert-success"><CheckCircle2 size={15} />{message}</div>}
          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2><Cookie size={16} /> Site cookies</h2>
          {cookiesConfigured !== null && (
            <span className={`tag status-tag ${cookiesConfigured ? 'status-completed' : ''}`}>
              {cookiesConfigured ? 'Configured' : 'Not configured'}
            </span>
          )}
        </div>
        <p className="panel-description">
          Used for any site that needs a logged-in session — most commonly YouTube, for
          age-restricted, members-only, or private videos. Export cookies from a browser
          where you're signed in using an extension like <em>"Get cookies.txt LOCALLY"</em>{' '}
          (Netscape format), then paste the file's contents below. A single cookies.txt can
          hold cookies for multiple sites at once, so this also covers Twitch if you export
          twitch.tv cookies into the same file — as an alternative to the separate auth-token
          field on the Twitch page. They're stored on this server only, with owner-only file
          permissions — never share this content with anyone else, it's equivalent to your
          login session. Uploading a new file here won't remove a Twitch auth-token set
          separately; only "Remove saved cookies" below clears everything.
        </p>
        <form onSubmit={handleSaveCookies} className="settings-form">
          <label className="file-input-label">
            <Upload size={14} />
            {cookiesFileName || 'Upload cookies.txt…'}
            <input type="file" accept=".txt,text/plain" onChange={handleCookiesFile} hidden />
          </label>
          <textarea
            placeholder="…or paste cookies.txt contents here"
            rows={6}
            value={cookiesText}
            onChange={(e) => setCookiesText(e.target.value)}
          />
          <div className="options-row" style={{ marginTop: 0 }}>
            <button type="submit" disabled={cookiesBusy || !cookiesText.trim()}>
              {cookiesBusy ? 'Saving…' : 'Save cookies'}
            </button>
            {cookiesConfigured && (
              <button type="button" className="btn-secondary" onClick={handleClearCookies}>
                Remove saved cookies
              </button>
            )}
          </div>
          {cookiesMessage && <div className="alert alert-success"><CheckCircle2 size={15} />{cookiesMessage}</div>}
          {cookiesError && <div className="alert alert-error"><AlertCircle size={15} />{cookiesError}</div>}
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2><PackageCheck size={16} /> yt-dlp &amp; dependencies</h2>
        </div>
        <dl className="version-list">
          <dt>yt-dlp</dt><dd>{versions ? versions.ytdlp || 'unknown' : 'Loading…'}</dd>
          <dt>ffmpeg</dt><dd>{versions ? versions.ffmpeg || 'unknown' : 'Loading…'}</dd>
          <dt>Node.js</dt><dd>{versions ? versions.node || 'unknown' : 'Loading…'}</dd>
          {versions && versions.deno && (<><dt>Deno</dt><dd>{versions.deno}</dd></>)}
        </dl>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '16px' }}>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>yt-dlp</h3>
            <p className="panel-description" style={{ marginBottom: '10px' }}>
              Nightly builds get new site fixes sooner but are less tested. Switch channels here,
              then use "Update yt-dlp" to pull the latest version.
            </p>
            <div className="options-row" style={{ marginTop: 0 }}>
              <label className="field-inline">
                Update channel
                <select value={channel} onChange={(e) => handleChannelChange(e.target.value)}>
                  <option value="stable">Stable</option>
                  <option value="nightly">Nightly</option>
                </select>
              </label>
              <button type="button" onClick={handleUpdateYtdlp} disabled={ytdlpBusy}>
                {ytdlpBusy ? 'Updating yt-dlp…' : 'Update yt-dlp'}
              </button>
            </div>
            {ytdlpMessage && <div className="alert alert-success" style={{ marginTop: '10px' }}><CheckCircle2 size={15} />{ytdlpMessage}</div>}
            {ytdlpError && <div className="alert alert-error" style={{ marginTop: '10px' }}><AlertCircle size={15} />{ytdlpError}</div>}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>FFmpeg</h3>
            <p className="panel-description" style={{ marginBottom: '10px' }}>
              Uses the latest static builds from{' '}
              <a href="https://github.com/yt-dlp/FFmpeg-Builds" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                yt-dlp/FFmpeg-Builds
              </a>{' '}
              with updated codecs and fixes.
            </p>
            <div className="options-row" style={{ marginTop: 0 }}>
              <button type="button" onClick={handleUpdateFfmpeg} disabled={ffmpegBusy}>
                {ffmpegBusy ? 'Updating FFmpeg…' : 'Update FFmpeg'}
              </button>
            </div>
            {ffmpegMessage && <div className="alert alert-success" style={{ marginTop: '10px' }}><CheckCircle2 size={15} />{ffmpegMessage}</div>}
            {ffmpegError && <div className="alert alert-error" style={{ marginTop: '10px' }}><AlertCircle size={15} />{ffmpegError}</div>}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2><Trash2 size={16} /> Auto-delete watched downloads</h2>
        </div>
        <p className="panel-description">
          Applies only to videos downloaded automatically by a Watch (manual downloads are
          never touched). Runs once a night. Both rules below can be turned on at the same
          time — a video is deleted as soon as either one matches.
        </p>
        {!cleanupSettings ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : (
          <form onSubmit={handleSaveCleanup} className="settings-form">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!cleanupSettings.ageEnabled}
                onChange={(e) => updateCleanupField('ageEnabled', e.target.checked)}
              />
              <span>Delete after</span>
              <input
                type="number"
                min="1"
                style={{ width: '70px' }}
                value={cleanupSettings.ageDays}
                onChange={(e) => updateCleanupField('ageDays', e.target.value)}
                disabled={!cleanupSettings.ageEnabled}
              />
              <span>days</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!cleanupSettings.jellyfinEnabled}
                onChange={(e) => updateCleanupField('jellyfinEnabled', e.target.checked)}
              />
              Delete once watched in Jellyfin
            </label>

            <label className="field-label">
              Jellyfin server URL
              <input
                type="text"
                placeholder="http://jellyfin.local:8096"
                value={cleanupSettings.jellyfinUrl || ''}
                onChange={(e) => updateCleanupField('jellyfinUrl', e.target.value)}
              />
            </label>
            <label className="field-label">
              Jellyfin API key
              <input
                type="password"
                placeholder={cleanupSettings.jellyfinApiKeyConfigured ? '••••••••  (saved — enter a new key to replace)' : 'Paste an API key from Jellyfin Dashboard → API Keys'}
                value={jellyfinApiKeyInput}
                onChange={(e) => setJellyfinApiKeyInput(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="field-label">
              Jellyfin user (optional)
              <input
                type="text"
                placeholder="Leave blank to count a video as watched if any user has watched it"
                value={cleanupSettings.jellyfinUserId || ''}
                onChange={(e) => updateCleanupField('jellyfinUserId', e.target.value)}
              />
            </label>

            <label className="field-label">
              Always keep newest videos per watch
              <input
                type="number"
                min="0"
                style={{ width: '90px' }}
                value={cleanupSettings.keepRecentPerWatch}
                onChange={(e) => updateCleanupField('keepRecentPerWatch', e.target.value)}
              />
              <span className="muted small">
                A safety guard — even if a video matches a rule above, the N most recent videos
                per watch are never deleted. 0 disables this guard.
              </span>
            </label>

            <p className="panel-description" style={{ margin: 0 }}>
              You can also protect an individual video from a download's list, or exclude a
              whole watch from auto-delete on its Edit → Safety &amp; Limits tab.
            </p>

            <div className="options-row" style={{ marginTop: 0 }}>
              <button type="submit" disabled={cleanupBusy}>
                {cleanupBusy ? 'Saving…' : 'Save auto-delete settings'}
              </button>
              <button type="button" className="btn-secondary" onClick={handleTestJellyfin} disabled={testBusy}>
                {testBusy ? 'Testing…' : 'Test Jellyfin connection'}
              </button>
              <button type="button" className="btn-secondary" onClick={handlePreviewCleanup} disabled={previewBusy}>
                {previewBusy ? 'Checking…' : 'Preview (dry run)'}
              </button>
              <button type="button" className="btn-secondary" onClick={handleRunCleanupNow} disabled={runNowBusy}>
                {runNowBusy ? 'Running…' : 'Run cleanup now'}
              </button>
            </div>
            {cleanupMessage && <div className="alert alert-success"><CheckCircle2 size={15} />{cleanupMessage}</div>}
            {cleanupError && <div className="alert alert-error"><AlertCircle size={15} />{cleanupError}</div>}
            {testMessage && <div className="alert alert-success"><CheckCircle2 size={15} />{testMessage}</div>}
            {testError && <div className="alert alert-error"><AlertCircle size={15} />{testError}</div>}
            {runNowMessage && <div className="alert alert-success"><CheckCircle2 size={15} />{runNowMessage}</div>}
            {previewError && <div className="alert alert-error"><AlertCircle size={15} />{previewError}</div>}

            {previewResult && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {previewResult.jellyfinError && (
                  <div className="alert alert-warning">
                    <AlertCircle size={14} />
                    <span>Jellyfin check failed for this preview: {previewResult.jellyfinError}</span>
                  </div>
                )}
                <div>
                  <strong style={{ fontSize: 13 }}>Would delete ({previewResult.toDelete.length})</strong>
                  {previewResult.toDelete.length === 0 ? (
                    <p className="muted small" style={{ margin: '4px 0 0' }}>Nothing matches the current rules right now.</p>
                  ) : (
                    <ul className="cleanup-preview-list">
                      {previewResult.toDelete.map((item) => (
                        <li key={item.id}>
                          <span className="cleanup-preview-title">{item.title}</span>
                          <span className="muted small">{item.matchedReasons.join(', ')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <strong style={{ fontSize: 13 }}>Protected ({previewResult.toKeep.length})</strong>
                  {previewResult.toKeep.length === 0 ? (
                    <p className="muted small" style={{ margin: '4px 0 0' }}>Nothing is currently shielded from a matching rule.</p>
                  ) : (
                    <ul className="cleanup-preview-list">
                      {previewResult.toKeep.map((item) => (
                        <li key={item.id}>
                          <span className="cleanup-preview-title">{item.title}</span>
                          <span className="muted small">{item.matchedReasons.join(', ')} — {item.protectedReason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </form>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2><PackageCheck size={16} /> Media server metadata (.nfo)</h2>
        </div>
        <p className="panel-description">
          Writes a Kodi/Jellyfin/Emby-compatible <code>.nfo</code> file and a matching poster
          image next to every new download, so title, description, and artwork get scraped
          reliably instead of depending on each media server's support for reading metadata
          embedded inside the video file itself. Only affects downloads made after this is
          turned on.
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={nfoEnabled}
            onChange={(e) => handleToggleNfo(e.target.checked)}
            disabled={nfoBusy}
          />
          Write .nfo + poster files for new downloads
        </label>
        {nfoMessage && <div className="alert alert-success" style={{ marginTop: 10 }}><CheckCircle2 size={15} />{nfoMessage}</div>}
      </section>
    </>
  );
}
