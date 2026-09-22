import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download, Clock, Loader2, CheckCircle2, ChevronDown, ListChecks, ArrowRight, Activity,
} from 'lucide-react';
import { useDownloads } from '../context/DownloadsContext.jsx';

export default function QueueStatusWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  const {
    activeJobs,
    downloadingJobs,
    queuedJobs,
    currentJob,
    hasActive,
    isDownloading,
  } = useDownloads();

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  function handleGoToDashboard() {
    setIsOpen(false);
    navigate('/');
  }

  const percent = currentJob && typeof currentJob.percent === 'number' ? Math.round(currentJob.percent) : null;
  const speed = currentJob && currentJob.speed ? currentJob.speed : null;
  const eta = currentJob && currentJob.eta ? currentJob.eta : null;

  return (
    <div className="topbar-queue-widget" ref={containerRef}>
      <button
        type="button"
        className={`topbar-queue-btn${hasActive ? ' active' : ' idle'}${isOpen ? ' open' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        title={
          hasActive
            ? `${activeJobs.length} item(s) in queue. Click to inspect.`
            : 'Queue idle. Click to view dashboard.'
        }
      >
        {hasActive ? (
          <>
            <span className="queue-live-indicator">
              <span className="queue-live-ping" />
              <span className="queue-live-dot" />
            </span>
            {isDownloading ? (
              <Download size={14} className="queue-icon-active" />
            ) : (
              <Clock size={14} className="queue-icon-waiting" />
            )}
            <span className="queue-btn-status-label">
              {isDownloading ? (
                <>
                  <span className="queue-btn-main-text">Downloading</span>
                  {percent !== null && percent > 0 && (
                    <span className="queue-btn-percent">{percent}%</span>
                  )}
                </>
              ) : (
                <span className="queue-btn-main-text">Queued</span>
              )}
            </span>
            <span className="queue-btn-count-pill" title={`${activeJobs.length} total in queue`}>
              {activeJobs.length}
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 size={13} className="queue-icon-idle" />
            <span className="queue-btn-idle-label">Queue idle</span>
          </>
        )}
        <ChevronDown size={13} className={`queue-btn-chevron${isOpen ? ' rotated' : ''}`} />
      </button>

      {isOpen && (
        <div className="topbar-queue-popover" role="dialog" aria-label="Download queue overview">
          <div className="queue-popover-header">
            <div className="queue-popover-title-row">
              <span className="queue-popover-title">
                <ListChecks size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
                Queue Status
              </span>
              <span className={`count-badge${hasActive ? ' accent' : ''}`}>
                {activeJobs.length} in queue
              </span>
            </div>
            <p className="queue-popover-subtitle">
              {hasActive
                ? `${downloadingJobs.length} active · ${queuedJobs.length} waiting`
                : 'No active downloads in progress'}
            </p>
          </div>

          <div className="queue-popover-body">
            {hasActive ? (
              <>
                {downloadingJobs.length > 0 && (
                  <div className="queue-popover-section">
                    <div className="queue-popover-section-label">
                      <Activity size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                      Active Download{downloadingJobs.length > 1 ? 's' : ''}
                    </div>
                    {downloadingJobs.map((job) => {
                      const jobPercent = typeof job.percent === 'number' ? Math.round(job.percent) : 0;
                      return (
                        <div key={job.id} className="queue-popover-job-card">
                          <div className="queue-popover-job-title" title={job.title || job.url}>
                            {job.title || job.url}
                          </div>
                          <div className="queue-popover-progress-bar-wrap">
                            <div
                              className="queue-popover-progress-bar-fill"
                              style={{ width: `${Math.min(100, Math.max(0, jobPercent))}%` }}
                            />
                          </div>
                          <div className="queue-popover-job-meta">
                            <span className="queue-popover-percent">{jobPercent}%</span>
                            {job.speed && <span className="queue-popover-speed">{job.speed}</span>}
                            {job.eta && <span className="queue-popover-eta">ETA {job.eta}</span>}
                            {!job.speed && !job.eta && (
                              <span className="queue-popover-stage">{job.stage || 'Downloading…'}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {queuedJobs.length > 0 && (
                  <div className="queue-popover-section">
                    <div className="queue-popover-section-label">
                      <Clock size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                      Up Next ({queuedJobs.length})
                    </div>
                    <div className="queue-popover-waiting-list">
                      {queuedJobs.slice(0, 4).map((job, idx) => (
                        <div key={job.id} className="queue-popover-waiting-item">
                          <span className="queue-popover-waiting-pos">#{idx + downloadingJobs.length + 1}</span>
                          <span className="queue-popover-waiting-title" title={job.title || job.url}>
                            {job.title || job.url}
                          </span>
                          <span className="badge badge-queued">Queued</span>
                        </div>
                      ))}
                      {queuedJobs.length > 4 && (
                        <div className="queue-popover-more-hint">
                          +{queuedJobs.length - 4} more waiting in queue
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="queue-popover-empty">
                <CheckCircle2 size={24} className="queue-popover-empty-icon" />
                <div className="queue-popover-empty-title">All caught up!</div>
                <div className="queue-popover-empty-desc">
                  Any new downloads started from Dashboard, Music, Twitch, or Watches will show here in real time.
                </div>
              </div>
            )}
          </div>

          <div className="queue-popover-footer">
            <button
              type="button"
              className="btn-secondary btn-sm queue-popover-btn"
              onClick={handleGoToDashboard}
            >
              <span>View full Queue in Dashboard</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
