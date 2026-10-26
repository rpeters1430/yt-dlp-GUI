# Existing music metadata review and fingerprint identification

Goal: continue the standalone music plan with a reviewable existing-library tag editor and optional free audio identification.

Design: browse only the configured music directory; never follow symlinks or scan staging/backup folders. Inspect a selected file with Mutagen, choose a MusicBrainz release/track, show a persisted before/after preview, then apply only that preview. Match the file SHA-256 before writing, retain an original backup, preserve unrelated metadata, and support restore only while the current file matches the applied revision. No automatic renaming or bulk retagging in this increment.

Free identification: package Chromaprint/fpcalc and query AcoustID only when requested. The app stores a user-provided free AcoustID application key, never returns the key, and sends only duration/fingerprint. Identification suggests recordings/releases; it never auto-writes tags. MusicBrainz manual selection works without this key.

Implementation:
- [x] Extend the Mutagen helper with read-only inspection, preservation mode, explicit field clearing and revision guards; test with real audio and unrelated tags.
- [x] Add bounded library browsing, persisted review previews, hash-guarded apply, original backups, and guarded restore; test path traversal/symlinks, changed files and recovery behavior.
- [x] Add Chromaprint/AcoustID service, timeout/rate limit, redacted key settings and fixture-based API tests; package fpcalc in Docker.
- [x] Add authenticated routes and mobile-friendly Library tab for inspect, search/choose release/track, preview, apply, restore and identify.
- [x] Run server/client suites, lint/build and independent review; commit and open a draft PR.

Limits: no existing-file renaming, background fingerprinting, automatic paid services, or automatic metadata assignment. Backups stay under .tag-backups until manually removed. Native clients must install Mutagen and fpcalc. Actual NAS library files are untouched during development.
