import React, { useState } from 'react';
import { Rows3, Rows4 } from 'lucide-react';
import { getEffectiveDensity, setDensity } from '../density.js';

export default function DensityToggle() {
  const [density, setDensityState] = useState(getEffectiveDensity);

  function toggle() {
    const next = density === 'compact' ? 'comfortable' : 'compact';
    setDensity(next);
    setDensityState(next);
  }

  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={toggle}
      title={density === 'compact' ? 'Switch to comfortable spacing' : 'Switch to compact spacing'}
    >
      {density === 'compact' ? <Rows4 size={15} /> : <Rows3 size={15} />}
      {density === 'compact' ? 'Compact' : 'Cozy'}
    </button>
  );
}
