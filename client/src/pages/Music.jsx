import React, { useEffect, useState, useRef } from 'react';
import {
  Music,
  Disc3,
  Search,
  Download,
  Play,
  Pause,
  Folder,
  Sliders,
  Settings,
  Radar,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  Plus,
  Trash2,
  Volume2,
  FileAudio,
  Layers,
  ListMusic,
  Check,
  Radio,
} from 'lucide-react';
import { api } from '../api.js';

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.floor(sec);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const FORMAT_OPTIONS = [
  { value: 'mp3', label: 'MP3 (Universal, tagged)' },
  { value: 'flac', label: 'FLAC (Lossless Studio Quality)' },
  { value: 'm4a', label: 'M4A / AAC (Apple / High Efficiency)' },
  { value: 'opus', label: 'OPUS (Modern / Low Bitrate)' },
  { value: 'wav', label: 'WAV (Uncompressed Lossless)' },
];

const QUALITY_OPTIONS_BY_FORMAT = {
  mp3: [
    { value: '320k', label: '320 kbps (High Quality CBR)' },
    { value: '256k', label: '256 kbps (High Quality)' },
    { value: '192k', label: '192 kbps (Standard Quality)' },
    { value: '128k', label: '128 kbps (Compact)' },
    { value: '0', label: 'VBR 0 (Best Variable)' },
  ],
  flac: [
    { value: '0', label: 'Lossless (Original / Bit-perfect)' },
  ],
  m4a: [
    { value: '256k', label: '256 kbps (iTunes / Apple Standard)' },
    { value: '320k', label: '320 kbps (High Bitrate AAC)' },
    { value: '192k', label: '192 kbps' },
  ],
  opus: [
    { value: '160k', label: '160 kbps (Transparent Quality)' },
    { value: '128k', label: '128 kbps (Standard OPUS)' },
    { value: '96k', label: '96 kbps (High Efficiency)' },
  ],
  wav: [
    { value: '0', label: 'Lossless Uncompressed (16/24-bit PCM)' },
  ],
};

