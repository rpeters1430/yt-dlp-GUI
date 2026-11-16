import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, ExternalLink, Search, Youtube } from 'lucide-react';
import { api } from '../api.js';
import { formatDuration } from '../format.js';
import { useStaging } from '../context/StagingContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

function statusLabel(status) {
  if (status === 'completed') return 'Already downloaded';
  if (status === 'queued' || status === 'downloading') return status === 'queued' ? 'In queue' : 'Downloading';
  if (status === 'failed') return 'Previously failed';
  return '';
}

export default function Discover() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { analyze } = useStaging();
  const toast = useToast();

  async function search(e) {
    e.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) return;
    setLoading(true);
    setError('');
    setSearchedQuery(cleanQuery);
    try {
      const response = await api.searchYouTube(cleanQuery);
      setResults(response.results || []);
    } catch (err) {
      setResults([]);
      setError(err.message || 'YouTube search failed.');
    } finally {
      setLoading(false);
    }
  }

  function stageVideo(video) {
    const added = analyze(video.url);
    if (added) {
      toast('Added to the download tray for review.');
      navigate('/');
    } else {
      toast('This video is already in the download tray.');
    }
  }

  function watchChannel(video) {
    if (!video.channelUrl) return;
    navigate(`/watches?add=${encodeURIComponent(video.channelUrl)}`);
  }

  return (
    <div className="discover-page">
      <div className="page-title-row">
        <div>
          <h1><Youtube size={22} /> Discover on YouTube</h1>
          <p className="page-subtitle">Find videos, see what is already in your library, then send a video to the download tray or start watching its channel.</p>
        </div>
      </div>

      <form className="discover-search" onSubmit={search}>
        <Search size={18} aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YouTube videos…"
          aria-label="Search YouTube videos"
          maxLength={200}
        />
        <button className="btn-primary" type="submit" disabled={loading || !query.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <div className="notice notice-danger discover-message">{error}</div>}
      {!loading && searchedQuery && !error && results.length === 0 && (
        <div className="empty-state"><Search size={24} /><p>No videos found for “{searchedQuery}”.</p></div>
      )}
      {loading && (
        <div className="discover-loading"><div className="spinner" /><span>Searching YouTube for “{searchedQuery}”</span></div>
      )}

      {results.length > 0 && (
        <>
          <div className="discover-results-heading">
            <h2>Results</h2>
            <span>{results.length} videos · “{searchedQuery}”</span>
          </div>
          <div className="discover-grid">
            {results.map((video) => {
              const label = statusLabel(video.downloadStatus);
              return (
                <article className="discover-card" key={video.id || video.url}>
                  <a className="discover-art" href={video.url} target="_blank" rel="noreferrer" aria-label={`Open ${video.title} on YouTube`}>
                    {video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" /> : <div className="discover-art-empty"><Youtube size={26} /></div>}
                    {video.duration != null && <span className="discover-duration">{formatDuration(video.duration)}</span>}
                  </a>
                  <div className="discover-card-body">
                    <a className="discover-title" href={video.url} target="_blank" rel="noreferrer">{video.title || 'Untitled video'} <ExternalLink size={12} /></a>
                    <div className="discover-channel">{video.uploader || 'Unknown channel'}</div>
                    {label && <span className={`discover-status${video.downloadStatus === 'completed' ? ' complete' : ''}`}>{label}</span>}
                    <div className="discover-actions">
                      <button type="button" className="btn-primary btn-sm" onClick={() => stageVideo(video)}>
                        <ArrowDownToLine size={14} /> Add to tray
                      </button>
                      {video.channelUrl && (
                        <button type="button" className="btn-ghost btn-sm" onClick={() => watchChannel(video)}>
                          Watch channel
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
