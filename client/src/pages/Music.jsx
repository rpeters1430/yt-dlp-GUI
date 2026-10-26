import React, { useEffect, useMemo, useState, useRef } from 'react';
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
  Copy,
} from 'lucide-react';
import { musicTrackKey } from '../musicTracks.js';
import { api } from '../api.js';
import { useDownloads } from '../context/DownloadsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Art from '../components/Art.jsx';
import Drawer from '../components/Drawer.jsx';
import { Segmented, ToggleRow } from '../components/DownloadOptionsFields.jsx';

// Key for looking up a song in the Jellyfin library check results.
function parseJobOptions(json) {
  try {
    return (json && JSON.parse(json)) || {};
  } catch (_) {
    return {};
  }
}

function libraryTrackKey(t) {
  return `${t.artist || ''}|${t.album || ''}|${t.title || ''}|${t.discNumber || ''}|${t.trackNumber || ''}`;
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.floor(sec);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const FORMAT_OPTIONS = [
  { value: 'opus', label: 'OPUS (Prefer native Opus; quality depends on source)' },
  { value: 'mp3', label: 'MP3 (Universal 320 kbps CBR, Tagged)' },
  { value: 'm4a', label: 'M4A / AAC (Apple Compatible)' },
  { value: 'flac', label: 'FLAC (Transcoded - large file, not native lossless)' },
  { value: 'wav', label: 'WAV (Transcoded - uncompressed PCM)' },
];

const QUALITY_OPTIONS_BY_FORMAT = {
  // YouTube's Opus stream is always kept as-is (no re-encode), so there's no bitrate to pick.
  opus: [
    { value: '0', label: 'Prefer native Opus (avoid conversion when available)' },
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
  const [metadataSource, setMetadataSource] = useState('itunes');
  const [activeTab, setActiveTab] = useState('search'); // 'search' | 'direct' | 'watches' | 'settings'

  // Settings
  const [settings, setSettings] = useState({
    musicFolder: 'Music',
    musicFormat: 'mp3',
    musicQuality: '320k',
    saveCover: true,
    naming: 'classic',
    embedArtwork: true,
    libraryMode: 'standalone',
  });
  const [settingsSavedToast, setSettingsSavedToast] = useState(false);

  // Lidarr Integration state
  const [lidarrConfig, setLidarrConfig] = useState({
    enabled: false,
    url: 'http://localhost:8686',
    apiKey: '',
    torznabApiKey: '',
    autoNotify: true,
    musicFolder: 'Music',
    category: 'music',
    format: 'mp3',
    quality: '320k',
  });
  const [lidarrStatus, setLidarrStatus] = useState(null);
  const [lidarrTesting, setLidarrTesting] = useState(false);
  const [lidarrTestResult, setLidarrTestResult] = useState(null);
  const [lidarrSaving, setLidarrSaving] = useState(false);
  const [lidarrSavedToast, setLidarrSavedToast] = useState(false);
  const [lidarrWanted, setLidarrWanted] = useState({ records: [], totalRecords: 0, loading: false });
  const [lidarrWantedFilter, setLidarrWantedFilter] = useState('');
  const [downloadingWantedId, setDownloadingWantedId] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

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
  // Id of the album whose tracklist is being fetched, so its card can show it's working.
  const [loadingAlbumId, setLoadingAlbumId] = useState(null);
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [downloadingAlbum, setDownloadingAlbum] = useState(false);
  const [downloadingAlbumId, setDownloadingAlbumId] = useState(null);
  const [musicOptionsOpen, setMusicOptionsOpen] = useState(false);
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
  const { jobs: rawJobs } = useDownloads() || { jobs: [] };
  // Rows carry their extra options as a JSON string column (options_json).
  const jobs = useMemo(() => (rawJobs || []).map((j) => ({ ...j, options: parseJobOptions(j.options_json) })), [rawJobs]);
  const activeMusicJobs = jobs.filter(
    (j) => (j.status === 'queued' || j.status === 'downloading') && (j.options.isMusicDownload || j.options.audioOnly || j.audio_only)
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
  const [jellyfinCheckingAlbum, setJellyfinCheckingAlbum] = useState(false);
  // What the Jellyfin music library already has: release id -> { status, ownedTracks, totalTracks }
  // and libraryTrackKey(track) -> true/false. Filled in lazily for whatever is on screen.
  const [libraryAlbums, setLibraryAlbums] = useState({});
  const [libraryTracks, setLibraryTracks] = useState({});
  const [jellyfinScanning, setJellyfinScanning] = useState(false);

  // Toast notification state
  const appToast = useToast();
  function showToast(text, type = 'success') {
    appToast(text, { error: type === 'error' });
  }

  function getTrackJobStatus(trackTitle, trackArtist = null, albumName = null) {
    if (!trackTitle || !jobs) return null;
    const titLower = trackTitle.toLowerCase().trim();
    const artLower = trackArtist ? trackArtist.toLowerCase().trim() : null;
    const albLower = albumName ? albumName.toLowerCase().trim() : null;
    return jobs.find((j) => {
      const meta = j.options?.musicMetadata;
      const metaTitle = meta?.title;
      if (metaTitle && metaTitle.toLowerCase().trim() === titLower) {
        if (albLower && meta?.album && meta.album.toLowerCase().trim() !== albLower) return false;
        if (artLower) {
          const mArt = (meta?.artist || meta?.albumArtist || "").toLowerCase().trim();
          if (mArt && !mArt.includes(artLower) && !artLower.includes(mArt)) return false;
        }
        return true;
      }
      if (!metaTitle && j.title && j.title.toLowerCase().includes(titLower)) {
        if (artLower && !j.title.toLowerCase().includes(artLower)) return false;
        return true;
      }
      return false;
    });
  }

  async function handleOpenMatchModal(track) {
    setInspectingTrack(track);
    setCustomMatchUrl(trackMatches[musicTrackKey(track)]?.youtubeUrl || track.youtubeUrl || '');
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
      [musicTrackKey(inspectingTrack)]: {
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
      [musicTrackKey(inspectingTrack)]: {
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

  // Load Lidarr config and status when entering Lidarr tab
  useEffect(() => {
    if (activeTab === 'lidarr') {
      api.getLidarrSettings().then((cfg) => {
        setLidarrConfig(cfg);
        if (cfg.url && cfg.apiKey) {
          loadLidarrWanted();
        }
      }).catch(() => {});

      api.getLidarrStatus().then((st) => setLidarrStatus(st)).catch(() => {});
    }
  }, [activeTab]);

  function copyToClipboard(text, key) {
    if (!text) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  }

  async function handleTestLidarr() {
    setLidarrTesting(true);
    setLidarrTestResult(null);
    try {
      const res = await api.testLidarrConnection({ url: lidarrConfig.url, apiKey: lidarrConfig.apiKey });
      setLidarrTestResult({ ok: true, message: `Connected to ${res.appName || 'Lidarr'} (v${res.version})` });
    } catch (err) {
      setLidarrTestResult({ ok: false, error: err.message });
    } finally {
      setLidarrTesting(false);
    }
  }

  async function handleSaveLidarr(e) {
    if (e) e.preventDefault();
    setLidarrSaving(true);
    try {
      const updated = await api.updateLidarrSettings(lidarrConfig);
      setLidarrConfig(updated);
      setLidarrSavedToast(true);
      setTimeout(() => setLidarrSavedToast(false), 3000);
      if (updated.url && updated.apiKey) {
        loadLidarrWanted();
      }
    } catch (err) {
      alert(`Failed to save Lidarr settings: ${err.message}`);
    } finally {
      setLidarrSaving(false);
    }
  }

  async function loadLidarrWanted() {
    setLidarrWanted((prev) => ({ ...prev, loading: true }));
    try {
      const data = await api.getLidarrWanted({ page: 1, pageSize: 60 });
      setLidarrWanted({
        records: data.records || [],
        totalRecords: data.totalRecords || (data.records || []).length,
        loading: false,
      });
    } catch (err) {
      setLidarrWanted((prev) => ({ ...prev, loading: false }));
    }
  }

  async function handleDownloadWanted(item) {
    const artist = item.artist?.artistName || item.artistName || '';
    const album = item.title;
    setDownloadingWantedId(item.id);
    try {
      await api.downloadLidarrWanted({ artist, album });
      showToast(`Started download for "${artist} - ${album}"!`);
      api.getLidarrStatus().then((st) => setLidarrStatus(st)).catch(() => {});
    } catch (err) {
      showToast(`Could not download "${album}": ${err.message}`, 'error');
    } finally {
      setDownloadingWantedId(null);
    }
  }

  // Check every release/song currently on screen against the Jellyfin library, so search
  // results can show what's already owned. Only items not checked yet are sent.
  useEffect(() => {
    if (!jellyfinStatus?.configured) return;
    const releases = [];
    if (searchType === 'album') releases.push(...searchResults);
    if (matchedArtist) releases.push(...(matchedArtist.all || []), ...(matchedArtist.albums || []), ...(matchedArtist.singles || []));
    if (selectedArtist) releases.push(...(selectedArtist.all || []), ...(selectedArtist.albums || []), ...(selectedArtist.singles || []));
    const albumsToCheck = [];
    const seen = new Set();
    for (const r of releases) {
      if (!r || r.id == null || seen.has(r.id) || libraryAlbums[r.id]) continue;
      seen.add(r.id);
      albumsToCheck.push({ id: r.id, artist: r.artist, name: r.name, trackCount: r.trackCount });
    }

    const songs = [];
    if (searchType === 'track') songs.push(...searchResults);
    if (selectedAlbum?.tracks) songs.push(...selectedAlbum.tracks);
    const tracksToCheck = [];
    for (const t of songs) {
      const key = libraryTrackKey(t);
      if (!t?.title || key in libraryTracks || tracksToCheck.some((x) => x.key === key)) continue;
      tracksToCheck.push({ key, artist: t.artist, title: t.title, album:t.album, discNumber:t.discNumber, trackNumber:t.trackNumber, strictVersion:true });
    }

    if (albumsToCheck.length === 0 && tracksToCheck.length === 0) return;
    let cancelled = false;
    const checkingAlbum = selectedAlbum?.tracks?.length > 0;
    if (checkingAlbum) setJellyfinCheckingAlbum(true);
    api.checkJellyfinMusicLibrary({ albums: albumsToCheck, tracks: tracksToCheck })
      .then((res) => {
        if (cancelled || !res?.configured) return;
        if (res.albums && Object.keys(res.albums).length) setLibraryAlbums((prev) => ({ ...prev, ...res.albums }));
        if (res.tracks && Object.keys(res.tracks).length) {
          setLibraryTracks((prev) => ({ ...prev, ...res.tracks }));
          // Songs already in Jellyfin start unticked in the album view.
          if (selectedAlbum?.tracks) {
            setSelectedTracks((prev) => {
              const next = new Set(prev);
              for (const t of selectedAlbum.tracks) {
                if (res.tracks[libraryTrackKey(t)]) next.delete(musicTrackKey(t));
              }
              return next;
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (checkingAlbum && !cancelled) setJellyfinCheckingAlbum(false);
      });
    return () => { cancelled = true; };
    // libraryAlbums/libraryTracks are only read to skip already-checked items; this effect
    // writes them, so depending on them would re-run it after every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jellyfinStatus, searchType, searchResults, matchedArtist, selectedArtist, selectedAlbum]);

  async function handleTriggerJellyfinScan() {
    setJellyfinScanning(true);
    try {
      await api.refreshJellyfinLibrary();
      setLibraryAlbums({});
      setLibraryTracks({});
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
  }, [availableQualities, downloadQuality]);

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
      const data = await api.searchMusic(q, sType, metadataSource);
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
      showToast(`Could not load the artist: ${err.message}`, 'error');
    } finally {
      setArtistLoading(false);
    }
  }

  // Sorted releases for dedicated artist discography view
  function getSortedArtistReleases() {
    if (!selectedArtist) return [];
    let list;
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
          totalTracks: t.totalTracks,
        })),
        audioFormat: downloadFormat,
        audioQuality: downloadQuality,
        musicFolder: downloadFolder,
        saveCover: downloadSaveCover,
        skipInLibrary: true,
      };
      const res = await api.downloadMusic(payload);
      const skippedCount = res.skipped?.length || 0;
      showToast(res.enqueued === 0 && skippedCount > 0
          ? `"${details.album.name}" is already in your Jellyfin library. Nothing to download.`
        : `Queued "${details.album.name}" (${res.enqueued} songs)${skippedCount ? ` · skipped ${skippedCount} already in Jellyfin` : ''}`);
    } catch (err) {
      showToast(`Download failed: ${err.message}`, 'error');
    } finally {
      setDownloadingAlbumId(null);
    }
  }

  // Square album tile: cover with a Jellyfin badge, quick download, then title and year.
  function renderReleaseCard(item) {
    const isDownloadingThis = downloadingAlbumId === item.id;
    const isLoadingThis = loadingAlbumId === item.id;
    const libraryStatus = libraryAlbums[item.id];
    const owned = libraryStatus?.totalTracks ? Math.min(libraryStatus.ownedTracks, libraryStatus.totalTracks) : null;
    return (
      <div key={item.id} className={`album-tile${isLoadingThis ? ' loading' : ''}`} aria-busy={isLoadingThis}>
        <button type="button" className="album-tile-art" onClick={() => handleSelectAlbum(item)} aria-label={`Open ${item.name}`}>
          <Art src={item.artwork} ratio="1" label={isLoadingThis ? 'loading…' : null}>
            {libraryStatus?.status === 'complete' && <span className="badge badge-success badge-tl">IN LIBRARY</span>}
            {libraryStatus?.status === 'partial' && <span className="badge badge-warning badge-tl">{owned !== null ? `${owned}/${libraryStatus.totalTracks}` : 'PARTIAL'}</span>}
          </Art>
        </button>
        <button
          type="button"
          className="art-x album-quick"
          disabled={isDownloadingThis}
          onClick={(e) => handleQuickDownloadAlbum(e, item)}
          title={libraryStatus?.status === 'partial' ? `Download the songs not in Jellyfin (${downloadFormat.toUpperCase()})` : `Download all ${item.trackCount} songs (${downloadFormat.toUpperCase()})`}
          aria-label={`Download ${item.name}`}
        >
          {isDownloadingThis ? <RefreshCw size={13} className="spin" /> : <Download size={13} />}
        </button>
        <div className="tile-title" title={item.name}>{item.name}</div>
        <div className="tile-meta mono-meta">
          {[item.source === 'musicbrainz' ? item.artist : null, item.releaseYear, item.country, item.edition, item.isSingle ? (item.trackCount > 1 ? `EP · ${item.trackCount} songs` : 'Single') : `${item.trackCount} songs`].filter(Boolean).join(' · ')}
        </div>
      </div>
    );
  }

  // Opens the Music Watch form prefilled to follow an artist's new releases,
  // resolving their canonical YouTube / Topic channel URL asynchronously.
  async function openArtistWatch(name) {
    const cleanName = String(name || "").trim();
    const fallbackHandle = cleanName.replace(/[^a-zA-Z0-9._-]/g, "") || "music";
    setNewWatchName(`${cleanName} Releases`);
    setNewWatchUrl(`https://www.youtube.com/@${fallbackHandle}`);
    setActiveTab('watches');
    setShowAddWatchModal(true);
    try {
      const resolved = await api.resolveMusicArtistChannel(cleanName);
      if (resolved && resolved.url) {
        setNewWatchUrl(resolved.url);
      }
    } catch (_) {}
  }

  // View album details
  async function handleSelectAlbum(album) {
    if (loadingAlbumId) return;
    setLoadingAlbumId(album.id);
    setAlbumDownloadMessage(null);
    try {
      const data = await api.getMusicAlbum(album.id);
      // Default: select every track not already in Jellyfin (the library check effect
      // unticks any it finds once it hears back)
      const missingTrackNums = new Set((data.tracks || [])
        .filter((t) => !libraryTracks[libraryTrackKey(t)])
        .map(musicTrackKey));
      setSelectedTracks(missingTrackNums);
      setTrackMatches({});
      setSelectedAlbum(data);
    } catch (err) {
      showToast(`Could not load album details: ${err.message}`, 'error');
    } finally {
      setLoadingAlbumId(null);
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
    setSelectedTracks(new Set(selectedAlbum.tracks.map(musicTrackKey)));
  }

  function deselectAllTracks() {
    setSelectedTracks(new Set());
  }

  // Download Album or Selected Tracks
  async function handleDownloadAlbum(onlySelected = false, returnToSearch = false) {
    if (!selectedAlbum || !selectedAlbum.tracks) return;
    const tracksToDownload = selectedAlbum.tracks.filter((t) =>
      onlySelected ? selectedTracks.has(musicTrackKey(t)) : true
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
          totalTracks: t.totalTracks,
          totalDiscs: selectedAlbum.album.totalDiscs || selectedAlbum.tracks[0]?.totalDiscs || 1,
          youtubeUrl: trackMatches[musicTrackKey(t)]?.youtubeUrl || t.youtubeUrl || null,
        })),
        audioFormat: downloadFormat,
        audioQuality: downloadQuality,
        musicFolder: downloadFolder,
        saveCover: downloadSaveCover,
        // "Download Selected" honours the user's ticks; the whole-album buttons leave out
        // songs Jellyfin already has.
        skipInLibrary: !onlySelected,
      };

      const res = await api.downloadMusic(payload);
      const skippedCount = res.skipped?.length || 0;
      const skippedNote = skippedCount ? ` Skipped ${skippedCount} already in Jellyfin.` : '';
      const msg = res.enqueued === 0 && skippedCount > 0
        ? `Every song on "${selectedAlbum.album.name}" is already in your Jellyfin library. Nothing to download.`
        : `Successfully queued ${res.enqueued} song${res.enqueued === 1 ? '' : 's'} into "${downloadFolder}/${selectedAlbum.album.artist}/${selectedAlbum.album.name}"!${skippedNote}`;

      showToast(msg);
      if (returnToSearch) {
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
    if (libraryTracks[libraryTrackKey(track)] && !window.confirm(`"${track.title}" is already in your Jellyfin library. Download it again?`)) {
      return;
    }
    try {
      const customMatch = trackMatches[musicTrackKey(track)];
      const payload = {
        track: {
          ...track,
          albumArtist: selectedAlbum?.album?.artist || track.artist,
          totalTracks: track.totalTracks || null,
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
          tracks: chosenEntries.map((e) => ({
            title: e.track || e.title,
            artist: e.artist || e.uploader || 'Unknown Artist',
            album: e.album || null,
            trackNumber: e.trackNumber || null,
            discNumber:e.discNumber || null,
            playlistName:directInfo.title,
            playlistIndex:e.playlistIndex,
            metadataSource:'extractor',
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
            title: directInfo.track || directInfo.title,
            artist: directInfo.artist || directInfo.uploader || 'Unknown Artist',
            album:directInfo.album || null,
            metadataSource:'extractor',
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

  const albumOwnedCount = selectedAlbum?.tracks
    ? selectedAlbum.tracks.filter((t) => libraryTracks[libraryTrackKey(t)]).length
    : 0;

  return (
    <div className="music-hub-container">
      <div className="page-title-row music-title-row">
        <h1>Music</h1>
        <div className="pill-tabs" role="tablist">
          {[
            ['search', 'Search'],
            ['direct', 'Direct URL'],
            ['watches', 'Watches'],
            ['lidarr', lidarrWanted.totalRecords > 0 ? `Lidarr · ${lidarrWanted.totalRecords}` : 'Lidarr'],
            ['settings', 'Settings'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              className={activeTab === id ? 'active' : ''}
              onClick={() => { setActiveTab(id); if (id === 'search') setSelectedAlbum(null); }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeMusicJobs.length > 0 && (
        <div className="music-active">
          <span className="music-active-dot" />
          <span>
            <strong>{activeMusicJobs.length}</strong> music download{activeMusicJobs.length === 1 ? '' : 's'} running
            <span className="mono-meta">
              {' · '}{activeMusicJobs[0]?.title || 'Processing'}
              {typeof activeMusicJobs[0]?.percent === 'number' && activeMusicJobs[0].status === 'downloading' ? ` · ${Math.round(activeMusicJobs[0].percent)}%` : ''}
            </span>
          </span>
          <Link to="/" className="text-btn">View on Home</Link>
        </div>
      )}

      {activeTab === 'search' && (
        <>
          {!selectedAlbum && !selectedArtist && (
            <>
              <label className="mono-meta">Metadata catalog
                <select className="select" value={metadataSource} aria-label="Metadata catalog" onChange={e => {
                  setMetadataSource(e.target.value); setSearchResults([]); setMatchedArtist(null);
                  setSearchError('');
                  if (e.target.value === 'musicbrainz') setSearchType('album');
                }}>
                  <option value="itunes">Apple catalog</option>
                  <option value="musicbrainz">MusicBrainz releases (free)</option>
                </select>
              </label>
              {metadataSource === 'musicbrainz' && <p className="mono-meta">Search artist and album, then choose the country, date and edition that match your music.</p>}
              <form className="music-search" onSubmit={handleSearch}>
                <input
                  type="text"
                  placeholder={searchType === 'artist' ? 'Search for an artist' : searchType === 'album' ? 'Search albums or artists' : 'Search for a song and artist'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search music"
                />
                <Segmented
                  value={searchType}
                  onChange={(v) => {
                    setSearchType(v);
                    setSearchResults([]);
                    setMatchedArtist(null);
                    if (searchQuery.trim()) handleSearch(null, searchQuery, v);
                  }}
                  options={metadataSource === 'musicbrainz' ? [{value:'album',label:'Releases'}] : [{ value: 'artist', label: 'Artists' }, { value: 'album', label: 'Albums' }, { value: 'track', label: 'Songs' }]}
                />
              </form>
              {searching && <p className="empty-line">Searching…</p>}
              {!searching && !searchResults.length && !matchedArtist && !searchError && (
                <div className="chip-row">
                  <span className="mono-meta" style={{ alignSelf: 'center' }}>Try</span>
                  {['Daft Punk', 'Radiohead', 'Pink Floyd', 'Kendrick Lamar', 'The Beatles'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="chip"
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
              )}
              {searchError && <div className="notice notice-danger">{searchError}</div>}
              {artistLoading && <p className="empty-line">Loading discography…</p>}

              {searchType === 'artist' && searchResults.length > 0 && (
                <div className="artist-grid">
                  {searchResults.map((artist) => (
                    <button key={artist.id} type="button" className="artist-card" onClick={() => handleViewArtist(artist.id)}>
                      <Art src={artist.artwork} className="artist-art" ratio="1" />
                      <span className="artist-name">{artist.name}</span>
                      <span className="mono-meta">{artist.genre || 'Artist'}</span>
                    </button>
                  ))}
                </div>
              )}

              {searchType === 'album' && (matchedArtist || searchResults.length > 0) && (() => {
                let list = searchResults;
                if (matchedArtist && albumViewFilter === 'artist-albums') list = matchedArtist.albums || [];
                else if (matchedArtist && albumViewFilter === 'artist-singles') list = matchedArtist.singles || [];
                else if (matchedArtist && albumViewFilter === 'artist-all') list = matchedArtist.all || [];
                else if (albumViewFilter === 'albums-only') list = searchResults.filter((r) => !r.isSingle);
                else if (albumViewFilter === 'singles-only') list = searchResults.filter((r) => r.isSingle);
                const filters = matchedArtist
                  ? [
                    ['artist-albums', `Albums ${matchedArtist.counts?.albums || 0}`],
                    ['artist-singles', `Singles & EPs ${matchedArtist.counts?.singles || 0}`],
                    ['artist-all', `All ${matchedArtist.counts?.total || 0}`],
                    ...(searchResults.length ? [['all-search', `Other matches ${searchResults.length}`]] : []),
                  ]
                  : [
                    ['all', `All ${searchResults.length}`],
                    ['albums-only', 'Albums'],
                    ['singles-only', 'Singles'],
                  ];
                return (
                  <>
                    {matchedArtist && (
                      <div className="artist-strip">
                        <Art src={matchedArtist.artwork} className="artist-strip-art" ratio="1" />
                        <div className="artist-strip-text">
                          <div className="artist-strip-name">{matchedArtist.name}</div>
                          <div className="mono-meta">
                            {[matchedArtist.genre, `${matchedArtist.counts?.albums || 0} albums`, `${matchedArtist.counts?.singles || 0} singles & EPs`].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <div className="btn-row">
                          <button type="button" className="btn-ghost btn-sm" onClick={() => handleViewArtist(matchedArtist.id)}>Artist page</button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => openArtistWatch(matchedArtist.name)}>Watch artist</button>
                        </div>
                      </div>
                    )}
                    <div className="chip-row">
                      {filters.map(([value, label]) => (
                        <button key={value} type="button" className={`chip${albumViewFilter === value ? ' active' : ''}`} onClick={() => setAlbumViewFilter(value)}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {list.length === 0
                      ? <p className="empty-line">No releases in this category.</p>
                      : <div className="album-grid">{list.map(renderReleaseCard)}</div>}
                  </>
                );
              })()}

              {searchType === 'track' && searchResults.length > 0 && (
                <div className="rows">
                  {searchResults.map((t, idx) => (
                    <div key={`${t.title}-${idx}`} className="row song-row">
                      <Art src={t.artwork} className="song-thumb" ratio="1">
                        {t.previewUrl && (
                          <button type="button" className="song-preview" onClick={() => togglePreview(t.previewUrl)} aria-label={playingPreviewUrl === t.previewUrl ? 'Stop preview' : 'Play 30-second preview'}>
                            {playingPreviewUrl === t.previewUrl ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                          </button>
                        )}
                      </Art>
                      <div className="row-main">
                        <div className="row-title">
                          {t.title}
                          {libraryTracks[libraryTrackKey(t)] && <span className="tag-success">IN JELLYFIN</span>}
                        </div>
                        <div className="song-sub">
                          <button type="button" className="link-plain" onClick={() => handleViewArtist(null, t.artist)}>{t.artist}</button>
                          {' · '}{t.album || 'Single'}
                        </div>
                      </div>
                      <span className="mono-meta">{formatDuration(t.duration)}</span>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => handleDownloadSingleTrack(t)}>Download</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {!selectedAlbum && selectedArtist && (
            <>
              <button type="button" className="back-link" onClick={() => setSelectedArtist(null)}>‹ Back to results</button>
              <div className="artist-hero">
                <Art src={selectedArtist.artist.artwork} className="artist-hero-art" ratio="1" />
                <div className="artist-hero-text">
                  <div className="eyebrow">ARTIST{selectedArtist.artist.genre ? ` · ${selectedArtist.artist.genre.toUpperCase()}` : ''}</div>
                  <h2 className="artist-hero-name">{selectedArtist.artist.name}</h2>
                  <div className="mono-meta">
                    {selectedArtist.counts.albums} albums · {selectedArtist.counts.singles} singles &amp; EPs · {selectedArtist.counts.total} releases
                  </div>
                </div>
                <button type="button" className="btn-ghost" onClick={() => openArtistWatch(selectedArtist.artist.name)}>Watch artist</button>
              </div>
              <div className="toolbar">
                <Segmented
                  value={artistTab}
                  onChange={setArtistTab}
                  options={[
                    { value: 'albums', label: `Albums ${selectedArtist.counts.albums}` },
                    { value: 'singles', label: `Singles ${selectedArtist.counts.singles}` },
                    { value: 'all', label: `All ${selectedArtist.counts.total}` },
                  ]}
                />
                <input className="toolbar-search" placeholder="Filter by title" value={artistSearchTerm} onChange={(e) => setArtistSearchTerm(e.target.value)} aria-label="Filter releases" />
                <select className="toolbar-select" value={artistSort} onChange={(e) => setArtistSort(e.target.value)} aria-label="Sort releases">
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="name">A–Z</option>
                  <option value="tracks">Most songs</option>
                </select>
              </div>
              {getSortedArtistReleases().length === 0
                ? <p className="empty-line">Nothing here.</p>
                : <div className="album-grid">{getSortedArtistReleases().map(renderReleaseCard)}</div>}
            </>
          )}

          {selectedAlbum && (() => {
            const tracks = selectedAlbum.tracks || [];
            const album = selectedAlbum.album;
            const ownedAll = tracks.length > 0 && albumOwnedCount >= tracks.length;
            const moreBy = (selectedArtist?.all || matchedArtist?.all || searchResults || [])
              .filter((r) => r && r.id !== album.id && r.name && (!r.artist || r.artist === album.artist))
              .slice(0, 6);
            return (
              <>
                <button type="button" className="back-link" onClick={() => setSelectedAlbum(null)}>
                  ‹ {selectedArtist ? `Back to ${selectedArtist.artist.name}` : 'Back to results'}
                </button>
                <section className="album-hero">
                  <Art src={album.artwork} className="album-cover" ratio="1" />
                  <div className="album-hero-text">
                    <div className="eyebrow">
                      {[album.isSingle ? 'SINGLE' : 'ALBUM', album.releaseYear, `${tracks.length} SONG${tracks.length === 1 ? '' : 'S'}`].filter(Boolean).join(' · ')}
                    </div>
                    <h2 className="album-title">{album.name}</h2>
                    <div className="album-artist">
                      <button type="button" className="link-plain" disabled={!album.artistId} onClick={() => handleViewArtist(album.artistId, album.artist)}>{album.artist}</button>
                      {album.genre ? ` · ${album.genre}` : ''}
                    </div>
                    {jellyfinStatus?.configured && (
                      <div className="album-jellyfin">
                        {jellyfinCheckingAlbum ? (
                          <span className="pill pill-muted">Checking Jellyfin…</span>
                        ) : albumOwnedCount > 0 ? (
                          <span className="pill pill-success">{ownedAll ? 'Whole album in Jellyfin' : `${albumOwnedCount} of ${tracks.length} in Jellyfin`}</span>
                        ) : (
                          <span className="pill pill-muted">Not in Jellyfin</span>
                        )}
                        <button type="button" className="text-btn" disabled={jellyfinScanning} onClick={handleTriggerJellyfinScan}>
                          {jellyfinScanning ? 'Scanning…' : 'Rescan'}
                        </button>
                      </div>
                    )}
                    <div className="album-actions">
                      <button
                        type="button"
                        className="btn-primary pill-btn"
                        disabled={downloadingAlbum || selectedTracks.size === 0}
                        onClick={() => handleDownloadAlbum(true, false)}
                      >
                        {downloadingAlbum ? 'Adding…' : `Download ${selectedTracks.size} song${selectedTracks.size === 1 ? '' : 's'}`}
                      </button>
                      <Segmented
                        size="sm"
                        className="seg-pill"
                        value={downloadFormat}
                        onChange={setDownloadFormat}
                        options={['flac', 'mp3', 'm4a', 'opus'].map((f) => ({ value: f, label: f.toUpperCase() }))}
                      />
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => setSelectedTracks(new Set(tracks.filter((t) => !libraryTracks[libraryTrackKey(t)]).map(musicTrackKey)))}
                      >
                        Select missing
                      </button>
                      <button type="button" className="text-btn" onClick={selectedTracks.size === tracks.length ? deselectAllTracks : selectAllTracks}>
                        {selectedTracks.size === tracks.length && tracks.length > 0 ? 'Select none' : 'Select all'}
                      </button>
                      <button type="button" className="text-btn" onClick={() => setMusicOptionsOpen(true)}>Options</button>
                    </div>
                    {albumDownloadMessage && (
                      <div className={`notice ${albumDownloadMessage.type === 'success' ? 'notice-info' : 'notice-danger'}`}>{albumDownloadMessage.text}</div>
                    )}
                  </div>
                </section>

                <div className="album-body">
                  <div className="tracklist" role="list">
                    {tracks.map((t) => {
                      const isSelected = selectedTracks.has(musicTrackKey(t));
                      const customMatch = trackMatches[musicTrackKey(t)];
                      const job = getTrackJobStatus(t.title, t.artist || selectedAlbum?.album?.artist, t.album || selectedAlbum?.album?.name);
                      const inJellyfin = !!libraryTracks[libraryTrackKey(t)];
                      const state = job?.status === 'downloading'
                        ? (typeof job.percent === 'number' && job.percent > 0 ? `${Math.round(job.percent)}%` : 'downloading')
                        : job?.status === 'queued' ? 'queued'
                          : job?.status === 'completed' ? 'done' : null;
                      return (
                        <div
                          key={`${t.discNumber || 1}-${t.trackNumber}`}
                          role="listitem"
                          className={`track${isSelected ? ' selected' : ''}${inJellyfin && !isSelected ? ' owned' : ''}`}
                          onClick={() => toggleTrackSelection(musicTrackKey(t))}
                        >
                          <span className={`track-check${isSelected ? ' on' : ''}`} role="checkbox" aria-checked={isSelected} aria-label={`Select ${t.title}`} />
                          <span className="track-num mono">{t.trackNumber}</span>
                          <span className="track-title">
                            {t.title}
                            {t.discNumber > 1 && <span className="tag-muted">DISC {t.discNumber}</span>}
                            {inJellyfin && <span className="tag-success">IN JELLYFIN</span>}
                            {state && <span className={state === 'done' ? 'tag-success' : 'tag-muted'}>{String(state).toUpperCase()}</span>}
                          </span>
                          <span className="track-tools" onClick={(e) => e.stopPropagation()}>
                            {t.previewUrl && (
                              <button type="button" className="icon-plain" onClick={() => togglePreview(t.previewUrl)} aria-label={playingPreviewUrl === t.previewUrl ? 'Stop preview' : 'Play preview'}>
                                {playingPreviewUrl === t.previewUrl ? <Pause size={14} /> : <Play size={14} />}
                              </button>
                            )}
                            <button
                              type="button"
                              className={`text-btn track-match${customMatch ? ' custom' : ''}`}
                              onClick={() => handleOpenMatchModal(t)}
                              title={customMatch ? `Custom source: ${customMatch.title}` : 'Check or change the YouTube source'}
                            >
                              {customMatch ? 'Custom source' : 'Source'}
                            </button>
                          </span>
                          <span className="track-dur mono">{formatDuration(t.duration)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {moreBy.length > 0 && (
                    <aside className="more-by">
                      <h3>More by {album.artist}</h3>
                      <div className="more-by-grid">
                        {moreBy.map((r) => (
                          <button key={r.id} type="button" className="more-by-item" onClick={() => handleSelectAlbum(r)}>
                            <Art src={r.artwork} ratio="1" />
                            <span className="more-by-name">{r.name}</span>
                            <span className="mono-meta">{r.releaseYear || ''}</span>
                          </button>
                        ))}
                      </div>
                    </aside>
                  )}
                </div>

                <Drawer
                  open={musicOptionsOpen}
                  onClose={() => setMusicOptionsOpen(false)}
                  label="Music download options"
                  footer={<><span /><button type="button" className="btn-primary btn-lg" onClick={() => setMusicOptionsOpen(false)}>Done</button></>}
                >
                  <h2 className="drawer-title">Download options</h2>
                  <p className="drawer-sub mono">{downloadFolder}/{album.artist}/{album.name}/## - Song.{downloadFormat}</p>
                  <div className="drawer-section dl-options">
                    <div className="dl-options-group">
                      <span className="field-caption">Format</span>
                      <div className="choice-row">
                        {FORMAT_OPTIONS.map((f) => (
                          <button key={f.value} type="button" className={`choice mono${downloadFormat === f.value ? ' active' : ''}`} onClick={() => setDownloadFormat(f.value)} title={f.label}>
                            {f.value.toUpperCase()}
                          </button>
                        ))}
                      </div>
                      {(downloadFormat === 'flac' || downloadFormat === 'wav') && (
                        <p className="field-hint text-warning">YouTube has no lossless audio. {downloadFormat.toUpperCase()} re-encodes the ~160k Opus stream into a much bigger file without adding detail. OPUS or MP3 320k is the better choice.</p>
                      )}
                      {downloadFormat === 'opus' && <p className="field-hint">OPUS keeps YouTube&apos;s native audio stream as-is, with no re-encoding.</p>}
                    </div>
                    <label className="field-caption form-col">Quality
                      <select value={downloadQuality} onChange={(e) => setDownloadQuality(e.target.value)}>
                        {availableQualities.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
                      </select>
                    </label>
                    <label className="field-caption form-col">Music folder
                      <input value={downloadFolder} onChange={(e) => setDownloadFolder(e.target.value)} placeholder="Music" />
                    </label>
                    <div className="toggle-list">
                      <ToggleRow label="Save cover.jpg" description="Album art next to the songs, for Jellyfin and Plex" checked={downloadSaveCover} onChange={setDownloadSaveCover} />
                    </div>
                  </div>
                </Drawer>
              </>
            );
          })()}
        </>
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
                    style={{ width: 120, height: 120, borderRadius: 'var(--radius-sm)', objectFit: 'cover', boxShadow: 'var(--shadow-sm)' }}
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
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.78rem',
                  background: 'rgba(255, 42, 109, 0.1)',
                  border: '1px solid rgba(255, 42, 109, 0.25)',
                  color: 'var(--danger)',
                  lineHeight: 1.4,
                }}>
                  ⚠️ <strong>Notice:</strong> YouTube does not host lossless audio. {downloadFormat.toUpperCase()} will transcode YouTube's lossy 160k Opus stream into a large file without improving quality. For the highest native quality, choose <strong>OPUS</strong> or <strong>MP3 (320k)</strong>.
                </div>
              ) : downloadFormat === 'opus' ? (
                <div style={{
                  marginBottom: 14,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.78rem',
                  background: 'rgba(57, 255, 156, 0.1)',
                  border: '1px solid rgba(57, 255, 156, 0.25)',
                  color: 'var(--success, #10b981)',
                  lineHeight: 1.4,
                }}>
                  ✨ <strong>Highest Quality:</strong> OPUS copies YouTube's native ~160 kbps VBR audio stream directly with no additional transcoding loss.
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

                  <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
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
                            <tr key={e.id || idx} style={{ backgroundColor: isSelected ? 'rgba(0, 240, 255, 0.04)' : undefined }}>
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
                        <span>Last check: {w.last_checked_at ? new Date(`${w.last_checked_at}Z`).toLocaleTimeString() : 'Pending'}</span>
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
                  {settings.musicDir && (
                    <> Currently saving to <code>{settings.musicDir}</code> (save to refresh). &quot;Music&quot; or blank uses the
                    container&apos;s <code>MUSIC_DIR</code> mount when one is set.</>
                  )}
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
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                  💡 YouTube Audio Quality Guide:
                </strong>
                YouTube encodes all uploaded audio to lossy streams. It does <em>not</em> host FLAC or uncompressed lossless audio.
                <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                  <li><strong>OPUS:</strong> Prefers the available native Opus stream, avoiding conversion where possible with <em>no additional transcoding loss</em>.</li>
                  <li><strong>MP3 (320 kbps):</strong> Transcoded from YouTube's Opus stream at maximum bitrate with full ID3v2 tags and cover art for broad player compatibility.</li>
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

              <label>Library management
                <select className="select" value={settings.libraryMode || 'standalone'} onChange={e => setSettings({...settings, libraryMode:e.target.value})}>
                  <option value="standalone">Manage tags and library here</option>
                  <option value="lidarr">Send downloads to Lidarr for import</option>
                </select>
              </label>
              <label>Music naming
                <select className="select" value={settings.naming || 'classic'} onChange={e => setSettings({...settings, naming:e.target.value})}>
                  <option value="classic">Artist / Album / 01 - Title</option>
                  <option value="release">Artist / Album (Year) [Edition] [Release ID] / Disc 01 / 01 - Title</option>
                </select>
              </label>
              <ToggleRow label="Embed album artwork" description="Independent of saving a separate cover image" checked={settings.embedArtwork !== false} onChange={value => setSettings({...settings, embedArtwork:value})} />
              <p className="mono-meta">Music is tagged with Mutagen and verified before import. Existing files are never replaced automatically. Naming changes apply to new downloads.</p>
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
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(57, 255, 156, 0.1)',
                border: '1px solid rgba(57, 255, 156, 0.25)',
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
              borderRadius: 'var(--radius-sm)',
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

      {/* ========================================================================= */}
      {/* TAB 5: LIDARR INTEGRATION                                                 */}
      {/* ========================================================================= */}
      {activeTab === 'lidarr' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Header Card */}
          <div className="card" style={{ maxWidth: 840 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Radio size={24} color="var(--accent)" />
                <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 700 }}>Lidarr Music Integration</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {lidarrConfig.enabled ? (
                  <span className="badge" style={{ background: 'rgba(57, 255, 156, 0.15)', color: 'var(--success)', border: '1px solid rgba(57, 255, 156, 0.3)', padding: '4px 10px', fontSize: '0.8rem' }}>
                    ● Integration Enabled
                  </span>
                ) : (
                  <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)', padding: '4px 10px', fontSize: '0.8rem' }}>
                    Disabled
                  </span>
                )}
              </div>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, margin: 0 }}>
              Use this app as both an <strong>Indexer</strong> and <strong>Downloader</strong> for Lidarr. When Lidarr searches for an album or track, our Torznab indexer finds album metadata and sends downloads to our queue through the qBittorrent adapter. When downloads finish, Lidarr automatically imports and renames the files into your library!
            </p>
          </div>

          {/* Quick Setup / Connection Guide Card */}
          <div className="card" style={{ maxWidth: 840 }}>
            <h3 style={{ fontSize: '1.05rem', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileAudio size={18} color="var(--accent)" /> How to Connect in Lidarr
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
              {/* Step 1: Torznab Indexer */}
              <div style={{ padding: 14, borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: '0.92rem', color: 'var(--text-primary)' }}>1. Add as Indexer in Lidarr</strong>
                  <span className="badge" style={{ fontSize: '0.72rem' }}>Torznab</span>
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                  In Lidarr, go to <strong>Settings → Indexers → Add (+) → Torznab (Custom)</strong>:
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', display: 'block', marginBottom: 2 }}>URL</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        readOnly
                        className="input"
                        style={{ fontSize: '0.82rem', padding: '6px 8px', flex: 1 }}
                        value={`${window.location.origin}/api/lidarr/torznab`}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 8px' }}
                        onClick={() => copyToClipboard(`${window.location.origin}/api/lidarr/torznab`, 'torznabUrl')}
                        title="Copy Indexer URL"
                      >
                        {copiedKey === 'torznabUrl' ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', display: 'block', marginBottom: 2 }}>API Key</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        readOnly
                        className="input"
                        style={{ fontSize: '0.82rem', padding: '6px 8px', flex: 1 }}
                        value={lidarrConfig.torznabApiKey || 'Generating...'}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 8px' }}
                        onClick={() => copyToClipboard(lidarrConfig.torznabApiKey, 'torznabKey')}
                        title="Copy Torznab API Key"
                      >
                        {copiedKey === 'torznabKey' ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Categories: <code>3000, 3010, 3040</code> (Audio)
                  </div>
                </div>
              </div>

              {/* Step 2: Download Client */}
              <div style={{ padding: 14, borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: '0.92rem', color: 'var(--text-primary)' }}>2. Add as Download Client</strong>
                  <span className="badge" style={{ fontSize: '0.72rem' }}>qBittorrent</span>
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                  In Lidarr, go to <strong>Settings → Download Clients → Add (+) → qBittorrent</strong>:
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', display: 'block', marginBottom: 2 }}>Host</label>
                      <input
                        type="text"
                        readOnly
                        className="input"
                        style={{ fontSize: '0.82rem', padding: '6px 8px', width: '100%' }}
                        value={window.location.hostname || '127.0.0.1'}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', display: 'block', marginBottom: 2 }}>Port</label>
                      <input
                        type="text"
                        readOnly
                        className="input"
                        style={{ fontSize: '0.82rem', padding: '6px 8px', width: '100%' }}
                        value={window.location.port || (window.location.protocol === 'https:' ? '443' : '80')}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', display: 'block', marginBottom: 2 }}>URL Base</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        readOnly
                        className="input"
                        style={{ fontSize: '0.82rem', padding: '6px 8px', flex: 1 }}
                        value="/api/lidarr/qbit"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 8px' }}
                        onClick={() => copyToClipboard('/api/lidarr/qbit', 'qbitUrl')}
                        title="Copy URL Base"
                      >
                        {copiedKey === 'qbitUrl' ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Username: anything (e.g. <code>lidarr</code>). Password: the API Key above. Category: <code>music</code>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    Use SSL: {window.location.protocol === 'https:' ? 'Yes' : 'No'}. Initial State: Start. Priorities: Last. Reported download path: <code>{lidarrConfig.musicFolder || '/downloads/Music'}</code>
                  </div>

                  <div style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(245, 237, 0, 0.08)',
                    border: '1px solid rgba(245, 237, 0, 0.25)',
                    fontSize: '0.74rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.4,
                  }}>
                    <strong style={{ color: 'var(--warning)' }}>⚠️ Remote Path Mapping tip:</strong> If Lidarr is in Docker and you configure a Remote Path Mapping, set <strong>Remote Path</strong> to <code>{lidarrConfig.musicFolder || '/downloads/Music'}</code> and <strong>Local Path</strong> to your downloads directory (e.g. <code>/downloads</code> or <code>/music/Downloads</code>). Do <em>not</em> set Local Path to your Lidarr library Root Folder (<code>/music</code>).
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Lidarr Server Settings Form */}
          <div className="card" style={{ maxWidth: 840 }}>
            <h3 style={{ fontSize: '1.05rem', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Settings size={18} color="var(--accent)" /> Lidarr Server Connection & Automation
            </h3>

            <form onSubmit={handleSaveLidarr}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={lidarrConfig.enabled}
                    onChange={(e) => setLidarrConfig({ ...lidarrConfig, enabled: e.target.checked })}
                  />
                  <strong>Enable Lidarr Integration</strong>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
                      Lidarr Server URL
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ width: '100%', fontSize: '0.9rem' }}
                      placeholder="http://localhost:8686"
                      value={lidarrConfig.url}
                      onChange={(e) => setLidarrConfig({ ...lidarrConfig, url: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
                      Lidarr API Key
                    </label>
                    <input
                      type="password"
                      className="input"
                      style={{ width: '100%', fontSize: '0.9rem' }}
                      placeholder="Found in Lidarr: Settings → General → Security → API Key"
                      value={lidarrConfig.apiKey}
                      onChange={(e) => setLidarrConfig({ ...lidarrConfig, apiKey: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
                      Lidarr Download Folder
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ width: '100%', fontSize: '0.9rem' }}
                      placeholder="/downloads/Music"
                      value={lidarrConfig.musicFolder}
                      onChange={(e) => setLidarrConfig({ ...lidarrConfig, musicFolder: e.target.value })}
                    />
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                      Where Lidarr grabs are saved, as a path <em>inside this container</em> (e.g. <code>/downloads/Music</code>). It is also the path reported to Lidarr; if Lidarr sees the folder at a different path, add a Remote Path Mapping in Lidarr instead of changing this.
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={lidarrConfig.autoNotify}
                      onChange={(e) => setLidarrConfig({ ...lidarrConfig, autoNotify: e.target.checked })}
                    />
                    Automatically notify Lidarr (trigger <code>DownloadedAlbumsScan</code>) when downloads finish
                  </label>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4, marginLeft: 24 }}>
                    Instantly notifies Lidarr to scan and import completed albums into your library without waiting for the next download client poll cycle.
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" onClick={handleTestLidarr} disabled={lidarrTesting || !lidarrConfig.url}>
                    <RefreshCw size={15} className={lidarrTesting ? 'spin' : ''} />
                    {lidarrTesting ? 'Testing Connection...' : 'Test Connection'}
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={lidarrSaving}>
                    {lidarrSaving ? 'Saving...' : 'Save Lidarr Settings'}
                  </button>
                  {lidarrSavedToast && (
                    <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}>
                      <CheckCircle2 size={16} /> Settings Saved!
                    </span>
                  )}
                </div>

                {lidarrTestResult && (
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)',
                    background: lidarrTestResult.ok ? 'rgba(57, 255, 156, 0.12)' : 'rgba(255, 42, 109, 0.12)',
                    border: `1px solid ${lidarrTestResult.ok ? 'rgba(57, 255, 156, 0.3)' : 'rgba(255, 42, 109, 0.3)'}`,
                    color: lidarrTestResult.ok ? 'var(--success)' : 'var(--danger)',
                    fontSize: '0.86rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    {lidarrTestResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    <span>{lidarrTestResult.ok ? lidarrTestResult.message : `Connection test failed: ${lidarrTestResult.error}`}</span>
                  </div>
                )}
              </div>
            </form>
          </div>

          {/* Lidarr Wanted / Missing Albums Section */}
          <div className="card" style={{ maxWidth: 840 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Search size={18} color="var(--accent)" />
                <h3 style={{ fontSize: '1.05rem', margin: 0 }}>Wanted / Missing Albums in Lidarr</h3>
                {lidarrWanted.totalRecords > 0 && (
                  <span className="badge" style={{ fontSize: '0.75rem' }}>
                    {lidarrWanted.totalRecords} Wanted
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={loadLidarrWanted}
                  disabled={lidarrWanted.loading || !lidarrConfig.url || !lidarrConfig.apiKey}
                >
                  <RefreshCw size={14} className={lidarrWanted.loading ? 'spin' : ''} />
                  Refresh
                </button>
              </div>
            </div>

            {(!lidarrConfig.url || !lidarrConfig.apiKey) ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.88rem' }}>
                Enter your Lidarr Server URL and API Key above and save settings to browse wanted albums.
              </div>
            ) : lidarrWanted.loading ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px auto' }} />
                <div>Fetching wanted albums from Lidarr...</div>
              </div>
            ) : lidarrWanted.records.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                🎉 No missing albums currently wanted in Lidarr! All monitored albums are downloaded.
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <input
                    type="text"
                    className="input"
                    style={{ width: '100%', fontSize: '0.85rem' }}
                    placeholder="Filter wanted albums by artist or title..."
                    value={lidarrWantedFilter}
                    onChange={(e) => setLidarrWantedFilter(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
                  {lidarrWanted.records
                    .filter((item) => {
                      if (!lidarrWantedFilter.trim()) return true;
                      const q = lidarrWantedFilter.toLowerCase();
                      const artist = (item.artist?.artistName || item.artistName || '').toLowerCase();
                      const title = (item.title || '').toLowerCase();
                      return artist.includes(q) || title.includes(q);
                    })
                    .slice(0, 30)
                    .map((item) => {
                      const artistName = item.artist?.artistName || item.artistName || 'Unknown Artist';
                      const albumTitle = item.title;
                      const releaseDate = item.releaseDate ? item.releaseDate.slice(0, 4) : '';
                      const isDownloading = downloadingWantedId === item.id;

                      return (
                        <div
                          key={item.id}
                          style={{
                            padding: '10px 14px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--surface-hover)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                            <div style={{
                              width: 40,
                              height: 40,
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--bg-subtle, rgba(255,255,255,0.05))',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--accent)',
                              flexShrink: 0,
                            }}>
                              <Disc3 size={20} />
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {albumTitle}
                              </div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                {artistName} {releaseDate ? `• ${releaseDate}` : ''}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            style={{ flexShrink: 0, padding: '4px 10px', fontSize: '0.8rem' }}
                            disabled={isDownloading}
                            onClick={() => handleDownloadWanted(item)}
                          >
                            <Download size={13} />
                            {isDownloading ? 'Searching…' : 'Download via yt-dlp'}
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* Active Dispatched Lidarr Downloads */}
          {lidarrStatus && (lidarrStatus.activeTasks?.length > 0 || lidarrStatus.completedTasks?.length > 0) && (
            <div className="card" style={{ maxWidth: 840 }}>
              <h3 style={{ fontSize: '1.05rem', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={18} color="var(--accent)" /> Lidarr Dispatched Queue & History
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...(lidarrStatus.activeTasks || []), ...(lidarrStatus.completedTasks || [])].map((task) => {
                  const isReady = task.state === 'pausedUP' || task.state === 'uploading';
                  const isError = task.state === 'error';
                  const pct = Math.round((task.progress || 0) * 100);
                  const badgeBg = isReady
                    ? 'rgba(57, 255, 156, 0.15)'
                    : isError
                      ? 'rgba(255, 42, 109, 0.15)'
                      : 'rgba(0, 240, 255, 0.15)';
                  const badgeColor = isReady
                    ? 'var(--success)'
                    : isError
                      ? 'var(--danger)'
                      : 'var(--accent)';
                  const badgeLabel = isReady
                    ? 'Ready for Lidarr Import'
                    : isError
                      ? 'Failed'
                      : task.state === 'queuedDL' && pct === 0
                        ? 'Queued'
                        : `${pct}% Downloading`;
                  return (
                    <div
                      key={task.hash}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface-hover)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{task.name}</span>
                        <span className="badge" style={{
                          fontSize: '0.72rem',
                          background: badgeBg,
                          color: badgeColor,
                        }}>
                          {badgeLabel}
                        </span>
                      </div>

                      <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: badgeColor,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
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

            {trackMatches[musicTrackKey(inspectingTrack)] && (
              <div style={{
                marginBottom: 16,
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(57, 255, 156, 0.12)',
                border: '1px solid rgba(57, 255, 156, 0.3)',
                fontSize: '0.84rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong style={{ color: 'var(--success)' }}>✓ Custom match active:</strong>{' '}
                    <span>{trackMatches[musicTrackKey(inspectingTrack)].title}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--danger)' }}
                    onClick={() => {
                      setTrackMatches((prev) => {
                        const copy = { ...prev };
                        delete copy[musicTrackKey(inspectingTrack)];
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
                    const isSelected = trackMatches[musicTrackKey(inspectingTrack)]?.youtubeUrl === c.youtubeUrl;
                    return (
                      <div
                        key={c.id || idx}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                          background: isSelected ? 'rgba(0, 240, 255, 0.08)' : 'var(--bg-subtle, rgba(255,255,255,0.02))',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        {c.thumbnail ? (
                          <img src={c.thumbnail} alt="" style={{ width: 44, height: 44, borderRadius: 'var(--radius-sm)', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                              <span className="badge" style={{ fontSize: '0.68rem', padding: '1px 5px', background: 'rgba(57, 255, 156, 0.15)', color: 'var(--success)' }}>
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

    </div>
  );
}
