# Standalone music downloads and tagging

Music can now be managed here without a Lidarr server. No paid tagging service or API key is required.

## Free components

- **MusicBrainz**: public release search and selected-release tracklists, credits, dates and identifiers. Requests are cached, serialized at no more than one per 1.1 seconds and identify the application. Its public API is free for non-commercial use; commercial deployments must check MusicBrainz's service terms.
- **Cover Art Archive**: optional release artwork. Missing artwork does not prevent downloading the release.
- **Mutagen**: open-source container-aware tags and artwork for MP3, M4A, FLAC, Opus, Ogg and WAV. Installed by Docker and CI as `python3-mutagen`.
- **yt-dlp and FFmpeg**: audio acquisition and extraction. Tags are written without re-encoding audio. Converting a lossy stream to FLAC does not make the source lossless.

## Setup

1. Open **Music → Settings**. Choose **Manage tags and library here** for standalone imports. Existing installations with Lidarr enabled retain Lidarr handoff until explicitly changed.
2. Choose the music directory and output format. Opus/M4A native options avoid conversion when a compatible source stream is available.
3. Choose classic naming or release naming. Release naming includes year, edition and the selected MusicBrainz release ID, with separate disc folders. Naming changes affect new downloads only.
4. Choose embedded artwork and separate cover images independently.
5. In **Search**, choose **MusicBrainz releases**, search an artist and album, and select the correct release by date, country and edition. Apple catalog searches remain available.
6. Review uncertain audio matches with the existing source-selection dialog. Automatic matching rejects unrelated titles/artists, incompatible version labels and large duration differences. It remains heuristic, not audio fingerprint identification.

## Reliability and data

Standalone files download into `<music directory>/.staging/<job>/`. Mutagen edits a sibling temporary copy and reopens it to verify all requested tags and artwork. Only verified files are published to the final library. Configure music servers to ignore `.staging` or exclude that folder explicitly; this app only requests scans after verified imports, but cannot control an external real-time watcher.

A failed tag/import job stays failed with its saved audio available for the existing **Retry** action. Retry reuses staged audio; a persisted import checkpoint also avoids re-downloading after a restart. The import never replaces a different file at the destination. Matching bytes allow an interrupted import to resume. The original source sidecar is retained on repeated imports.

Each standalone imported song has an `<audio filename>.source.json` sidecar with source URL, metadata, tag verification and SHA-256. Download rows persist selected metadata and batch IDs. Removing an audio file through the app also removes its provenance sidecar; shared album covers are retained.

Album requests are tracked as persistent batches. App-requested media scans and Lidarr imports wait until enqueueing has finished and every requested song has completed. A failed match, failed download or failed tag prevents a batch from being reported ready. Successful files remain available; an enqueue failure requires selecting/retrying the missing track manually. Library badges may use broad album summaries, but per-track automatic skipping uses exact titles, album names and supplied disc/track numbers.

Music watches use extractor-supplied music fields and the same verified tag writer; they do not invent MusicBrainz IDs. A watch metadata lookup failure fails the job instead of bypassing tagging. Direct playlists preserve playlist name and position as provenance, rather than inventing a common album/artist. They do not yet export an M3U playlist.

For a non-Docker installation, install Python 3 and Mutagen (for example `python3 -m pip install mutagen`). `PYTHON_BIN` can select a Python interpreter with Mutagen installed.

## Limits

Existing libraries are not automatically retagged or renamed. Fingerprint/AcoustID matching, an existing-library metadata editor, automatic quality upgrades and catalog-based release monitoring are future work. Artwork fetch failures are optional; they can produce a correctly tagged file without a cover. This implementation does not guarantee that a YouTube source is the exact master of a selected catalog release.
