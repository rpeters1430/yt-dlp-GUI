// The app has one look; the only appearance choice left is the CRT scanline overlay.
const SCANLINES_KEY = 'ytdlp-gui-scanlines';

export function getScanlines() {
  try {
    return localStorage.getItem(SCANLINES_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function applyScanlines(on) {
  document.documentElement.setAttribute('data-scanlines', on ? 'on' : 'off');
}

export function setScanlines(on) {
  try {
    if (on) localStorage.removeItem(SCANLINES_KEY);
    else localStorage.setItem(SCANLINES_KEY, 'off');
  } catch {
    // ignore storage failures (private browsing, etc.)
  }
  applyScanlines(on);
}

export function initTheme() {
  try {
    // Leftover from the old light/dark/midnight picker.
    localStorage.removeItem('ytdlp-gui-theme');
  } catch {
    // ignore
  }
  applyScanlines(getScanlines());
}
