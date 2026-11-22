import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Switch } from '../DownloadOptionsFields.jsx';
import { SettingRow } from './DownloadsSettings.jsx';

function statusText(status) {
  if (!status) return 'Checking…';
  if (!status.pluginInstalled) return 'The bgutil plugin is not installed in this container (rebuild from the current Dockerfile).';
  if (status.mode === 'off') return 'Off.';
  if (!status.reachable) return `Provider unreachable at ${status.url}${status.error ? ` (${status.error})` : ''}. YouTube downloads still run, with a warning in the log.`;
  return `Active: tokens from ${status.url}${status.version ? ` (provider ${status.version})` : ''}.`;
}

// YouTube PO-token provider (server/src/services/poToken.js). After toggling, re-run
// "Test YouTube cookies" in Settings → Cookies to see whether the IP is still bot-checked.
export default function PoTokenSettings() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setUrl(s.pot_provider_url || '');
      setSavedUrl(s.pot_provider_url || '');
    }).catch(() => {});
    api.getPoTokenStatus().then(setStatus).catch(() => {});
  }, []);

  async function recheck() {
    setBusy(true);
    try {
      setStatus(await api.getPoTokenStatus());
    } catch (err) {
      toast(err.message || 'Could not check the provider', { error: true });
    } finally {
      setBusy(false);
    }
  }

  async function save(patch, ok) {
    setBusy(true);
    try {
      await api.updateSettings(patch);
      setStatus(await api.getPoTokenStatus());
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
    if (await save({ pot_provider_url: value }, value ? 'Provider URL saved' : 'Using the default provider URL')) {
      setSavedUrl(value);
    }
  }

  const enabled = status?.mode === 'on';

  return (
    <>
      <SettingRow
        label="YouTube PO-token provider"
        description={`Gets YouTube "proof of origin" tokens from a bgutil-ytdlp-pot-provider container, which can get past the "confirm you're not a bot" check on some IPs. It won't fix rejected cookies or a heavily flagged VPN/datacenter IP. ${statusText(status)}`}
      >
        <button type="button" className="btn-ghost btn-sm" onClick={recheck} disabled={busy} title="Check the provider now">
          <RefreshCw size={13} /> Check
        </button>
        <Switch
          size="lg"
          label="Use PO-token provider"
          checked={enabled}
          disabled={busy || Boolean(status && !status.pluginInstalled && !enabled)}
          onChange={(v) => save({ pot_provider_mode: v ? 'on' : 'off' }, v ? 'PO-token provider on' : 'PO-token provider off')}
        />
      </SettingRow>
      {enabled && (
        <SettingRow
          label="Provider URL"
          description={savedUrl
            ? 'Leave blank to use the default.'
            : `Using ${status?.url || 'http://bgutil-provider:4416'}${status?.urlSource === 'env' ? ' from BGUTIL_POT_URL' : ''}. Enter a URL to override it.`}
        >
          <form onSubmit={saveUrl} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://bgutil-provider:4416"
              aria-label="PO-token provider URL"
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
