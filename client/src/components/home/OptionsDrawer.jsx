import React, { useState } from 'react';
import Drawer from '../Drawer.jsx';
import Art from '../Art.jsx';
import DownloadOptionsFields, { capsFromUrl, capsForItem, mergeCapabilities } from '../DownloadOptionsFields.jsx';
import { useStaging } from '../../context/StagingContext.jsx';
import { formatDuration } from '../../format.js';

function liveInfoOf(info) {
  return info?.liveStatus ? { liveStatus: info.liveStatus, offline: !!info.offline } : null;
}

// Per-link options ('item' mode) or the defaults every new link starts with ('defaults').
// Edits are local until "Save options".
export default function OptionsDrawer({ mode, itemId, onClose, onSaved }) {
  const { staged, defaults, setDefaults, update } = useStaging();
  const item = mode === 'item' ? staged.find((it) => it.id === itemId) : null;
  const [values, setValues] = useState(() => ({ ...(item?.opts || defaults) }));
  const [applyAll, setApplyAll] = useState(false);
  const open = mode === 'defaults' || !!item;

  function save() {
    if (mode === 'defaults') {
      setDefaults(values);
      // Links still on defaults pick the new ones up; customized links keep theirs.
      onSaved?.('Defaults saved');
    } else if (applyAll) {
      for (const it of staged) update(it.id, { opts: { ...values } });
      onSaved?.(`Options applied to ${staged.length} links`);
    } else {
      update(item.id, { opts: { ...values } });
      onSaved?.('Options saved');
    }
    onClose();
  }

  const info = item?.info;
  const caps = item
    ? (applyAll ? mergeCapabilities(staged.map((it) => (it.info ? capsForItem({ url: it.url, data: it.info }) : capsFromUrl(it.url)))) : capsForItem({ url: item.url, data: info }))
    : null;
  const sub = info ? [info.uploader, info.duration ? formatDuration(info.duration) : null, info.highestQuality ? `best ${info.highestQuality}` : null].filter(Boolean).join(' · ') : '';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      label={mode === 'defaults' ? 'Download defaults' : 'Download options'}
      header={mode === 'item' ? <Art src={info?.thumbnail} className="drawer-art" ratio="auto" label="video thumbnail" /> : null}
      footer={(
        <>
          {mode === 'item' && staged.length > 1 ? (
            <label className="check">
              <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
              <span>Apply to all <span className="mono">{staged.length}</span> links</span>
            </label>
          ) : <span />}
          <button type="button" className="btn-primary btn-lg" onClick={save}>Save options</button>
        </>
      )}
    >
      {mode === 'defaults' ? (
        <>
          <h2 className="drawer-title">Download defaults</h2>
          <p className="drawer-sub">Every link you analyze starts with these. You can still change them per link.</p>
        </>
      ) : (
        <>
          <h2 className="drawer-title">{info?.title || item?.url}</h2>
          {sub && <p className="drawer-sub">{sub}</p>}
        </>
      )}
      <DownloadOptionsFields
        values={values}
        onChange={setValues}
        caps={caps}
        liveInfo={mode === 'item' && !applyAll ? liveInfoOf(info) : null}
      />
    </Drawer>
  );
}
