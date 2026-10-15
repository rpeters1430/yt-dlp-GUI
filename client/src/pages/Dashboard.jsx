import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardPaste, Play } from 'lucide-react';
import StagingTray from '../components/home/StagingTray.jsx';
import OptionsDrawer from '../components/home/OptionsDrawer.jsx';
import NowDownloading, { isLiveJob, isWaitingForLive } from '../components/home/NowDownloading.jsx';
import UpNext from '../components/home/UpNext.jsx';
import RecentlyFinished from '../components/home/RecentlyFinished.jsx';
import { api } from '../api.js';
import { useDownloads } from '../context/DownloadsContext.jsx';
import { parseLinks, useStaging } from '../context/StagingContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { getAutoAnalyzeOnPaste } from '../prefs.js';

function Stat({ value, label, to, accent }) {
  const body = (
    <>
      <strong>{value}</strong> {label}
    </>
  );
  return to ? (
    <Link to={to} className={`stat${accent ? ' stat-accent' : ''}`}>{body}</Link>
  ) : (
    <span className="stat">{body}</span>
  );
}

export default function Dashboard() {
  const { jobs, setJobs, loaded, downloadingJobs, queuedJobs, completedCount, failedCount, queuePaused, setCounts } = useDownloads();
  const { staged, analyze, commit } = useStaging();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [drawer, setDrawer] = useState(null); // { kind: 'item' | 'defaults', id }
  const inputRef = useRef(null);

  // A link pasted elsewhere in the app lands here (see App.jsx's global paste handler).
  const pasteNonce = location.state?.nonce;
  useEffect(() => {
    const pasted = location.state?.paste;
    if (!pasted) return;
    const added = analyze(pasted);
    if (!added && parseLinks(pasted).length === 0) toast('No links found in what you pasted', { error: true });
    navigate('.', { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteNonce]);

  // Android Web Share Target & desktop bookmarklet support (?url=...&text=...).
  useEffect(() => {
    const sharedUrl = searchParams.get('url') || '';
    const sharedText = searchParams.get('text') || '';
    if (!sharedUrl && !sharedText) return;
    const combined = `${sharedUrl} ${sharedText}`.trim();
    const added = analyze(combined);
    if (!added && parseLinks(combined).length === 0) {
      toast('No valid links found in shared content', { error: true });
    }
    const next = new URLSearchParams(searchParams);
    next.delete('url');
    next.delete('text');
    next.delete('title');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function runAnalyze(value = text) {
    const links = parseLinks(value);
    if (links.length === 0) {
      if (value.trim()) toast('No links found', { error: true });
      return;
    }
    analyze(value);
    setText('');
  }

  function handleInputPaste(e) {
    if (!getAutoAnalyzeOnPaste()) return;
    const pasted = e.clipboardData?.getData('text') || '';
    if (parseLinks(pasted).length === 0) return;
    e.preventDefault();
    runAnalyze(`${text} ${pasted}`);
  }

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip) return;
      if (getAutoAnalyzeOnPaste()) runAnalyze(`${text} ${clip}`);
      else setText((prev) => (prev.trim() ? `${prev.trim()} ${clip.trim()}` : clip.trim()));
      inputRef.current?.focus();
    } catch {
      toast('Clipboard access was blocked. Paste with ⌘V / Ctrl+V instead.', { error: true });
    }
  }

  async function handleCommit() {
    const { summary, error } = await commit();
    if (error) toast(summary ? `${summary} · ${error}` : error, { error: true });
    else if (summary) toast(summary);
  }

  async function handleToggleQueuePause() {
    try {
      const res = queuePaused ? await api.resumeQueue() : await api.pauseQueue();
      setCounts?.((prev) => (prev ? { ...prev, paused: !!res.paused } : prev));
      toast(res.paused ? 'Queue paused (active downloads will finish)' : 'Queue resumed');
    } catch (err) {
      toast(err.message || 'Could not update queue state', { error: true });
    }
  }

  const hero = useMemo(
    () => downloadingJobs.find((j) => !isLiveJob(j)) || downloadingJobs.find((j) => !isWaitingForLive(j)) || null,
    [downloadingJobs]
  );
  const upNext = useMemo(() => {
    const others = downloadingJobs.filter((j) => j !== hero);
    return [
      ...others.filter((j) => !isLiveJob(j)),
      ...others.filter((j) => isLiveJob(j) && !isWaitingForLive(j)),
      ...queuedJobs,
      ...others.filter(isWaitingForLive),
    ];
  }, [downloadingJobs, queuedJobs, hero]);
  const recentFinished = useMemo(
    () => jobs.filter((j) => j.status === 'completed' || j.status === 'failed').slice(0, 5),
    [jobs]
  );

  function handleRemoved(id) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  const dash = loaded ? null : '—';

  return (
    <>
      <div className="command-row">
        <form
          className={`command-bar${focused ? ' focused' : ''}`}
          onSubmit={(e) => { e.preventDefault(); runAnalyze(); }}
        >
          <input
            ref={inputRef}
            className="command-input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste links: YouTube, Twitch, SoundCloud, 1,700+ sites"
            aria-label="Links to download"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handleInputPaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <button type="button" className="btn-ghost btn-sm command-paste" onClick={pasteFromClipboard}>
            <ClipboardPaste size={14} /> Paste
          </button>
          <button type="submit" className="btn-primary command-go" disabled={!text.trim()}>Analyze</button>
        </form>
        <div className="stats-inline">
          <Stat value={dash ?? downloadingJobs.filter((j) => !isWaitingForLive(j)).length} label="active" />
          <Stat value={dash ?? queuedJobs.length + downloadingJobs.filter(isWaitingForLive).length} label={queuePaused ? 'paused' : 'waiting'} />
          <Stat value={dash ?? completedCount.toLocaleString()} label="done" />
          <Stat value={dash ?? failedCount.toLocaleString()} label="failed" to="/history?status=failed" accent={failedCount > 0} />
        </div>
      </div>

      {queuePaused && upNext.length === 0 && (
        <div className="notice notice-warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <span>Download queue is paused — new downloads will wait until resumed.</span>
          <button type="button" className="btn-secondary btn-sm" onClick={handleToggleQueuePause}>
            <Play size={13} /> Resume queue
          </button>
        </div>
      )}

      {staged.length > 0 && (
        <StagingTray
          onOptions={(id) => setDrawer({ kind: 'item', id })}
          onDefaults={() => setDrawer({ kind: 'defaults' })}
          onCommit={handleCommit}
        />
      )}

      {!loaded ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : (
        <>
          <NowDownloading key={hero?.id || 'none'} job={hero} onRemoved={handleRemoved} />
          <UpNext
            jobs={upNext}
            onRemoved={handleRemoved}
            queuePaused={queuePaused}
            onTogglePause={handleToggleQueuePause}
          />
          <RecentlyFinished jobs={recentFinished} failedCount={failedCount} />
        </>
      )}

      {drawer && (
        <OptionsDrawer
          key={`${drawer.kind}-${drawer.id || ''}`}
          mode={drawer.kind}
          itemId={drawer.id}
          onClose={() => setDrawer(null)}
          onSaved={(msg) => toast(msg)}
        />
      )}
    </>
  );
}
