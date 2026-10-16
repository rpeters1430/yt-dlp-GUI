import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Cookie, PackageCheck, CheckCircle2, AlertCircle, Upload, Trash2, ListMusic, } from 'lucide-react';
import { api } from '../api.js';
import FileNamingSettings from '../components/FileNamingSettings.jsx';
import NotificationSettings from '../components/NotificationSettings.jsx';
import PlexSettings from '../components/PlexSettings.jsx';
import DownloadsSettings from '../components/settings/DownloadsSettings.jsx';
import AppearanceSettings from '../components/settings/AppearanceSettings.jsx';

const SECTIONS = [
  { id: 'downloads', label: 'Downloads', description: 'Defaults used when you analyze a link. You can still change them per download.' },
  { id: 'naming', label: 'File naming', description: 'Where downloads are saved and how files are named.' },
  { id: 'cookies', label: 'Cookies', description: 'Sign-in cookies for members-only, age-restricted or bot-checked videos.' },
  { id: 'tools', label: 'Tools', description: 'yt-dlp, FFmpeg and QuickJS versions and updates.' },
  { id: 'media', label: 'Media servers', description: 'Jellyfin and Plex playlists, library scans and .nfo metadata.' },
  { id: 'autodelete', label: 'Auto-delete', description: 'Remove downloads once they have been watched.' },
  { id: 'notifications', label: 'Notifications', description: 'Get told when downloads finish or fail.' },
  { id: 'account', label: 'Account', description: 'Appearance, password and sign-out.' },
];

