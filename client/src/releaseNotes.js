export const RELEASE_NOTES_DISMISSAL_KEY = 'yt-dlp-gui.dismissed-release-revision';

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function shouldShowReleaseNotes(metadata, storage = browserStorage()) {
  if (!metadata || typeof metadata !== 'object') return false;
  const { revision, notes } = metadata;
  if (typeof revision !== 'string' || !revision.trim()) return false;
  if (typeof notes !== 'string' || !notes.trim()) return false;
  try {
    return storage?.getItem(RELEASE_NOTES_DISMISSAL_KEY) !== revision;
  } catch {
    return true;
  }
}

export function dismissReleaseNotes(revision, storage = browserStorage()) {
  try {
    storage?.setItem(RELEASE_NOTES_DISMISSAL_KEY, revision);
  } catch {
    // Storage may be disabled; the dialog can still be dismissed for this session.
  }
}
