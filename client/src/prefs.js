// Per-browser UI preferences that aren't worth a server round-trip.
const AUTO_ANALYZE_KEY = 'ytdlp-gui-auto-analyze';

export function getAutoAnalyzeOnPaste() {
  try {
    return localStorage.getItem(AUTO_ANALYZE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAutoAnalyzeOnPaste(on) {
  try {
    if (on) localStorage.setItem(AUTO_ANALYZE_KEY, '1');
    else localStorage.removeItem(AUTO_ANALYZE_KEY);
  } catch {
    // ignore storage failures (private browsing, etc.)
  }
}

const DOWNLOAD_DEFAULTS_KEY = 'ytdlp-gui-download-defaults';

// The options a newly analyzed link starts with (quality, file type, embeds, ...), edited
// from Home's "Defaults" drawer and Settings > Downloads.
export function getStoredDownloadDefaults() {
  try {
    const raw = localStorage.getItem(DOWNLOAD_DEFAULTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function storeDownloadDefaults(values) {
  try {
    localStorage.setItem(DOWNLOAD_DEFAULTS_KEY, JSON.stringify(values));
  } catch {
    // ignore storage failures (private browsing, etc.)
  }
}
