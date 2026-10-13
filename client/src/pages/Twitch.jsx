import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useDownloads } from '../context/DownloadsContext.jsx';
import Art from '../components/Art.jsx';
import Drawer from '../components/Drawer.jsx';
import { Segmented, Switch, ToggleRow } from '../components/DownloadOptionsFields.jsx';
import { UpNextCard } from '../components/home/UpNext.jsx';
import { FinishedRow } from '../components/home/RecentlyFinished.jsx';
import { formatCount } from '../format.js';

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.floor(sec);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const QUALITY_OPTIONS = [
  { value: '', label: 'Source / Best (Original quality)' },
  { value: '1080p60__source_', label: '1080p 60fps (Source)' },
  { value: '1080', label: '1080p (Full HD)' },
  { value: '720p60', label: '720p 60fps' },
  { value: '720', label: '720p (HD)' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: 'audio_only', label: 'Audio Only' },
];

export default function Twitch() {
  const [channelInput, setChannelInput] = useState('');
  const [checkingChannel, setCheckingChannel] = useState(false);
  const [channelData, setChannelData] = useState(null);
  const [channelError, setChannelError] = useState('');

  // Active sub-tab: 'record' | 'vods' | 'direct' | 'settings'
  const [activeTab, setActiveTab] = useState('record');

  // Live recording options
  const [liveChannel, setLiveChannel] = useState('');
  const [waitForLive, setWaitForLive] = useState(false);
  const [liveFromStart, setLiveFromStart] = useState(true);
  const [moreOptions, setMoreOptions] = useState(false);
  const waitInterval = 15;
  const [quality, setQuality] = useState('');
  const [container, setContainer] = useState('mp4');
  const [hlsUseMpegts, setHlsUseMpegts] = useState(true);
  const [twitchChat, setTwitchChat] = useState(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const [splitLiveChunks, setSplitLiveChunks] = useState(false);
  const [liveChunkDuration, setLiveChunkDuration] = useState(30);
  const [startingLive, setStartingLive] = useState(false);
  const [liveSuccess, setLiveSuccess] = useState('');
  const [liveError, setLiveError] = useState('');

  // Direct VOD / Clip download options
  const [directUrl, setDirectUrl] = useState('');
  const [directQuality, setDirectQuality] = useState('');
  const [directContainer, setDirectContainer] = useState('mp4');
  const [directStart, setDirectStart] = useState('');
  const [directEnd, setDirectEnd] = useState('');
  const [directChat, setDirectChat] = useState(false);
  const [directAudioOnly, setDirectAudioOnly] = useState(false);
  const [directSubmitting, setDirectSubmitting] = useState(false);
  const [directMessage, setDirectMessage] = useState('');

  // Selected VOD for trimming
  const [selectedVod, setSelectedVod] = useState(null);
  const [trimStart, setTrimStart] = useState('00:00:00');
  const [trimEnd, setTrimEnd] = useState('00:15:00');
  const [trimQuality, setTrimQuality] = useState('');
  const [trimContainer, setTrimContainer] = useState('mp4');

  // Twitch Settings (OAuth token & Client ID). The server never sends the real token back —
  // only whether one's configured and a masked hint — so authToken here only ever holds a
  // value the user is actively typing to replace it.
  const [authToken, setAuthToken] = useState('');
  const [authTokenTouched, setAuthTokenTouched] = useState(false);
  const [authTokenMasked, setAuthTokenMasked] = useState('');
  const [clientId, setClientId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');

  // Live job list, shared with the rest of the app through one socket connection.
  const { jobs, setJobs } = useDownloads();

  const [vodMessage, setVodMessage] = useState(null); // { type: 'success' | 'error', text }


  // The shared list only holds the newest finished jobs across every site, so Twitch
  // captures could fall out of it; this page loads its own recent Twitch history.
  const [twitchHistory, setTwitchHistory] = useState([]);
  const [removedIds, setRemovedIds] = useState(() => new Set());

  useEffect(() => {
    api.getTwitchSettings().then((s) => {
      setAuthTokenMasked(s.authTokenMasked || '');
      setClientId(s.clientId || '');
    }).catch(() => {});
    api.listTwitchJobs().then(setTwitchHistory).catch(() => {});
  }, []);

  // Live rows from the shared socket win over the history snapshot for the same job. Only
  // finished rows come from the snapshot: the shared list always holds every active job, and
  // its copy disappears when the job is removed (from any tab).
  const twitchJobs = useMemo(() => {
    const isTwitch = (j) => j.is_live === 1 || (j.url && j.url.includes('twitch.tv'));
    const finished = twitchHistory.filter((j) => j.status !== 'queued' && j.status !== 'downloading');
    const byId = new Map(finished.map((j) => [j.id, j]));
    for (const j of jobs) if (isTwitch(j)) byId.set(j.id, j);
    return [...byId.values()]
      .filter((j) => !removedIds.has(j.id))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }, [jobs, twitchHistory, removedIds]);

  function handleTwitchJobDeleted(id) {
    setRemovedIds((prev) => new Set(prev).add(id));
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  const activeLiveJobs = useMemo(
    () => twitchJobs.filter((j) => j.status === 'downloading' || j.status === 'queued'),
    [twitchJobs]
  );

  const finishedTwitchJobs = useMemo(
    () => twitchJobs.filter((j) => j.status === 'completed' || j.status === 'failed'),
    [twitchJobs]
  );

  async function handleCheckChannel(nameToCheck) {
    const target = (nameToCheck || channelInput).trim();
    if (!target) return;
    setCheckingChannel(true);
    setChannelError('');
    try {
      const data = await api.getTwitchChannel(target);
      setChannelData(data);
      setLiveChannel(data.channel);
    } catch (err) {
      setChannelError(err.message || 'Failed to query Twitch channel');
      setChannelData(null);
    } finally {
      setCheckingChannel(false);
    }
  }

  async function handleStartLiveRecord(e) {
    e?.preventDefault();
    const ch = (liveChannel || channelInput).trim();
    if (!ch) {
      setLiveError('Look up a channel first, or type its name above.');
      return;
    }

    setStartingLive(true);
    setLiveError('');
    setLiveSuccess('');
    try {
      await api.downloadTwitch({
        channel: ch,
        isLive: true,
        waitForLive,
        liveFromStart: !waitForLive && liveFromStart,
        waitInterval,
        quality,
        container,
        hlsUseMpegts,
        twitchChat,
        audioOnly,
        splitLiveChunks,
        liveChunkDuration,
      });
      const splitNote = splitLiveChunks ? ` (will auto-split into ${liveChunkDuration}m chunks)` : '';
      setLiveSuccess(
        waitForLive
          ? `Waiting for ${ch} to go live${splitNote}. Recording starts automatically.`
          : `Recording ${ch}${splitNote}. Progress shows below and on Home.`
      );
    } catch (err) {
      setLiveError(err.message || 'Failed to start live recording');
    } finally {
      setStartingLive(false);
    }
  }

  async function handleDirectDownload(e) {
    e?.preventDefault();
    if (!directUrl.trim()) return;
    const sections = directStart.trim() || directEnd.trim()
      ? `${directStart.trim() || '00:00:00'}-${directEnd.trim() || 'inf'}`
      : '';

    setDirectSubmitting(true);
    setDirectMessage('');
    try {
      await api.downloadTwitch({
        url: directUrl.trim(),
        quality: directQuality,
        container: directContainer,
        downloadSections: sections ? `*${sections}` : '',
        twitchChat: directChat,
        audioOnly: directAudioOnly,
        isLive: false,
      });
      setDirectMessage('Download queued successfully!');
      setDirectUrl('');
      setDirectStart('');
      setDirectEnd('');
    } catch (err) {
      setDirectMessage(`Error: ${err.message}`);
    } finally {
      setDirectSubmitting(false);
    }
  }

  async function handleDownloadVod(vod, customSections = '') {
    try {
      await api.downloadTwitch({
        url: vod.url,
        quality: trimQuality,
        container: trimContainer,
        downloadSections: customSections ? `*${customSections}` : '',
        isLive: false,
      });
      setSelectedVod(null);
      setVodMessage({ type: 'success', text: `Queued download for "${vod.title}"` });
    } catch (err) {
      setVodMessage({ type: 'error', text: `Download failed: ${err.message}` });
    }
    setTimeout(() => setVodMessage(null), 4000);
  }

  async function handleSaveSettings(e) {
    e?.preventDefault();
    setSavingSettings(true);
    setSettingsStatus('');
    try {
      const payload = { clientId };
      if (authTokenTouched) payload.authToken = authToken;
      await api.saveTwitchSettings(payload);
      if (authTokenTouched) {
        setAuthTokenMasked(authToken ? `••••${authToken.slice(-4)}` : '');
        setAuthToken('');
        setAuthTokenTouched(false);
      }
      setSettingsStatus('Settings saved! Applies to all Twitch downloads.');
    } catch (err) {
      setSettingsStatus(`Failed to save: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleClearAuthToken() {
    setSavingSettings(true);
    setSettingsStatus('');
    try {
      await api.saveTwitchSettings({ authToken: '' });
      setAuthTokenMasked('');
      setAuthToken('');
      setAuthTokenTouched(false);
      setSettingsStatus('Auth token cleared.');
    } catch (err) {
      setSettingsStatus(`Failed to clear: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  }

  const lookedUp = channelData;
  const isLive = !!lookedUp?.live;
  const targetChannel = (liveChannel || channelInput).trim();
  const recordLabel = startingLive
    ? 'Starting…'
    : waitForLive || (lookedUp && !isLive)
      ? 'Record when they go live'
      : liveFromStart ? 'Record full broadcast' : 'Start recording now';
  const chunkValue = splitLiveChunks ? liveChunkDuration : 0;

  return (
    <>
      <div className="page-title-row">
        <h1>Twitch</h1>
        <div className="pill-tabs" role="tablist">
          {[
            ['record', 'Record live'],
            ['vods', channelData?.vods?.length ? `VODs · ${channelData.vods.length}` : 'VODs'],
            ['direct', 'Direct URL'],
            ['settings', 'Settings'],
          ].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {(activeTab === 'record' || activeTab === 'vods') && (
        <form className="lookup-row" onSubmit={(e) => { e.preventDefault(); handleCheckChannel(); }}>
          <input
            type="text"
            placeholder="Channel name or link, e.g. riotgames or twitch.tv/riotgames"
            value={channelInput}
            onChange={(e) => { setChannelInput(e.target.value); setLiveChannel(''); }}
            aria-label="Twitch channel"
          />
          <button type="submit" className="btn-secondary btn-lg" disabled={checkingChannel || !channelInput.trim()}>
            {checkingChannel ? 'Looking up…' : 'Look up'}
          </button>
        </form>
      )}
      {channelError && (activeTab === 'record' || activeTab === 'vods') && <div className="notice notice-danger">{channelError}</div>}

      {activeTab === 'record' && (
        <section className="twitch-live">
          <Art
            src={isLive ? lookedUp.stream?.thumbnail : null}
            className={`twitch-preview${isLive ? '' : ' twitch-preview-empty'}`}
            label={!lookedUp ? 'Look up a channel to see if it is live' : isLive ? 'live stream preview' : `@${lookedUp.channel} is offline`}
          >
            {isLive && <span className="badge badge-live badge-tl">● LIVE</span>}
            {isLive && lookedUp.stream?.viewCount ? <span className="badge badge-dark badge-tr">{formatCount(lookedUp.stream.viewCount)} watching</span> : null}
          </Art>

          <form className="twitch-side" onSubmit={handleStartLiveRecord}>
            <div className="twitch-channel">
              <Art src={null} className="twitch-avatar" ratio="1" />
              <div>
                <div className="twitch-channel-name">{lookedUp?.channel || targetChannel || 'No channel yet'}</div>
                <div className="twitch-channel-sub">
                  {!lookedUp ? 'Look up a channel above' : isLive ? `Live · best ${lookedUp.stream?.highestQuality || 'source'}` : 'Offline'}
                </div>
              </div>
            </div>
            {isLive && lookedUp.stream?.title && <h2 className="twitch-stream-title">{lookedUp.stream.title}</h2>}
            {lookedUp && !isLive && (
              <p className="field-hint">Not live right now. Queue it and recording starts the moment they go live (yt-dlp checks every {waitInterval}s).</p>
            )}

            {(!lookedUp || isLive) && (
              <div className="dl-options-group">
                <span className="field-caption">When</span>
                <Segmented
                  className="seg-full"
                  value={waitForLive ? 'wait' : 'now'}
                  onChange={(v) => setWaitForLive(v === 'wait')}
                  options={[{ value: 'now', label: 'Record now' }, { value: 'wait', label: 'When they go live' }]}
                />
              </div>
            )}
            {!waitForLive && (!lookedUp || isLive) && (
              <div className="dl-options-group">
                <span className="field-caption">Start from</span>
                <Segmented
                  className="seg-full"
                  value={liveFromStart}
                  onChange={setLiveFromStart}
                  options={[{ value: true, label: 'Beginning of stream' }, { value: false, label: 'Right now' }]}
                />
              </div>
            )}

            <div className="dl-options-group">
              <span className="field-caption">Split recording into chunks</span>
              <div className="choice-grid choice-grid-4">
                {[[0, 'Off'], [30, '30m'], [60, '1h'], [120, '2h']].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    className={`choice choice-accent mono${chunkValue === v ? ' active' : ''}`}
                    onClick={() => { setSplitLiveChunks(v > 0); if (v) setLiveChunkDuration(v); }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <button type="button" className="text-btn more-toggle" onClick={() => setMoreOptions((v) => !v)} aria-expanded={moreOptions}>
              {moreOptions ? 'Fewer options' : 'More options'}
            </button>
            {moreOptions && (
              <div className="dl-options">
                <Segmented
                  className="seg-full"
                  value={audioOnly}
                  onChange={setAudioOnly}
                  options={[{ value: false, label: 'Video' }, { value: true, label: 'Audio only' }]}
                />
                {!audioOnly && (
                  <div className="form-pair">
                    <label className="field-caption">Quality
                      <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                        {QUALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                    <label className="field-caption">File type
                      <select value={container} onChange={(e) => setContainer(e.target.value)}>
                        <option value="mp4">MP4</option>
                        <option value="mkv">MKV</option>
                        <option value="ts">TS (raw stream)</option>
                      </select>
                    </label>
                  </div>
                )}
                <div className="toggle-list">
                  <ToggleRow label="Crash-proof recording" description="Writes MPEG-TS segments so an interrupted recording stays playable" checked={hlsUseMpegts} onChange={setHlsUseMpegts} />
                  <ToggleRow label="Save chat log" checked={twitchChat} onChange={setTwitchChat} />
                </div>
              </div>
            )}

            <button type="submit" className="btn-primary btn-lg btn-block" disabled={startingLive || !targetChannel}>
              {recordLabel}
            </button>
            {liveSuccess && <div className="notice notice-info">{liveSuccess}</div>}
            {liveError && <div className="notice notice-danger">{liveError}</div>}
          </form>
        </section>
      )}

      {activeTab === 'vods' && (
        <section>
          {vodMessage && <div className={`notice ${vodMessage.type === 'error' ? 'notice-danger' : 'notice-info'}`} style={{ marginBottom: 14 }}>{vodMessage.text}</div>}
          {!channelData ? (
            <p className="empty-line">Look up a channel to see its past broadcasts.</p>
          ) : channelData.vods.length === 0 ? (
            <p className="empty-line">No public VODs. The channel may have past broadcasts turned off, or they may be subscriber-only (add your auth token under Settings).</p>
          ) : (
            <div className="vod-grid">
              {channelData.vods.map((vod) => (
                <article key={vod.id} className="vod-tile">
                  <Art src={vod.thumbnail} className="vod-art">
                    {vod.duration ? <span className="badge badge-duration">{formatDuration(vod.duration)}</span> : null}
                  </Art>
                  <div className="up-title" title={vod.title}>{vod.title}</div>
                  <div className="up-meta-row">
                    <span className="mono-meta">VOD {vod.rawId}</span>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setSelectedVod(vod);
                          setTrimStart('00:00:00');
                          setTrimEnd(vod.duration ? formatDuration(Math.min(vod.duration, 1800)) : '00:30:00');
                        }}
                      >
                        Trim
                      </button>
                      <button type="button" className="btn-primary btn-sm" onClick={() => handleDownloadVod(vod)}>Download</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          <Drawer
            open={!!selectedVod}
            onClose={() => setSelectedVod(null)}
            label="Download part of a VOD"
            header={<Art src={selectedVod?.thumbnail} className="drawer-art" ratio="auto" />}
            footer={(
              <>
                <span />
                <button type="button" className="btn-primary btn-lg" onClick={() => handleDownloadVod(selectedVod, `${trimStart}-${trimEnd}`)}>
                  Download segment
                </button>
              </>
            )}
          >
            <h2 className="drawer-title">{selectedVod?.title}</h2>
            <p className="drawer-sub">Download only part of this VOD.</p>
            <div className="drawer-section dl-options">
              <div className="form-pair">
                <label className="field-caption">Start (HH:MM:SS)
                  <input className="mono" value={trimStart} onChange={(e) => setTrimStart(e.target.value)} placeholder="00:00:00" />
                </label>
                <label className="field-caption">End (HH:MM:SS)
                  <input className="mono" value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} placeholder="00:30:00" />
                </label>
              </div>
              <div className="form-pair">
                <label className="field-caption">Quality
                  <select value={trimQuality} onChange={(e) => setTrimQuality(e.target.value)}>
                    {QUALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="field-caption">File type
                  <select value={trimContainer} onChange={(e) => setTrimContainer(e.target.value)}>
                    <option value="mp4">MP4</option>
                    <option value="mkv">MKV</option>
                  </select>
                </label>
              </div>
            </div>
          </Drawer>
        </section>
      )}

      {activeTab === 'direct' && (
        <form className="panel direct-form" onSubmit={handleDirectDownload}>
          <label className="field-caption">VOD or clip link
            <input
              className="mono"
              type="text"
              placeholder="https://www.twitch.tv/videos/12345678 or a clips.twitch.tv link"
              value={directUrl}
              onChange={(e) => setDirectUrl(e.target.value)}
              required
            />
          </label>
          <div className="form-pair">
            <label className="field-caption">Start time
              <input className="mono" placeholder="00:10:00" value={directStart} onChange={(e) => setDirectStart(e.target.value)} />
            </label>
            <label className="field-caption">End time
              <input className="mono" placeholder="00:25:00" value={directEnd} onChange={(e) => setDirectEnd(e.target.value)} />
            </label>
          </div>
          <p className="field-hint">Leave start and end empty to download the whole video.</p>
          <div className="toolbar">
            <Segmented value={directAudioOnly} onChange={setDirectAudioOnly} options={[{ value: false, label: 'Video' }, { value: true, label: 'Audio only' }]} />
            {!directAudioOnly && (
              <>
                <select className="toolbar-select" value={directQuality} onChange={(e) => setDirectQuality(e.target.value)} aria-label="Quality">
                  {QUALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select className="toolbar-select" value={directContainer} onChange={(e) => setDirectContainer(e.target.value)} aria-label="File type">
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                </select>
              </>
            )}
            <label className="switch-label">
              <Switch checked={directChat} onChange={setDirectChat} label="Save chat log" />
              <span>Chat log</span>
            </label>
            <span className="btn-row-spacer" />
            <button type="submit" className="btn-primary" disabled={directSubmitting || !directUrl.trim()}>
              {directSubmitting ? 'Adding…' : 'Download'}
            </button>
          </div>
          {directMessage && <div className={`notice ${directMessage.startsWith('Error') ? 'notice-danger' : 'notice-info'}`}>{directMessage}</div>}
        </form>
      )}

      {activeTab === 'settings' && (
        <form className="panel direct-form" onSubmit={handleSaveSettings}>
          <h2 className="panel-title">Twitch sign-in</h2>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Without your Twitch <code>auth-token</code>, downloads get ad breaks and subscriber-only VODs are blocked. The token is saved
            as a cookie, the same way as cookies.txt in Settings, so you only need to set it in one place.
          </p>
          <label className="field-caption">auth-token
            <input
              className="mono"
              type="password"
              placeholder={authTokenMasked ? `Saved (${authTokenMasked}). Type a new value to replace it` : 'Your 30-character auth-token cookie'}
              value={authToken}
              onChange={(e) => {
                setAuthToken(e.target.value);
                setAuthTokenTouched(true);
              }}
            />
          </label>
          <details className="how-to">
            <summary>How to find your auth-token</summary>
            <ol>
              <li>Open <a href="https://twitch.tv" target="_blank" rel="noopener noreferrer">twitch.tv</a> while signed in.</li>
              <li>Press <strong>F12</strong> to open developer tools.</li>
              <li>Go to <strong>Application</strong> (Chrome, Edge) or <strong>Storage</strong> (Firefox) › <strong>Cookies</strong> › <code>https://www.twitch.tv</code>.</li>
              <li>Copy the value of the cookie named <code>auth-token</code> and paste it here.</li>
            </ol>
          </details>
          <div className="btn-row">
            <button type="submit" className="btn-primary" disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save'}</button>
            {authTokenMasked && !authTokenTouched && (
              <button type="button" className="btn-ghost" onClick={handleClearAuthToken} disabled={savingSettings}>Clear saved token</button>
            )}
          </div>
          {settingsStatus && <div className={`notice ${settingsStatus.startsWith('Failed') ? 'notice-danger' : 'notice-info'}`}>{settingsStatus}</div>}
        </form>
      )}

      {activeLiveJobs.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Recording and queued</h2>
            <span className="mono-meta">{activeLiveJobs.length}</span>
          </div>
          <div className="up-grid">
            {activeLiveJobs.map((job) => <UpNextCard key={job.id} job={job} onRemoved={handleTwitchJobDeleted} />)}
          </div>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>Recent Twitch downloads</h2>
          <Link to="/history" className="text-btn section-head-actions">All history</Link>
        </div>
        {finishedTwitchJobs.length === 0 ? (
          <p className="empty-line">Recorded streams and downloaded VODs show up here.</p>
        ) : (
          <div className="rows">
            {finishedTwitchJobs.slice(0, 15).map((job) => <FinishedRow key={job.id} job={job} />)}
          </div>
        )}
      </section>
    </>
  );
}
