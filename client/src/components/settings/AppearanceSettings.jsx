import React, { useState } from 'react';
import { Segmented } from '../DownloadOptionsFields.jsx';
import { SettingRow } from './DownloadsSettings.jsx';
import { getScanlines, setScanlines } from '../../theme.js';
import { getEffectiveDensity, setDensity } from '../../density.js';

// Scanline overlay and density.
export default function AppearanceSettings() {
  const [scanlines, setScanlinesState] = useState(getScanlines);
  const [density, setDensityState] = useState(getEffectiveDensity);

  return (
    <div className="setting-rows">
      <SettingRow label="Scanlines" description="Faint CRT lines over the whole screen">
        <Segmented
          size="sm"
          value={scanlines ? 'on' : 'off'}
          onChange={(v) => { setScanlines(v === 'on'); setScanlinesState(v === 'on'); }}
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
        />
      </SettingRow>
      <SettingRow label="Density" description="Compact fits more rows on screen">
        <Segmented
          size="sm"
          value={density === 'compact' ? 'compact' : 'comfortable'}
          onChange={(v) => { setDensity(v); setDensityState(v); }}
          options={[{ value: 'comfortable', label: 'Cozy' }, { value: 'compact', label: 'Compact' }]}
        />
      </SettingRow>
    </div>
  );
}
