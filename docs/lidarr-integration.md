# Lidarr Integration (Indexer & Download Client)

This app can integrate directly with [Lidarr](https://lidarr.audio) to automatically search, download, tag, and import music into your Lidarr library. It acts as both a **Torznab Indexer** and a **Download Client** (through a limited qBittorrent Web API adapter).

---

## How It Works

1. **Torznab Indexer (`/api/lidarr/torznab` or `/api/torznab`)**:
   - Supports the standard Torznab specification (`t=caps`, `t=music`, `t=search`).
   - When Lidarr searches for an artist or album, our indexer searches album metadata from iTunes or the configured Lidarr catalog and returns Torznab RSS 2.0 XML with audio categories (`3000`, `3010`, `3040`).
   - Generates synthetic `.torrent` envelopes for this adapter with deterministic SHA-1 infohashes matching the download client tasks.

2. **Download Client Bridge (`/api/lidarr/qbit`)**:
   - **qBittorrent Web API emulation**: Emulates qBittorrent v2 Web API (`/api/v2/auth/login`, `/api/v2/app/version`, `/api/v2/torrents/add`, `/api/v2/torrents/info`).
   - When Lidarr sends a download task, all tracks for the release are resolved and enqueued into the download queue with high-bitrate encoding (OPUS, 320k MP3, M4A, FLAC) and embedded metadata and album art.
   - Reports live progress back to Lidarr as tracks complete. Once 100% finished, reports `state: pausedUP` with a zero seed goal and the storage path.
   - Lidarr's **Completed Download Handling** detects the completion, inspects the tags, and moves/imports the songs into your artist library.
   - Use qBittorrent in Lidarr. The legacy SABnzbd endpoints are not a native Usenet integration: Lidarr requires an NZB indexer and `addfile`, which this Torznab bridge does not provide.

3. **Lidarr Server REST API Client**:
   - When configured with your Lidarr Server URL and API key, the app can trigger Lidarr's `DownloadedAlbumsScan` after an app-initiated album folder has been quiet for 60 seconds. Lidarr-initiated grabs use Completed Download Handling instead.
   - You can also view and browse **Wanted / Missing Albums** from Lidarr directly inside the Music page and trigger searches/downloads with one click.

---

## Step-by-Step Configuration

In the app, open the **Music** page and click the **Lidarr** tab. Your unique Torznab API key and copy buttons are displayed there.

### 1. Add Indexer in Lidarr

1. In Lidarr, navigate to **Settings → Indexers**.
2. Click the **+** (Add) button and select **Torznab (Custom)**.
3. Configure the fields:
   - **Name**: `yt-dlp Music`
   - **URL**: `http://<your-server-ip>:3000/api/lidarr/torznab`
   - **API Key**: Copy your generated key from the Lidarr tab in the app.
   - **Categories**: `3000, 3010, 3040` (Audio).
4. Click **Test** (should show a green checkmark) and then **Save**.

### 2. Add Download Client in Lidarr

1. In Lidarr, navigate to **Settings → Download Clients**.
2. Click the **+** (Add) button and select **qBittorrent**.
3. Configure the fields:
   - **Name**: `yt-dlp GUI`
   - **Host**: `<your-server-ip>`
   - **Port**: `3000` (or your app's port)
   - **URL Base**: `/api/lidarr/qbit`
   - **Username**: Anything, e.g. `lidarr` (Lidarr skips logging in when it's blank, so it can't be empty).
   - **Password**: Your Torznab API key from the Lidarr tab in the app.
   - **Category**: `music`
6. Set **Initial State** to **Start**, and **Recent Priority / Older Priority** to **Last**. Pause and priority changes are not supported by the adapter. Enable **Use SSL** only when the app URL is HTTPS.
7. Ensure **Completed Download Handling** is enabled. Enable **Remove Completed** if you want Lidarr to clean up the finished downloads after import.
8. Click **Test** and then **Save**.

### Remote Path Mappings (Docker / Alpine)

The download client reports the download save path as an absolute Linux path (`/downloads/Music`), satisfying Linux and Alpine container path validation. If your Lidarr container has the shared download volume mounted at a different mount point (e.g. `/music` or `/data/downloads`), configure a Remote Path Mapping in Lidarr:

1. In Lidarr, navigate to **Settings → Download Clients**.
2. Scroll down to **Remote Path Mappings** and click **+** (Add).
3. Set:
   - **Host**: `<your-server-ip>` (e.g. `192.168.50.114`, matching the Host entered in your Download Client)
   - **Remote Path**: `/downloads/Music`
   - **Local Path**: The path inside Lidarr's container where incoming downloads appear (e.g. `/downloads` or `/downloads/Music`).
   > **Note**: Do **not** point Local Path to your Lidarr library Root Folder (e.g. `/music` or `/media/music`). Lidarr requires incoming downloads to be in a separate directory so it can import, rename, and move them into your library. If Lidarr only has your music folder mounted, point Local Path to a subfolder like `/music/Downloads`.
4. Click **Save**.



### 3. Connect Lidarr in yt-dlp GUI (Optional but Recommended)

In the app's **Music → Lidarr** tab:
1. Enter your **Lidarr Server URL** (e.g. `http://localhost:8686`).
2. Enter your **Lidarr API Key** (found in Lidarr: **Settings → General → Security → API Key**).
3. Enable **Automatically notify Lidarr when downloads finish**.
4. Click **Test Connection** and then **Save Lidarr Settings**.
5. You can now view missing/wanted albums from your Lidarr library directly within the app and queue them with one click!

## Troubleshooting

### Indexer or download client test fails with an authentication error

The indexer, `.torrent` download and SABnzbd endpoints require the Torznab API key, and the qBittorrent login requires it as the password. Setups made before this was enforced (blank qBittorrent username/password) need the username and password filled in as described in step 2. Until then Lidarr can't see the download client's queue, so nothing imports.

### "Downloaded - Unable to Import Automatically: Artist name mismatch"

Lidarr links a finished download to the release it grabbed by the torrent's infohash. Older versions of this integration reported a different hash to Lidarr's qBittorrent client, so Lidarr couldn't find the grab in its history and fell back to guessing the artist from the folder name. That is fixed: the mock qBittorrent client now reports the same infohash Lidarr computed from the `.torrent` file.

Downloads grabbed **before** the fix keep the old hash. For each one, either use **Manual Import** in Lidarr's Activity → Queue, or remove it from the queue (with "Remove from Client") and search for the album again.

"Automatically notify Lidarr when downloads finish" only applies to music you download from the app yourself. Lidarr imports its own grabs through the download client, so the app no longer sends a separate scan for those, and it waits for an album folder to stop changing (60 seconds) before asking Lidarr to scan it.

### Album search downloads only the title song, or a compilation has no results

Album searches now return matching album releases, rather than individual songs or similarly named live releases. Explicit `track` searches still support individual songs.

If an album is missing from the iTunes catalog, the indexer can use the album already added to Lidarr and download the complete track list from its selected (monitored) release. This requires the **Lidarr Server URL** and **Lidarr API Key** in Music → Lidarr to be configured. Multi-disc releases retain their disc and track numbers. Incomplete track lists fail rather than silently downloading a partial album.

After updating the container, remove the incorrect grab from Lidarr's Activity → Queue with **Remove from Client**, then search the album again. An older `Make Yourself (Live)` grab from `HQ Live` will not turn into the studio album when the app updates.

The Wanted/Missing page now uses Lidarr's default sorting instead of requesting `airDateUtc`, which causes `no such column: Albums.AirDateUtc` on Lidarr 3.1.6.

## Protocol review (October 13, 2026)

Checked against [Servarr's Lidarr settings](https://github.com/Servarr/Wiki/blob/master/lidarr/settings.md), [Torznab specification](https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html), [qBittorrent v2 API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)), and the current Lidarr implementations of [capability discovery](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Indexers/Newznab/NewznabCapabilitiesProvider.cs), [search requests](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Indexers/Newznab/NewznabRequestGenerator.cs), [queue and import handling](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Download/Clients/QBittorrent/QBittorrent.cs), and [SABnzbd downloads](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Download/Clients/Sabnzbd/SabnzbdProxy.cs).

| Requirement | Adapter behavior |
| --- | --- |
| Structured album capability | `audio-search`, with `q,artist,album,track` and raw search text. Lidarr does not recognize `music-search`. |
| Category filtering | Honors `cat`; advertises only music categories it can emit. |
| Paging | Advertised maximum/default 50; stable candidate set, offset/limit slicing, and namespaced response metadata. |
| Release identity | Torrent infohash matches the task ID returned by qBittorrent endpoints; download URLs carry API keys. |
| Album completion | All expected jobs must finish after tagging. Failed or unmatched tracks keep the album in an error state; they do not report 100% completion. |
| Completed-download cleanup | Complete albums report `pausedUP`, ratio/seed-time limits zero, and remain in the client until Lidarr removes them. There is no BitTorrent swarm or seeding in this adapter. |
| Categories | Category download folders are honored; post-import `setCategory` updates stored tasks. |
| Delete files | `deleteFiles=true` removes only completed job files recorded for that grab and located within its content folder. Unrelated files and folder trees are retained. |
| Add failure | Invalid or unaccepted requests return `Fails.`, rather than successful empty grabs. |
| Downloads versus library | Default staging is `DOWNLOAD_DIR/Music`, independent of `MUSIC_DIR`. Explicit saved paths remain in effect. |
| Pausing and priority | Unsupported. Use Start / Last. Paused adds and pause/priority commands are rejected. |
| SABnzbd | Unsupported for Lidarr's native download workflow. Configure qBittorrent. |
| Automated retry | Lidarr treats qBittorrent `error` as a warning, not a failed Usenet job. Remove/blocklist and re-search failed albums manually; there is no automatic torrent failed-download handling. |

Keep the reported download path separate from every Lidarr library root. For this NAS, a suitable layout is incoming files under `/data/Downloads/Music` (host `/volume1/Downloads/Music`) and the library under `/data/Media/Music` (host `/volume1/Media/music`). Both containers must mount the incoming folder; use Remote Path Mapping only if their internal paths differ. A mapping translates paths; it does not move files or create a mount.

The logged `/music/Incubus/...` destination must be changed if `/music` is your Lidarr root. Saved absolute paths are deliberately not migrated automatically. Re-test/save the Torznab indexer after updating to refresh capabilities; Lidarr caches capabilities, so a restart may be needed if it keeps using old ones. Leave RSS Sync off: the no-query feed is a catalog probe, not a feed of newly available releases. Enable Automatic and Interactive Search instead.

Audio format labels describe the encoded output, not the source fidelity. YouTube audio is generally lossy; converting it to FLAC/WAV does not restore lost detail. MP3/AAC profiles are appropriate for this source. This review covers the Lidarr workflow, not complete qBittorrent or Torznab feature parity. Tests use fixtures; the user's NAS paths and end-to-end downloads still need a live check.
