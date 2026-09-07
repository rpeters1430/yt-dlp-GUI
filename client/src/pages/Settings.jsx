import React, { useEffect, useState } from 'react';
import { KeyRound, Cookie, PackageCheck, CheckCircle2, AlertCircle, Upload } from 'lucide-react';
import { api } from '../api.js';

export default function Settings() {
  const [newPassword, setNewPassword] = useState('');
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
    }).catch(() => {});
  }, []);

  async function handleChangePassword(e) {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      await api.changePassword(newPassword);
      setMessage('Password updated.');
      setNewPassword('');
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
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <div>
            <button type="submit" disabled={!newPassword}>Update password</button>
          </div>
          {message && <div className="alert alert-success"><CheckCircle2 size={15} />{message}</div>}
          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2><Cookie size={16} /> YouTube cookies</h2>
          {cookiesConfigured !== null && (
            <span className={`tag status-tag ${cookiesConfigured ? 'status-completed' : ''}`}>
              {cookiesConfigured ? 'Configured' : 'Not configured'}
            </span>
          )}
        </div>
        <p className="panel-description">
          Needed for age-restricted, members-only, or private videos, and it helps YouTube
          trust this server as a logged-in browser. Export cookies from a browser where
          you're signed into YouTube using an extension like{' '}
          <em>"Get cookies.txt LOCALLY"</em> (Netscape format), then paste the file's
          contents below. They're stored on this server only, with owner-only file
          permissions — never share this content with anyone else, it's equivalent to
          your login session.
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
    </>
  );
}
