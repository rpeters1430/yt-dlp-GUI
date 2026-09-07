import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Watches() {
  const [watches, setWatches] = useState([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [audioOnly, setAudioOnly] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

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

  async function handleDelete(id) {
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
    <div>
      <section className="panel">
        <h2>Watch a playlist or channel</h2>
        <p className="muted">Checked automatically every 30 minutes for new videos. The first check only records existing videos — it won't bulk-download the whole back catalog.</p>
        <form onSubmit={handleAdd} className="watch-form">
          <input placeholder="Playlist or channel URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <label>
            <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} />
            Audio only
          </label>
          <button type="submit" disabled={!url.trim()}>Add watch</button>
        </form>
        {error && <div className="error-text">{error}</div>}
      </section>

      <section className="panel">
        <h2>Watched sources</h2>
        {watches.length === 0 && <p className="muted">No watches yet.</p>}
        {watches.map((w) => (
          <div key={w.id} className="watch-item">
            <div>
              <div className="queue-item-title">{w.name || w.url}</div>
              <div className="muted small">{w.url}</div>
              <div className="muted small">
                Last checked: {w.last_checked_at ? new Date(w.last_checked_at + 'Z').toLocaleString() : 'never'}
              </div>
            </div>
            <div className="watch-actions">
              <button onClick={() => handleCheckNow(w.id)} disabled={busyId === w.id}>
                {busyId === w.id ? 'Checking…' : 'Check now'}
              </button>
              <button className="icon-btn" onClick={() => handleDelete(w.id)}>✕</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
