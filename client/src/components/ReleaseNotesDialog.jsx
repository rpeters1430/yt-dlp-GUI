import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { dismissReleaseNotes, shouldShowReleaseNotes } from '../releaseNotes.js';
import ReleaseNotesMarkdown from './ReleaseNotesMarkdown.js';
import './ReleaseNotesDialog.css';

export default function ReleaseNotesDialog() {
  const [release, setRelease] = useState(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    let active = true;
    api.getReleaseNotes()
      .then((metadata) => {
        if (active && shouldShowReleaseNotes(metadata)) setRelease(metadata);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!release || !dialog) return undefined;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [release]);

  function close() {
    if (release) dismissReleaseNotes(release.revision);
    setRelease(null);
  }

  if (!release) return null;
  return (
    <dialog
      ref={dialogRef}
      className="release-notes-dialog"
      aria-labelledby="release-notes-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
    >
      <header className="release-notes-header">
        <div>
          <p className="release-notes-eyebrow">Updated image</p>
          <h2 id="release-notes-title">What’s new{release.version ? ` in ${release.version}` : ''}</h2>
        </div>
        <button ref={closeRef} className="release-notes-close" type="button" onClick={close} aria-label="Close release notes">
          Close
        </button>
      </header>
      <div className="release-notes-content">
        <ReleaseNotesMarkdown>{release.notes}</ReleaseNotesMarkdown>
      </div>
      <p className="release-notes-revision">Revision {release.revision.slice(0, 12)}</p>
    </dialog>
  );
}
