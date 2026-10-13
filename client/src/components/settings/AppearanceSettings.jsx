import React, { useState } from 'react';
import { Segmented } from '../DownloadOptionsFields.jsx';
import { SettingRow } from './DownloadsSettings.jsx';
import { getStoredTheme, setTheme } from '../../theme.js';
import { getEffectiveDensity, setDensity } from '../../density.js';

// Theme and density, moved here from the old sidebar footer.
export default function AppearanceSettings() {
  const [theme, setThemeState] = useState(() => getStoredTheme() || 'system');
  const [density, setDensityState] = useState(getEffectiveDensity);

  return (
    <div className="setting-rows">
      <SettingRow label="Theme" description="System follows your device's light or dark setting">
        <Segmented
          size="sm"
          value={theme}
          onChange={(v) => { setTheme(v === 'system' ? null : v); setThemeState(v); }}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'midnight', label: 'Midnight' },
            { value: 'light', label: 'Light' },
          ]}
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
