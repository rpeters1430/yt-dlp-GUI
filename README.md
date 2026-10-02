# yt-dlp GUI

[![Build and publish Docker image](https://github.com/rpeters1430/yt-dlp-gui/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/rpeters1430/yt-dlp-gui/actions/workflows/docker-publish.yml)
![Platforms](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-blue)
![Image](https://img.shields.io/badge/image-ghcr.io%2Frpeters1430%2Fyt--dlp--gui-informational)

A self-hosted web app for downloading video and audio from **any site [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports** — YouTube, Vimeo, Twitter/X, TikTok, Reddit, SoundCloud, Twitch, and hundreds more. Paste URLs, watch live progress, browse your history, record live streams, build a music library, and automatically follow playlists and channels for new uploads.

It runs as a single Docker container (one port, two volumes) and is designed to live on a home server or NAS alongside Jellyfin, Plex, Emby, Kodi, or Navidrome.

## Contents

- [Features](#features)
- [Quick start (Docker Compose)](#quick-start-docker-compose)
- [Updating](#updating)
- [Configuration](#configuration)
- [File naming](#file-naming)
- [Notifications](#notifications)
- [Site cookies](#site-cookies-youtube-twitch-and-others)
- [Jellyfin integration](#jellyfin-integration)
- [Scheduled tasks](#scheduled-tasks)
- [Where your data lives](#where-your-data-lives)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Local development](#local-development-without-docker)
- [Architecture](#architecture)
- [Automatic image builds](#automatic-image-builds)

## Features

### Downloading
- Paste one or many URLs at once; jobs are queued with configurable concurrency
- Live progress bars over WebSocket (percent, speed, ETA)
- Format picker, audio-only (MP3), subtitles, embedded thumbnail/metadata/chapters, and SponsorBlock auto-remove
- Download history with thumbnails, file paths, and the exact yt-dlp command and log for every job
- Customizable filename/folder layout — pick a preset or write your own yt-dlp template, globally or per Watch (see [File naming](#file-naming))
- Writes a Kodi/Jellyfin/Emby-compatible `.nfo` + poster image next to every download so titles, descriptions, and artwork scrape reliably (toggle in Settings)

### Library
- Browse everything you've downloaded as a grid of cards, with search, filters (source Watch, video/audio), sorting, and pagination
- Play videos and audio right in the browser, with seeking — no media server required
- Download a file to your device, protect it from auto-delete, or delete it (along with its `.nfo`, poster, and subtitle files)
- Files deleted or moved outside the app are flagged as missing

### Watches (auto-download new uploads)
- Point a Watch at a playlist or channel URL and it's checked on a schedule (every 30 minutes by default, adjustable per Watch) — new videos are downloaded automatically
- The first check records what's already there as a **baseline** and downloads nothing, unless you ask for a backfill of the newest N matching videos when creating the Watch; later checks queue anything new
- **Include / exclude title regex** — optional, case-insensitive regular expressions, entered without `/…/` delimiters. A title must match the include pattern (if set) and must not match the exclude pattern; exclude wins when both match. Duration limits are applied after the title rules, and a video with unknown duration isn't excluded by them. For example, to follow only IGN's trailers: `\b(movie|video game|gameplay|official)\s+trailer\b`. Invalid or unsafe patterns are rejected when saving, and **Preview against recent videos** shows which of the 20 latest uploads would match before you save
- Every discovered video is kept with what happened to it (baseline, filtered and why, pending, queued, completed, failed), viewable in the Watch's **Activity** view alongside a history of checks
- **Nothing is dropped by the per-check limit** — matching videos beyond a Watch's download limit stay *pending* and are queued by later checks, newest first
- **Failed downloads retry automatically** — up to four attempts in total, waiting at least 15 minutes, 1 hour, then 6 hours between them (picked up by the next check after that time). After that the video stays failed until you click **Retry** in Activity
- If a big upload burst means a check reads 1,000 videos without reaching ones it already knows, the check is reported as a **partial scan** with a warning; everything it found is still kept
- Watch cards show **Cataloged** (every video discovered), **Pending** (matching, waiting to be queued), **Queued** (queued or downloading), **Completed** (downloaded) and **Failed**, plus a badge for the latest check: `89 baseline`, `3 new / 2 queued`, `No new videos`, `Partial scan`, or `Check failed`
- Checks of the same Watch never overlap, so a scheduled check and a "Check now" can't queue the same video twice
- Failures are surfaced in the UI instead of hiding in server logs
- **Upgrading:** the old list of seen video IDs is converted into baseline videos (linked to their existing downloads where possible) the first time the new version starts, so upgrading never triggers a mass download

### Auto-delete
- Optionally clean up Watch-downloaded videos: delete after N days, once watched in Jellyfin, or both
- Runs nightly, with a dry-run preview and a "run now" button
- Safety guards: per-video protect, per-Watch exemption, and "always keep newest N"

### Live streams
- **YouTube and any other yt-dlp live extractor** — a URL that's currently live is detected automatically in the Analyze modal
- Join at the live edge, or record the whole broadcast from the start (`--live-from-start`)
- Scheduled streams that haven't started yet can be waited on and recorded the moment they go live (`--wait-for-video`)
- **TikTok Live** — paste a `tiktok.com/@user/live` link; if they're offline, queue **Wait & Auto-Record** and recording starts the next time they go live (also works for offline Twitch channels)
- Recordings use MPEG-TS-safe HLS segments (`--hls-use-mpegts`), so the file stays playable even if interrupted
- Live jobs show a pulsing **LIVE** badge and elapsed time, with a one-click **Stop Recording** that keeps everything captured so far

### Twitch hub
- Record a live channel, including auto-record when it goes live
- Browse and download a channel's VODs
- Trim a VOD or clip to a time range
- Track active recordings in real time

### Music Hub & Music Watcher
- Search and discover albums or songs with clean metadata and high-resolution album art, and preview 30-second snippets
- Auto-match and download tracks from YouTube as OPUS (highest quality native stream, ~160 kbps VBR bitstream copy), MP3 (up to 320 kbps CBR), M4A (AAC), or FLAC, with embedded ID3/Vorbis tags and cover art
- Organized into `{MusicFolder}/{Artist}/{Album}/{TrackNumber} - {Title}.{ext}`, with an optional `cover.jpg` for Jellyfin/Plex/Navidrome
- Music Watches follow artist channels or playlists for new releases and add them to your library

### Notifications
- Discord, Slack (and Mattermost/Rocket.Chat), ntfy, Gotify, or any generic JSON webhook (Home Assistant, n8n, Node-RED)
- Pick which events notify you: download completed, download failed, Watch queued new videos, Watch check started failing
- One-click test message from Settings

### Jellyfin playlist sync
- Maintains one Jellyfin playlist per Watch, named after the channel/playlist, containing everything that Watch has downloaded
- Syncs after each download, every 15 minutes, or on demand

### Maintenance & security
- Bundles modern static FFmpeg builds from [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) and the [Deno](https://deno.com) runtime yt-dlp needs for YouTube, with one-click in-app updates
- Choose the yt-dlp **stable** or **nightly** channel; the choice survives container recreation
- Single admin login with rate-limited login attempts and session invalidation on password change
- Cookie support for any site, for age-restricted, members-only, private, or subscriber-only content
- Blocks URLs pointing at private/loopback addresses by default (SSRF guard)

## Quick start (Docker Compose)

A prebuilt multi-arch image (amd64 + arm64) is published to GitHub Container Registry on every merge to `main`, so your server never needs to build anything — just pull.

**Requirements:** Docker with the Compose plugin, and enough disk space for your downloads.

### 1. Create a project folder

Anywhere with disk space, e.g. `/volume1/docker/ytdlp-gui` on a NAS:

```bash
mkdir -p ytdlp-gui/downloads ytdlp-gui/config
cd ytdlp-gui
```

### 2. Create `docker-compose.yml`

This pulls the published image, so you don't need the rest of this repo:

```yaml
services:
  ytdlp-gui:
    image: ghcr.io/rpeters1430/yt-dlp-gui:latest
    container_name: ytdlp-gui
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      - MAX_CONCURRENT_DOWNLOADS=2
      - TZ=America/Los_Angeles
    volumes:
      - ./downloads:/downloads
      - ./config:/config
```

Adjust to taste:
- **`ports`** — change the left-hand `3000` if that port is taken (e.g. `"8080:3000"`).
- **`TZ`** — your timezone (e.g. `America/New_York`), so scheduled checks and timestamps line up.
- **`MAX_CONCURRENT_DOWNLOADS`** — keep this low (1–2) on a NAS with limited CPU.

### 3. Create `.env` next to it

```env
ADMIN_USER=choose-a-username
ADMIN_PASSWORD=choose-a-strong-password
```

Both are optional:
- If `ADMIN_PASSWORD` is unset, a random password is generated on first boot and printed **once** to the logs (`docker compose logs ytdlp-gui`). It can't be recovered later, so set your own if you prefer.
- `SESSION_SECRET` is also optional — if unset, one is generated and persisted in `./config/app.db`, so logins survive restarts.

This file holds real credentials: keep it out of git and run `chmod 600 .env` on a shared machine.

### 4. Start it

```bash
docker compose pull
docker compose up -d
```

Open `http://<your-server-ip>:3000` and log in with the credentials from `.env`.

### Running behind a reverse proxy (HTTPS)

Recommended for anything reachable outside your LAN. Add to `.env`:

```env
TRUST_PROXY=1
COOKIE_SECURE=1
```

- `TRUST_PROXY=1` trusts the proxy's forwarded-HTTPS header, which `COOKIE_SECURE` needs.
- `COOKIE_SECURE=1` only sends the login cookie over HTTPS. Set it **only** once the app is actually served over HTTPS — otherwise logins will silently fail to stick.

Live progress uses WebSockets (socket.io), so make sure your proxy forwards `Upgrade`/`Connection` headers (Nginx Proxy Manager: enable "Websockets Support"; Caddy and Traefik do this automatically).

### Ugreen / Synology / other NAS

Most NAS container apps (Ugreen's Docker app, Synology Container Manager, Portainer stacks, etc.) can import the `docker-compose.yml` from step 2 directly, or you can SSH in and run the commands above. Make sure the host folders mounted for `downloads` and `config` are on a volume with plenty of free space — video adds up fast.

### Building locally instead

To build the image yourself (e.g. to test an unmerged change), clone the repo — its `docker-compose.yml` includes `build: .`, so `docker compose up -d --build` builds and runs it locally.

## Updating

A new image is published a few minutes after anything lands on `main`. To pick it up:

```bash
docker compose pull
docker compose up -d
```

Your downloads, history, Watches, settings, and login all persist in `./downloads` and `./config`.

yt-dlp, FFmpeg, and Deno can also be updated from **Settings** without pulling a new image, and are checked automatically overnight (see [Scheduled tasks](#scheduled-tasks)). If you'd rather have a reproducible yt-dlp version, pin it in the `Dockerfile` (`pip3 install yt-dlp==<version>`) and build locally — see [PyPI](https://pypi.org/project/yt-dlp/) for release history.

## Configuration

Everything below is optional — set it in `.env` (or `environment:` in `docker-compose.yml`) only if the default doesn't fit.

### Core

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_USER` | `admin` | Login username. |
| `ADMIN_PASSWORD` | random (printed once) | Login password. |
| `SESSION_SECRET` | generated & persisted | Secret used to sign session cookies. |
| `TZ` | container default (UTC) | Timezone for schedules and timestamps. |
| `PORT` | `3000` | Port the server listens on inside the container. |
| `MAX_CONCURRENT_DOWNLOADS` | `2` | How many downloads run at once. |
| `TRUST_PROXY` | off | Set to `1` behind a TLS-terminating reverse proxy — required for `COOKIE_SECURE` to work there. |
| `COOKIE_SECURE` | off | Set to `1` once the app is reachable over HTTPS; restricts the login cookie to HTTPS. |
| `ALLOW_LOCAL_URLS` | off | Set to `1` to allow URLs pointing at loopback/private/link-local addresses (e.g. `127.0.0.1`, `192.168.x.x`). Only needed to target an internal mirror or service. |

### Timeouts & watchdogs

| Variable | Default | Purpose |
|---|---|---|
| `DOWNLOAD_IDLE_TIMEOUT_MS` | `900000` (15 min) | Stops a download if yt-dlp produces no output this long, so a hung job can't hold a queue slot forever. Not applied to "wait for stream to go live" jobs. |
| `LIVE_DOWNLOAD_IDLE_TIMEOUT_MS` | `3600000` (60 min) | Same watchdog for active live recordings, which can legitimately stay quiet longer. |
| `PLAYLIST_DOWNLOAD_IDLE_TIMEOUT_MS` | `3600000` (60 min) | Same watchdog for playlist URLs (e.g. `...?list=...`), which may spend a long time preparing before the first progress line. |
| `DOWNLOAD_MAX_QUIET_MS` | `14400000` (4 h) | When the watchdog fires but the job is still using CPU (e.g. FFmpeg merging a multi-hour capture), it's spared — up to this hard cap of total silence. |
| `GETINFO_TIMEOUT_MS` | `120000` (2 min) | Timeout for metadata-only lookups (format picker, Watch checks, pre-download info). |

### Binaries & update schedules

| Variable | Default | Purpose |
|---|---|---|
| `YTDLP_BIN` | `yt-dlp` | Path to the yt-dlp binary, if not on `PATH`. |
| `FFMPEG_DIR` | auto-detected | Directory containing `ffmpeg`/`ffprobe`, if not using the Settings-managed build. |
| `YTDLP_UPDATE_CRON` | `0 3 * * *` | When to check for a new yt-dlp build (only when the saved channel is Nightly). |
| `FFMPEG_UPDATE_CRON` | `30 3 * * *` | When to check for a new FFmpeg build. |
| `DENO_UPDATE_CRON` | `45 3 * * *` | When to check for a new Deno release. |
| `DEPENDENCY_UPDATE_STARTUP_DELAY_MS` | `30000` | Delay before re-applying a saved Nightly yt-dlp channel after startup. |

### Paths (non-Docker use)

| Variable | Default | Purpose |
|---|---|---|
| `DOWNLOAD_DIR` | `/downloads` in Docker, `./downloads` otherwise | Where downloaded files are written. |
| `CONFIG_DIR` | `/config` in Docker, `./config` otherwise | Where the database, sessions, and cookies are stored. |

## File naming

**Settings → File naming** controls where new downloads go inside `./downloads`, as a [yt-dlp output template](https://github.com/yt-dlp/yt-dlp#output-template). Presets:

| Preset | Example result |
|---|---|
| Channel folder (default) | `Example Channel/Video title [id].mp4` |
| Flat | `Video title [id].mp4` |
| Channel / Year | `Example Channel/2026/Video title [id].mp4` |
| Channel / date-prefixed title | `Example Channel/2026-09-14 Video title [id].mp4` |
| Site / Channel | `Youtube/Example Channel/Video title [id].mp4` |

Or write your own — the page shows a live example of the result. Each Watch can override the global template in its **Quality & Format** tab, which is handy for sending a channel to its own media-server library (e.g. `Kids/%(uploader)s/%(title)s [%(id)s].%(ext)s`). Music downloads always use their Artist/Album layout.

Templates must be relative to the downloads folder, can't contain `..`, must end in `.%(ext)s`, and must include `%(title)s` or `%(id)s`. Changing the template only affects new downloads; existing files aren't moved.

## Notifications

**Settings → Notifications** sends a message to one webhook when things happen:

| Service | What to paste as the URL |
|---|---|
| Discord | A channel webhook URL (Channel settings → Integrations → Webhooks) |
| Slack / Mattermost / Rocket.Chat | An incoming-webhook URL |
| ntfy | Your topic URL, e.g. `https://ntfy.sh/my-topic` (self-hosted servers work too) |
| Gotify | `https://<server>/message?token=<app token>` |
| Generic JSON | Any URL; receives `{event, title, message, url, thumbnail, timestamp}` |

Choose which events notify you, and optionally limit completion/failure messages to Watch downloads. A Watch that keeps failing only notifies once, when it starts failing. Use **Send test** to check the webhook before saving. Webhook URLs usually act as secrets, so treat them like passwords.

## Site cookies (YouTube, Twitch, and others)

Some videos — age-restricted, members-only, private, subscriber-only, or anything a site is being extra suspicious about — require you to be logged in.

1. In a browser where you're signed into the site, export `cookies.txt` (e.g. with the "Get cookies.txt LOCALLY" extension).
2. In the app, go to **Settings** and paste the contents in.

It's saved to `./config/cookies.txt` with owner-only permissions and used for every yt-dlp call. One file can hold cookies for several sites at once. **Treat it like a password** — anyone with it is logged in as you.

For Twitch, **Twitch → Twitch Settings & OAuth** has a shortcut field for just your `auth-token` cookie. It's merged into the same `cookies.txt`, and uploading a new cookies.txt from Settings won't remove it — only "Remove saved cookies" clears everything.

## Jellyfin integration

Set your Jellyfin URL, API key, and (optionally) user in **Settings**. This one connection powers two features:

- **"Watched in Jellyfin" auto-delete** — a video counts as watched if any Jellyfin user has played it, or only the chosen user if one is set.
- **Playlist sync** — requires a specific user, since Jellyfin playlists belong to one user. Use **Sync to Jellyfin** on the Watches page or **Sync all playlists now** in Settings for an immediate sync.

Videos are matched to Jellyfin library items **by filename**, not full path, so it works even when this app and Jellyfin mount the download folder at different paths. A new download only appears in its playlist after Jellyfin has scanned it; the 15-minute sync picks it up once the scan finishes.

## Scheduled tasks

All times are server-local (set `TZ`).

| Task | When |
|---|---|
| Watch checks | Evaluated every 5 minutes; each Watch runs once its own interval (default 30 min) has elapsed |
| Jellyfin playlist sync | Every 15 minutes, plus right after each Watch download |
| Auto-delete | Nightly at 03:00 |
| yt-dlp nightly check | 03:00 (`YTDLP_UPDATE_CRON`, Nightly channel only) |
| FFmpeg check | 03:30 (`FFMPEG_UPDATE_CRON`) — downloaded only when the upstream build changes |
| Deno check | 03:45 (`DENO_UPDATE_CRON`) |

Dependency updates are skipped while downloads are active, so they never interrupt a running job.

## Where your data lives

| Host path | Container path | Contents |
|---|---|---|
| `./downloads` | `/downloads` | Downloaded media (a subfolder per uploader/channel by default — see [File naming](#file-naming)), plus `.nfo`/poster files |
| `./config` | `/config` | SQLite database (`app.db`), sessions, saved cookies, and app-managed tool builds |

**Back up `./config`** to keep your history, Watches, and settings. Everything in it can be restored by copying the folder back before starting the container.

## Security notes

- This app is meant for a single trusted admin. Don't expose it to the internet without HTTPS (see [reverse proxy](#running-behind-a-reverse-proxy-https)) and a strong password.
- `.env` and `./config/cookies.txt` contain secrets — keep them out of git and off shared drives.
- Only download content you have the right to download, and respect each site's terms of service.

## Troubleshooting

**`docker pull` fails with an auth/denied error** — the GHCR package may be private. Set it to public in the package's GitHub settings, or `docker login ghcr.io` with a token that has `read:packages`.

**I lost the generated admin password** — set `ADMIN_PASSWORD` in `.env` and run `docker compose up -d` to recreate the container.

**Login doesn't stick / I get logged straight back out** — you likely set `COOKIE_SECURE=1` while accessing the app over plain HTTP, or forgot `TRUST_PROXY=1` behind a proxy.

**Progress bars don't update** — your reverse proxy isn't forwarding WebSockets. Enable WebSocket support for the proxy host.

**YouTube says "Sign in to confirm you're not a bot" or a video is unavailable** — add cookies (see [Site cookies](#site-cookies-youtube-twitch-and-others)) and update yt-dlp from Settings; switching to the Nightly channel often helps when YouTube changes something.

**A URL to a local service is rejected** — that's the private-address guard. Set `ALLOW_LOCAL_URLS=1` if it's intentional.

**A file won't play in the Library** — browsers can't play every format (for example `.ts` recordings, or some codecs inside `.mkv`). Use **Download file** and open it in VLC, or choose MP4 as the container for future downloads.

**Notifications aren't arriving** — use **Send test** in Settings → Notifications; the error it shows comes straight from the webhook. Failed deliveries are also logged with a `[notify]` prefix.

**Something failed and I want details** — every job in History shows the exact yt-dlp command and its full log. Server logs are available with `docker compose logs -f ytdlp-gui`.

## Local development (without Docker)

Prerequisites: Node.js 24+, plus `yt-dlp`, `ffmpeg`, and `deno` installed and on your `PATH`.

```bash
# terminal 1: backend (http://localhost:3000)
cd server
npm install
npm run dev

# terminal 2: frontend with hot reload (proxies /api to localhost:3000)
cd client
npm install
npm run dev
```

Run the server unit tests with Node's built-in test runner:

```bash
cd server
node --test
```

### Project layout

```
client/              React (Vite) frontend
  src/pages/         Top-level pages (Dashboard, Library, History, Watches, Music, Twitch, Settings, ...)
  src/components/    Shared UI components
server/
  src/index.js       Express + socket.io entry point
  src/routes/        REST API routes
  src/services/      yt-dlp runner, queue, scheduler, Jellyfin, music, cleanup, notifications, updaters
Dockerfile           Multi-stage build: client bundle + runtime with yt-dlp, FFmpeg, Deno
docker-compose.yml   Compose file (pulls the published image, or builds locally)
```

## Architecture

- **Backend** — Node.js + Express, `better-sqlite3` for storage, `socket.io` for live progress, and `node-cron` for scheduling. yt-dlp is invoked via `child_process.spawn` rather than a library binding, so any yt-dlp version and any site it supports works without code changes.
- **Frontend** — React (Vite), built and served as static files by the Express server: one container, one port.
- **Library playback** — files are streamed from disk (with HTTP range requests, so seeking works) behind the same login as the rest of the app. Files are only served by download ID, from the path yt-dlp reported when the download finished — never from a path the browser supplies.
- **YouTube JS runtime** — since yt-dlp 2025.11.12, full YouTube support requires an external JavaScript runtime to solve YouTube's JS challenges. The image ships [Deno](https://deno.com), yt-dlp's recommended runtime, for both amd64 and arm64. Outside Docker, install Deno yourself.
- **Watches** — every video a Watch discovers is a row in a ledger (`watch_items`) with its filter decision and download state, and every check is a row in `watch_runs`; download jobs link back to their item, so a failure is retried rather than forgotten. The first check on a new Watch only records existing videos; later checks auto-queue anything new. **Reset history** forgets everything except completed downloads and re-baselines on the next check.
- **Auto-delete** — evaluates only Watch-downloaded videos; see [Jellyfin integration](#jellyfin-integration) for how "watched" is determined.
- **Jellyfin playlist sync** — each Watch's playlist is created on first sync and its Jellyfin item ID is cached on the Watch, so renaming it doesn't create a duplicate.

## Automatic image builds

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) builds and pushes a multi-arch (amd64 + arm64) image to `ghcr.io/rpeters1430/yt-dlp-gui:latest` on every push to `main`, including merged PRs. Each image is also tagged with the short commit SHA if you need to pin a specific build.

## Acknowledgements

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — the downloader doing all the heavy lifting
- [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) — static FFmpeg builds
- [Deno](https://deno.com) — JavaScript runtime for YouTube challenge solving
