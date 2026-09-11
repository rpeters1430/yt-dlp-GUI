import React, { useEffect, useState } from 'react';
import { X, Download, Film, Loader2, Archive, ExternalLink, AlertCircle, Shield, ShieldOff } from 'lucide-react';
import { api } from '../api.js';
import { useModalA11y } from '../hooks/useModalA11y.js';

export default function WatchDownloadsModal({
  open,
  watch,
  onClose,
}) {
  const containerRef = useModalA11y(open, onClose);
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !watch) return;
    setLoading(true);
    setError('');
    api.getWatchDownloads(watch.id)
      .then(setDownloads)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, watch]);

  async function handleToggleProtect(download) {
    try {
      const updated = await api.toggleDownloadProtect(download.id, !download.protected);
      setDownloads((prev) => prev.map((d) => (d.id === download.id ? updated : d)));
    } catch (err) {
      console.error('Failed to toggle protection:', err);
    }
  }

  if (!open || !watch) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={containerRef}
        className="modal-container preview-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <Download size={18} className="text-accent" />
            <span>Downloads from "{watch.name || watch.channel_name || watch.url}"</span>
          </div>
          <button type="button" className="icon-btn-neutral" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="empty-state">
              <Loader2 size={24} className="spin-icon text-accent" />
              <span className="empty-subtitle">Loading download history…</span>
            </div>
          ) : error ? (
            <div className="alert alert-error">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          ) : downloads.length === 0 ? (
            <div className="empty-state">
              <Archive size={32} />
              <span className="empty-title">No downloads yet</span>
              <span className="empty-subtitle">
                Videos auto-downloaded by this watch will be listed here.
              </span>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="watch-downloads-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Downloaded</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {downloads.map((d) => (
                    <tr key={d.id}>
                      <td style={{ width: 48 }}>
                        {d.thumbnail ? (
                          <img className="thumb-sm" src={d.thumbnail} alt="" />
                        ) : (
                          <div className="thumb-sm thumb-empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Film size={12} />
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>
                          {d.title || d.url}
                        </div>
                        {d.filepath && (
                          <div className="muted small" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                            {d.filepath}
                          </div>
                        )}
                        {d.error && (
                          <div className="muted small" style={{ color: 'var(--danger)', fontSize: 11 }}>
                            {d.error}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`tag status-tag status-${d.status}`}>{d.status}</span>
                      </td>
                      <td className="muted small" style={{ whiteSpace: 'nowrap' }}>
                        {new Date(d.created_at + 'Z').toLocaleDateString()}
                      </td>
                      <td style={{ width: 40 }}>
                        {d.status === 'completed' && (
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => handleToggleProtect(d)}
                            title={d.protected ? 'Protected from auto-delete — click to allow it again' : 'Protect this video from auto-delete'}
                          >
                            {d.protected ? <Shield size={14} /> : <ShieldOff size={14} />}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
