# yt-dlp GUI

A self-hosted web app for downloading videos/audio from any site [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports (YouTube, Vimeo, Twitter/X, TikTok, SoundCloud, and hundreds more) — not just YouTube. Paste URLs, watch live progress, browse history, and optionally auto-monitor playlists/channels for new uploads.

## Features

- Paste one or many URLs at once, queued with configurable concurrency
- Live progress bars via WebSocket (percent, speed, ETA)
- Audio-only (MP3) and subtitle download options, plus embedded thumbnail/metadata/chapters and SponsorBlock auto-remove
- Download history with thumbnails, file paths, and the exact yt-dlp command/log per job
- "Watches" — point it at a playlist or channel URL and it checks every 30 minutes for new videos, auto-downloading them, with failures surfaced in the UI instead of only in server logs
- Auto-delete for watch-downloaded videos (Settings page) — delete after N days, delete once watched in Jellyfin (via URL + API key), or both at once; runs nightly, with a dry-run preview, a "run now" button, and safety guards (per-video protect, per-watch exemption, "always keep newest N")
- **Jellyfin playlist sync** — builds and maintains a Jellyfin playlist per Watch, named after the channel/playlist, filled with everything that Watch has downloaded; syncs automatically after each download and every 15 minutes, or on demand from the Watches page ("Sync to Jellyfin") or Settings ("Sync all playlists now")
- Writes a Kodi/Jellyfin/Emby-compatible `.nfo` + poster image next to every download, so title/description/artwork scrape reliably (toggle in Settings)
- **Music Hub & Music Watcher** — search and discover full albums or songs via clean metadata with high-resolution album artwork, preview 30-second audio snippets, and auto-match and download songs from YouTube in MP3 (up to 320 kbps CBR), FLAC (lossless), M4A (AAC), or OPUS with embedded ID3/Vorbis tags and cover art. Automatically arranges downloads into organized folders: `{MusicFolder}/{Artist}/{Album}/{TrackNumber} - {Title}.{ext}` with optional `cover.jpg` for Jellyfin/Plex/Navidrome. Set up dedicated Music Watches to monitor artist channels or playlists for new releases and auto-convert them into your music library.
- **Twitch hub** — record a live channel (including auto-record when it goes live), browse and download a channel's VODs, trim a VOD/clip to a time range, and track active recordings in real time
- **Live stream recording for YouTube (and any other yt-dlp-supported live extractor)** — pasting a URL that's currently live is auto-detected in the Analyze modal: pick whether to join at the live edge or record the full broadcast from its start (`--live-from-start`), and if the stream hasn't started yet, wait for it and auto-record the moment it goes live (`--wait-for-video`). Recordings write MPEG-TS-safe HLS segments (`--hls-use-mpegts`) so the file stays intact and playable even if it's interrupted. In the queue, live jobs show a pulsing LIVE badge and elapsed recording time instead of a meaningless percent bar, with a one-click "Stop Recording" that finalizes and keeps the file captured so far
- Simple username/password login (single admin account), with rate-limited login attempts and session invalidation on password change
- Cookie support (Settings page) for any site — YouTube, Twitch, or others — for age-restricted/members-only/private/subscriber-only content
- Ships with modern static FFmpeg builds from [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds), with one-click in-app updates in Settings
- Persists the selected yt-dlp stable/nightly channel across container recreation; Nightly selections are reapplied on startup and checked daily at 03:00, while FFmpeg is checked daily at 03:30 and downloaded only when its upstream build changes
- Ships with the Deno JS runtime yt-dlp now requires to solve YouTube's JS challenges

## Quick start (Docker Compose)

A prebuilt image is published automatically to GitHub Container Registry on every merge to `main` (see [Automatic image builds](#automatic-image-builds)), so your NAS never needs to build anything itself — just pull.

### 1. Create a project folder on your NAS

Anywhere with disk space, e.g. `/volume1/docker/ytdlp-gui` — SSH in and:

```bash
mkdir -p ytdlp-gui/downloads ytdlp-gui/config
cd ytdlp-gui
```

### 2. Create `docker-compose.yml`

Paste this in as-is — it pulls the published image, so you don't need the rest of this repo at all:

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
- `ports`: change the left-hand `3000` if that port is already used on your NAS (e.g. `"8080:3000"`).
- `TZ`: your timezone (e.g. `America/New_York`), so scheduled watch checks and timestamps line up.
- `MAX_CONCURRENT_DOWNLOADS`: how many downloads run at once — keep this low (1-2) on a NAS with limited CPU.

### 3. Create `.env` next to it

```env
ADMIN_USER=choose-a-username
ADMIN_PASSWORD=choose-a-strong-password
```

Both are optional. Leave `ADMIN_PASSWORD` unset and the server generates a random one on first boot, printing it once to the container logs (`docker compose logs ytdlp-gui`) — it's not recoverable after that, so set it explicitly if you'd rather choose your own. `SESSION_SECRET` is also optional: if unset, the server generates one on first boot and persists it in `./config/app.db`, so sessions survive container restarts either way.

This file holds real credentials — keep it out of git and don't paste it anywhere public. `chmod 600 .env` is good practice on a shared NAS.

If you put this behind a reverse proxy with HTTPS (recommended for anything reachable outside your LAN), also set:

```env
TRUST_PROXY=1
COOKIE_SECURE=1
```

`COOKIE_SECURE=1` stops the login cookie from being sent over plain HTTP, so only set it once the app is actually reachable over HTTPS (directly or via that proxy) — otherwise login will silently fail to persist. `TRUST_PROXY=1` tells the app to trust the proxy's forwarded-HTTPS header, which `COOKIE_SECURE` needs behind a proxy.

### 4. Pull and start

```bash
docker compose pull
docker compose up -d
```

Open `http://<your-nas-ip>:3000` and log in with the credentials from `.env`.

### 5. Updating later

Whenever a fix or feature lands on `main`, a new image is published within a few minutes (see below). To pick it up:

```bash
docker compose pull
docker compose up -d
```

This recreates the container with the new image; your downloads, history, watches, and login all persist in the `./downloads` and `./config` folders.

Downloaded files land in `./downloads`, organized into a subfolder per uploader/channel. The SQLite database, session store, and any saved cookies live in `./config`.

### Ugreen NAS

Ugreen's Docker/Container app UI can import a `docker-compose.yml` directly (point it at the file from step 2), or you can SSH in and run the `docker compose` commands above from the project directory. Make sure the host paths you mount for `downloads` and `config` are on a volume with enough free space — downloaded video can add up fast.

### Building locally instead

If you'd rather build the image yourself (e.g. to test an unmerged change), clone the full repo — its `docker-compose.yml` also has a `build: .` line, so `docker compose up -d --build` builds and runs it locally instead of pulling.

## Automatic image builds

`.github/workflows/docker-publish.yml` builds and pushes a multi-arch (amd64 + arm64) image to `ghcr.io/rpeters1430/yt-dlp-gui:latest` on every push to `main` — including every merged PR — using GitHub Actions, so a new image is always available shortly after a change lands. It's also tagged with the short commit SHA if you ever need to pin to a specific build.

The first time this runs, the resulting GHCR package may default to private — if `docker pull` fails on the NAS with an auth error, go to the package's settings on GitHub and set its visibility to public (or `docker login ghcr.io` on the NAS with a personal access token that has `read:packages`).

If you want reproducible yt-dlp versions instead of always-latest, pin a version in the `Dockerfile` (`pip3 install yt-dlp==<version>`) — see https://pypi.org/project/yt-dlp/ for release history.

## YouTube JS runtime (Deno)

As of yt-dlp 2025.11.12+, full YouTube support requires an external JavaScript runtime to solve YouTube's JS challenges and generate PO tokens — the bundled `yt-dlp-ejs` component can't do this on its own. The `Dockerfile` installs [Deno](https://deno.com) (yt-dlp's default/recommended runtime) automatically for both amd64 and arm64, so no setup is needed. If you run the server outside Docker (see below), install Deno yourself and make sure it's on `PATH`.

## Site cookies (YouTube, Twitch, and others)

Some videos (age-restricted, members-only, private, subscriber-only, or anything a site is being extra suspicious about) need you to be "logged in." Go to **Settings** in the app, export `cookies.txt` from a browser where you're signed into the relevant site (e.g. the "Get cookies.txt LOCALLY" extension), and paste its contents in. It's saved to `./config/cookies.txt` with owner-only file permissions and used for every yt-dlp call, for any site — a single cookies.txt can hold cookies for multiple domains at once. Treat that file like a password — anyone with it is logged in as you.

For Twitch specifically, the **Twitch → Twitch Settings & OAuth** tab has a dedicated field for your `auth-token` cookie value as a shortcut that doesn't require exporting a full cookies.txt; it's stored the same way (merged into `cookies.txt` as a proper cookie), so you only need to set it in one place. Uploading a new cookies.txt via the main Settings page won't remove a Twitch token set this way — only "Remove saved cookies" clears everything.

## Advanced environment variables

All optional — set these in `.env` (or `environment:` in `docker-compose.yml`) only if the default doesn't fit your setup.

| Variable | Default | Purpose |
|---|---|---|
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy terminating TLS — required for `COOKIE_SECURE` to work correctly. |
| `COOKIE_SECURE` | off | Set to `1` once the app is reachable over HTTPS; restricts the login cookie to HTTPS requests. |
| `MAX_CONCURRENT_DOWNLOADS` | `2` | How many downloads run at once. |
| `DOWNLOAD_IDLE_TIMEOUT_MS` | `900000` (15 min) | Kills a download if yt-dlp produces no output for this long (a hung/stalled job would otherwise occupy a queue slot forever). Skipped for "wait for stream to go live" jobs, which are supposed to sit idle. |
| `GETINFO_TIMEOUT_MS` | `120000` (2 min) | Same idea, for metadata-only lookups (the format picker, watch checks, pre-download info fetch). |
| `ALLOW_LOCAL_URLS` | off | Set to `1` to disable the guard that rejects URLs pointing at loopback/private/link-local addresses (e.g. `127.0.0.1`, `192.168.x.x`) — only needed if you intentionally target an internal mirror or service. |
| `YTDLP_BIN` | `yt-dlp` | Path to the yt-dlp binary, if not on `PATH`. |
| `FFMPEG_DIR` | auto-detected | Directory containing `ffmpeg`/`ffprobe`, if not using the Settings-page-managed build. |
| `YTDLP_UPDATE_CRON` | `0 3 * * *` | Cron schedule for automatic yt-dlp checks when the saved channel is Nightly. |
| `FFMPEG_UPDATE_CRON` | `30 3 * * *` | Cron schedule for automatic FFmpeg build checks. |
| `DEPENDENCY_UPDATE_STARTUP_DELAY_MS` | `30000` | Delay before restoring a saved Nightly yt-dlp channel after container startup. |

## Local development (without Docker)

```bash
# terminal 1: backend
cd server
npm install
npm run dev

# terminal 2: frontend (proxies /api to localhost:3000)
cd client
npm install
npm run dev
```

You'll also need `yt-dlp`, `ffmpeg`, and `deno` installed locally and on your `PATH`.

## Architecture

- **Backend**: Node.js + Express, `better-sqlite3` for storage, `socket.io` for live progress, `node-cron` for the watch scheduler. yt-dlp is invoked via `child_process.spawn`, not a library binding, so any yt-dlp version/site support works without code changes.
- **Frontend**: React (Vite), built and served as static files by the Express server — one container, one port.
- **Watches**: the first check on a new watch only records existing videos (no bulk backfill); subsequent checks auto-queue anything new.
- **Auto-delete**: runs nightly at 03:00 server time, evaluating only watch-downloaded videos. The Jellyfin-watched check matches by filename (not full path), since this app's download folder and Jellyfin's library mount may differ; it counts a video as watched if any Jellyfin user has marked it played, unless a specific user ID is set in Settings.
- **Jellyfin playlist sync**: shares its connection settings (URL/API key/user) with the auto-delete "watched in Jellyfin" check — a specific Jellyfin user must be set, since a playlist always belongs to one user. Each Watch's downloaded videos are matched to Jellyfin library items by filename (same approach as the watched-check), then added to a playlist named after the Watch; the playlist is created on first sync and its Jellyfin item ID is cached on the Watch so renaming it in this app's Settings doesn't create a duplicate. A newly downloaded video only appears in its playlist once Jellyfin has scanned it into the library — sync is attempted right after download and retried every 15 minutes to catch up once the scan finishes.