export default function Settings({ username, onLogout }) {
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.some((s) => s.id === params.get('section')) ? params.get('section') : 'downloads';
  const current = SECTIONS.find((s) => s.id === section);
  const [currentPassword, setCurrentPassword] = useState('');
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

  const [crawlerCookiesStatus, setCrawlerCookiesStatus] = useState(null);
  const [crawlerCookiesText, setCrawlerCookiesText] = useState('');
  const [crawlerCookiesFileName, setCrawlerCookiesFileName] = useState('');
  const [crawlerCookiesBusy, setCrawlerCookiesBusy] = useState(false);
  const [crawlerCookiesMessage, setCrawlerCookiesMessage] = useState('');
  const [crawlerCookiesError, setCrawlerCookiesError] = useState('');

  const [versions, setVersions] = useState(null);
  const [channel, setChannel] = useState('stable');
  const [ytdlpBusy, setYtdlpBusy] = useState(false);
  const [ytdlpMessage, setYtdlpMessage] = useState('');
  const [ytdlpError, setYtdlpError] = useState('');

  const [ffmpegBusy, setFfmpegBusy] = useState(false);
  const [ffmpegMessage, setFfmpegMessage] = useState('');
  const [ffmpegError, setFfmpegError] = useState('');

  const [quickjsBusy, setQuickjsBusy] = useState(false);
  const [quickjsMessage, setQuickjsMessage] = useState('');
  const [quickjsError, setQuickjsError] = useState('');

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


  const [jellyfinSync, setJellyfinSync] = useState(null);
  const [jellyfinSyncBusy, setJellyfinSyncBusy] = useState(false);
  const [jellyfinSyncMessage, setJellyfinSyncMessage] = useState('');
  const [jellyfinSyncNowBusy, setJellyfinSyncNowBusy] = useState(false);
  const [jellyfinSyncNowResult, setJellyfinSyncNowResult] = useState(null);
  const [jellyfinSyncNowError, setJellyfinSyncNowError] = useState('');

  function refreshCookiesStatus() {
    api.getCookiesStatus().then((s) => setCookiesConfigured(s.configured)).catch(() => {});
    api.getLinkGrabberCookies().then(setCrawlerCookiesStatus).catch(() => {});
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
  useEffect(() => {
    api.getJellyfinSyncSettings().then(setJellyfinSync).catch(() => {});
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
      await api.changePassword(currentPassword, newPassword);
      setMessage('Password updated.');
      setCurrentPassword('');
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

  async function handleSaveCrawlerCookies(e) {
    if (e) e.preventDefault();
    setCrawlerCookiesMessage('');
    setCrawlerCookiesError('');
    setCrawlerCookiesBusy(true);
    try {
      const res = await api.saveLinkGrabberCookies(crawlerCookiesText);
      setCrawlerCookiesText('');
      setCrawlerCookiesMessage(`Crawler cookies saved (${res.cookieCount} cookies).`);
      refreshCookiesStatus();
    } catch (err) {
      setCrawlerCookiesError(err.message);
    } finally {
      setCrawlerCookiesBusy(false);
    }
  }

  async function handleClearCrawlerCookies() {
    setCrawlerCookiesMessage('');
    setCrawlerCookiesError('');
    try {
      await api.deleteLinkGrabberCookies();
      setCrawlerCookiesMessage('Crawler cookies removed.');
      refreshCookiesStatus();
    } catch (err) {
      setCrawlerCookiesError(err.message);
    }
  }

  function handleCrawlerCookiesFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setCrawlerCookiesFileName(file.name);
    setCrawlerCookiesError('');
    const reader = new FileReader();
    reader.onload = async () => {
      const content = String(reader.result || '').trim();
      setCrawlerCookiesText(content);
      if (content) {
        setCrawlerCookiesBusy(true);
        try {
          const res = await api.saveLinkGrabberCookies(content);
          setCrawlerCookiesMessage(`Crawler cookies saved (${res.cookieCount} cookies).`);
          refreshCookiesStatus();
        } catch (err) {
          setCrawlerCookiesError(err.message);
        } finally {
          setCrawlerCookiesBusy(false);
        }
      }
    };
    reader.onerror = () => setCrawlerCookiesError('Failed to read the selected file.');
    reader.readAsText(file);
    e.target.value = '';
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

  async function handleUpdateQuickjs() {
    setQuickjsMessage('');
    setQuickjsError('');
    setQuickjsBusy(true);
    try {
      const result = await api.updateQuickjs();
      setVersions(result);
      setQuickjsMessage(`QuickJS-ng is now updated (${result.quickjs || 'latest'}).`);
    } catch (err) {
      setQuickjsError(err.message);
    } finally {
      setQuickjsBusy(false);
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
        keepRecentPerWatch: parseInt(cleanupSettings.keepRecentPerWatch, 10) || 0,
        minFreeDiskGb: Math.max(0, parseFloat(cleanupSettings.minFreeDiskGb) || 0),
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

  async function handleToggleJellyfinSync(checked) {
    setJellyfinSync((prev) => ({ ...prev, syncEnabled: checked }));
    setJellyfinSyncMessage('');
    setJellyfinSyncBusy(true);
    try {
      const updated = await api.updateJellyfinSyncSettings({ syncEnabled: checked });
      setJellyfinSync(updated);
      setJellyfinSyncMessage(checked
        ? 'Enabled — each watch gets its own Jellyfin playlist, kept up to date automatically.'
        : 'Disabled — playlists already created in Jellyfin are left as-is.');
    } catch (err) {
      setJellyfinSyncMessage(err.message);
      setJellyfinSync((prev) => ({ ...prev, syncEnabled: !checked }));
    } finally {
      setJellyfinSyncBusy(false);
    }
  }

  async function handleToggleJellyfinAutoScan(checked) {
    setJellyfinSync((prev) => ({ ...prev, autoScanEnabled: checked }));
    setJellyfinSyncMessage('');
    setJellyfinSyncBusy(true);
    try {
      const updated = await api.updateJellyfinSyncSettings({ autoScanEnabled: checked });
      setJellyfinSync(updated);
      setJellyfinSyncMessage(checked
        ? 'Enabled — Jellyfin will be automatically notified to scan libraries after downloads complete.'
        : 'Disabled — Jellyfin will rely on its own periodic library scans.');
    } catch (err) {
      setJellyfinSyncMessage(err.message);
      setJellyfinSync((prev) => ({ ...prev, autoScanEnabled: !checked }));
    } finally {
      setJellyfinSyncBusy(false);
    }
  }

  async function handleRefreshJellyfin() {
    setTestMessage('');
    setTestError('');
    setTestBusy(true);
    try {
      await api.refreshJellyfinLibrary();
      setTestMessage('Jellyfin library refresh scan triggered.');
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTestBusy(false);
    }
  }

  async function handleSyncJellyfinNow() {
    setJellyfinSyncNowError('');
    setJellyfinSyncNowResult(null);
    setJellyfinSyncNowBusy(true);
    try {
      const result = await api.syncJellyfinPlaylists();
      if (result.skipped) {
        setJellyfinSyncNowError(
          result.reason === 'disabled'
            ? 'Enable playlist sync above first.'
            : 'Set a Jellyfin URL, API key, and user (above, in Auto-delete) first.'
        );
      } else {
        setJellyfinSyncNowResult(result.results);
      }
    } catch (err) {
      setJellyfinSyncNowError(err.message);
    } finally {
      setJellyfinSyncNowBusy(false);
    }
  }

  return (
    <>
      <div className="page-title-row">
        <h1>Settings</h1>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={section === s.id ? 'active' : ''}
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => setParams(s.id === 'downloads' ? {} : { section: s.id }, { replace: true })}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="settings-main">
          <div className="settings-head">
            <h2>{current.label}</h2>
            <p>{current.description}</p>
          </div>

          {section === 'downloads' && <DownloadsSettings />}

          {section === 'naming' && (
            <>
              <FileNamingSettings />
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
          )}

          {section === 'cookies' && (
            <>
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

      <section className="panel" style={{ marginTop: '24px' }}>
        <div className="panel-header">
          <h2><Cookie size={16} /> Forum crawler cookies</h2>
          {crawlerCookiesStatus !== null && (
            <span className={`tag status-tag ${crawlerCookiesStatus.configured ? 'status-completed' : ''}`}>
              {crawlerCookiesStatus.configured ? `Active (${crawlerCookiesStatus.cookieCount} cookies)` : 'Not configured'}
            </span>
          )}
        </div>
        <p className="panel-description">
          Used by the forum crawler &amp; link grabber (SimpCity / XenForo) to access members-only threads, hidden attachments,
          and protected download links. Export cookies while signed into the forum using <em>Cookie-Editor</em> (JSON) or <em>Get cookies.txt LOCALLY</em> (Netscape format).
          Saved permanently as <code>config/crawler_cookies.txt</code> and used automatically for all future crawls.
          {crawlerCookiesStatus?.domains?.length > 0 && (
            <span style={{ display: 'block', marginTop: '6px' }}>
              <strong>Configured domains:</strong> {crawlerCookiesStatus.domains.join(', ')}
            </span>
          )}
        </p>
        <form onSubmit={handleSaveCrawlerCookies} className="settings-form">
          <label className="file-input-label">
            <Upload size={14} />
            {crawlerCookiesFileName || 'Upload crawler cookies.txt or cookies.json…'}
            <input type="file" accept=".txt,.json,text/plain" onChange={handleCrawlerCookiesFile} hidden />
          </label>
          <textarea
            placeholder="…or paste crawler Netscape cookies.txt or JSON array here"
            rows={6}
            value={crawlerCookiesText}
            onChange={(e) => setCrawlerCookiesText(e.target.value)}
          />
          <div className="options-row" style={{ marginTop: 0 }}>
            <button type="submit" disabled={crawlerCookiesBusy || !crawlerCookiesText.trim()}>
              {crawlerCookiesBusy ? 'Saving…' : 'Save crawler cookies'}
            </button>
            {crawlerCookiesStatus?.configured && (
              <button type="button" className="btn-secondary" onClick={handleClearCrawlerCookies}>
                Remove saved crawler cookies
              </button>
            )}
          </div>
          {crawlerCookiesMessage && <div className="alert alert-success"><CheckCircle2 size={15} />{crawlerCookiesMessage}</div>}
          {crawlerCookiesError && <div className="alert alert-error"><AlertCircle size={15} />{crawlerCookiesError}</div>}
        </form>
      </section>
            </>
          )}

          {section === 'tools' && (
      <section className="panel">
        <div className="panel-header">
          <h2><PackageCheck size={16} /> yt-dlp &amp; dependencies</h2>
        </div>
        <dl className="version-list">
          <dt>yt-dlp</dt><dd>{versions ? versions.ytdlp || 'unknown' : 'Loading…'}</dd>
          <dt>ffmpeg</dt><dd>{versions ? versions.ffmpeg || 'unknown' : 'Loading…'}</dd>
          <dt>Node.js</dt><dd>{versions ? versions.node || 'unknown' : 'Loading…'}</dd>
          <dt>QuickJS-ng</dt><dd>{versions ? versions.quickjs || 'not found' : 'Loading…'}</dd>
          <dt>Deno</dt><dd>{versions ? versions.deno || 'not installed' : 'Loading…'}</dd>
          <dt>JS runtimes yt-dlp can use</dt><dd>{versions ? versions.jsRuntimes || 'unknown' : 'Loading…'}</dd>
        </dl>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '16px' }}>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>yt-dlp</h3>
            <p className="panel-description" style={{ marginBottom: '10px' }}>
              Nightly builds get new site fixes sooner but are less tested. Switch channels here,
              then use "Update yt-dlp" to switch immediately. Your choice is saved across
              restarts and app updates; when Nightly is selected, the app checks for a newer
              nightly build automatically every night at 3:00 AM.
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
              The app checks for a changed build every night at 3:30 AM and only downloads it
              when an update is available.
            </p>
            <div className="options-row" style={{ marginTop: 0 }}>
              <button type="button" onClick={handleUpdateFfmpeg} disabled={ffmpegBusy}>
                {ffmpegBusy ? 'Updating FFmpeg…' : 'Update FFmpeg'}
              </button>
            </div>
            {ffmpegMessage && <div className="alert alert-success" style={{ marginTop: '10px' }}><CheckCircle2 size={15} />{ffmpegMessage}</div>}
            {ffmpegError && <div className="alert alert-error" style={{ marginTop: '10px' }}><AlertCircle size={15} />{ffmpegError}</div>}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>QuickJS-ng</h3>
            <p className="panel-description" style={{ marginBottom: '10px' }}>
              The JavaScript runtime used by yt-dlp to solve YouTube video extraction and JavaScript challenges.
              The app automatically checks for newer QuickJS-ng releases nightly at 3:45 AM and updates when available.
            </p>
            <div className="options-row" style={{ marginTop: 0 }}>
              <button type="button" onClick={handleUpdateQuickjs} disabled={quickjsBusy}>
                {quickjsBusy ? 'Updating QuickJS…' : 'Update QuickJS'}
              </button>
            </div>
            {quickjsMessage && <div className="alert alert-success" style={{ marginTop: '10px' }}><CheckCircle2 size={15} />{quickjsMessage}</div>}
            {quickjsError && <div className="alert alert-error" style={{ marginTop: '10px' }}><AlertCircle size={15} />{quickjsError}</div>}
          </div>
        </div>
      </section>
          )}

          {section === 'media' && (
            <>
      <section className="panel">
        <div className="panel-header">
          <h2><ListMusic size={16} /> Jellyfin playlist sync</h2>
        </div>
        <p className="panel-description">
          Builds a Jellyfin playlist per Watch (named after the channel/playlist), keeping it
          filled with every video that Watch has downloaded — so browsing playlists in Jellyfin
          mirrors what's being auto-monitored here. Uses the same Jellyfin server URL, API key,
          and user configured above in <em>Auto-delete watched downloads</em> — a specific
          user is required here, since a playlist always belongs to one Jellyfin user. A video
          only gets added once Jellyfin has scanned it into its library, so newly downloaded
          videos may take one library scan before appearing in the playlist.
        </p>
        {!jellyfinSync ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : (
          <div className="settings-form">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={jellyfinSync.autoScanEnabled !== false}
                onChange={(e) => handleToggleJellyfinAutoScan(e.target.checked)}
                disabled={jellyfinSyncBusy}
              />
              Automatically trigger Jellyfin library scan when downloads complete (video &amp; music)
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!jellyfinSync.syncEnabled}
                onChange={(e) => handleToggleJellyfinSync(e.target.checked)}
                disabled={jellyfinSyncBusy}
              />
              Automatically sync playlists (after each download, and every 15 minutes)
            </label>

            {jellyfinSync.syncEnabled && !jellyfinSync.userId && (
              <div className="alert alert-warning">
                <AlertCircle size={14} />
                <span>No Jellyfin user set above — sync will do nothing until one is configured.</span>
              </div>
            )}

            <div className="options-row" style={{ marginTop: 0 }}>
              <button type="button" className="btn-secondary" onClick={handleSyncJellyfinNow} disabled={jellyfinSyncNowBusy}>
                {jellyfinSyncNowBusy ? 'Syncing…' : 'Sync all playlists now'}
              </button>
            </div>

            {jellyfinSyncMessage && <div className="alert alert-success"><CheckCircle2 size={15} />{jellyfinSyncMessage}</div>}
            {jellyfinSyncNowError && <div className="alert alert-error"><AlertCircle size={15} />{jellyfinSyncNowError}</div>}

            {jellyfinSyncNowResult && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {jellyfinSyncNowResult.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>No watches have any completed downloads yet.</p>
                ) : (
                  <ul className="cleanup-preview-list">
                    {jellyfinSyncNowResult.map((r) => (
                      <li key={r.watchId}>
                        <span className="cleanup-preview-title">{r.playlistName || `Watch #${r.watchId}`}</span>
                        <span className="muted small">
                          {r.error
                            ? r.error
                            : `+${r.added} added${r.alreadyPresent ? `, ${r.alreadyPresent} already present` : ''}${r.missingFromLibrary ? `, ${r.missingFromLibrary} not yet in Jellyfin` : ''}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </section>
              <PlexSettings />

            </>
          )}

          {section === 'autodelete' && (
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

            {cleanupSettings.storage && (
              <div className="notice" style={{ marginBottom: 8 }}>
                <strong>Disk volume ({cleanupSettings.storage.path}):</strong> {cleanupSettings.storage.freeGb} GB free ({cleanupSettings.storage.usedPercent}% used)
              </div>
            )}

            <label className="field-label">
              Minimum free disk space guard (GB)
              <input
                type="number"
                min="0"
                step="0.5"
                style={{ width: '90px' }}
                value={cleanupSettings.minFreeDiskGb ?? 0}
                onChange={(e) => updateCleanupField('minFreeDiskGb', e.target.value)}
              />
              <span className="muted small">
                If free space on your media volume drops below this threshold, scheduled Watch checks
                trigger an automatic cleanup pass and pause queueing until space is freed. 0 disables this guard.
              </span>
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
              <button type="button" className="btn-secondary" onClick={handleRefreshJellyfin} disabled={testBusy}>
                {testBusy ? 'Scanning…' : 'Scan Jellyfin library'}
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
                {previewResult.plexError && (
                  <div className="alert alert-warning">
                    <AlertCircle size={14} />
                    <span>Plex check failed for this preview: {previewResult.plexError}</span>
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
          )}

          {section === 'notifications' && <NotificationSettings />}

          {section === 'account' && (
            <>
              <AppearanceSettings />
      <section className="panel">
        <div className="panel-header">
          <h2><KeyRound size={16} /> Password</h2>
        </div>
        <form onSubmit={handleChangePassword} className="settings-form">
          <label className="field-label">
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
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
            <button type="submit" disabled={!currentPassword || !newPassword || !confirmPassword}>Update password</button>
          </div>
          {message && <div className="alert alert-success"><CheckCircle2 size={15} />{message}</div>}
          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
        </form>
      </section>
              <div className="setting-row">
                <div className="setting-row-text">
                  <div className="setting-row-label">Signed in as {username}</div>
                </div>
                <div className="setting-row-control">
                  <button type="button" className="btn-ghost" onClick={onLogout}>Log out</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
