import React, { useEffect, useState } from 'react';
import { Bookmark, Copy } from 'lucide-react';
import { api } from '../../api.js';
import { useStaging } from '../../context/StagingContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Switch } from '../DownloadOptionsFields.jsx';
import { getAutoAnalyzeOnPaste, setAutoAnalyzeOnPaste } from '../../prefs.js';
import SolverrProxySettings from './SolverrProxySettings.jsx';

export function SettingRow({ label, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-row-text">
        <div className="setting-row-label">{label}</div>
        {description && <div className="setting-row-desc">{description}</div>}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

const QUALITIES = [['', 'Best'], ['2160', '2160p'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']];
const CHUNKS = [[0, 'Off'], [15, '15 min'], [30, '30 min'], [60, '60 min'], [120, '120 min']];
const RATE_LIMITS = [['', 'Unlimited'], ['2M', '2 MB/s'], ['5M', '5 MB/s'], ['10M', '10 MB/s'], ['25M', '25 MB/s'], ['50M', '50 MB/s']];
const SLEEP_INTERVALS = [[0, 'Off'], [2, '2–4 sec'], [5, '5–10 sec'], [10, '10–20 sec']];

export default function DownloadsSettings() {
  const { defaults, setDefaults } = useStaging();
  const toast = useToast();
  const [concurrent, setConcurrent] = useState(null);
  const [chunkMins, setChunkMins] = useState(null);
  const [limitRate, setLimitRate] = useState('');
  const [sleepInterval, setSleepInterval] = useState(0);
  const [impersonateTarget, setImpersonateTarget] = useState('');
  const [autoAnalyze, setAutoAnalyze] = useState(getAutoAnalyzeOnPaste);

  useEffect(() => {
    api.getSettings().then((s) => {
      setConcurrent(s.max_concurrent_downloads || 2);
      setChunkMins(parseInt(s.default_live_chunk_mins, 10) || 0);
      setLimitRate(s.download_limit_rate || '');
      setSleepInterval(parseInt(s.download_sleep_interval, 10) || 0);
      setImpersonateTarget(s.impersonate_target || '');
    }).catch(() => {});
  }, []);

  async function save(patch, ok, rollback) {
    try {
      await api.updateSettings(patch);
      toast(ok);
    } catch (err) {
      rollback();
      toast(err.message || 'Could not save', { error: true });
    }
  }

  function changeConcurrent(value) {
    const prev = concurrent;
    setConcurrent(value);
    save({ max_concurrent_downloads: value }, `${value} download${value === 1 ? '' : 's'} at once`, () => setConcurrent(prev));
  }

  function changeChunks(value) {
    const prev = chunkMins;
    const prevDefaults = defaults;
    setChunkMins(value);
    setDefaults({ ...defaults, splitLiveChunks: value > 0, liveChunkDuration: value > 0 ? value : defaults.liveChunkDuration });
    save({ default_live_chunk_mins: String(value) }, value ? `Live recordings split every ${value} min` : 'Live recordings stay one file', () => {
      setChunkMins(prev);
      setDefaults(prevDefaults);
    });
  }

  function changeLimitRate(value) {
    const prev = limitRate;
    setLimitRate(value);
    save({ download_limit_rate: value }, value ? `Bandwidth capped at ${value}/s per download` : 'Bandwidth limit removed', () => setLimitRate(prev));
  }

  function changeSleepInterval(value) {
    const prev = sleepInterval;
    setSleepInterval(value);
    save({ download_sleep_interval: String(value) }, value ? `Added ${value}–${value * 2}s delay between downloads` : 'Download sleep delay disabled', () => setSleepInterval(prev));
  }

  function changeImpersonate(value) {
    const prev = impersonateTarget;
    setImpersonateTarget(value);
    save(
      { impersonate_target: value },
      value ? `Browser TLS impersonation enabled (${value})` : 'Browser TLS impersonation disabled',
      () => setImpersonateTarget(prev)
    );
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const bookmarkletHref = `javascript:void(window.open('${origin}/?url='+encodeURIComponent(location.href),'_blank','noopener'))`;

  const audio = !!defaults.audioOnly;
  const types = audio ? ['m4a', 'mp3', 'opus', 'flac'] : ['mp4', 'mkv', 'webm'];

  return (
    <div className="setting-rows">
      <SettingRow label="Default quality" description="If unavailable, the closest quality below is used">
        <select className="value-chip" value={defaults.quality || ''} disabled={audio} onChange={(e) => setDefaults({ ...defaults, quality: e.target.value })} aria-label="Default quality">
          {QUALITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Download as" description="Video, or extract just the audio">
        <select
          className="value-chip"
          value={audio ? 'audio' : 'video'}
          onChange={(e) => {
            const a = e.target.value === 'audio';
            setDefaults({ ...defaults, audioOnly: a, container: a ? 'mp3' : 'mp4' });
          }}
          aria-label="Download as"
        >
          <option value="video">Video</option>
          <option value="audio">Audio only</option>
        </select>
      </SettingRow>
      <SettingRow label="Default file type">
        <select className="value-chip" value={types.includes(defaults.container) ? defaults.container : types[0]} onChange={(e) => setDefaults({ ...defaults, container: e.target.value })} aria-label="Default file type">
          {types.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Simultaneous downloads" description="How many run at once; the rest wait in line">
        <select className="value-chip" value={concurrent ?? ''} disabled={concurrent === null} onChange={(e) => changeConcurrent(Number(e.target.value))} aria-label="Simultaneous downloads">
          {concurrent === null && <option value="">…</option>}
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Bandwidth limit per download" description="Cap per-job speed (--limit-rate) so downloads don't saturate your LAN">
        <select className="value-chip" value={limitRate} onChange={(e) => changeLimitRate(e.target.value)} aria-label="Bandwidth limit">
          {RATE_LIMITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {limitRate && !RATE_LIMITS.some(([v]) => v === limitRate) && <option value={limitRate}>{limitRate}</option>}
        </select>
      </SettingRow>
      <SettingRow label="Rate-limit protection delay" description="Add a jittered pause (--sleep-interval) before downloads to reduce YouTube 429s">
        <select className="value-chip" value={sleepInterval} onChange={(e) => changeSleepInterval(Number(e.target.value))} aria-label="Rate-limit protection delay">
          {SLEEP_INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Default live chunk length" description="Split long live recordings into parts">
        <select className="value-chip" value={chunkMins ?? ''} disabled={chunkMins === null} onChange={(e) => changeChunks(Number(e.target.value))} aria-label="Default live chunk length">
          {chunkMins === null && <option value="">…</option>}
          {CHUNKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {chunkMins > 0 && !CHUNKS.some(([v]) => v === chunkMins) && <option value={chunkMins}>{chunkMins} min</option>}
        </select>
      </SettingRow>
      <SettingRow label="SponsorBlock" description="Cut sponsor segments and intros from YouTube videos">
        <Switch
          size="lg"
          label="SponsorBlock by default"
          checked={!!defaults.sponsorblock}
          onChange={(v) => setDefaults({ ...defaults, sponsorblock: v, sponsorblockCategories: v && !defaults.sponsorblockCategories?.length ? ['sponsor', 'intro'] : defaults.sponsorblockCategories })}
        />
      </SettingRow>
      <SettingRow label="Subtitles" description="Embed subtitles when a video has them">
        <Switch size="lg" label="Subtitles by default" checked={!!defaults.subtitles} onChange={(v) => setDefaults({ ...defaults, subtitles: v })} />
      </SettingRow>
      <SettingRow label="Auto-analyze on paste" description="Start analyzing as soon as links are pasted into the Home bar">
        <Switch
          size="lg"
          label="Auto-analyze on paste"
          checked={autoAnalyze}
          onChange={(v) => { setAutoAnalyze(v); setAutoAnalyzeOnPaste(v); }}
        />
      </SettingRow>
      <SettingRow
        label="Browser TLS impersonation"
        description="Impersonate real browser TLS handshakes via curl_cffi (--impersonate) to bypass bot checks and Cloudflare on YouTube and other sites"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch
            size="lg"
            label="Enable browser impersonation"
            checked={!!impersonateTarget}
            onChange={(checked) => changeImpersonate(checked ? 'chrome' : '')}
          />
          {impersonateTarget && (
            <select
              className="value-chip"
              value={impersonateTarget}
              onChange={(e) => changeImpersonate(e.target.value)}
              aria-label="Browser impersonation target"
            >
              <option value="chrome">Chrome (recommended)</option>
              <option value="safari">Safari</option>
              <option value="firefox">Firefox</option>
              <option value="edge">Edge</option>
            </select>
          )}
        </div>
      </SettingRow>
      <SolverrProxySettings />
      <SettingRow
        label="One-click browser bookmarklet & Android Share"
        description="Drag 'Send to yt-dlp GUI' to your bookmarks bar, or install this web app on Android to share links directly from the native Share sheet."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a
            href={bookmarkletHref}
            onClick={(e) => {
              e.preventDefault();
              toast('Drag this button to your browser bookmarks bar');
            }}
            className="btn-secondary btn-sm"
            title="Drag to your bookmarks bar"
          >
            <Bookmark size={13} /> Send to yt-dlp GUI
          </a>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(bookmarkletHref)
                .then(() => toast('Copied bookmarklet URL'))
                .catch(() => toast('Could not copy bookmarklet', { error: true }));
            }}
            title="Copy bookmarklet script"
          >
            <Copy size={13} /> Copy
          </button>
        </div>
      </SettingRow>
    </div>
  );
}
