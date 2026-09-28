import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api.js';

const FORMAT_INFO = {
  discord: {
    label: 'Discord',
    placeholder: 'https://discord.com/api/webhooks/…',
    hint: 'Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.',
  },
  slack: {
    label: 'Slack / Mattermost / Rocket.Chat',
    placeholder: 'https://hooks.slack.com/services/…',
    hint: 'An "incoming webhook" URL. Mattermost and Rocket.Chat accept the same format.',
  },
  ntfy: {
    label: 'ntfy',
    placeholder: 'https://ntfy.sh/your-topic',
    hint: 'The topic URL you subscribe to in the ntfy app. Works with ntfy.sh or a self-hosted server.',
  },
  gotify: {
    label: 'Gotify',
    placeholder: 'https://gotify.example.com/message?token=…',
    hint: 'Your server\'s /message URL with an application token.',
  },
  json: {
    label: 'Generic JSON webhook',
    placeholder: 'https://homeassistant.local:8123/api/webhook/…',
    hint: 'POSTs {event, title, message, url, thumbnail, timestamp} — for Home Assistant, n8n, Node-RED, and similar.',
  },
};

export default function NotificationSettings() {
  const [settings, setSettings] = useState(null);
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('discord');
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function apply(data) {
    setSettings(data);
    setUrl(data.url || '');
    setFormat(data.format || 'discord');
  }

  useEffect(() => {
    api.getNotificationSettings().then(apply).catch((err) => setError(err.message));
  }, []);

  async function save(patch, successMessage) {
    setMessage('');
    setError('');
    setBusy(true);
    try {
      const updated = await api.updateNotificationSettings(patch);
      setSettings(updated);
      if (successMessage) setMessage(successMessage);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveWebhook(e) {
    e.preventDefault();
    await save({ url: url.trim(), format }, 'Webhook saved.');
  }

  async function handleTest() {
    setMessage('');
    setError('');
    setTestBusy(true);
    try {
      await api.testNotification({ url: url.trim(), format });
      setMessage('Test notification sent — check your app.');
    } catch (err) {
      setError(err.message);
    } finally {
      setTestBusy(false);
    }
  }

  const info = FORMAT_INFO[format] || FORMAT_INFO.discord;
  const webhookDirty = settings && (url.trim() !== (settings.url || '') || format !== settings.format);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2><Bell size={16} /> Notifications</h2>
      </div>
      <p className="panel-description">
        Get a message when downloads finish or fail, when a Watch queues new videos, or when a
        Watch check starts failing. A Watch that keeps failing only notifies once, until it
        recovers.
      </p>
      {!settings ? (
        error ? <div className="alert alert-error"><AlertCircle size={15} />{error}</div> : <div className="empty-state"><div className="spinner" /></div>
      ) : (
        <div className="settings-form notify-form">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={busy}
              onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? 'Notifications enabled.' : 'Notifications disabled.')}
            />
            Send notifications
          </label>

          <form className="settings-form notify-form" onSubmit={handleSaveWebhook} style={{ gap: 8 }}>
            <label className="field-label" htmlFor="notify-format">Service</label>
            <select id="notify-format" value={format} onChange={(e) => setFormat(e.target.value)}>
              {settings.formats.map((f) => <option key={f} value={f}>{FORMAT_INFO[f]?.label || f}</option>)}
            </select>

            <label className="field-label" htmlFor="notify-url">Webhook URL</label>
            <input
              id="notify-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={info.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="muted small">{info.hint} Treat this URL like a password.</span>

            <div className="options-row" style={{ marginTop: 4 }}>
              <button type="submit" disabled={busy || !webhookDirty}>{busy ? 'Saving…' : 'Save webhook'}</button>
              <button type="button" className="btn-secondary" onClick={handleTest} disabled={testBusy || !url.trim()}>
                {testBusy ? 'Sending…' : 'Send test'}
              </button>
            </div>
          </form>

          <fieldset className="notify-events" disabled={busy}>
            <legend className="field-label">Notify me when</legend>
            {Object.entries(settings.eventLabels).map(([name, label]) => (
              <label key={name} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!settings.events[name]}
                  onChange={(e) => save({ events: { [name]: e.target.checked } })}
                />
                {label}
              </label>
            ))}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!settings.watchOnly}
                onChange={(e) => save({ watchOnly: e.target.checked })}
              />
              Only for Watch downloads (skip ones I queued myself)
            </label>
          </fieldset>

          {settings.enabled && !settings.url && (
            <div className="alert alert-warning"><AlertCircle size={14} /><span>Add a webhook URL — nothing is sent until one is saved.</span></div>
          )}
          {message && <div className="alert alert-success"><CheckCircle2 size={15} />{message}</div>}
          {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
        </div>
      )}
    </section>
  );
}
