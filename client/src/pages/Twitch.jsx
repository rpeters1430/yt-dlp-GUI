import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Radio,
  Tv,
  Film,
  Clock,
  Sparkles,
  Download,
  Square,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  Search,
  Scissors,
  Key,
  RefreshCw,
  ExternalLink,
  Music,
  Captions,
  Terminal,
  Play,
  Sliders,
  Video,
} from 'lucide-react';
import { api } from '../api.js';
import QueueItem from '../components/QueueItem.jsx';

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
  const [waitInterval, setWaitInterval] = useState(15);
  const [quality, setQuality] = useState('');
  const [container, setContainer] = useState('mp4');
  const [hlsUseMpegts, setHlsUseMpegts] = useState(true);
  const [twitchChat, setTwitchChat] = useState(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const [startingLive, setStartingLive] = useState(false);
  const [liveSuccess, setLiveSuccess] = useState('');
  const [liveError, setLiveError] = useState('');

  // Direct VOD / Clip download options
  const [directUrl, setDirectUrl] = useState('');
  const [directQuality, setDirectQuality] = useState('');
  const [directContainer, setDirectContainer] = useState('mp4');
  const [directDownloadSections, setDirectDownloadSections] = useState('');
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
  const [trimSubmitting, setTrimSubmitting] = useState(false);

  // Twitch Settings (OAuth token & Client ID)
  const [authToken, setAuthToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');

  // Global jobs from socket
  const [jobs, setJobs] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    // Initial fetch of jobs & settings
    api.listDownloads().then(setJobs).catch(() => {});
    api.getTwitchSettings().then((s) => {
      setAuthToken(s.authToken || '');
      setClientId(s.clientId || '');
    }).catch(() => {});

    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('jobs:init', (initialJobs) => setJobs(initialJobs));
    socket.on('job:update', (job) => {
      setJobs((prev) => {
        const exists = prev.some((j) => j.id === job.id);
        if (exists) return prev.map((j) => (j.id === job.id ? job : j));
        return [job, ...prev];
      });
    });

    return () => socket.disconnect();
  }, []);

  // Filter jobs for Twitch
  const twitchJobs = useMemo(
    () => jobs.filter((j) => j.is_live === 1 || (j.url && j.url.includes('twitch.tv'))),
    [jobs]
  );

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
      setLiveError('Please enter a channel name or URL');
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
        waitInterval,
        quality,
        container,
        hlsUseMpegts,
        twitchChat,
        audioOnly,
      });
      setLiveSuccess(
        waitForLive
          ? `Monitoring stream for ${ch}. yt-dlp will automatically begin recording as soon as the channel goes live.`
          : `Started recording live stream for ${ch}. Tracking progress below.`
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

    setDirectSubmitting(true);
    setDirectMessage('');
    try {
      await api.downloadTwitch({
        url: directUrl.trim(),
        quality: directQuality,
        container: directContainer,
        downloadSections: directDownloadSections ? `*${directDownloadSections}` : '',
        twitchChat: directChat,
        audioOnly: directAudioOnly,
        isLive: false,
      });
      setDirectMessage('Download queued successfully!');
      setDirectUrl('');
      setDirectDownloadSections('');
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
      alert(`Queued download for "${vod.title}"`);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    }
  }

  async function handleStopJob(id) {
    if (!confirm('Stop recording and save the stream captured so far?')) return;
    try {
      await api.stopTwitchJob(id);
    } catch (err) {
      alert(`Failed to stop recording: ${err.message}`);
    }
  }

  async function handleSaveSettings(e) {
    e?.preventDefault();
    setSavingSettings(true);
    setSettingsStatus('');
    try {
      await api.saveTwitchSettings({ authToken, clientId });
      setSettingsStatus('Settings saved! OAuth token will be used for all Twitch downloads.');
    } catch (err) {
      setSettingsStatus(`Failed to save: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1><Tv className="header-icon" size={24} style={{ color: '#a855f7', marginRight: 8, verticalAlign: -4 }} /> Twitch Hub</h1>
          <p>Record live streams, download VODs & highlights, clip time slices, and track active captures.</p>
        </div>
      </div>

      {/* Top Channel Checker Bar */}
      <section className="panel twitch-channel-panel">
        <div className="twitch-search-row">
          <div className="search-input-group">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Enter channel name or link (e.g. eslcs, shroud, twitch.tv/riotgames)"
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCheckChannel()}
            />
          </div>
          <button
            type="button"
            onClick={() => handleCheckChannel()}
            disabled={checkingChannel || !channelInput.trim()}
          >
            {checkingChannel ? <><Loader2 size={15} className="spin-icon" /> Checking…</> : 'Check Channel'}
          </button>
        </div>

        <div className="twitch-quick-chips">
          <span className="muted small">Try:</span>
          {['eslcs', 'shroud', 'criticalrole', 'riotgames', 'dota2ti'].map((name) => (
            <button
              key={name}
              type="button"
              className="chip-btn"
              onClick={() => {
                setChannelInput(name);
                handleCheckChannel(name);
              }}
            >
              {name}
            </button>
          ))}
        </div>

        {channelError && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            <AlertCircle size={16} /> {channelError}
          </div>
        )}

        {/* Live / Offline Status Result Card */}
        {channelData && (
          <div className="twitch-status-card">
            {channelData.live ? (
              <div className="twitch-live-banner">
                <div className="twitch-live-preview">
                  {channelData.stream?.thumbnail ? (
                    <img src={channelData.stream.thumbnail} alt={channelData.stream.title} />
                  ) : (
                    <div className="empty-thumb"><Tv size={32} /></div>
                  )}
                  <span className="live-pulsing-badge">
                    <span className="pulsing-dot" /> LIVE NOW
                  </span>
                </div>

                <div className="twitch-live-details">
                  <div className="live-header-line">
                    <span className="twitch-channel-tag">@{channelData.channel}</span>
                    <span className="tag status-tag status-downloading">Online</span>
                    {channelData.stream?.highestQuality && (
                      <span className="tag"><Sparkles size={11} /> {channelData.stream.highestQuality}</span>
                    )}
                  </div>
                  <h3 className="twitch-stream-title">{channelData.stream?.title}</h3>
                  <div className="twitch-stream-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setLiveChannel(channelData.channel);
                        setActiveTab('record');
                        setWaitForLive(false);
                      }}
                    >
                      <Radio size={14} /> Record Live Stream
                    </button>
                    <a
                      href={channelData.channelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary"
                    >
                      <ExternalLink size={14} /> View on Twitch
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div className="twitch-offline-banner">
                <div className="offline-left">
                  <span className="offline-dot" />
                  <div>
                    <strong>@{channelData.channel}</strong> is currently <strong>Offline</strong>.
                    <div className="muted small">You can set up auto-recording to start downloading the moment they go live.</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setLiveChannel(channelData.channel);
                    setActiveTab('record');
                    setWaitForLive(true);
                  }}
                >
                  <Clock size={14} /> Wait For Live (Auto-Record)
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Main Tabs Navigation */}
      <div className="twitch-tabs">
        <button
          type="button"
          className={`twitch-tab-btn ${activeTab === 'record' ? 'active' : ''}`}
          onClick={() => setActiveTab('record')}
        >
          <Radio size={15} /> Live Stream Recorder
        </button>
        <button
          type="button"
          className={`twitch-tab-btn ${activeTab === 'vods' ? 'active' : ''}`}
          onClick={() => setActiveTab('vods')}
        >
          <Film size={15} /> Channel VODs & Highlights {channelData?.vods?.length ? `(${channelData.vods.length})` : ''}
        </button>
        <button
          type="button"
          className={`twitch-tab-btn ${activeTab === 'direct' ? 'active' : ''}`}
          onClick={() => setActiveTab('direct')}
        >
          <Scissors size={15} /> Direct VOD / Clip Trimmer
        </button>
        <button
          type="button"
          className={`twitch-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Key size={15} /> Twitch Settings & OAuth
        </button>
      </div>

      {/* Tab 1: Live Stream Recorder */}
      {activeTab === 'record' && (
        <section className="panel">
          <div className="panel-header">
            <h2><Radio size={16} /> Live Stream Recording Configuration</h2>
          </div>
          <form onSubmit={handleStartLiveRecord}>
            <div className="form-group">
              <label className="field-label">
                Twitch Channel or URL
                <input
                  type="text"
                  placeholder="e.g. eslcs or https://twitch.tv/eslcs"
                  value={liveChannel}
                  onChange={(e) => setLiveChannel(e.target.value)}
                  required
                />
              </label>
            </div>

            <div className="segmented-choice" style={{ marginBottom: 16 }}>
              <button
                type="button"
                className={!waitForLive ? 'active' : ''}
                onClick={() => setWaitForLive(false)}
              >
                <Radio size={14} /> Record Live Stream Now
              </button>
              <button
                type="button"
                className={waitForLive ? 'active' : ''}
                onClick={() => setWaitForLive(true)}
              >
                <Clock size={14} /> Wait For Stream (Auto-record when live)
              </button>
            </div>

            {waitForLive && (
              <div className="alert alert-info" style={{ marginBottom: 14 }}>
                <Clock size={16} />
                <div>
                  <strong>Auto-Record Enabled:</strong> yt-dlp will poll every {waitInterval}s in the background and automatically start capturing the moment this channel goes live.
                </div>
              </div>
            )}

            <div className="options-row" style={{ flexWrap: 'wrap', gap: 14 }}>
              <div className="segmented">
                <button type="button" className={!audioOnly ? 'active' : ''} onClick={() => setAudioOnly(false)}>
                  <Video size={13} /> Video
                </button>
                <button type="button" className={audioOnly ? 'active' : ''} onClick={() => setAudioOnly(true)}>
                  <Music size={13} /> Audio only
                </button>
              </div>

              {!audioOnly && (
                <label className="field-inline">
                  Quality Cap
                  <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                    {QUALITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              )}

              {!audioOnly && (
                <label className="field-inline">
                  Container
                  <select value={container} onChange={(e) => setContainer(e.target.value)}>
                    <option value="mp4">MP4 (Standard)</option>
                    <option value="mkv">MKV (Matroska)</option>
                    <option value="ts">TS (MPEG-TS Raw Stream)</option>
                  </select>
                </label>
              )}

              <label className="checkbox-label" title="Records MPEG-TS live segments to guarantee stream files remain intact and playable even if stopped or interrupted.">
                <input
                  type="checkbox"
                  checked={hlsUseMpegts}
                  onChange={(e) => setHlsUseMpegts(e.target.checked)}
                />
                Crash-proof MPEG-TS HLS
              </label>

              <label className="checkbox-label" title="Download Twitch chat / rechat stream when available.">
                <input
                  type="checkbox"
                  checked={twitchChat}
                  onChange={(e) => setTwitchChat(e.target.checked)}
                />
                <Captions size={14} /> Twitch Chat Log
              </label>

              <div className="spacer">
                <button type="submit" disabled={startingLive || !liveChannel.trim()}>
                  {startingLive ? (
                    <><Loader2 size={15} className="spin-icon" /> Starting…</>
                  ) : waitForLive ? (
                    <><Clock size={15} /> Start Stream Watcher</>
                  ) : (
                    <><Radio size={15} /> Start Live Capture</>
                  )}
                </button>
              </div>
            </div>

            {liveSuccess && <div className="alert alert-success" style={{ marginTop: 12 }}><CheckCircle2 size={16} />{liveSuccess}</div>}
            {liveError && <div className="alert alert-error" style={{ marginTop: 12 }}><AlertCircle size={16} />{liveError}</div>}
          </form>
        </section>
      )}

      {/* Tab 2: Channel VODs & Highlights */}
      {activeTab === 'vods' && (
        <section className="panel">
          <div className="panel-header">
            <h2><Film size={16} /> Past Broadcasts & VODs {channelData?.channel ? `for @${channelData.channel}` : ''}</h2>
            {channelData?.channel && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => handleCheckChannel(channelData.channel)}
                disabled={checkingChannel}
              >
                <RefreshCw size={13} className={checkingChannel ? 'spin-icon' : ''} /> Refresh VODs
              </button>
            )}
          </div>

          {!channelData ? (
            <div className="empty-state">
              <Tv size={32} />
              <span className="empty-title">No channel selected</span>
              <span className="empty-subtitle">Use the search bar at the top to check a channel and view its VODs.</span>
            </div>
          ) : channelData.vods.length === 0 ? (
            <div className="empty-state">
              <Film size={32} />
              <span className="empty-title">No public VODs found</span>
              <span className="empty-subtitle">This channel might not have past broadcasts enabled or they may be subscriber-only (check the OAuth tab).</span>
            </div>
          ) : (
            <div className="twitch-vod-grid">
              {channelData.vods.map((vod) => (
                <div key={vod.id} className="twitch-vod-card">
                  <div className="vod-thumb-box">
                    {vod.thumbnail ? (
                      <img src={vod.thumbnail} alt={vod.title} className="vod-thumb-img" />
                    ) : (
                      <div className="vod-thumb-empty"><Film size={24} /></div>
                    )}
                    {vod.duration ? (
                      <span className="vod-duration-tag">
                        <Clock size={10} /> {formatDuration(vod.duration)}
                      </span>
                    ) : null}
                  </div>
                  <div className="vod-card-body">
                    <h4 className="vod-title" title={vod.title}>{vod.title}</h4>
                    <div className="vod-meta-row">
                      <span className="tag">VOD {vod.rawId}</span>
                    </div>

                    <div className="vod-actions-row">
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => handleDownloadVod(vod)}
                      >
                        <Download size={13} /> Full VOD
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => {
                          setSelectedVod(vod);
                          setTrimStart('00:00:00');
                          setTrimEnd(vod.duration ? formatDuration(Math.min(vod.duration, 1800)) : '00:30:00');
                        }}
                      >
                        <Scissors size={13} /> Trim Segment
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Modal / Panel for Trimming a selected VOD */}
          {selectedVod && (
            <div className="modal-backdrop" onClick={() => setSelectedVod(null)}>
              <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
                <div className="modal-header">
                  <div className="modal-header-title">
                    <Scissors size={18} className="text-accent" />
                    <span>Trim VOD Segment</span>
                  </div>
                  <button type="button" className="icon-btn-neutral" onClick={() => setSelectedVod(null)}>
                    <XCircle size={18} />
                  </button>
                </div>
                <div className="modal-body">
                  <p><strong>{selectedVod.title}</strong></p>
                  <p className="muted small">Download only a specific segment instead of the entire VOD.</p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '14px 0' }}>
                    <label className="field-label">
                      Start Time (HH:MM:SS)
                      <input
                        type="text"
                        value={trimStart}
                        onChange={(e) => setTrimStart(e.target.value)}
                        placeholder="00:00:00"
                      />
                    </label>
                    <label className="field-label">
                      End Time (HH:MM:SS)
                      <input
                        type="text"
                        value={trimEnd}
                        onChange={(e) => setTrimEnd(e.target.value)}
                        placeholder="00:30:00"
                      />
                    </label>
                  </div>

                  <div className="options-row" style={{ marginTop: 8 }}>
                    <label className="field-inline">
                      Quality
                      <select value={trimQuality} onChange={(e) => setTrimQuality(e.target.value)}>
                        {QUALITY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field-inline">
                      Container
                      <select value={trimContainer} onChange={(e) => setTrimContainer(e.target.value)}>
                        <option value="mp4">MP4</option>
                        <option value="mkv">MKV</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn-secondary" onClick={() => setSelectedVod(null)}>Cancel</button>
                  <button
                    type="button"
                    onClick={() => handleDownloadVod(selectedVod, `${trimStart}-${trimEnd}`)}
                  >
                    <Download size={14} /> Download Trimmed Segment
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tab 3: Direct VOD / Clip Trimmer */}
      {activeTab === 'direct' && (
        <section className="panel">
          <div className="panel-header">
            <h2><Scissors size={16} /> Direct VOD & Clip Downloader</h2>
          </div>
          <form onSubmit={handleDirectDownload}>
            <label className="field-label" style={{ marginBottom: 12 }}>
              Twitch VOD or Clip URL
              <input
                type="text"
                placeholder="https://www.twitch.tv/videos/12345678 or https://clips.twitch.tv/..."
                value={directUrl}
                onChange={(e) => setDirectUrl(e.target.value)}
                required
              />
            </label>

            <label className="field-label" style={{ marginBottom: 16 }}>
              Time-Slice Trimming (Optional, e.g. 00:10:00-00:25:00)
              <input
                type="text"
                placeholder="Leave blank for full video, or enter Start-End (HH:MM:SS-HH:MM:SS)"
                value={directDownloadSections}
                onChange={(e) => setDirectDownloadSections(e.target.value)}
              />
            </label>

            <div className="options-row" style={{ flexWrap: 'wrap', gap: 14 }}>
              <div className="segmented">
                <button type="button" className={!directAudioOnly ? 'active' : ''} onClick={() => setDirectAudioOnly(false)}>
                  <Video size={13} /> Video
                </button>
                <button type="button" className={directAudioOnly ? 'active' : ''} onClick={() => setDirectAudioOnly(true)}>
                  <Music size={13} /> Audio only
                </button>
              </div>

              {!directAudioOnly && (
                <label className="field-inline">
                  Quality
                  <select value={directQuality} onChange={(e) => setDirectQuality(e.target.value)}>
                    {QUALITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              )}

              {!directAudioOnly && (
                <label className="field-inline">
                  Container
                  <select value={directContainer} onChange={(e) => setDirectContainer(e.target.value)}>
                    <option value="mp4">MP4</option>
                    <option value="mkv">MKV</option>
                  </select>
                </label>
              )}

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={directChat}
                  onChange={(e) => setDirectChat(e.target.checked)}
                />
                <Captions size={14} /> Download Chat Log
              </label>

              <div className="spacer">
                <button type="submit" disabled={directSubmitting || !directUrl.trim()}>
                  {directSubmitting ? <><Loader2 size={15} className="spin-icon" /> Adding…</> : 'Download'}
                </button>
              </div>
            </div>

            {directMessage && (
              <div className={`alert ${directMessage.startsWith('Error') ? 'alert-error' : 'alert-success'}`} style={{ marginTop: 12 }}>
                {directMessage.startsWith('Error') ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                {directMessage}
              </div>
            )}
          </form>
        </section>
      )}

      {/* Tab 4: Twitch Settings & OAuth */}
      {activeTab === 'settings' && (
        <section className="panel">
          <div className="panel-header">
            <h2><Key size={16} /> Twitch Authentication & Ad-Bypass (OAuth)</h2>
          </div>
          <form onSubmit={handleSaveSettings}>
            <p className="muted" style={{ marginBottom: 16 }}>
              Twitch limits non-authenticated downloads with ad interstitials and blocks subscriber-only VODs. By providing your Twitch <code>auth-token</code>, yt-dlp can access sub-only content and avoid ad breaks.
            </p>

            <label className="field-label" style={{ marginBottom: 12 }}>
              Twitch OAuth Auth Token (auth-token)
              <input
                type="password"
                placeholder="e.g. your 30-character oauth auth-token cookie"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
              />
            </label>

            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <div>
                <strong>How to get your auth-token:</strong>
                <ol style={{ paddingLeft: 18, marginTop: 6, marginBottom: 0 }}>
                  <li>Open <a href="https://twitch.tv" target="_blank" rel="noopener noreferrer">twitch.tv</a> and ensure you are logged in.</li>
                  <li>Press <strong>F12</strong> to open Browser Developer Tools.</li>
                  <li>Go to <strong>Application</strong> (Chrome/Edge) or <strong>Storage</strong> (Firefox) &gt; <strong>Cookies</strong> &gt; <code>https://www.twitch.tv</code>.</li>
                  <li>Find the cookie named <code>auth-token</code>, copy its value, and paste it here.</li>
                </ol>
              </div>
            </div>

            <button type="submit" disabled={savingSettings}>
              {savingSettings ? <><Loader2 size={15} className="spin-icon" /> Saving…</> : 'Save Twitch Credentials'}
            </button>

            {settingsStatus && (
              <div className={`alert ${settingsStatus.startsWith('Failed') ? 'alert-error' : 'alert-success'}`} style={{ marginTop: 12 }}>
                {settingsStatus.startsWith('Failed') ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                {settingsStatus}
              </div>
            )}
          </form>
        </section>
      )}

      {/* Real-time Active Captures Tracker */}
      <section className="panel">
        <div className="panel-header">
          <h2><Radio size={16} /> Active Twitch Recordings & Queue</h2>
          {activeLiveJobs.length > 0 && <span className="count-badge">{activeLiveJobs.length}</span>}
        </div>

        {activeLiveJobs.length === 0 ? (
          <div className="empty-state">
            <Radio size={30} />
            <span className="empty-title">No active Twitch downloads</span>
            <span className="empty-subtitle">Active live stream captures and VOD downloads will show up here in real time.</span>
          </div>
        ) : (
          <div className="twitch-active-list">
            {activeLiveJobs.map((job) => (
              <div key={job.id} className="twitch-active-card">
                <div className="twitch-active-header">
                  <div className="active-title-group">
                    {job.is_live === 1 ? (
                      <span className="live-pulsing-badge-sm">
                        <span className="pulsing-dot" /> LIVE RECORDING
                      </span>
                    ) : (
                      <span className="tag status-tag status-downloading">DOWNLOADING</span>
                    )}
                    <span className="active-job-title">{job.title || job.url}</span>
                  </div>

                  <div className="active-actions">
                    {job.status === 'downloading' && (
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => handleStopJob(job.id)}
                        title="Stop recording and save file to disk"
                      >
                        <Square size={13} /> Stop Recording
                      </button>
                    )}
                  </div>
                </div>

                <div className="active-meta-line">
                  <span className="muted small">URL: {job.url}</span>
                  {job.speed && <span className="tag">Speed: {job.speed}</span>}
                  {job.percent != null && job.percent > 0 && <span className="tag">{job.percent.toFixed(1)}%</span>}
                </div>

                <QueueItem job={job} onDeleted={() => {}} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Twitch Downloads History */}
      <section className="panel">
        <div className="panel-header">
          <h2><CheckCircle2 size={16} /> Recent Twitch Captures & VODs</h2>
          {finishedTwitchJobs.length > 0 && <span className="count-badge">{finishedTwitchJobs.length}</span>}
        </div>

        {finishedTwitchJobs.length === 0 ? (
          <div className="empty-state">
            <Tv size={30} />
            <span className="empty-title">No completed Twitch downloads yet</span>
            <span className="empty-subtitle">Recorded live streams and downloaded VODs will appear here.</span>
          </div>
        ) : (
          <div className="queue-list">
            {finishedTwitchJobs.slice(0, 15).map((job) => (
              <QueueItem key={job.id} job={job} onDeleted={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
