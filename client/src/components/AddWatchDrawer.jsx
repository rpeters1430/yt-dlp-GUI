import React, { useState } from 'react';
import Drawer from './Drawer.jsx';
import { Segmented } from './DownloadOptionsFields.jsx';
import { api } from '../api.js';
import { useStaging } from '../context/StagingContext.jsx';
import { normalizeUrl } from './DownloadOptionsFields.jsx';

const BACKFILL = [
  { value: 'all', label: 'Download all' },
  { value: 50, label: 'Newest 50' },
  { value: 0, label: 'Only new' },
];
const INTERVALS = [
  { value: 60, label: '1h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: '24h' },
];

// Quick "Add watch": a link plus two choices. Quality, file type and the rest come from the
// download defaults; "More options" opens the full form.
export default function AddWatchDrawer({ open, onClose, onCreated, onAdvanced }) {
  const { defaults } = useStaging();
  const [url, setUrl] = useState('');
  const [backfill, setBackfill] = useState('all');
  const [checkEvery, setCheckEvery] = useState(360);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function close() {
    setError('');
    onClose();
  }

  async function submit(e) {
    e?.preventDefault();
    const target = normalizeUrl(url);
    if (!/^https?:\/\//i.test(target)) {
      setError('Paste a channel or playlist link.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const info = await api.inspectWatch(target);
      if (!info?.isChannel && !info?.isPlaylist) {
        throw new Error('That link is a single video, not a channel or playlist. Paste it on Home to download it.');
      }
      const created = await api.addWatch({
        url: target,
        name: info?.title || null,
        channelName: info?.channelName || info?.uploader || null,
        thumbnail: info?.thumbnail || null,
        backfillCount: backfill,
        checkIntervalMins: checkEvery,
        audioOnly: defaults.audioOnly,
        quality: defaults.quality,
        container: defaults.container,
        subtitles: defaults.subtitles,
        subLangs: defaults.subLangs,
        embedThumbnail: defaults.embedThumbnail,
        embedMetadata: defaults.embedMetadata,
        embedChapters: defaults.embedChapters,
        sponsorblock: defaults.sponsorblock,
        sponsorblockCategories: defaults.sponsorblock ? defaults.sponsorblockCategories : [],
      });
      onCreated(created);
      setUrl('');
      close();
    } catch (err) {
      setError(err.message || 'Could not add this watch');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      label="Add watch"
      footer={(
        <>
          <button type="button" className="text-btn" onClick={() => onAdvanced(normalizeUrl(url))}>More options</button>
          <button type="button" className="btn-primary btn-lg" onClick={submit} disabled={saving || !url.trim()}>
            {saving ? 'Starting…' : 'Start watching'}
          </button>
        </>
      )}
    >
      <h2 className="drawer-title">Add watch</h2>
      <p className="drawer-sub">A YouTube channel or playlist. New videos download automatically.</p>
      <form className="drawer-section dl-options" onSubmit={submit}>
        <div className="dl-options-group">
          <span className="field-caption">Link</span>
          <input
            className="mono"
            placeholder="youtube.com/@channel or a playlist link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
        </div>
        <div className="dl-options-group">
          <span className="field-caption">Videos already there</span>
          <Segmented className="seg-full" value={backfill} onChange={setBackfill} options={BACKFILL} />
        </div>
        <div className="dl-options-group">
          <span className="field-caption">Check for new videos</span>
          <div className="choice-grid choice-grid-4">
            {INTERVALS.map((o) => (
              <button key={o.value} type="button" className={`choice mono${checkEvery === o.value ? ' active' : ''}`} onClick={() => setCheckEvery(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <p className="field-hint">
          Quality, file type and filters use your download defaults. You can change them per watch later.
        </p>
        {error && <div className="notice notice-danger">{error}</div>}
      </form>
    </Drawer>
  );
}
