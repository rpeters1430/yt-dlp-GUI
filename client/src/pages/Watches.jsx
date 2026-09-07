import React, { useEffect, useState } from 'react';
import { Radar, RefreshCw, X, AlertCircle } from 'lucide-react';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

export default function Watches() {
  const [watches, setWatches] = useState([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [audioOnly, setAudioOnly] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { id, label }

  function refresh() {
    api.listWatches().then(setWatches).catch(() => {});
  }

  useEffect(refresh, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await api.addWatch({ url, name, audioOnly });
      setUrl('');
      setName('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDelete(id, label) {
    setPendingDelete({ id, label });
  }

  async function confirmDelete() {
    const { id } = pendingDelete;
    setPendingDelete(null);
    await api.deleteWatch(id);
    refresh();
  }

  async function handleCheckNow(id) {
    setBusyId(id);
    try {
      await api.checkWatch(id);
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Watches</h1>
          <p>Auto-monitor playlists and channels for new uploads.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Watch a playlist or channel</h2>
        </div>
        <p className="panel-description">
          Checked automatically every 30 minutes for new videos. The first check only records
          existing videos — it won't bulk-download the whole back catalog.
        </p>
        <form onSubmit={handleAdd} className="watch-form">
          <input placeholder="Playlist or channel URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="checkbox-label">
            <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} />
            Audio only
          </label>
          <button type="submit" disabled={!url.trim()}>Add watch</button>
        </form>
        {error && <div className="alert alert-error"><AlertCircle size={15} />{error}</div>}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Watched sources</h2>
          {watches.length > 0 && <span className="count-badge">{watches.length}</span>}
        </div>
        {watches.length === 0 ? (
          <div className="empty-state">
            <Radar size={30} />
            <span className="empty-title">No watches yet</span>
            <span className="empty-subtitle">Add a playlist or channel URL above to start monitoring it.</span>
          </div>
        ) : (
          <div className="watch-list">
            {watches.map((w) => (
              <div key={w.id} className="watch-item">
                <div className="watch-item-body">
                  <div className="watch-icon"><Radar size={17} /></div>
                  <div>
                    <div className="watch-item-title">{w.name || w.url}</div>
                    <div className="watch-item-url">{w.url}</div>
                    <div className="muted small">
                      Last checked: {w.last_checked_at ? new Date(w.last_checked_at + 'Z').toLocaleString() : 'never'}
                    </div>
                    {w.last_status === 'error' && (
                      <div className="alert alert-error" style={{ marginTop: 6 }}>
                        <AlertCircle size={13} />
                        Last check failed: {w.last_error || 'unknown error'}
                      </div>
                    )}
                  </div>
                </div>
                <div className="watch-actions">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => handleCheckNow(w.id)} disabled={busyId === w.id}>
                    <RefreshCw size={13} className={busyId === w.id ? 'spin-icon' : undefined} />
                    {busyId === w.id ? 'Checking…' : 'Check now'}
                  </button>
                  <button className="icon-btn" onClick={() => handleDelete(w.id, w.name || w.url)} title="Remove"><X size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove watch"
        message={`Remove watch "${pendingDelete?.label}"? This won't affect videos already downloaded.`}
        confirmLabel="Remove"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
