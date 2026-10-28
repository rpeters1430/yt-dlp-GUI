import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Switch } from '../DownloadOptionsFields.jsx';
import { SettingRow } from './DownloadsSettings.jsx';

function statusText(status) {
  if (!status) return 'Checking…';
  if (status.mode === 'off') return 'Off: yt-dlp connects directly';
  if (!status.url) return 'No proxy URL set';
  if (!status.caInstalled) return 'Solverr CA not installed in this container (set SOLVERR_PROXY_CA_URL and SOLVERR_PROXY_CA_SHA256, then restart)';
  if (!status.reachable) return `Solverr unreachable${status.error ? ` (${status.error})` : ''}: yt-dlp connects directly`;
  return 'Active: yt-dlp downloads go through Solverr';
}

export default function SolverrProxySettings() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setUrl(s.solverr_proxy_url || '');
      setSavedUrl(s.solverr_proxy_url || '');
    }).catch(() => {});
    api.getSolverrProxyStatus().then(setStatus).catch(() => {});
  }, []);

  async function save(patch, ok) {
    setBusy(true);
    try {
      await api.updateSettings(patch);
      setStatus(await api.checkSolverrProxy());
      toast(ok);
      return true;
    } catch (err) {
      toast(err.message || 'Could not save', { error: true });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveUrl(e) {
    e.preventDefault();
    const value = url.trim();
    if (await save({ solverr_proxy_url: value }, value ? 'Solverr proxy URL saved' : 'Using SOLVERR_PROXY_URL from the environment')) {
      setSavedUrl(value);
    }
  }

  async function recheck() {
    setBusy(true);
    try {
      setStatus(await api.checkSolverrProxy());
    } catch (err) {
      toast(err.message || 'Could not check the proxy', { error: true });
    } finally {
      setBusy(false);
    }
  }

  const enabled = status ? status.mode !== 'off' : true;

  return (
    <>
      <SettingRow
        label="Solverr proxy"
        description={`Route yt-dlp through a Solverr forward proxy to get past Cloudflare and other challenge walls, whenever it's reachable. ${statusText(status)}`}
      >
        <button type="button" className="btn-ghost btn-sm" onClick={recheck} disabled={busy} title="Check the proxy now">
          <RefreshCw size={13} /> Check
        </button>
        <Switch
          size="lg"
          label="Use Solverr proxy when available"
          checked={enabled}
          onChange={(v) => save({ solverr_proxy_mode: v ? 'auto' : 'off' }, v ? 'Solverr proxy enabled when available' : 'Solverr proxy disabled')}
        />
      </SettingRow>
      {enabled && (
        <SettingRow
          label="Solverr proxy URL"
          description={status?.urlSource === 'env' && !savedUrl
            ? `Using SOLVERR_PROXY_URL (${status.url}). Enter a URL to override it.`
            : 'e.g. http://USER:PASSWORD@solverr:8192. Leave blank to use SOLVERR_PROXY_URL.'}
        >
          <form onSubmit={saveUrl} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://USER:PASSWORD@solverr:8192"
              aria-label="Solverr proxy URL"
              autoComplete="off"
              spellCheck={false}
              style={{ minWidth: 240 }}
            />
            <button type="submit" className="btn-secondary btn-sm" disabled={busy || url.trim() === savedUrl}>Save</button>
          </form>
        </SettingRow>
      )}
    </>
  );
}
