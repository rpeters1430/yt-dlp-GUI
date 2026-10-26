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

Existing files can be reviewed and retagged individually using the Library tab. Automatic renaming, bulk retagging, quality upgrades and catalog-based release monitoring are not included. Artwork fetch failures are optional; they can produce a correctly tagged file without a cover. This implementation does not guarantee that a YouTube source is the exact master of a selected catalog release.


## Review existing music

Open **Music → Library** to browse the configured music directory. The browser is bounded to 200 audio files and 3,000 directory entries per request; enter an artist/album subfolder for a large collection. Hidden folders, staging, backups and symlinks are excluded.

Select a file to inspect its current tags. Choose Apple catalog or MusicBrainz, select a release and a track, then **Preview changes**. Apple lookups and previews do not require MusicBrainz. Apple track IDs are kept separate from MusicBrainz identifiers. Review the before/after tags and use **Apply reviewed tags** to write only those reviewed changes. Unrelated comments, artwork and other metadata are preserved. Standard MusicBrainz ID3 UFIDs are read correctly. Choosing another release clears obsolete recording identifiers/ISRCs when the selected release does not provide replacements. Existing filenames are never changed.

Previews expire after 24 hours. A changed file or changed music root invalidates the preview. Every apply retains the original audio at `.tag-backups/<review ID>/original.<extension>`. Recent tag reviews provide **Restore original**, which is allowed only while the current file still matches the trusted output revision. Newer external edits are not accepted as this app's output. Updates and restores schedule configured Jellyfin/Plex library refreshes.

Exclude `.tag-backups` as well as `.staging` from media-server scanning. Backups are not deleted automatically; they take space equal to the original files. Remove an old review's backup folder manually only after you no longer need restore.

If a process stops after the file is replaced but before the review database records the result, the review remains `applying` and automatic restore is intentionally unavailable. Inspect the current file and recover the retained original backup manually; the app cannot safely infer whether another editor has changed the new file.

## Optional audio fingerprint identification

Chromaprint's `fpcalc` is included in the Docker image as `libchromaprint-tools`. Native installations must install that package or provide `FPCALC_BIN`.

Expand **Optional audio identification** in the Library tab and enter a free **AcoustID application key**, obtained from https://acoustid.org/new-application. This is the application/client key, not a personal fingerprint-submission user key. Alternatively supply `ACOUSTID_CLIENT_KEY` through the container environment. The API returns only whether a key is configured; it never returns the key itself.

Select a song and press **Identify audio with AcoustID**. The app computes a local fingerprint and sends only that fingerprint and the duration to AcoustID. Requests are serialized at no more than one per 400 ms. It does not upload the music file or submit new fingerprints. Suggested recordings and releases require your selection and the same tag preview/apply workflow. A fingerprint score does not establish an exact release edition or master.

Manual Apple/MusicBrainz release selection requires no AcoustID key and works independently of the fingerprint service.

### Selective tag updates and album review

In **Music → Library**, a preview shows current and catalog values with a choice for each field:

- **Keep current** leaves the stored tag untouched. Existing genre, ISRC and MusicBrainz IDs default to Keep, including when Apple does not provide a replacement.
- **Replace with catalog** writes the value from the selected release/track. Missing catalog values cannot be selected as replacements.
- **Clear tag** explicitly removes the field. Clearing a track/disc number also selects its total for clearing because those values share storage in some formats. Clearing only a total preserves its number.

Review identifiers when changing editions: retained IDs can refer to the old release. The preview does not verify previously stored identifiers. Artwork, comments, lyrics, ratings and ReplayGain remain untouched by this workflow. Preview field names are logical names; the writer maps them to ID3, MP4 atoms or Vorbis comments for the file type. Fresh previews are required for reviews created before field choices were supported.

For an album, browse its subfolder, select 2–50 files with the checkboxes and choose **Review selected album files**. Select a catalog release and map every file to a different track, then **Preview album changes**. Nothing is tagged until **Apply reviewed album tags**. Every file has independent choices, verification, backup and restore history. The operation is sequential, not an atomic album transaction: successful files remain saved if another fails. Correct the cause and preview again before retrying; already saved files are skipped while the current batch remains open. Closing the drawer does not undo saved files; use Recent tag reviews to restore them individually. Existing file names are unchanged.
