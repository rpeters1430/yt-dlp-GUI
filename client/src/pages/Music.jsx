import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
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
  User,
  Users,
  Filter,
  Library,
  X,
  Link as LinkIcon,
} from 'lucide-react';
import { api } from '../api.js';
import { useDownloads } from '../context/DownloadsContext.jsx';

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.floor(sec);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const FORMAT_OPTIONS = [
  { value: 'opus', label: 'OPUS (Highest Quality - YouTube Native ~160k VBR)' },
  { value: 'mp3', label: 'MP3 (Universal 320 kbps CBR, Tagged)' },
  { value: 'm4a', label: 'M4A / AAC (Apple Compatible)' },
  { value: 'flac', label: 'FLAC (Transcoded - large file, not native lossless)' },
  { value: 'wav', label: 'WAV (Transcoded - uncompressed PCM)' },
];

const QUALITY_OPTIONS_BY_FORMAT = {
  // YouTube's Opus stream is always kept as-is (no re-encode), so there's no bitrate to pick.
  opus: [
    { value: '0', label: 'Native / Best Quality (Direct stream copy, ~160 kbps VBR)' },
  ],
  mp3: [
    { value: '320k', label: '320 kbps (Highest Quality CBR)' },
    { value: '256k', label: '256 kbps (High Quality)' },
    { value: '192k', label: '192 kbps (Standard Quality)' },
    { value: '128k', label: '128 kbps (Compact)' },
    { value: '0', label: 'VBR 0 (Best Variable)' },
  ],
  m4a: [
    { value: '0', label: 'Native AAC (Direct stream copy, ~128 kbps)' },
    { value: '256k', label: '256 kbps (Re-encoded from Opus)' },
    { value: '320k', label: '320 kbps (Re-encoded from Opus)' },
    { value: '192k', label: '192 kbps (Re-encoded from Opus)' },
  ],
  flac: [
    { value: '0', label: 'Transcode only (YouTube has no native lossless)' },
  ],
  wav: [
    { value: '0', label: 'Transcode only (Uncompressed PCM from lossy source)' },
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
  const [searchType, setSearchType] = useState('album'); // 'album' | 'artist' | 'track'
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [matchedArtist, setMatchedArtist] = useState(null);
  const [albumViewFilter, setAlbumViewFilter] = useState('artist-albums'); // 'artist-albums' | 'artist-singles' | 'artist-all' | 'all' | 'albums-only' | 'singles-only'

  // Dedicated Artist Discography state
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistTab, setArtistTab] = useState('albums'); // 'albums' | 'singles' | 'all'
  const [artistSort, setArtistSort] = useState('newest'); // 'newest' | 'oldest' | 'name' | 'tracks'
  const [artistSearchTerm, setArtistSearchTerm] = useState('');

  // Selected album details
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [downloadingAlbum, setDownloadingAlbum] = useState(false);
  const [downloadingAlbumId, setDownloadingAlbumId] = useState(null);
  const [quickDownloadToast, setQuickDownloadToast] = useState(null);
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

  // Live downloads from context
  const { jobs } = useDownloads() || { jobs: [] };
  const activeMusicJobs = (jobs || []).filter(
    (j) => (j.status === 'queued' || j.status === 'downloading') && (j.optionsJson?.isMusicDownload || j.optionsJson?.audioOnly || j.audio_only)
  );

  // Match inspection modal state
  const [inspectingTrack, setInspectingTrack] = useState(null);
  const [matchCandidates, setMatchCandidates] = useState([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [customMatchUrl, setCustomMatchUrl] = useState('');
  const [trackMatches, setTrackMatches] = useState({}); // trackNumber -> { youtubeUrl, title, uploader, duration, isTopic }

  // Direct URL selected tracks state
  const [directSelectedTracks, setDirectSelectedTracks] = useState(new Set());

  // Jellyfin library sync & matching state
  const [jellyfinStatus, setJellyfinStatus] = useState(null);
  const [jellyfinAlbumData, setJellyfinAlbumData] = useState(null);
  const [jellyfinCheckingAlbum, setJellyfinCheckingAlbum] = useState(false);
  const [jellyfinScanning, setJellyfinScanning] = useState(false);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState(null);
  function showToast(text, type = 'success') {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4500);
  }

  function getTrackJobStatus(trackTitle) {
    if (!trackTitle || !jobs) return null;
    const titLower = trackTitle.toLowerCase().trim();
    return jobs.find((j) => {
      const metaTitle = j.optionsJson?.musicMetadata?.title;
      if (metaTitle && metaTitle.toLowerCase().trim() === titLower) return true;
      if (j.title && j.title.toLowerCase().includes(titLower)) return true;
      return false;
    });
  }

  async function handleOpenMatchModal(track) {
    setInspectingTrack(track);
    setCustomMatchUrl(trackMatches[track.trackNumber]?.youtubeUrl || track.youtubeUrl || '');
    setLoadingCandidates(true);
    setMatchCandidates([]);
    try {
      const res = await api.getMusicMatchCandidates({
        title: track.title,
        artist: track.artist || selectedAlbum?.album?.artist,
        duration: track.duration,
      }, 5);
      setMatchCandidates(res.candidates || []);
    } catch (err) {
      console.error('Failed to load match candidates:', err);
    } finally {
      setLoadingCandidates(false);
    }
  }

  function handleSelectMatch(candidate) {
    if (!inspectingTrack) return;
    setTrackMatches((prev) => ({
      ...prev,
      [inspectingTrack.trackNumber]: {
        youtubeUrl: candidate.youtubeUrl || candidate.url,
        title: candidate.title,
        uploader: candidate.uploader,
        duration: candidate.duration,
        isTopic: candidate.isTopic,
      },
    }));
    showToast(`Assigned match for "${inspectingTrack.title}"!`);
    setInspectingTrack(null);
  }

  function handleApplyCustomUrl(e) {
    e.preventDefault();
    if (!inspectingTrack || !customMatchUrl.trim()) return;
    setTrackMatches((prev) => ({
      ...prev,
      [inspectingTrack.trackNumber]: {
        youtubeUrl: customMatchUrl.trim(),
        title: customMatchUrl.trim(),
        uploader: 'Custom URL',
      },
    }));
    showToast(`Custom URL assigned to "${inspectingTrack.title}"!`);
    setInspectingTrack(null);
  }

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

    api.getJellyfinStatus()
      .then((st) => setJellyfinStatus(st))
      .catch(() => {});
  }, []);

  async function handleTriggerJellyfinScan() {
    setJellyfinScanning(true);
    try {
      await api.refreshJellyfinLibrary();
      showToast('Jellyfin library refresh scan triggered!');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setJellyfinScanning(false);
    }
  }

  async function handleToggleJellyfinAutoScan(enabled) {
    try {
      const updated = await api.updateJellyfinSyncSettings({ autoScanEnabled: enabled });
      setJellyfinStatus((prev) => ({ ...prev, autoScanEnabled: updated.autoScanEnabled }));
      showToast(enabled ? 'Enabled auto Jellyfin library scan' : 'Disabled auto Jellyfin library scan');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

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
  async function handleSearch(e, forcedQuery, forcedType) {
    if (e) e.preventDefault();
    const q = (forcedQuery !== undefined ? forcedQuery : searchQuery).trim();
    const sType = forcedType || searchType;
    if (!q) return;

    setSearching(true);
    setSearchError('');
    setSelectedAlbum(null);
    setSelectedArtist(null);
    setMatchedArtist(null);

    try {
      const data = await api.searchMusic(q, sType);
      setSearchResults(data.results || []);
      setMatchedArtist(data.matchedArtist || null);

      if (sType === 'album') {
        if (data.matchedArtist && (data.matchedArtist.albums?.length > 0 || data.matchedArtist.singles?.length > 0)) {
          setAlbumViewFilter(data.matchedArtist.albums?.length > 0 ? 'artist-albums' : 'artist-singles');
        } else {
          setAlbumViewFilter('all');
        }
      }

      const totalFound = (data.results || []).length + (data.matchedArtist ? 1 : 0);
      if (totalFound === 0) {
        setSearchError(`No ${sType === 'album' ? 'albums' : sType === 'artist' ? 'artists' : 'tracks'} found for "${q}". Try another search term.`);
      }
    } catch (err) {
      setSearchError(err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  // View full artist discography
  async function handleViewArtist(artistId, artistName) {
    setArtistLoading(true);
    setSelectedAlbum(null);
    try {
      let data;
      if (artistId) {
        data = await api.getMusicArtist(artistId);
      } else if (artistName) {
        const searchRes = await api.searchMusic(artistName, 'artist');
        if (searchRes.results && searchRes.results.length > 0) {
          data = await api.getMusicArtist(searchRes.results[0].id);
        } else {
          throw new Error(`Could not find artist "${artistName}"`);
        }
      }
      if (data) {
        setSelectedArtist(data);
        setArtistTab('albums');
        setArtistSearchTerm('');
        setArtistSort('newest');
      }
    } catch (err) {
      alert(`Could not load artist discography: ${err.message}`);
    } finally {
      setArtistLoading(false);
    }
  }

  // Sorted releases for dedicated artist discography view
  function getSortedArtistReleases() {
    if (!selectedArtist) return [];
    let list = [];
    if (artistTab === 'albums') list = selectedArtist.albums || [];
    else if (artistTab === 'singles') list = selectedArtist.singles || [];
    else list = selectedArtist.all || [];

    if (artistSearchTerm.trim()) {
      const q = artistSearchTerm.toLowerCase();
      list = list.filter((r) => (r.name || '').toLowerCase().includes(q));
    }

    const copy = [...list];
    if (artistSort === 'newest') {
      copy.sort((a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0));
    } else if (artistSort === 'oldest') {
      copy.sort((a, b) => new Date(a.releaseDate || 0) - new Date(b.releaseDate || 0));
    } else if (artistSort === 'name') {
      copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (artistSort === 'tracks') {
      copy.sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0));
    }
    return copy;
  }

  // Quick download album without leaving search results
  async function handleQuickDownloadAlbum(e, albumItem) {
    if (e) e.stopPropagation();
    setDownloadingAlbumId(albumItem.id);
    try {
      const details = await api.getMusicAlbum(albumItem.id);
      if (!details || !details.tracks || details.tracks.length === 0) {
        throw new Error('No tracks found for this album');
      }
      const payload = {
        tracks: details.tracks.map((t) => ({
          ...t,
          album: details.album.name,
          artist: t.artist || details.album.artist,
          albumArtist: details.album.artist,
          year: details.album.releaseYear,
          genre: details.album.genre,
          artwork: details.album.artwork,
          totalTracks: details.tracks.length,
        })),
        audioFormat: downloadFormat,
        audioQuality: downloadQuality,
        musicFolder: downloadFolder,
        saveCover: downloadSaveCover,
      };
      const res = await api.downloadMusic(payload);
      setQuickDownloadToast({
        id: albumItem.id,
        text: `Queued "${details.album.name}" (${res.enqueued} tracks) for download!`,
      });
      setTimeout(() => setQuickDownloadToast(null), 5000);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloadingAlbumId(null);
    }
  }

  // Shared release card renderer
  function renderReleaseCard(item) {
    const isDownloadingThis = downloadingAlbumId === item.id;
    return (
      <div
        key={item.id}
        className="card music-release-card"
        style={{
          padding: 12,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={() => handleSelectAlbum(item)}
      >
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', borderRadius: 8, overflow: 'hidden', backgroundColor: 'var(--surface-hover)', marginBottom: 10 }}>
          {item.artwork ? (
            <img
              src={item.artwork}
              alt={item.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              loading="lazy"
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
              <Disc3 size={48} />
            </div>
          )}
          {item.releaseYear && (
            <span className="badge" style={{ position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '0.75rem', backdropFilter: 'blur(4px)' }}>
              {item.releaseYear}
            </span>
          )}
          {item.isSingle ? (
            <span className="badge badge-single" style={{ position: 'absolute', top: 8, left: 8, fontSize: '0.72rem', backdropFilter: 'blur(4px)' }}>
              Single / EP
            </span>
          ) : (
            <span className="badge badge-album" style={{ position: 'absolute', top: 8, left: 8, fontSize: '0.72rem', backdropFilter: 'blur(4px)' }}>
              Album
            </span>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '0.96rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
            {item.name}
          </h3>
          <div
            style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onClick={(e) => {
              e.stopPropagation();
              handleViewArtist(item.artistId, item.artist);
            }}
            title={`View all releases by ${item.artist}`}
          >
            <span style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>{item.artist}</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
          <span>{item.trackCount} {item.trackCount === 1 ? 'Track' : 'Tracks'}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '3px 8px', fontSize: '0.78rem' }}
              onClick={(e) => {
                e.stopPropagation();
                handleSelectAlbum(item);
              }}
              title="View tracklist & customize download"
            >
              Tracks
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ padding: '3px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              disabled={isDownloadingThis}
              onClick={(e) => handleQuickDownloadAlbum(e, item)}
              title={`Download all ${item.trackCount} tracks directly in ${downloadFormat.toUpperCase()}`}
            >
              {isDownloadingThis ? (
                <RefreshCw size={12} className="spin" />
              ) : (
                <Download size={12} />
              )}
              Get
            </button>
          </div>
        </div>
      </div>
    );
  }

  // View album details
  async function handleSelectAlbum(album) {
    setAlbumLoading(true);
    setAlbumDownloadMessage(null);
    setJellyfinAlbumData(null);
    try {
      const data = await api.getMusicAlbum(album.id);
      setSelectedAlbum(data);
      // Default: select all tracks
      const allTrackNums = new Set((data.tracks || []).map((t) => t.trackNumber));
      setSelectedTracks(allTrackNums);

      // Check if already in Jellyfin library
      if (data?.album) {
        setJellyfinCheckingAlbum(true);
        api.checkJellyfinAlbum(data.album.artist, data.album.name)
          .then((jf) => setJellyfinAlbumData(jf))
          .catch(() => setJellyfinAlbumData(null))
          .finally(() => setJellyfinCheckingAlbum(false));
      }
    } catch (err) {
      showToast(`Could not load album details: ${err.message}`, 'error');
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
  async function handleDownloadAlbum(onlySelected = false, returnToSearch = false) {
    if (!selectedAlbum || !selectedAlbum.tracks) return;
    const tracksToDownload = selectedAlbum.tracks.filter((t) =>
      onlySelected ? selectedTracks.has(t.trackNumber) : true
    );

    if (tracksToDownload.length === 0) {
      showToast('Please select at least one track to download.', 'error');
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
          totalDiscs: selectedAlbum.album.totalDiscs || selectedAlbum.tracks[0]?.totalDiscs || 1,
          youtubeUrl: trackMatches[t.trackNumber]?.youtubeUrl || t.youtubeUrl || null,
        })),
        audioFormat: downloadFormat,
        audioQuality: downloadQuality,
        musicFolder: downloadFolder,
        saveCover: downloadSaveCover,
      };

      const res = await api.downloadMusic(payload);
      const msg = `Successfully queued ${res.enqueued} song${res.enqueued === 1 ? '' : 's'} into "${downloadFolder}/${selectedAlbum.album.artist}/${selectedAlbum.album.name}"!`;

      showToast(msg);
      if (returnToSearch) {
        setQuickDownloadToast({ text: msg });
        setTimeout(() => setQuickDownloadToast(null), 5000);
        setSelectedAlbum(null);
      } else {
        setAlbumDownloadMessage({
          type: 'success',
          text: msg,
        });
      }
    } catch (err) {
      const errText = `Download failed: ${err.message}`;
      showToast(errText, 'error');
      setAlbumDownloadMessage({
        type: 'error',
        text: errText,
      });
    } finally {
      setDownloadingAlbum(false);
    }
  }

  // Download a single track
  async function handleDownloadSingleTrack(track) {
    try {
      const customMatch = trackMatches[track.trackNumber];
      const payload = {
        track: {
          ...track,
          albumArtist: selectedAlbum?.album?.artist || track.artist,
          totalTracks: selectedAlbum?.tracks?.length || 1,
          totalDiscs: selectedAlbum?.album?.totalDiscs || track.totalDiscs || 1,
          youtubeUrl: customMatch?.youtubeUrl || track.youtubeUrl || null,
        },
        audioFormat: downloadFormat,
        audioQuality: downloadQuality,
        musicFolder: downloadFolder,
        saveCover: downloadSaveCover,
      };
      await api.downloadMusic(payload);
      showToast(`Queued "${track.title}" for download in ${downloadFormat.toUpperCase()}!`);
    } catch (err) {
      showToast(`Failed to queue track: ${err.message}`, 'error');
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
      if (info && info.entries && info.entries.length > 0) {
        setDirectSelectedTracks(new Set(info.entries.map((_, i) => i)));
      } else {
        setDirectSelectedTracks(new Set());
      }
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
        const chosenEntries = directInfo.entries.filter((_, idx) => directSelectedTracks.has(idx));
        if (chosenEntries.length === 0) {
          showToast('Please select at least one track to download.', 'error');
          setDirectDownloading(false);
          return;
        }

        const payload = {
          tracks: chosenEntries.map((e, idx) => ({
            title: e.title,
            artist: directInfo.uploader || 'YouTube Music',
            album: directInfo.title || 'Playlist',
            trackNumber: idx + 1,
            totalTracks: chosenEntries.length,
            youtubeUrl: e.url,
            artwork: e.thumbnail || directInfo.thumbnail,
          })),
          audioFormat: downloadFormat,
          audioQuality: downloadQuality,
          musicFolder: downloadFolder,
          saveCover: downloadSaveCover,
        };
        const res = await api.downloadMusic(payload);
        const msg = `Queued ${res.enqueued} track(s) from playlist into "${downloadFolder}"!`;
        showToast(msg);
        setDirectDownloadMessage({
          type: 'success',
          text: msg,
        });
      } else {
        const payload = {
          track: {
            title: directInfo.title,
            artist: directInfo.uploader || 'YouTube',
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
        const msg = `Queued "${directInfo.title}" for download into "${downloadFolder}"!`;
        showToast(msg);
        setDirectDownloadMessage({
          type: 'success',
          text: msg,
        });
      }
    } catch (err) {
      showToast(`Download error: ${err.message}`, 'error');
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
      <div className="card" style={{ marginBottom: 20, background: 'linear-gradient(135deg, var(--accent-music-soft) 0%, var(--accent-cyan-soft) 100%)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm), var(--card-highlight)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'linear-gradient(135deg, var(--accent-music) 0%, var(--accent-cyan) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
            }}>
              <Disc3 size={28} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Music Hub & Watcher</h1>
              <p style={{ margin: '3px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Discover albums, download YouTube tracks in pristine high-fidelity audio (native OPUS, 320k MP3, M4A) with embedded metadata & artwork, and monitor artists.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'search' ? 'btn-music-active' : 'btn-secondary'}`}
              onClick={() => { setActiveTab('search'); setSelectedAlbum(null); }}
            >
              <Search size={15} />
              Albums & Songs
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'direct' ? 'btn-music-active' : 'btn-secondary'}`}
              onClick={() => setActiveTab('direct')}
            >
              <FileAudio size={15} />
              Direct URL
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'watches' ? 'btn-music-active' : 'btn-secondary'}`}
              onClick={() => setActiveTab('watches')}
            >
              <Radar size={15} />
              Music Watches
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'settings' ? 'btn-music-active' : 'btn-secondary'}`}
              onClick={() => setActiveTab('settings')}
            >
              <Settings size={15} />
              Settings
            </button>

            <Link
              to={`/library?folder=${encodeURIComponent(settings.musicFolder || 'Music')}`}
              className="btn btn-sm btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Open downloaded music in Library"
            >
              <Library size={15} />
              Library
            </Link>
          </div>
        </div>
      </div>

      {/* Active Music Downloads Bar */}
      {activeMusicJobs.length > 0 && (
        <div style={{
          marginBottom: 20,
          padding: '12px 18px',
          borderRadius: 'var(--radius-md, 10px)',
          background: 'linear-gradient(90deg, rgba(91, 109, 248, 0.12), rgba(16, 185, 129, 0.12))',
          border: '1px solid rgba(91, 109, 248, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RefreshCw size={18} className="spin" color="var(--accent)" />
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                {activeMusicJobs.length} Music Download{activeMusicJobs.length === 1 ? '' : 's'} In Progress
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {activeMusicJobs[0]?.title || 'Processing audio track...'}
                {activeMusicJobs[0]?.progress ? ` • ${activeMusicJobs[0].progress}` : ''}
                {activeMusicJobs[0]?.speed ? ` • ${activeMusicJobs[0].speed}` : ''}
                {activeMusicJobs[0]?.eta ? ` • ETA ${activeMusicJobs[0].eta}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/dashboard" className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              View Queue
            </Link>
            <Link to={`/library?folder=${encodeURIComponent(settings.musicFolder || 'Music')}`} className="btn btn-sm btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Library size={14} /> Open Music Folder
            </Link>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: ALBUM & SONG SEARCH                                                */}
      {/* ========================================================================= */}
      {activeTab === 'search' && (
        <div>
          {!selectedAlbum ? (
            selectedArtist ? (
              /* ========================================================================= */
              /* DEDICATED ARTIST DISCOGRAPHY VIEW                                        */
              /* ========================================================================= */
              <div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ marginBottom: 16 }}
                  onClick={() => setSelectedArtist(null)}
                >
                  <ArrowLeft size={16} /> Back to Search
                </button>

                {quickDownloadToast && (
                  <div style={{
                    marginBottom: 16,
                    padding: '12px 18px',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'var(--success-soft)',
                    color: 'var(--success)',
                    fontWeight: 600,
                    fontSize: '0.92rem',
                    boxShadow: 'var(--shadow-sm)',
                  }}>
                    <CheckCircle2 size={20} />
                    <span>{quickDownloadToast.text}</span>
                  </div>
                )}

                {/* Artist Hero Banner */}
                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                    {selectedArtist.artist.artwork ? (
                      <img
                        src={selectedArtist.artist.artwork}
                        alt={selectedArtist.artist.name}
                        style={{ width: 110, height: 110, borderRadius: 16, objectFit: 'cover', boxShadow: 'var(--shadow-md)' }}
                      />
                    ) : (
                      <div style={{ width: 110, height: 110, borderRadius: 16, background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                        <User size={52} />
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 }}>
                          Artist Discography
                        </span>
                        {selectedArtist.artist.genre && (
                          <span className="badge">{selectedArtist.artist.genre}</span>
                        )}
                      </div>
                      <h1 style={{ margin: '0 0 6px 0', fontSize: '1.7rem', fontWeight: 800 }}>
                        {selectedArtist.artist.name}
                      </h1>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        {selectedArtist.counts.albums} Studio & Live Albums • {selectedArtist.counts.singles} Singles & EPs • {selectedArtist.counts.total} Total Releases
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setNewWatchName(`${selectedArtist.artist.name} Releases`);
                          setNewWatchUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(selectedArtist.artist.name + ' official audio')}`);
                          setShowAddWatchModal(true);
                        }}
                      >
                        <Radar size={15} /> Watch Artist
                      </button>
                    </div>
                  </div>
                </div>

                {/* Filter & Controls Card */}
                <div className="card" style={{ marginBottom: 20, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    {/* The Primary Triggers */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={`btn btn-sm ${artistTab === 'albums' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setArtistTab('albums')}
                      >
                        <Disc3 size={15} />
                        Albums ({selectedArtist.counts.albums})
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${artistTab === 'singles' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setArtistTab('singles')}
                      >
                        <Music size={15} />
                        Singles & EPs ({selectedArtist.counts.singles})
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${artistTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setArtistTab('all')}
                      >
                        <Layers size={15} />
                        All Releases ({selectedArtist.counts.total})
                      </button>
                    </div>

                    {/* Search & Sort */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        className="input"
                        style={{ width: 170, fontSize: '0.84rem', padding: '6px 10px' }}
                        placeholder="Filter by title..."
                        value={artistSearchTerm}
                        onChange={(e) => setArtistSearchTerm(e.target.value)}
                      />
                      <select
                        className="select"
                        style={{ fontSize: '0.84rem', padding: '6px 10px' }}
                        value={artistSort}
                        onChange={(e) => setArtistSort(e.target.value)}
                      >
                        <option value="newest">Release Date (Newest)</option>
                        <option value="oldest">Release Date (Oldest)</option>
                        <option value="name">Title (A - Z)</option>
                        <option value="tracks">Most Tracks</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Grid of Releases */}
                {getSortedArtistReleases().length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                    No {artistTab === 'albums' ? 'albums' : artistTab === 'singles' ? 'singles & EPs' : 'releases'} found.
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 18,
                  }}>
                    {getSortedArtistReleases().map(renderReleaseCard)}
                  </div>
                )}
              </div>
            ) : (
              <div>
                {quickDownloadToast && (
                  <div style={{
                    marginBottom: 16,
                    padding: '12px 18px',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'var(--success-soft)',
                    color: 'var(--success)',
                    fontWeight: 600,
                    fontSize: '0.92rem',
                    boxShadow: 'var(--shadow-sm)',
                  }}>
                    <CheckCircle2 size={20} />
                    <span>{quickDownloadToast.text}</span>
                  </div>
                )}

                {/* Search Bar */}
                <div className="card" style={{ marginBottom: 20 }}>
                  <form onSubmit={handleSearch}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: 6, background: 'var(--bg)', padding: 4, borderRadius: 'var(--radius-sm)' }}>
                        <button
                          type="button"
                          className={`btn btn-sm ${searchType === 'artist' ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setSearchType('artist')}
                        >
                          <User size={14} /> Artists
                        </button>
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
                          style={{ paddingLeft: 38, paddingRight: searchQuery ? 34 : 12, width: '100%' }}
                          placeholder={
                            searchType === 'artist'
                              ? 'Search artist name (e.g. "System of a Down", "Daft Punk", "Tool")'
                              : searchType === 'album'
                              ? 'Search album or artist name (e.g. "System of a Down", "Toxicity", "Discovery")'
                              : 'Search song name & artist (e.g. "Chop Suey!", "Get Lucky", "Bohemian Rhapsody")'
                          }
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                          <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            style={{
                              position: 'absolute',
                              right: 10,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-tertiary)',
                              cursor: 'pointer',
                              padding: 4,
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Clear search query"
                          >
                            <X size={15} />
                          </button>
                        )}
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
                    {['System of a Down', 'Daft Punk', 'Pink Floyd', 'Radiohead', 'The Beatles', 'Kendrick Lamar', 'Linkin Park', 'Metallica'].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        className="badge"
                        style={{ cursor: 'pointer', background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                        onClick={() => {
                          setSearchQuery(chip);
                          setSearchType('album');
                          handleSearch(null, chip, 'album');
                        }}
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

                {/* Artist Loading */}
                {artistLoading && (
                  <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', marginBottom: 20 }}>
                    <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px auto' }} />
                    <div>Loading artist discography...</div>
                  </div>
                )}

                {/* Results for ARTISTS */}
                {searchType === 'artist' && searchResults.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Found {searchResults.length} Artists</h2>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Click an artist to view their complete albums & singles discography</span>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                      gap: 16,
                    }}>
                      {searchResults.map((artist) => (
                        <div
                          key={artist.id}
                          className="card"
                          style={{
                            padding: 16,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 14,
                            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                          }}
                          onClick={() => handleViewArtist(artist.id)}
                        >
                          {artist.artwork ? (
                            <img
                              src={artist.artwork}
                              alt={artist.name}
                              style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                              loading="lazy"
                            />
                          ) : (
                            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}>
                              <User size={26} />
                            </div>
                          )}

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {artist.name}
                            </h3>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                              {artist.genre || 'Artist'}
                            </div>
                            <span style={{ color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              View Discography →
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Results for ALBUMS */}
                {searchType === 'album' && (matchedArtist || searchResults.length > 0) && (
                  <div>
                    {/* ARTIST SPOTLIGHT / DISCOGRAPHY BANNER (when artist is matched) */}
                    {matchedArtist && (
                      <div className="card" style={{
                        marginBottom: 20,
                        background: 'linear-gradient(135deg, rgba(91, 109, 248, 0.12) 0%, rgba(155, 107, 255, 0.08) 100%)',
                        border: '1px solid var(--accent)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            {matchedArtist.artwork ? (
                              <img
                                src={matchedArtist.artwork}
                                alt={matchedArtist.name}
                                style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', boxShadow: 'var(--shadow-sm)' }}
                              />
                            ) : (
                              <div style={{
                                width: 64,
                                height: 64,
                                borderRadius: 12,
                                background: 'var(--accent)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                              }}>
                                <User size={32} />
                              </div>
                            )}
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span className="badge" style={{ background: 'var(--accent)', color: '#fff', fontWeight: 600 }}>
                                  Artist Discography
                                </span>
                                {matchedArtist.genre && (
                                  <span className="badge" style={{ background: 'var(--surface-hover)' }}>
                                    {matchedArtist.genre}
                                  </span>
                                )}
                              </div>
                              <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700 }}>{matchedArtist.name}</h2>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 3 }}>
                                {matchedArtist.counts?.albums || 0} Studio Albums • {matchedArtist.counts?.singles || 0} Singles & EPs • {matchedArtist.counts?.total || 0} Total Official Releases
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => handleViewArtist(matchedArtist.id)}
                            >
                              <Layers size={14} /> Full Artist View
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => {
                                setNewWatchName(`${matchedArtist.name} Releases`);
                                setNewWatchUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(matchedArtist.name + ' official audio')}`);
                                setShowAddWatchModal(true);
                              }}
                              title="Monitor this artist for new releases"
                            >
                              <Radar size={14} /> Watch Artist
                            </button>
                          </div>
                        </div>

                        {/* THE BUTTONS / TRIGGERS TO SWITCH BETWEEN ALBUMS, SINGLES, AND ALL */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          paddingTop: 12,
                          borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                        }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: 4 }}>
                            Show for {matchedArtist.name}:
                          </span>
                          <button
                            type="button"
                            className={`btn btn-sm ${albumViewFilter === 'artist-albums' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setAlbumViewFilter('artist-albums')}
                          >
                            <Disc3 size={14} /> Albums ({matchedArtist.counts?.albums || 0})
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${albumViewFilter === 'artist-singles' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setAlbumViewFilter('artist-singles')}
                          >
                            <Music size={14} /> Singles & EPs ({matchedArtist.counts?.singles || 0})
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${albumViewFilter === 'artist-all' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setAlbumViewFilter('artist-all')}
                          >
                            <Layers size={14} /> All Official ({matchedArtist.counts?.total || 0})
                          </button>
                          {searchResults.length > 0 && (
                            <button
                              type="button"
                              className={`btn btn-sm ${albumViewFilter === 'all-search' ? 'btn-primary' : 'btn-ghost'}`}
                              style={{ marginLeft: 'auto' }}
                              onClick={() => setAlbumViewFilter('all-search')}
                            >
                              <Search size={14} /> Other Matches ({searchResults.length})
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Standard filter triggers when NO artist is matched or when viewing all search */}
                    {(!matchedArtist || albumViewFilter === 'all-search') && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                        <div>
                          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Found {searchResults.length} Search Matches</h2>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Click any release to view tracks & download</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className={`btn btn-sm ${albumViewFilter === 'all' || albumViewFilter === 'all-search' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setAlbumViewFilter('all')}
                          >
                            All ({searchResults.length})
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${albumViewFilter === 'albums-only' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setAlbumViewFilter('albums-only')}
                          >
                            <Disc3 size={13} /> Albums ({searchResults.filter((r) => !r.isSingle).length})
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${albumViewFilter === 'singles-only' ? 'btn-ghost' : 'btn-ghost'}`}
                            onClick={() => setAlbumViewFilter('singles-only')}
                          >
                            <Music size={13} /> Singles ({searchResults.filter((r) => r.isSingle).length})
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Current view release count */}
                    {matchedArtist && albumViewFilter !== 'all-search' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <h3 style={{ fontSize: '1.05rem', margin: 0 }}>
                          {albumViewFilter === 'artist-albums' && `Official Albums by ${matchedArtist.name} (${matchedArtist.counts?.albums || 0})`}
                          {albumViewFilter === 'artist-singles' && `Official Singles & EPs by ${matchedArtist.name} (${matchedArtist.counts?.singles || 0})`}
                          {albumViewFilter === 'artist-all' && `All Official Releases by ${matchedArtist.name} (${matchedArtist.counts?.total || 0})`}
                        </h3>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Click any album to view tracks & download</span>
                      </div>
                    )}

                    {/* Grid of Releases */}
                    {(() => {
                      let list = searchResults;
                      if (albumViewFilter === 'artist-albums') list = matchedArtist?.albums || [];
                      else if (albumViewFilter === 'artist-singles') list = matchedArtist?.singles || [];
                      else if (albumViewFilter === 'artist-all') list = matchedArtist?.all || [];
                      else if (albumViewFilter === 'albums-only') list = searchResults.filter((r) => !r.isSingle);
                      else if (albumViewFilter === 'singles-only') list = searchResults.filter((r) => r.isSingle);

                      if (list.length === 0) {
                        return (
                          <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                            No releases found in this category.
                          </div>
                        );
                      }

                      return (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                          gap: 18,
                        }}>
                          {list.map(renderReleaseCard)}
                        </div>
                      );
                    })()}
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
                              <td style={{ color: 'var(--text-secondary)' }}>
                                <span
                                  style={{ cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                                  onClick={() => handleViewArtist(null, t.artist)}
                                  title={`View all releases by ${t.artist}`}
                                >
                                  {t.artist}
                                </span>
                              </td>
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
            )
          ) : (
            /* ========================================================================= */
            /* ALBUM DETAIL VIEW                                                         */
            /* ========================================================================= */
            <div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedAlbum(null)}
                >
                  <ArrowLeft size={16} /> Back to Search Results
                </button>
                {selectedArtist && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSelectedAlbum(null)}
                  >
                    <User size={15} /> Back to {selectedArtist.artist.name} Discography
                  </button>
                )}
              </div>

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
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '0 4px', fontSize: '1.05rem', color: 'var(--accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        onClick={() => handleViewArtist(selectedAlbum.album.artistId, selectedAlbum.album.artist)}
                        title={`Browse all releases by ${selectedAlbum.album.artist}`}
                      >
                        <User size={16} /> {selectedAlbum.album.artist} (View All Releases)
                      </button>
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

                    {jellyfinStatus?.configured && (
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {jellyfinCheckingAlbum ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <RefreshCw size={13} className="spin" /> Checking Jellyfin library…
                          </span>
                        ) : jellyfinAlbumData?.inLibrary ? (
                          <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: '0.82rem' }}>
                            <CheckCircle2 size={14} /> In Jellyfin Library ({jellyfinAlbumData.trackCount} {jellyfinAlbumData.trackCount === 1 ? 'track' : 'tracks'})
                          </span>
                        ) : (
                          <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: '0.82rem' }}>
                            Not in Jellyfin Library
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}
                          disabled={jellyfinScanning}
                          onClick={handleTriggerJellyfinScan}
                          title="Trigger a Jellyfin library scan now"
                        >
                          <RefreshCw size={12} className={jellyfinScanning ? 'spin' : ''} /> {jellyfinScanning ? 'Scanning…' : 'Rescan Jellyfin'}
                        </button>
                      </div>
                    )}
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

                {(downloadFormat === 'flac' || downloadFormat === 'wav') ? (
                  <div style={{
                    marginTop: 12,
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    color: '#f87171',
                    lineHeight: 1.4,
                  }}>
                    ⚠️ <strong>Notice:</strong> YouTube does not host lossless/FLAC audio. Choosing {downloadFormat.toUpperCase()} transcodes YouTube's lossy 160k Opus stream into a large uncompressed file (~10× larger) without recovering lost audio detail. For genuine best quality, choose <strong>OPUS</strong> or <strong>MP3 (320k)</strong>.
                  </div>
                ) : downloadFormat === 'opus' ? (
                  <div style={{
                    marginTop: 12,
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    color: 'var(--success, #10b981)',
                    lineHeight: 1.4,
                  }}>
                    ✨ <strong>Highest Quality:</strong> OPUS extracts YouTube's native ~160 kbps VBR audio stream directly with zero transcoding/re-encoding loss.
                  </div>
                ) : null}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={downloadingAlbum || (selectedAlbum.tracks || []).length === 0}
                    onClick={() => handleDownloadAlbum(false, false)}
                  >
                    {downloadingAlbum ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}
                    Download Entire Album ({selectedAlbum.tracks?.length || 0} tracks)
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={downloadingAlbum || (selectedAlbum.tracks || []).length === 0}
                    onClick={() => handleDownloadAlbum(false, true)}
                    title="Queue this album and return directly to search results to pick more albums"
                  >
                    <Download size={15} />
                    Download & Back to Search
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={downloadingAlbum || selectedTracks.size === 0}
                    onClick={() => handleDownloadAlbum(true, false)}
                  >
                    <CheckCircle2 size={16} />
                    Download Selected ({selectedTracks.size})
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSelectedAlbum(null)}
                    title="Return to search results to pick another album"
                  >
                    <ArrowLeft size={15} /> Back to Search Results
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
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    background: albumDownloadMessage.type === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
                    color: albumDownloadMessage.type === 'success' ? 'var(--success)' : 'var(--danger)',
                    fontSize: '0.9rem',
                    fontWeight: 500,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {albumDownloadMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                      <span>{albumDownloadMessage.text}</span>
                    </div>
                    {albumDownloadMessage.type === 'success' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => setSelectedAlbum(null)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <ArrowLeft size={14} /> Back to Search (Pick More Albums)
                      </button>
                    )}
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
                        <th style={{ width: 40 }}>#</th>
                        <th style={{ width: 44 }}>Preview</th>
                        <th>Title</th>
                        <th>Artist</th>
                        <th style={{ width: 65 }}>Time</th>
                        <th style={{ width: 95 }}>Match</th>
                        <th style={{ width: 105 }}>Status</th>
                        <th style={{ width: 60, textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedAlbum.tracks?.map((t) => {
                        const isSelected = selectedTracks.has(t.trackNumber);
                        const isPlaying = playingPreviewUrl === t.previewUrl;
                        const customMatch = trackMatches[t.trackNumber];
                        const job = getTrackJobStatus(t.title);
                        const isDownloading = job?.status === 'downloading';
                        const isQueued = job?.status === 'queued';
                        const isCompleted = job?.status === 'completed';
                        const inJellyfin = jellyfinAlbumData?.tracks?.some((jt) =>
                          (jt.trackNumber && jt.trackNumber === t.trackNumber) ||
                          (jt.name && jt.name.toLowerCase().trim() === t.title.toLowerCase().trim())
                        );

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
                              {inJellyfin && (
                                <span className="badge" style={{ marginLeft: 6, fontSize: '0.68rem', padding: '1px 5px', background: 'rgba(16, 185, 129, 0.12)', color: 'var(--success)' }} title="Already indexed in Jellyfin library">
                                  In Jellyfin
                                </span>
                              )}
                            </td>
                            <td style={{ color: 'var(--text-secondary)' }}>{t.artist}</td>
                            <td style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>{formatDuration(t.duration)}</td>
                            <td>
                              {customMatch ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ padding: '2px 8px', fontSize: '0.74rem', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  onClick={() => handleOpenMatchModal(t)}
                                  title={`Custom match: ${customMatch.title}`}
                                >
                                  <CheckCircle2 size={12} /> Custom
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ padding: '2px 8px', fontSize: '0.74rem', color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  onClick={() => handleOpenMatchModal(t)}
                                  title="Inspect YouTube match or pick alternate audio stream"
                                >
                                  <Search size={12} /> Auto
                                </button>
                              )}
                            </td>
                            <td>
                              {isDownloading ? (
                                <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <RefreshCw size={10} className="spin" /> {job.progress || 'Downloading'}
                                </span>
                              ) : isQueued ? (
                                <span className="badge" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Clock size={10} /> Queued
                                </span>
                              ) : isCompleted ? (
                                <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Check size={10} /> Done
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>Ready</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleDownloadSingleTrack(t)}
                                disabled={isDownloading || isQueued}
                                title={`Download this track (${downloadFormat.toUpperCase()})`}
                              >
                                {isDownloading ? <RefreshCw size={14} className="spin" /> : isCompleted ? <Check size={14} color="var(--success)" /> : <Download size={14} />}
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

              {(downloadFormat === 'flac' || downloadFormat === 'wav') ? (
                <div style={{
                  marginBottom: 14,
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#f87171',
                  lineHeight: 1.4,
                }}>
                  ⚠️ <strong>Notice:</strong> YouTube does not host lossless audio. {downloadFormat.toUpperCase()} will transcode YouTube's lossy 160k Opus stream into a large file without improving quality. For the highest native quality, choose <strong>OPUS</strong> or <strong>MP3 (320k)</strong>.
                </div>
              ) : downloadFormat === 'opus' ? (
                <div style={{
                  marginBottom: 14,
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  color: 'var(--success, #10b981)',
                  lineHeight: 1.4,
                }}>
                  ✨ <strong>Highest Quality:</strong> OPUS copies YouTube's native ~160 kbps VBR audio stream directly with zero transcoding loss.
                </div>
              ) : null}

              {/* Playlist Tracks Selection */}
              {directInfo.isPlaylist && directInfo.entries?.length > 0 && (
                <div style={{ marginBottom: 18, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
                      Playlist Tracks ({directSelectedTracks.size} of {directInfo.entries.length} selected)
                    </h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setDirectSelectedTracks(new Set(directInfo.entries.map((_, i) => i)))}
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setDirectSelectedTracks(new Set())}
                      >
                        Clear Selection
                      </button>
                    </div>
                  </div>

                  <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <table className="table" style={{ width: '100%', margin: 0 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 36 }}>
                            <input
                              type="checkbox"
                              checked={directSelectedTracks.size === directInfo.entries.length && directInfo.entries.length > 0}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setDirectSelectedTracks(new Set(directInfo.entries.map((_, i) => i)));
                                } else {
                                  setDirectSelectedTracks(new Set());
                                }
                              }}
                            />
                          </th>
                          <th style={{ width: 36 }}>#</th>
                          <th>Title</th>
                          <th>Channel</th>
                          <th style={{ width: 65 }}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {directInfo.entries.map((e, idx) => {
                          const isSelected = directSelectedTracks.has(idx);
                          return (
                            <tr key={e.id || idx} style={{ backgroundColor: isSelected ? 'rgba(91, 109, 248, 0.04)' : undefined }}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    setDirectSelectedTracks((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(idx)) next.delete(idx);
                                      else next.add(idx);
                                      return next;
                                    });
                                  }}
                                />
                              </td>
                              <td style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}>{idx + 1}</td>
                              <td style={{ fontWeight: 600 }}>{e.title}</td>
                              <td style={{ color: 'var(--text-secondary)' }}>{e.uploader || directInfo.uploader}</td>
                              <td style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>{formatDuration(e.duration)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary"
                disabled={directDownloading || (directInfo.isPlaylist && directSelectedTracks.size === 0)}
                onClick={handleDownloadDirect}
              >
                {directDownloading ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}
                {directInfo.isPlaylist
                  ? `Download ${directSelectedTracks.size} Track(s) into "${downloadFolder}"`
                  : `Download into "${downloadFolder}"`} ({downloadFormat.toUpperCase()} • {downloadQuality})
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
                          onChange={(e) => {
                            const nextFmt = e.target.value;
                            const nextQuals = QUALITY_OPTIONS_BY_FORMAT[nextFmt] || QUALITY_OPTIONS_BY_FORMAT.mp3;
                            setNewWatchFormat(nextFmt);
                            if (!nextQuals.some((q) => q.value === newWatchQuality)) {
                              setNewWatchQuality(nextQuals[0]?.value || '320k');
                            }
                          }}
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
        <>
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
                    onChange={(e) => {
                      const nextFmt = e.target.value;
                      const nextQuals = QUALITY_OPTIONS_BY_FORMAT[nextFmt] || QUALITY_OPTIONS_BY_FORMAT.mp3;
                      const nextQual = nextQuals.some((q) => q.value === settings.musicQuality)
                        ? settings.musicQuality
                        : (nextQuals[0]?.value || '320k');
                      setSettings({ ...settings, musicFormat: nextFmt, musicQuality: nextQual });
                    }}
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

              <div style={{
                padding: '12px 14px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                  💡 YouTube Audio Quality Guide:
                </strong>
                YouTube encodes all uploaded audio to lossy streams. It does <em>not</em> host FLAC or uncompressed lossless audio.
                <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                  <li><strong>OPUS:</strong> The true highest-quality stream YouTube provides (~160 kbps VBR 48kHz). Extracted directly with <em>zero transcoding loss</em>.</li>
                  <li><strong>MP3 (320 kbps):</strong> Transcoded from YouTube's Opus stream at maximum bitrate with full ID3v2 tags and cover art for 100% universal player compatibility.</li>
                  <li><strong>M4A (AAC):</strong> High compatibility with Apple devices and iTunes.</li>
                  <li><strong>FLAC / WAV:</strong> Re-encodes YouTube's lossy 160k stream into an uncompressed container. It inflates file size by ~10× without restoring lost audio frequencies.</li>
                </ul>
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

        <div className="card" style={{ maxWidth: 640, marginTop: 20 }}>
          <h2 style={{ fontSize: '1.2rem', marginTop: 0, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Radio size={20} color="var(--accent)" /> Jellyfin Music Library Sync
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 16 }}>
            Automatically notifies your Jellyfin media server whenever music downloads complete so new albums and songs appear in your Jellyfin libraries (and apps like Finamp/Feishin) immediately.
          </p>

          {jellyfinStatus?.configured ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{
                padding: '10px 14px',
                borderRadius: 8,
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <CheckCircle2 size={16} color="var(--success)" />
                <span>
                  Connected to Jellyfin at <strong>{jellyfinStatus.url}</strong>
                </span>
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={jellyfinStatus.autoScanEnabled !== false}
                    onChange={(e) => handleToggleJellyfinAutoScan(e.target.checked)}
                  />
                  Automatically notify Jellyfin to scan library after music downloads complete
                </label>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4, marginLeft: 24 }}>
                  Debounced to wait until all tracks in an album or playlist finish before triggering a single scan.
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={jellyfinScanning}
                  onClick={handleTriggerJellyfinScan}
                >
                  <RefreshCw size={15} className={jellyfinScanning ? 'spin' : ''} />
                  {jellyfinScanning ? 'Triggering Scan…' : 'Trigger Jellyfin Library Scan Now'}
                </button>
                <Link to="/settings" className="btn btn-ghost btn-sm" style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem' }}>
                  Jellyfin Server Settings →
                </Link>
              </div>
            </div>
          ) : (
            <div style={{
              padding: '14px',
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border)',
              fontSize: '0.86rem',
              color: 'var(--text-secondary)',
            }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                Jellyfin is not yet connected
              </div>
              <div style={{ marginTop: 4, lineHeight: 1.4 }}>
                To enable automatic library refresh and in-library album indicators, set your Jellyfin URL and API key in the main Settings page.
              </div>
              <div style={{ marginTop: 12 }}>
                <Link to="/settings" className="btn btn-secondary btn-sm">
                  Configure Jellyfin in Settings →
                </Link>
              </div>
            </div>
          )}
        </div>
        </>
      )}

      {/* Match Inspection & Custom Source Modal */}
      {inspectingTrack && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setInspectingTrack(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: 640,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.5))',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>YouTube Audio Stream Match</h3>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  "{inspectingTrack.title}" by {inspectingTrack.artist} {inspectingTrack.duration ? `(${formatDuration(inspectingTrack.duration)})` : ''}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: 4 }}
                onClick={() => setInspectingTrack(null)}
              >
                <X size={18} />
              </button>
            </div>

            {trackMatches[inspectingTrack.trackNumber] && (
              <div style={{
                marginBottom: 16,
                padding: '10px 14px',
                borderRadius: 8,
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                fontSize: '0.84rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong style={{ color: 'var(--success)' }}>✓ Custom match active:</strong>{' '}
                    <span>{trackMatches[inspectingTrack.trackNumber].title}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--danger)' }}
                    onClick={() => {
                      setTrackMatches((prev) => {
                        const copy = { ...prev };
                        delete copy[inspectingTrack.trackNumber];
                        return copy;
                      });
                      showToast(`Reset to auto-match for "${inspectingTrack.title}"`);
                    }}
                  >
                    Reset to Auto
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 600, marginBottom: 8, display: 'block', fontSize: '0.85rem' }}>
                Candidate Audio Sources from YouTube
              </label>
              {loadingCandidates ? (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)' }}>
                  <RefreshCw size={22} className="spin" style={{ margin: '0 auto 10px auto' }} />
                  <div style={{ fontSize: '0.88rem' }}>Searching YouTube for official studio audio streams...</div>
                </div>
              ) : matchCandidates.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                  No candidate streams found. You can paste a direct YouTube link below.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                  {matchCandidates.map((c, idx) => {
                    const isSelected = trackMatches[inspectingTrack.trackNumber]?.youtubeUrl === c.youtubeUrl;
                    return (
                      <div
                        key={c.id || idx}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                          background: isSelected ? 'rgba(91, 109, 248, 0.08)' : 'var(--bg-subtle, rgba(255,255,255,0.02))',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        {c.thumbnail ? (
                          <img src={c.thumbnail} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Music size={18} />
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.title}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                            <span>{c.uploader}</span>
                            {c.isTopic && (
                              <span className="badge" style={{ fontSize: '0.68rem', padding: '1px 5px', background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>
                                Official Album Master
                              </span>
                            )}
                            <span>• {formatDuration(c.duration)}</span>
                            {c.durationDiff !== null && (
                              <span style={{ color: c.durationDiff <= 3 ? 'var(--success)' : c.durationDiff > 30 ? 'var(--danger)' : 'var(--warning)' }}>
                                ({c.durationDiff === 0 ? 'Exact time' : `±${c.durationDiff}s`})
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <a
                            href={c.youtubeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '5px 8px' }}
                            title="Preview on YouTube"
                          >
                            <ExternalLink size={14} />
                          </a>
                          <button
                            type="button"
                            className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                            onClick={() => handleSelectMatch(c)}
                          >
                            {isSelected ? 'Selected' : 'Use This'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <form onSubmit={handleApplyCustomUrl}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>
                  Or paste a custom YouTube URL for this track
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="input"
                    style={{ flex: 1, fontSize: '0.85rem' }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={customMatchUrl}
                    onChange={(e) => setCustomMatchUrl(e.target.value)}
                  />
                  <button type="submit" className="btn btn-secondary btn-sm" disabled={!customMatchUrl.trim()}>
                    Apply URL
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modern Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          padding: '12px 18px',
          borderRadius: 8,
          background: toastMessage.type === 'error' ? 'var(--danger, #ef4444)' : 'var(--accent, #5b6df8)',
          color: '#fff',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: '0.9rem',
          fontWeight: 500,
          maxWidth: 420,
        }}>
          {toastMessage.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span style={{ flex: 1 }}>{toastMessage.text}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
