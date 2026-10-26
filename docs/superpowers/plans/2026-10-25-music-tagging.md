# Standalone Music Tagging Implementation Plan

Goal: Download and tag catalog-selected music without requiring Lidarr, using free MusicBrainz metadata and the open-source Mutagen tag writer.

Architecture: Keep the existing iTunes catalog and add explicit MusicBrainz release search/selection. Normalize both into the same track schema. Write container-specific tags with Mutagen on a temporary copy, read them back, then publish into a collision-safe library path. Preserve download job metadata and source provenance. Existing libraries are not reorganized automatically.

Implementation choices: MusicBrainz public read API (no key, serialized requests and identifying user agent); Mutagen (Debian python3-mutagen package); FFmpeg remains responsible for extraction. Existing naming stays the default, with optional year/edition naming. Release IDs are only assigned to explicitly selected MusicBrainz tracklists. No paid services, credentials, or silent fuzzy identity assignment.

- [x] Add MusicBrainz client and release normalization; fixture tests for multi-disc totals, artist credits and IDs, error/invalid-ID handling.
- [x] Add atomic Mutagen tagging with verified readback for MP3/M4A/FLAC/Opus/Ogg/WAV; real generated audio fixtures, artwork and preservation tests; Docker and CI dependencies.
- [x] Fix multi-disc UI keys/totals, add source selection and configurable naming, preserve all normalized metadata through enqueue.
- [x] Add confidence gating and version checks; exact-version duplicate checks; reject poor automatic fallbacks.
- [x] Add staging/import with collision protection, persistent provenance and reusable staged audio after tagging failure; make queue fail rather than report false success.
- [x] Update watch metadata handling and album completion checks; exercise queue integration.
- [x] Run server/client tests, lint, production build and review diff; commit and prepare draft PR.

Review focus: repeated track numbers across discs; wrong live/remaster audio; source or MusicBrainz outage; process failure during tagging; pre-existing files and simultaneous imports. Never replace an existing library track automatically.

Deferred: automatic retag/reorganization of existing libraries, fingerprint/AcoustID matching, catalog-based release monitoring. These need separate user workflows rather than silently changing files.
