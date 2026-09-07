import React, { useEffect, useState } from 'react';
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

  function refreshCookiesStatus() {
    api.getCookiesStatus().then((s) => setCookiesConfigured(s.configured)).catch(() => {});
  }

  useEffect(refreshCookiesStatus, []);

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

  return (
    <div>
      <section className="panel">
        <h2>Settings</h2>
        <form onSubmit={handleChangePassword} className="settings-form">
          <label>Change password</label>
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button type="submit" disabled={!newPassword}>Update password</button>
          {message && <div className="success-text">{message}</div>}
          {error && <div className="error-text">{error}</div>}
        </form>
      </section>

      <section className="panel">
        <h2>YouTube cookies</h2>
        <p className="muted">
          Needed for age-restricted, members-only, or private videos, and it helps YouTube
          trust this server as a logged-in browser. Export cookies from a browser where
          you're signed into YouTube using an extension like{' '}
          <em>"Get cookies.txt LOCALLY"</em> (Netscape format), then paste the file's
          contents below. They're stored on this server only, with owner-only file
          permissions — never share this content with anyone else, it's equivalent to
          your login session.
        </p>
        {cookiesConfigured !== null && (
          <p>
            Status:{' '}
            <span className={`tag status-tag ${cookiesConfigured ? 'status-completed' : ''}`}>
              {cookiesConfigured ? 'Configured' : 'Not configured'}
            </span>
          </p>
        )}
        <form onSubmit={handleSaveCookies} className="settings-form">
          <textarea
            placeholder="Paste cookies.txt contents here"
            rows={6}
            value={cookiesText}
            onChange={(e) => setCookiesText(e.target.value)}
          />
          <div className="options-row">
            <button type="submit" disabled={cookiesBusy || !cookiesText.trim()}>
              {cookiesBusy ? 'Saving…' : 'Save cookies'}
            </button>
            {cookiesConfigured && (
              <button type="button" className="icon-btn" onClick={handleClearCookies}>
                Remove saved cookies
              </button>
            )}
          </div>
          {cookiesMessage && <div className="success-text">{cookiesMessage}</div>}
          {cookiesError && <div className="error-text">{cookiesError}</div>}
        </form>
      </section>
    </div>
  );
}
