const STORAGE_KEY = 'ytdlp-gui-density';

export function getStoredDensity() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function applyDensity(density) {
  const root = document.documentElement;
  if (density === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');
}

export function setDensity(density) {
  try {
    if (density === 'compact') localStorage.setItem(STORAGE_KEY, density);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures (private browsing, etc.)
  }
  applyDensity(density);
}

export function getEffectiveDensity() {
  return getStoredDensity() === 'compact' ? 'compact' : 'comfortable';
}

export function initDensity() {
  applyDensity(getStoredDensity());
}