export default function MusicPage() {
  const [activeTab, setActiveTab] = useState('search'); // 'search' | 'direct' | 'watches' | 'settings'

  // Settings
  const [settings, setSettings] = useState({
    musicFolder: 'Music',
    musicFormat: 'mp3',
    musicQuality: '320k',
    saveCover: true,
  });
  const [settingsSavedToast, setSettingsSavedToast] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('album'); // 'album' | 'track'
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState('');

  // Selected album details
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [downloadingAlbum, setDownloadingAlbum] = useState(false);
  const [albumDownloadMessage, setAlbumDownloadMessage] = useState(null);

  // Download options for current view
  const [downloadFormat, setDownloadFormat] = useState('mp3');
  const [downloadQuality, setDownloadQuality] = useState('320k');
  const [downloadFolder, setDownloadFolder] = useState('Music');
  const [downloadSaveCover, setDownloadSaveCover] = useState(true);

  // Direct URL state
  const [directUrl, setDirectUrl] = useState('');
  const [inspectingUrl, setInspectingUrl] = useState(false);
  const [directInfo, setDirectInfo] = useState(null);
  const [directError, setDirectError] = useState('');
  const [directDownloading, setDirectDownloading] = useState(false);
  const [directDownloadMessage, setDirectDownloadMessage] = useState(null);

  // Music Watches state
  const [musicWatches, setMusicWatches] = useState([]);
  const [watchesLoading, setWatchesLoading] = useState(false);
  const [showAddWatchModal, setShowAddWatchModal] = useState(false);
  const [newWatchUrl, setNewWatchUrl] = useState('');
  const [newWatchName, setNewWatchName] = useState('');
  const [newWatchFormat, setNewWatchFormat] = useState('mp3');
  const [newWatchQuality, setNewWatchQuality] = useState('320k');
  const [newWatchFolder, setNewWatchFolder] = useState('Music');
  const [newWatchInterval, setNewWatchInterval] = useState('60');
  const [newWatchError, setNewWatchError] = useState('');
  const [addingWatch, setAddingWatch] = useState(false);

  // Audio preview player
  const [playingPreviewUrl, setPlayingPreviewUrl] = useState(null);
  const audioPlayerRef = useRef(null);

  // Load initial settings
  useEffect(() => {
    api.getMusicSettings().then((s) => {
      setSettings(s);
      setDownloadFormat(s.musicFormat || 'mp3');
      setDownloadQuality(s.musicQuality || '320k');
      setDownloadFolder(s.musicFolder || 'Music');
      setDownloadSaveCover(s.saveCover !== false);
      setNewWatchFormat(s.musicFormat || 'mp3');
      setNewWatchQuality(s.musicQuality || '320k');
      setNewWatchFolder(s.musicFolder || 'Music');
    }).catch(() => {});
  }, []);

  // Sync quality options when format changes
  const availableQualities = QUALITY_OPTIONS_BY_FORMAT[downloadFormat] || QUALITY_OPTIONS_BY_FORMAT.mp3;
  useEffect(() => {
    if (!availableQualities.some((q) => q.value === downloadQuality)) {
      setDownloadQuality(availableQualities[0]?.value || '320k');
    }
  }, [downloadFormat]);

  // Load music watches when tab opens
  useEffect(() => {
    if (activeTab === 'watches') {
      loadMusicWatches();
    }
  }, [activeTab]);

  function loadMusicWatches() {
    setWatchesLoading(true);
    api.listMusicWatches()
      .then((data) => setMusicWatches(data || []))
      .catch((err) => console.error(err))
      .finally(() => setWatchesLoading(false));
  }

  // Audio preview play/pause handler
  function togglePreview(previewUrl) {
    if (!previewUrl) return;
    if (playingPreviewUrl === previewUrl) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      setPlayingPreviewUrl(null);
    } else {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      const audio = new Audio(previewUrl);
      audioPlayerRef.current = audio;
      setPlayingPreviewUrl(previewUrl);
      audio.play().catch(() => setPlayingPreviewUrl(null));
      audio.onended = () => setPlayingPreviewUrl(null);
      audio.onerror = () => setPlayingPreviewUrl(null);
    }
  }

  // Stop preview on unmount
  useEffect(() => {
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
    };
  }, []);

  // Perform search
  async function handleSearch(e) {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    setSearching(true);
    setSearchError('');
    setSelectedAlbum(null);

    try {
      const data = await api.searchMusic(q, searchType);
      setSearchResults(data.results || []);
      if ((data.results || []).length === 0) {
        setSearchError(`No ${searchType === 'album' ? 'albums' : 'tracks'} found for "${q}". Try another search term.`);
      }
    } catch (err) {
      setSearchError(err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  // View album details
  async function handleSelectAlbum(album) {
    setAlbumLoading(true);
    setAlbumDownloadMessage(null);
    try {
      const data = await api.getMusicAlbum(album.id);
      setSelectedAlbum(data);
      // Default: select all tracks
      const allTrackNums = new Set((data.tracks || []).map((t) => t.trackNumber));
      setSelectedTracks(allTrackNums);
    } catch (err) {
      alert(`Could not load album details: ${err.message}`);
    } finally {
      setAlbumLoading(false);
    }
  }

  // Track selection toggles
  function toggleTrackSelection(trackNumber) {
    setSelectedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackNumber)) next.delete(trackNumber);
      else next.add(trackNumber);
      return next;
    });
  }

  function selectAllTracks() {
    if (!selectedAlbum?.tracks) return;
    setSelectedTracks(new Set(selectedAlbum.tracks.map((t) => t.trackNumber)));
  }

  function deselectAllTracks() {
    setSelectedTracks(new Set());
  }

  // Download Album or Selected Tracks
  async function handleDownloadAlbum(onlySelected = false) {
    if (!selectedAlbum || !selectedAlbum.tracks) return;
    const tracksToDownload = selectedAlbum.tracks.filter((t) =>
      onlySelected ? selectedTracks.has(t.trackNumber) : true
    );

    if (tracksToDownload.length === 0) {
      alert('Please select at least one track to download.');
      return;
    }

    setDownloadingAlbum(true);
    setAlbumDownloadMessage(null);

    try {
      const payload = {
        tracks: tracksToDownload.map((t) => ({
          ...t,
          album: selectedAlbum.album.name,
          artist: t.artist || selectedAlbum.album.artist,
          albumArtist: selectedAlbum.album.artist,
          year: selectedAlbum.album.releaseYear,
          genre: selectedAlbum.album.genre,
          artwork: selectedAlbum.album.artwork,
          totalTracks: selectedAlbum.tracks.length,
        })),
        audioFormat: downloadFormat,
        audioQuality: downloadQuality,
        musicFolder: downloadFolder,
        saveCover: downloadSaveCover,
      };

      const res = await api.downloadMusic(payload);
      setAlbumDownloadMessage({
        type: 'success',
        text: `Successfully queued ${res.enqueued} song${res.enqueued === 1 ? '' : 's'} into "${downloadFolder}/${selectedAlbum.album.artist}/${selectedAlbum.album.name}"!`,
      });
    } catch (err) {
      setAlbumDownloadMessage({
        type: 'error',
        text: `Download failed: ${err.message}`,
      });
    } finally {
      setDownloadingAlbum(false);
    }
  }

  // Download a single track
  async function handleDownloadSingleTrack(track) {
    try {
      const payload = {
        track: {
          ...track,
          albumArtist: selectedAlbum?.album?.artist || track.artist,
          totalTracks: selectedAlbum?.tracks?.length || 1,
        },
        audioFormat: downloadFormat,
        audioQuality: downloadQuality,
        musicFolder: downloadFolder,
        saveCover: downloadSaveCover,
      };
      await api.downloadMusic(payload);
      alert(`Queued "${track.title}" for download in ${downloadFormat.toUpperCase()}!`);
    } catch (err) {
      alert(`Failed to queue track: ${err.message}`);
    }
  }

  // Inspect Direct URL
  async function handleInspectDirectUrl(e) {
    if (e) e.preventDefault();
    const url = directUrl.trim();
    if (!url) return;

    setInspectingUrl(true);
    setDirectError('');
    setDirectInfo(null);
    setDirectDownloadMessage(null);

    try {
      const info = await api.inspectMusicUrl(url);
      setDirectInfo(info);
    } catch (err) {
      setDirectError(err.message || 'Failed to inspect URL');
    } finally {
      setInspectingUrl(false);
    }
  }

  // Download from Direct URL
  async function handleDownloadDirect() {
    if (!directInfo) return;
    setDirectDownloading(true);
    setDirectDownloadMessage(null);

    try {
      if (directInfo.isPlaylist && directInfo.entries?.length > 0) {
        const payload = {
          tracks: directInfo.entries.map((e, idx) => ({
            title: e.title,
            artist: directInfo.uploader || 'YouTube Music',
            album: directInfo.title || 'Playlist',
            trackNumber: idx + 1,
            totalTracks: directInfo.entries.length,
            youtubeUrl: e.url,
            artwork: e.thumbnail || directInfo.thumbnail,
          })),
          audioFormat: downloadFormat,
          audioQuality: downloadQuality,
          musicFolder: downloadFolder,
          saveCover: downloadSaveCover,
        };
        const res = await api.downloadMusic(payload);
        setDirectDownloadMessage({
          type: 'success',
          text: `Queued ${res.enqueued} track(s) from playlist into "${downloadFolder}"!`,
        });
      } else {
        const payload = {
          track: {
            title: directInfo.title,
            artist: directInfo.uploader || 'YouTube',
            album: 'Singles',
            trackNumber: 1,
            youtubeUrl: directUrl,
            artwork: directInfo.thumbnail,
          },
          audioFormat: downloadFormat,
          audioQuality: downloadQuality,
          musicFolder: downloadFolder,
          saveCover: downloadSaveCover,
        };
        await api.downloadMusic(payload);
        setDirectDownloadMessage({
          type: 'success',
          text: `Queued "${directInfo.title}" for download into "${downloadFolder}"!`,
        });
      }
    } catch (err) {
      setDirectDownloadMessage({
        type: 'error',
        text: `Download error: ${err.message}`,
      });
    } finally {
      setDirectDownloading(false);
    }
  }

  // Create Music Watch
  async function handleCreateMusicWatch(e) {
    if (e) e.preventDefault();
    if (!newWatchUrl.trim()) return;

    setAddingWatch(true);
    setNewWatchError('');

    try {
      await api.createMusicWatch({
        url: newWatchUrl.trim(),
        name: newWatchName.trim() || undefined,
        audioFormat: newWatchFormat,
        audioQuality: newWatchQuality,
        musicFolder: newWatchFolder,
        checkIntervalMins: parseInt(newWatchInterval, 10) || 60,
      });
      setShowAddWatchModal(false);
      setNewWatchUrl('');
      setNewWatchName('');
      loadMusicWatches();
    } catch (err) {
      setNewWatchError(err.message || 'Failed to add music watch');
    } finally {
      setAddingWatch(false);
    }
  }

  // Trigger watch check
  async function handleCheckWatch(id) {
    try {
      await api.checkWatch(id);
      loadMusicWatches();
    } catch (err) {
      alert(`Check error: ${err.message}`);
    }
  }

  // Delete watch
  async function handleDeleteWatch(id) {
    if (!confirm('Are you sure you want to remove this music watch?')) return;
    try {
      await api.deleteWatch(id);
      loadMusicWatches();
    } catch (err) {
      alert(`Delete error: ${err.message}`);
    }
  }

  // Save general music settings
  async function handleSaveSettings(e) {
    if (e) e.preventDefault();
    try {
      const updated = await api.updateMusicSettings(settings);
      setSettings(updated);
      setSettingsSavedToast(true);
      setTimeout(() => setSettingsSavedToast(false), 3000);
    } catch (err) {
      alert(`Failed to save settings: ${err.message}`);
    }
  }

  return (
    <div className="music-hub-container" style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 60 }}>
      {/* Top Header Banner */}
      <div className="card" style={{ marginBottom: 20, background: 'linear-gradient(135deg, rgba(91, 109, 248, 0.12) 0%, rgba(155, 107, 255, 0.08) 100%)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <Disc3 size={28} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Music Hub & Watcher</h1>
              <p style={{ margin: '3px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Discover albums, download YouTube tracks in high-fidelity MP3/FLAC with embedded metadata & artwork, and monitor artists.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'search' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setActiveTab('search'); setSelectedAlbum(null); }}
            >
              <Search size={15} />
              Albums & Songs
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'direct' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('direct')}
            >
              <FileAudio size={15} />
              Direct URL
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'watches' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('watches')}
            >
              <Radar size={15} />
              Music Watches
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'settings' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('settings')}
            >
              <Settings size={15} />
              Settings
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: ALBUM & SONG SEARCH                                                */}
      {/* ========================================================================= */}
      {activeTab === 'search' && (
        <div>
          {!selectedAlbum ? (
            <div>
              {/* Search Bar */}
              <div className="card" style={{ marginBottom: 20 }}>
                <form onSubmit={handleSearch}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 6, background: 'var(--bg)', padding: 4, borderRadius: 'var(--radius-sm)' }}>
                      <button
                        type="button"
                        className={`btn btn-sm ${searchType === 'album' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setSearchType('album')}
                      >
                        <Disc3 size={14} /> Albums
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${searchType === 'track' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setSearchType('track')}
                      >
                        <Music size={14} /> Single Songs
                      </button>
                    </div>

                    <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
                      <Search size={17} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                      <input
                        type="text"
                        className="input"
                        style={{ paddingLeft: 38, width: '100%' }}
                        placeholder={searchType === 'album' ? 'Search album or artist name (e.g. "Random Access Memories", "The Dark Side of the Moon")' : 'Search song name & artist (e.g. "Get Lucky", "Bohemian Rhapsody")'}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={searching || !searchQuery.trim()}>
                      {searching ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
                      Search
                    </button>
                  </div>
                </form>

                {/* Popular chips */}
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
                  <span>Suggestions:</span>
                  {['Daft Punk Discovery', 'Pink Floyd', 'Radiohead OK Computer', 'The Beatles Abbey Road', 'Kendrick Lamar', 'Miles Davis Kind of Blue'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="badge"
                      style={{ cursor: 'pointer', background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                      onClick={() => { setSearchQuery(chip); setSearchType('album'); }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* Error state */}
              {searchError && (
                <div className="card" style={{ marginBottom: 20, borderColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--danger)' }}>
                    <AlertCircle size={18} />
                    <span>{searchError}</span>
                  </div>
                </div>
              )}

              {/* Results for ALBUMS */}
              {searchType === 'album' && searchResults.length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Found {searchResults.length} Albums</h2>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Click an album to view its tracklist & download</span>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 18,
                  }}>
                    {searchResults.map((album) => (
                      <div
                        key={album.id}
                        className="card"
                        style={{
                          padding: 12,
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                        }}
                        onClick={() => handleSelectAlbum(album)}
                      >
                        <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', borderRadius: 8, overflow: 'hidden', backgroundColor: 'var(--surface-hover)', marginBottom: 10 }}>
                          {album.artwork ? (
                            <img
                              src={album.artwork}
                              alt={album.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              loading="lazy"
                            />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                              <Disc3 size={48} />
                            </div>
                          )}
                          {album.releaseYear && (
                            <span className="badge" style={{ position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '0.75rem', backdropFilter: 'blur(4px)' }}>
                              {album.releaseYear}
                            </span>
                          )}
                        </div>

                        <div style={{ flex: 1 }}>
                          <h3 style={{ margin: '0 0 4px 0', fontSize: '0.96rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={album.name}>
                            {album.name}
                          </h3>
                          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {album.artist}
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                          <span>{album.trackCount} Tracks</span>
                          <span style={{ color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            View <Disc3 size={13} />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Results for TRACKS */}
              {searchType === 'track' && searchResults.length > 0 && (
                <div className="card">
                  <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: 14 }}>Found {searchResults.length} Songs</h2>
                  <div className="table-wrapper">
                    <table className="table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ width: 44 }}>Play</th>
                          <th style={{ width: 48 }}>Cover</th>
                          <th>Song Title</th>
                          <th>Artist</th>
                          <th>Album</th>
                          <th style={{ width: 70 }}>Time</th>
                          <th style={{ width: 100, textAlign: 'right' }}>Download</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchResults.map((t, idx) => (
                          <tr key={idx}>
                            <td>
                              {t.previewUrl ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ padding: 6, borderRadius: '50%' }}
                                  onClick={() => togglePreview(t.previewUrl)}
                                  title="Listen to 30s preview"
                                >
                                  {playingPreviewUrl === t.previewUrl ? <Pause size={14} color="var(--accent)" /> : <Play size={14} />}
                                </button>
                              ) : (
                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>—</span>
                              )}
                            </td>
                            <td>
                              {t.artwork ? (
                                <img src={t.artwork} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }} />
                              ) : (
                                <Music size={20} color="var(--text-tertiary)" />
                              )}
                            </td>
                            <td style={{ fontWeight: 500 }}>{t.title}</td>
                            <td style={{ color: 'var(--text-secondary)' }}>{t.artist}</td>
                            <td style={{ color: 'var(--text-secondary)' }}>{t.album || 'Single'}</td>
                            <td style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>{formatDuration(t.duration)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={() => handleDownloadSingleTrack(t)}
                                title={`Download in ${downloadFormat.toUpperCase()}`}
                              >
                                <Download size={13} />
                                Get
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ========================================================================= */
            /* ALBUM DETAIL VIEW                                                         */
            /* ========================================================================= */
            <div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginBottom: 16 }}
                onClick={() => setSelectedAlbum(null)}
              >
                <ArrowLeft size={16} /> Back to Search
              </button>

              {/* Album Hero Card */}
              <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{
                    width: 170,
                    height: 170,
                    borderRadius: 14,
                    overflow: 'hidden',
                    backgroundColor: 'var(--surface-hover)',
                    boxShadow: 'var(--shadow-md)',
                    flexShrink: 0,
                  }}>
                    {selectedAlbum.album.artwork ? (
                      <img
                        src={selectedAlbum.album.artwork}
                        alt={selectedAlbum.album.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                        <Disc3 size={64} />
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div className="badge" style={{ marginBottom: 8, background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 }}>
                      {selectedAlbum.album.genre || 'Album'}
                    </div>
                    <h1 style={{ margin: '0 0 6px 0', fontSize: '1.6rem', fontWeight: 800 }}>
                      {selectedAlbum.album.name}
                    </h1>
                    <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 10 }}>
                      {selectedAlbum.album.artist}
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: '0.88rem', color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                      <span>Released: {selectedAlbum.album.releaseYear || 'Unknown'}</span>
                      <span>•</span>
                      <span>{selectedAlbum.tracks?.length || 0} Songs</span>
                      {selectedAlbum.album.copyright && (
                        <>
                          <span>•</span>
                          <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>{selectedAlbum.album.copyright}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Download Configuration Panel */}
              <div className="card" style={{ marginBottom: 20, background: 'var(--surface-hover)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.95rem' }}>
                    <Sliders size={17} color="var(--accent)" />
                    Download Configuration
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
                    Files will be organized into: <code>{downloadFolder}/{selectedAlbum.album.artist}/{selectedAlbum.album.name}/## - Track.{downloadFormat}</code>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>
                      Audio Codec / Format
                    </label>
                    <select
                      className="select"
                      style={{ width: '100%' }}
                      value={downloadFormat}
                      onChange={(e) => setDownloadFormat(e.target.value)}
                    >
                      {FORMAT_OPTIONS.map((fmt) => (
                        <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>
                      Quality / Bitrate
                    </label>
                    <select
                      className="select"
                      style={{ width: '100%' }}
                      value={downloadQuality}
                      onChange={(e) => setDownloadQuality(e.target.value)}
                    >
                      {availableQualities.map((q) => (
                        <option key={q.value} value={q.value}>{q.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>
                      Destination Music Directory
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ width: '100%' }}
                      value={downloadFolder}
                      onChange={(e) => setDownloadFolder(e.target.value)}
                      placeholder="Music"
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={downloadSaveCover}
                        onChange={(e) => setDownloadSaveCover(e.target.checked)}
                      />
                      Save cover.jpg in album folder (Jellyfin/Plex)
                    </label>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 12, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={downloadingAlbum || (selectedAlbum.tracks || []).length === 0}
                    onClick={() => handleDownloadAlbum(false)}
                  >
                    {downloadingAlbum ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}
                    Download Entire Album ({selectedAlbum.tracks?.length || 0} tracks)
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={downloadingAlbum || selectedTracks.size === 0}
                    onClick={() => handleDownloadAlbum(true)}
                  >
                    <CheckCircle2 size={16} />
                    Download Selected ({selectedTracks.size})
                  </button>

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllTracks}>
                      Select All
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={deselectAllTracks}>
                      Clear Selection
                    </button>
                  </div>
                </div>

                {/* Status toast message */}
                {albumDownloadMessage && (
                  <div style={{
                    marginTop: 14,
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: albumDownloadMessage.type === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
                    color: albumDownloadMessage.type === 'success' ? 'var(--success)' : 'var(--danger)',
                    fontSize: '0.9rem',
                    fontWeight: 500,
                  }}>
                    {albumDownloadMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                    <span>{albumDownloadMessage.text}</span>
                  </div>
                )}
              </div>

              {/* Tracklist Table */}
              <div className="card">
                <h3 style={{ margin: '0 0 14px 0', fontSize: '1.05rem', fontWeight: 700 }}>
                  Tracklist ({selectedAlbum.tracks?.length || 0} Songs)
                </h3>

                <div className="table-wrapper">
                  <table className="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 38 }}>
                          <input
                            type="checkbox"
                            checked={selectedTracks.size === (selectedAlbum.tracks?.length || 0) && selectedTracks.size > 0}
                            onChange={(e) => (e.target.checked ? selectAllTracks() : deselectAllTracks())}
                          />
                        </th>
                        <th style={{ width: 44 }}>#</th>
                        <th style={{ width: 44 }}>Preview</th>
                        <th>Title</th>
                        <th>Artist</th>
                        <th style={{ width: 70 }}>Time</th>
                        <th style={{ width: 90, textAlign: 'right' }}>Download</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedAlbum.tracks?.map((t) => {
                        const isSelected = selectedTracks.has(t.trackNumber);
                        const isPlaying = playingPreviewUrl === t.previewUrl;
                        return (
                          <tr key={t.trackNumber} style={{ backgroundColor: isSelected ? 'rgba(91, 109, 248, 0.04)' : undefined }}>
                            <td>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleTrackSelection(t.trackNumber)}
                              />
                            </td>
                            <td style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}>{t.trackNumber}</td>
                            <td>
                              {t.previewUrl ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ padding: 6, borderRadius: '50%' }}
                                  onClick={() => togglePreview(t.previewUrl)}
                                  title="30s preview"
                                >
                                  {isPlaying ? <Pause size={14} color="var(--accent)" /> : <Play size={14} />}
                                </button>
                              ) : (
                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>—</span>
                              )}
                            </td>
                            <td style={{ fontWeight: 600 }}>
                              {t.title}
                              {t.discNumber > 1 && (
                                <span className="badge" style={{ marginLeft: 8, fontSize: '0.7rem' }}>Disc {t.discNumber}</span>
                              )}
                            </td>
                            <td style={{ color: 'var(--text-secondary)' }}>{t.artist}</td>
                            <td style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>{formatDuration(t.duration)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleDownloadSingleTrack(t)}
                                title={`Download this track (${downloadFormat.toUpperCase()})`}
                              >
                                <Download size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: DIRECT URL / YOUTUBE MUSIC                                         */}
      {/* ========================================================================= */}
      {activeTab === 'direct' && (
        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: '1.2rem', marginTop: 0, marginBottom: 8 }}>Paste YouTube / YouTube Music Link</h2>
            <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Paste any YouTube Music album, playlist, or single track link (e.g. <code>https://music.youtube.com/playlist?list=...</code>). The audio will be automatically converted to your selected codec with embedded metadata.
            </p>

            <form onSubmit={handleInspectDirectUrl}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="input"
                  style={{ flex: 1, minWidth: 280 }}
                  placeholder="https://music.youtube.com/playlist?list=... or https://www.youtube.com/watch?v=..."
                  value={directUrl}
                  onChange={(e) => setDirectUrl(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={inspectingUrl || !directUrl.trim()}>
                  {inspectingUrl ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
                  Inspect URL
                </button>
              </div>
            </form>

            {directError && (
              <div style={{ marginTop: 14, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
                <AlertCircle size={16} />
                <span>{directError}</span>
              </div>
            )}
          </div>

          {directInfo && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
                {directInfo.thumbnail && (
                  <img
                    src={directInfo.thumbnail}
                    alt=""
                    style={{ width: 120, height: 120, borderRadius: 10, objectFit: 'cover', boxShadow: 'var(--shadow-sm)' }}
                  />
                )}
                <div>
                  <div className="badge" style={{ marginBottom: 6 }}>
                    {directInfo.isPlaylist ? `Playlist (${directInfo.trackCount} tracks)` : 'Single Video / Track'}
                  </div>
                  <h2 style={{ margin: '0 0 6px 0', fontSize: '1.3rem' }}>{directInfo.title}</h2>
                  <div style={{ color: 'var(--text-secondary)' }}>Uploader / Channel: {directInfo.uploader}</div>
                </div>
              </div>

              {/* Configuration */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>Format</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    value={downloadFormat}
                    onChange={(e) => setDownloadFormat(e.target.value)}
                  >
                    {FORMAT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>Quality</label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    value={downloadQuality}
                    onChange={(e) => setDownloadQuality(e.target.value)}
                  >
                    {availableQualities.map((q) => (
                      <option key={q.value} value={q.value}>{q.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>Music Folder</label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: '100%' }}
                    value={downloadFolder}
                    onChange={(e) => setDownloadFolder(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                disabled={directDownloading}
                onClick={handleDownloadDirect}
              >
                {directDownloading ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}
                Download into "{downloadFolder}" ({downloadFormat.toUpperCase()} • {downloadQuality})
              </button>

              {directDownloadMessage && (
                <div style={{
                  marginTop: 14,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: directDownloadMessage.type === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
                  color: directDownloadMessage.type === 'success' ? 'var(--success)' : 'var(--danger)',
                  fontSize: '0.9rem',
                }}>
                  {directDownloadMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  <span>{directDownloadMessage.text}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: MUSIC WATCHES (MONITOR ARTISTS & PLAYLISTS)                        */}
      {/* ========================================================================= */}
      {activeTab === 'watches' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Active Music Watches</h2>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginTop: 2 }}>
                Periodically monitors artist channels and playlists, automatically converting new releases into your music library.
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddWatchModal(true)}
            >
              <Plus size={15} /> Add Music Watch
            </button>
          </div>

          {watchesLoading ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
              <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px auto' }} />
              <div>Loading music watches...</div>
            </div>
          ) : musicWatches.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 50 }}>
              <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px auto', color: 'var(--accent)' }}>
                <Radar size={28} />
              </div>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '1.1rem' }}>No Music Watches Yet</h3>
              <p style={{ color: 'var(--text-secondary)', maxWidth: 460, margin: '0 auto 18px auto', fontSize: '0.9rem' }}>
                Set up a watch on an artist's YouTube channel or topic playlist to automatically download and tag new songs as soon as they drop!
              </p>
              <button type="button" className="btn btn-primary" onClick={() => setShowAddWatchModal(true)}>
                <Plus size={16} /> Create Your First Music Watch
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
              {musicWatches.map((w) => (
                <div key={w.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    {w.thumbnail ? (
                      <img src={w.thumbnail} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Music size={22} color="var(--accent)" />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {w.name}
                      </h3>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {w.channel_name || w.url}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.78rem' }}>
                    <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      {(w.container || 'MP3').toUpperCase()} • {w.audio_quality || '320k'}
                    </span>
                    <span className="badge">
                      Folder: {w.music_folder || 'Music'}
                    </span>
                    <span className="badge">
                      Every {w.check_interval_mins}m
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
                    <div>
                      {w.last_status === 'checking' ? (
                        <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <RefreshCw size={12} className="spin" /> Checking...
                        </span>
                      ) : (
                        <span>Last check: {w.last_checked_at ? new Date(w.last_checked_at).toLocaleTimeString() : 'Pending'}</span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleCheckWatch(w.id)}
                        title="Check now for new releases"
                      >
                        <RefreshCw size={13} /> Check
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => handleDeleteWatch(w.id)}
                        title="Delete watch"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Modal: Add Music Watch */}
          {showAddWatchModal && (
            <div className="modal-backdrop" onClick={() => setShowAddWatchModal(false)}>
              <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
                <h2 style={{ margin: '0 0 14px 0', fontSize: '1.25rem' }}>Add Music Watch</h2>
                <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  Point at an artist YouTube channel, YouTube Music topic page, or album playlist to monitor for new tracks.
                </p>

                <form onSubmit={handleCreateMusicWatch}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>Channel or Playlist URL *</label>
                      <input
                        type="text"
                        className="input"
                        style={{ width: '100%' }}
                        placeholder="https://www.youtube.com/@DaftPunk or playlist URL"
                        value={newWatchUrl}
                        onChange={(e) => setNewWatchUrl(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>Custom Name (Optional)</label>
                      <input
                        type="text"
                        className="input"
                        style={{ width: '100%' }}
                        placeholder="e.g. Daft Punk Releases"
                        value={newWatchName}
                        onChange={(e) => setNewWatchName(e.target.value)}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>Audio Format</label>
                        <select
                          className="select"
                          style={{ width: '100%' }}
                          value={newWatchFormat}
                          onChange={(e) => setNewWatchFormat(e.target.value)}
                        >
                          {FORMAT_OPTIONS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>Audio Quality</label>
                        <select
                          className="select"
                          style={{ width: '100%' }}
                          value={newWatchQuality}
                          onChange={(e) => setNewWatchQuality(e.target.value)}
                        >
                          {(QUALITY_OPTIONS_BY_FORMAT[newWatchFormat] || QUALITY_OPTIONS_BY_FORMAT.mp3).map((q) => (
                            <option key={q.value} value={q.value}>{q.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>Destination Folder</label>
                        <input
                          type="text"
                          className="input"
                          style={{ width: '100%' }}
                          value={newWatchFolder}
                          onChange={(e) => setNewWatchFolder(e.target.value)}
                          placeholder="Music"
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>Check Frequency</label>
                        <select
                          className="select"
                          style={{ width: '100%' }}
                          value={newWatchInterval}
                          onChange={(e) => setNewWatchInterval(e.target.value)}
                        >
                          <option value="30">Every 30 minutes</option>
                          <option value="60">Every 1 hour</option>
                          <option value="180">Every 3 hours</option>
                          <option value="360">Every 6 hours</option>
                          <option value="1440">Once a day</option>
                        </select>
                      </div>
                    </div>

                    {newWatchError && (
                      <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{newWatchError}</div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                      <button type="button" className="btn btn-secondary" onClick={() => setShowAddWatchModal(false)}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={addingWatch || !newWatchUrl.trim()}>
                        {addingWatch ? <RefreshCw size={15} className="spin" /> : <Plus size={15} />}
                        Save Music Watch
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: SETTINGS                                                           */}
      {/* ========================================================================= */}
      {activeTab === 'settings' && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: '1.2rem', marginTop: 0, marginBottom: 12 }}>Music Hub Defaults</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 20 }}>
            Configure default audio encoding options and storage folder for music downloads and watches.
          </p>

          <form onSubmit={handleSaveSettings}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
                  Default Music Directory Path
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%' }}
                  value={settings.musicFolder}
                  onChange={(e) => setSettings({ ...settings, musicFolder: e.target.value })}
                  placeholder="Music"
                />
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Relative to downloads folder or absolute path. Songs are saved as: <code>{settings.musicFolder}/{'{Artist}'}/{'{Album}'}/## - {'{Title}'}.{settings.musicFormat}</code>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
                    Default Audio Format
                  </label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    value={settings.musicFormat}
                    onChange={(e) => setSettings({ ...settings, musicFormat: e.target.value })}
                  >
                    {FORMAT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
                    Default Bitrate / Quality
                  </label>
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    value={settings.musicQuality}
                    onChange={(e) => setSettings({ ...settings, musicQuality: e.target.value })}
                  >
                    {(QUALITY_OPTIONS_BY_FORMAT[settings.musicFormat] || QUALITY_OPTIONS_BY_FORMAT.mp3).map((q) => (
                      <option key={q.value} value={q.value}>{q.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.saveCover}
                    onChange={(e) => setSettings({ ...settings, saveCover: e.target.checked })}
                  />
                  Save high-resolution cover.jpg alongside album songs (for Jellyfin, Plex, Navidrome)
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <button type="submit" className="btn btn-primary">
                  Save Music Settings
                </button>
                {settingsSavedToast && (
                  <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}>
                    <CheckCircle2 size={16} /> Saved!
                  </span>
                )}
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
