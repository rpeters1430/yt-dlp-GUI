<p align="center">
  <a href="#yt-dlp-gui">
    <img src="docs/assets/banner.svg" alt="yt-dlp GUI Hero Banner" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://github.com/rpeters1430/yt-dlp-gui/actions/workflows/docker-publish.yml"><img src="https://github.com/rpeters1430/yt-dlp-gui/actions/workflows/docker-publish.yml/badge.svg" alt="Build Status"></a>
  <img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-blue?style=flat-square&logo=docker" alt="Platforms">
  <img src="https://img.shields.io/badge/image-ghcr.io%2Frpeters1430%2Fyt--dlp--gui-informational?style=flat-square&logo=github" alt="Docker Image">
  <img src="https://img.shields.io/badge/status-active%20development-emerald?style=flat-square" alt="Project Status">
  <img src="https://img.shields.io/badge/tests-212%2B%20passing-success?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/code%20style-eslint%20clean-blueviolet?style=flat-square" alt="ESLint">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

<p align="center">
  A high-density, cyberpunk-styled self-hosted web control deck for downloading, organizing, and streaming video and audio with <b><a href="https://github.com/yt-dlp/yt-dlp">yt-dlp</a></b> — YouTube, Twitch, TikTok, Vimeo, Twitter/X, Reddit, SoundCloud, Bandcamp, Bunkr, and hundreds more.
  <br><br>
  Equipped with a tactile <b>Cyber-Industrial Control Deck</b> UI, real-time WebSocket telemetry, standalone <b>MusicBrainz tagging & acoustic fingerprinting</b>, full <b>Lidarr bridge</b> automation, deep <b>forum link grabbing</b>, <b>Solverr MITM challenge proxy</b> routing, and <b>NAS post-processing optimization</b>.
</p>

<p align="center">
  <a href="#quick-start-docker-compose"><b>🚀 Quick Start</b></a> •
  <a href="#cyber-industrial-control-deck--ui-styles"><b>🎨 UI Styles & Design System</b></a> •
  <a href="#features"><b>✨ Features</b></a> •
  <a href="#project-status--roadmap"><b>📊 Project Status</b></a> •
  <a href="#music-hub--metadata-tagging"><b>🎵 Music Hub</b></a> •
  <a href="#link-grabber-and-forum-crawler"><b>🕷️ Link Grabber</b></a> •
  <a href="#solverr-forward-proxy"><b>🛡️ Solverr Proxy</b></a> •
  <a href="#nas-post-processing-optimizer"><b>⚡ NAS Optimization</b></a> •
  <a href="#configuration"><b>⚙️ Config</b></a>
</p>

---

<p align="center">
  <img src="docs/assets/ui-preview.svg" alt="yt-dlp GUI Dashboard Preview" width="100%">
</p>

---

## 🎨 Cyber-Industrial Control Deck & UI Styles

yt-dlp GUI features a purpose-built **Cyber-Industrial Control Deck** (*Night City Terminal*) interface. It pairs the density and tactile rigor of professional audio and broadcast workstations with the crisp precision of modern developer tools.

```
+-----------------------------------------------------------------------------------+
|  // COMMAND CENTER                                                                |
|  +-------------------------------------------------------------+-------+-------+  |
|  | [Link Icon] Paste links: YouTube, Twitch, Bunkr, 1,700+... | Paste | ANALYZE |  |
|  +-------------------------------------------------------------+-------+-------+  |
|     (•) 2 active   ( ) 4 waiting   (✓) 1,420 done   (⚠) 2 failed                  |
+-----------------------------------------------------------------------------------+
```

### 1. 4-Tier Dark Depth Architecture
The UI eliminates generic flat gray containers in favor of deep obsidian surfaces with subtle violet undertones, separated by laser-etched 1px micro-borders:

| Design Token | Hex Value | Role & Applied Elements |
| :--- | :--- | :--- |
| `--bg` | `#06050b` | Base ground (deep void black with faint violet undertone) |
| `--rail` | `#090812` | Navigation rail & persistent shell backdrop |
| `--bg-elevated` | `#0d0c18` | Panels, staging tray backdrop, drawer canvas (*Surface 1*) |
| `--surface` | `#131126` | Active cards, input interiors, dialog bodies (*Surface 2*) |
| `--surface-hover` | `#1b1736` | Card hover elevations, selected nav items, active chips (*Surface 3*) |
| `--surface-active`| `#241f48` | Pressed buttons, raised segments, active toggles |
| `--border` | `#1f1b3d` | Subtle dividers, card outlines |
| `--border-strong` | `#352f66` | Focused elements, active chip outlines, panel rims |
| `--border-active` | `#5c52a8` | Focused inputs, highlighted cards, modal borders |

### 2. Targeted Semantic Neon Signaling
Neon accents are applied in strictly targeted doses for instant cognitive status recognition:
- **`--neon-cyan` (`#00f0ff`) — Action & Telemetry**: Primary buttons, active tabs, yt-dlp analyzing radar beam, active filter chips, download progress fill bar.
- **`--neon-magenta` (`#ff2a6d`) — Live & Broadcast**: Pulsing live broadcast beacons (`● LIVE`), recording indicators, destructive actions (cancel / delete), error badges.
- **`--neon-green` (`#39ff9c`) — Success & Audio**: Completed downloads, online host indicators, Music mode highlights, Lidarr verified tags.
- **`--neon-yellow` (`#f5ed00`) — Caution & Offline**: Duplicate link alerts, paused queue state, Cloudflare challenge notifications, offline host checks.
- **`--neon-violet` (`#b98cff`) — Streamer & Feeds**: Twitch channel monitoring, custom watch tags, forum post archive passwords.

### 3. Display Density & Retro Scanlines
Configurable in **Settings → Appearance**:
- **Display Density**: Switch between **Cozy** (default breathing room) and **Compact** (tighter row spacing for viewing maximum downloads, watch items, and crawl results).
- **CRT Scanlines**: Toggle a retro full-screen CRT scanline texture (`data-scanlines="on"` / `off`) over the control deck.

### 4. Tactile Command Omnibar & Hotkeys
- **Chamfered 45° Cut Corners**: Styled with modern CSS `corner-shape: angle` for an authentic hardware terminal look.
- **Pulsing Laser Glow**: Deep matte black interior (`#04030a`) that pulses with a cyan border glow when focused.
- **Instant Clipboard Paste**: Quick-action **Paste** button with keyboard shortcut (`⌘V` / `Ctrl+V`), `Enter` to analyze, and `Esc` to clear.
- **Auto-Analyze**: Automatically inspects links immediately when pasted from clipboard (configurable in Settings).

### 5. Hero Telemetry Module (Now Downloading)
- **Dual-Column Cockpit**: Left pane features high-resolution artwork, a glowing cyan progress bar, smoothed download speeds, and dynamic ETA countdowns. The right pane provides a live terminal showing real-time yt-dlp/ffmpeg stage progress.
- **Moving-Average Smoothing**: Filters out bursty connection jitter to render readable, stable transfer speeds (`MB/s`) and accurate ETAs.
- **Persisted Stage Timing**: Shows real elapsed time across post-processing stages (`Merging formats...`, `Embedding subtitles...`), surviving browser refreshes and reconnects.

### 6. Responsive Adaptive Navigation
- **Desktop (1024px+)**: Collapsible left navigation rail (64px icon rail or 220px expanded with labels) with centered max-width workspace canvas.
- **Mobile & Tablet (<1024px)**: Persistent bottom Cyber TabBar (54px height) with touch-optimized 44px tap targets.
- **Progressive Web App (PWA)**: Installable standalone app on desktop (Chrome, Edge) and mobile (Android, iOS Safari) with instant launch, custom shortcuts, and Android Web Share target integration.

---

## 📊 Project Status & Roadmap

> [!NOTE]
> **Current Release:** `v1.0.0` (Active Production & Feature Development)  
> Multi-arch container images (`amd64` / `arm64`) are automatically published to GitHub Container Registry (`ghcr.io/rpeters1430/yt-dlp-gui:latest`) on every merge to `main`.

Each GitHub Actions image build checks official upstream releases for the latest **yt-dlp nightly** and **FFmpeg autobuild**. Upstream tools are resolved, verified against SHA256 checksums, and baked into the image. Image metadata and checksums are recorded in `/usr/local/share/yt-dlp-gui/tool-versions.json`.

### Component Status Matrix

| Module | Status | Highlights |
|---|---|---|
| **Cyber-Industrial UI** | 🟢 Production Ready | 4-tier dark depth, semantic neon signaling, CRT scanlines, Cozy/Compact density, PWA installable |
| **Core Queue & Downloader** | 🟢 Production Ready | Concurrent queue, watchdog timers, delta socket logs, audio drift correction, smoothed speed & ETA |
| **Music Hub & Standalone Tagging** | 🟢 Production Ready | MusicBrainz search, Cover Art Archive, Chromaprint / AcoustID fingerprinting, Apple catalog, selective tag reviews |
| **Lidarr Bridge & Indexer** | 🟢 Production Ready | Torznab indexer (`/api/lidarr/torznab`), qBit/SAB emulation, wanted album browser, auto-import sync |
| **Link Grabber & Forum Crawler** | 🟢 Production Ready | XenForo thread-aware crawling, multi-select host chips, grouped post archive passwords, JDownloader/aria2 hand-off |
| **Solverr MITM Forward Proxy** | 🟢 Production Ready | Transparent Cloudflare challenge bypass for crawler, link checks, and yt-dlp with auto CA trust installation |
| **NAS Post-Processing Optimizer** | 🟢 Production Ready | In-flight stream merge, dedicated post-processor gate, SSD work directory, persisted stage timing |
| **Watches (Channel Feeds)** | 🟢 Production Ready | Multi-tab discovery (Videos, Shorts, Live), baseline checks, regex filtering, retry backoff |
| **Live Stream Recorder** | 🟢 Production Ready | YouTube, Twitch, TikTok Live auto-record, MPEG-TS HLS chunking, graceful finalization, manual split |
| **Library & Streaming Player** | 🟢 Production Ready | In-browser seeking with HTTP range requests, `.nfo` & poster generation, file protection guard |
| **Media Server Integration** | 🟢 Production Ready | Jellyfin playlist sync & watched status, Plex library scans & watched auto-delete |
| **Test & Code Quality** | 🟢 212+ Tests Passing | ESLint clean across client and server, modular Express app (`src/app.js`), lazy-loaded client routes |

---

## Contents

- [🎨 Cyber-Industrial Control Deck & UI Styles](#cyber-industrial-control-deck--ui-styles)
- [📊 Project Status & Roadmap](#project-status--roadmap)
- [✨ Features](#features)
  - [Downloading & Queue Engine](#downloading--queue-engine)
  - [Cyber-Industrial UI & PWA](#cyber-industrial-ui--pwa)
  - [Music Hub & Metadata Tagging](#music-hub--metadata-tagging)
  - [Lidarr Integration](#lidarr-integration)
  - [Live Streams & Twitch Hub](#live-streams--twitch-hub)
  - [Link Grabber & Forum Crawler](#link-grabber-and-forum-crawler)
  - [Solverr Forward Proxy](#solverr-forward-proxy)
  - [NAS Post-Processing Optimizer](#nas-post-processing-optimizer)
  - [Library & Browser Media Player](#library--browser-media-player)
  - [Watches (Channel & Playlist Feeds)](#watches-channel--playlist-feeds)
  - [Auto-Delete & Housekeeping](#auto-delete--housekeeping)
  - [Media Server Sync (Jellyfin & Plex)](#media-server-integration-jellyfin--plex)
  - [Notifications](#notifications)
  - [Tooling & Multi-JS Engine](#tooling--multi-js-engine)
- [🚀 Quick Start (Docker Compose)](#quick-start-docker-compose)
- [⚙️ Configuration](#configuration)
  - [Core Settings](#core-settings)
  - [NAS Post-Processing](#nas-post-processing)
  - [Solverr Proxy](#solverr-proxy-variables)
  - [Timeouts & Watchdogs](#timeouts--watchdogs)
  - [Binaries & Update Schedules](#binaries--update-schedules)
- [📁 File Naming & Output Templates](#file-naming--output-templates)
- [🏗️ System Architecture](#system-architecture)
- [🔒 Security Notes](#security-notes)
- [🔧 Troubleshooting](#troubleshooting)
- [💻 Local Development](#local-development)
- [🙏 Acknowledgements](#acknowledgements)

---

## Features

### Downloading & Queue Engine
- **Universal Downloader**: Paste one or multiple URLs at once from YouTube, Twitch, TikTok, Vimeo, Twitter/X, Reddit, SoundCloud, Bunkr, and hundreds of yt-dlp supported sites.
- **Concurrent Queue Management**: Configurable concurrency slots with real-time pause/resume, front-of-queue priority bumping, and manual job prioritization ahead of Watch backfills.
- **Real-Time WebSocket Telemetry**: Live progress percentage, moving-average smoothed download speeds, and dynamic ETA countdowns without jitter.
- **Granular Format Picker**: Choose specific video/audio stream resolutions, containers, subtitle languages, chapter embeddings, and audio extraction options (OPUS, FLAC, MP3, M4A).
- **SponsorBlock Integration**: Automatically remove sponsor segments, intros, outros, or self-promotions from downloads.
- **Bandwidth Caps & Jitter**: Optional per-download transfer rate limits and randomized request delays to avoid network saturation and host rate limits.
- **Complete Job Audit**: View full yt-dlp execution commands, environment parameters, and real-time streaming logs for every job in history.
- **Kodi / Jellyfin / Plex Metadata**: Generates `.nfo` metadata and poster artwork alongside downloads for seamless scraping.

### Cyber-Industrial UI & PWA
- **Control Deck Styling**: High-contrast, obsidian dark cyberpunk aesthetic with purposeful semantic neon signaling (Cyan, Magenta, Green, Yellow, Violet).
- **Tactile Command Omnibar**: Floating input with chamfered 45° cut corners, glowing laser borders, clipboard paste shortcuts (`⌘V` / `Ctrl+V`), and automatic metadata analysis.
- **Dual Density Modes**: Segmented toggle between **Cozy** and **Compact** density in Appearance settings.
- **CRT Scanlines**: Optional retro CRT monitor overlay texture (`data-scanlines="on"`).
- **Progressive Web App (PWA)**:
  - Installable on desktop (Chrome, Edge) and mobile (Android, iOS Safari).
  - Dedicated window, app icon, and launch shortcuts directly into History, Watches, and Library.
  - Service worker caching for instant app shell startup.
  - **Android Web Share Target**: Share video and audio URLs directly from mobile browser or YouTube/Twitch apps into yt-dlp GUI.

### Music Hub & Metadata Tagging
- **Standalone Tagging & Import**: Tag, review, and organize audio releases directly in the web UI without needing Lidarr.
- **MusicBrainz & Cover Art Archive**: Automatic metadata retrieval for tracks, albums, release dates, and high-resolution cover artwork.
- **Acoustic Fingerprinting (Chromaprint / AcoustID)**: Identify unknown or misnamed audio files using audio waveform fingerprinting (`fpcalc`).
- **Apple Music / iTunes Catalog Search**: Search and match releases across worldwide Apple Music catalogs with country storefront selection.
- **Interactive Library Review**: Inspect tags across your existing music library with selective field updates and tag clearing (supports MP3/ID3, FLAC, Ogg Vorbis, and Opus).
- **High-Fidelity Audio Formats**: Native bitstream OPUS copy (~160 kbps VBR), 320 kbps CBR MP3, FLAC, and AAC M4A.
- **Structured Storage Layout**: `{MusicFolder}/{Artist}/{Album}/{TrackNumber} - {Title}.{ext}`.

### Lidarr Integration
- **Torznab RSS 2.0 Indexer (`/api/lidarr/torznab`)**: Functions as a native Lidarr indexer with audio categories (`3000`, `3010`, `3020`, `3040`) and deterministic torrent infohashes.
- **Download Client Emulation (`/api/lidarr/qbit` & `/api/lidarr/sab`)**: Emulates qBittorrent v2 or SABnzbd API endpoints for seamless handoff to Lidarr's Completed Download Handling.
- **Wanted Albums Browser**: Browse Lidarr's missing and wanted albums directly in the Music UI and queue them with a single click.
- **Automatic Library Rescan**: Triggers Lidarr's `DownloadedAlbumsScan` immediately upon audio job completion.

### Live Streams & Twitch Hub
- **Universal Live Detection**: Automatically recognizes live broadcasts from YouTube, Twitch, TikTok Live, and other supported extractors.
- **Wait & Auto-Record**: Queue streams that have not yet started or offline channels (e.g. `tiktok.com/@user/live` or Twitch channels); recording begins automatically the moment they go live.
- **Stream Edge or From Start**: Join at the current live edge or record from the beginning (`--live-from-start`).
- **Resilient HLS Chunking**: Records using MPEG-TS HLS chunks (`--hls-use-mpegts`) ensuring captures remain valid and playable even if abruptly interrupted.
- **Graceful Split & Stop**: Stop recordings without remux corruption, with optional user-directed chunk splitting.
- **Twitch VOD Browser & Trimmer**: Browse channel VODs and clips with precision time-range trimming before download.

### Link Grabber and Forum Crawler
- **Deep Forum Crawling**: Crawl forum threads (XenForo like SimpCity and others) across single pages, page ranges, the last $N$ pages, or whole threads.
- **Post-by-Post Intelligence**: Automatically extracts post author, avatar, thread page number, post ID, and archive passwords (`#password`) with one-click copy.
- **Multi-Select Host Chips**: Filter extracted links with interactive multi-select chips displaying live host counters (`Bunkr`, `Gofile`, `Pixeldrain`, `Mega`, etc.).
- **Content Cleaning**: Skips quoted replies, signatures, and mirror-bot reposts while automatically decoding Base64-hidden links.
- **Multi-Target Dispatch Bar**:
  - Send selected links directly to **JDownloader** (Click'n'Load) with package-per-page naming and embedded archive passwords.
  - Queue directly into **yt-dlp GUI** download queue.
  - Dispatch to **aria2** RPC.
  - Copy clean link lists to clipboard.
- **Link Availability Checks**: Tests links through host APIs (Pixeldrain, Mega, direct headers) to display **Online** / **Offline** status, file names, and byte sizes.
- **Scheduled Thread Watches**: Automatically monitors active forum threads on a recurring schedule (every 30m to 24h), filtering duplicates across mirror domains (e.g., `bunkr.si` and `bunkr.fi`).
- **Python CLI Crawler (`crawler/crawler.py`)**: Execute terminal-based forum crawls utilizing the app's saved cookies, downloader configurations, and history ledger.

### Solverr Forward Proxy
- **Transparent Challenge Solving**: Routes crawler page fetches, link availability checks, and yt-dlp media downloads through an authenticated [Solverr](https://github.com/rpeters1430/solverr) MITM forward proxy.
- **Bypasses Cloudflare & Bot Barriers**: Solves Cloudflare Turnstile, JavaScript challenges, and anti-bot verification transparently.
- **Automatic CA Trust Store Integration**: Container entrypoint downloads and installs Solverr's CA certificate with SHA-256 fingerprint verification (`SOLVERR_PROXY_CA_SHA256`).
- **Automatic Health Fallback**: Performs continuous TCP reachability checks; if Solverr becomes temporarily unavailable, new requests automatically fall back to direct routing.
- **Challenge Solver API**: Integrates with Solverr's FlareSolverr-compatible `/v1` endpoint for challenging forum pages.

### NAS Post-Processing Optimizer
- **In-Flight Stream Merging**: Merges video and audio streams while embedding tags and metadata in a single pass, eliminating costly secondary full-file rewrites on slow storage.
- **Post-Processing Concurrency Gate (`MAX_CONCURRENT_POSTPROCESSORS`)**: Limits disk-heavy operations (remuxing, moving, splitting) to 1 concurrent process (configurable 1–4) to prevent HDD thrashing while network downloads continue concurrently.
- **SSD Working Storage (`YTDLP_WORK_DIR`)**: Stages active downloads and merges on fast NVMe/SSD storage, transferring final files to HDD media shares atomically upon completion.
- **Real-Time Stage Telemetry**: Displays the active post-processing phase (`Merging formats...`, `Embedding subtitles...`) and persists elapsed stage durations across reconnects.

### Library & Browser Media Player
- **In-Browser Media Center**: Browse completed downloads in an interactive card grid with instant searching, category filters, and sorting.
- **Direct Streaming with Seeking**: Stream video and audio files in-browser using HTTP range requests (`206 Partial Content`) for instant seeking without external servers.
- **File Management**: Single-click downloads to local device, deletion protection locks, and clean file removals (including `.nfo`, subtitles, and posters).
- **Health Tracking**: Automatically detects and flags files that were moved or deleted outside the application.

### Watches (Channel & Playlist Feeds)
- **Automated Channel Polling**: Periodically monitors YouTube channels, playlists, Twitch channels, and RSS feeds on customizable schedules (default: every 30 minutes).
- **Granular YouTube Tab Tracking**: Selectively track **Videos**, **Shorts**, and **Live Streams** on YouTube channel URLs (`youtube.com/@name`).
- **Smart Baselining & Backfill**: Baselines existing channel uploads upon creation to avoid unwanted bulk downloads, with optional backfill of the newest $N$ uploads (up to 5,000).
- **Regex Title Filtering**: Include and exclude filters using regular expressions, with interactive in-browser regex testing before saving.
- **Exponential Retry Backoff**: Automatically retries failed jobs across 15m, 1h, and 6h intervals before flagging.
- **Detailed Activity Ledger**: Complete audit log displaying scan timestamps, discovered videos, filter decisions, and queue states.

### Auto-Delete & Housekeeping
- **Automated Retention**: Clean up Watch-downloaded media based on age (delete after $N$ days), watched status in Jellyfin/Plex, or both.
- **Disk Free-Space Guard**: Halts new Watch queueing and triggers emergency cleanup when disk space drops below a configurable threshold.
- **Exemption Protection**: Protect favorite videos from deletion, exempt specific Watches, or enforce "always keep newest $N$" rules.
- **Scheduled Dry-Runs**: Nightly automated runs with instant dry-run preview and manual "Run Now" execution.

### Media Server Integration (Jellyfin & Plex)
- **Jellyfin**:
  - Automatic per-Watch playlist creation and synchronization.
  - "Watched in Jellyfin" auto-delete triggers based on user watch activity.
  - Filename-based matching ensuring compatibility across varying Docker mount points.
- **Plex**:
  - Immediate post-download library scan commands sent to Plex Media Server.
  - Per-channel Plex playlist synchronization.
  - User-scoped "Watched in Plex" status tracking for automated cleanup.

### Notifications
- **Multi-Platform Webhooks**: Dispatches rich notifications to **Discord**, **Slack**, **Mattermost**, **Rocket.Chat**, **ntfy**, **Gotify**, or custom JSON webhooks (Home Assistant, n8n, Node-RED).
- **Event Subscriptions**: Subscribe to download completions, download failures, Watch queue events, Watch check errors, or Thread Watch link discoveries.

### Tooling & Multi-JS Engine
- **Multi-JS YouTube Challenge Solving**: Supports Deno, Node.js, and QuickJS-ng (`qjs`) runtimes required by yt-dlp for modern YouTube challenge solving.
- **In-App Deno Management**: Install and update Deno directly from **Settings → Tools**.
- **Automated Nightly Updates**: Daily background checks for yt-dlp (Stable vs. Nightly), static FFmpeg builds, QuickJS-ng, and Deno without interrupting active downloads.

---

## 🚀 Quick Start (Docker Compose)

Prebuilt multi-arch images (`linux/amd64` and `linux/arm64`) are published to GitHub Container Registry.

### 1. Directory Structure
```bash
mkdir -p ytdlp-gui/downloads ytdlp-gui/videos ytdlp-gui/music ytdlp-gui/config
cd ytdlp-gui
```

### 2. `docker-compose.yml`
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
      - VIDEO_DIR=/videos
      - MUSIC_DIR=/music
      # Optional: NAS user/group permissions (check with `id`)
      # - PUID=1000
      # - PGID=100
      # Optional: Solverr forward proxy integration
      # - SOLVERR_PROXY_URL=http://USER:PASS@solverr:8192
      # - SOLVERR_PROXY_CA_URL=http://solverr:8191/proxy-ca.crt
      # - SOLVERR_PROXY_CA_SHA256=your-ca-fingerprint
      # Optional: SSD working directory for post-processing
      # - YTDLP_WORK_DIR=/scratch
    volumes:
      - ./downloads:/downloads
      - ./videos:/videos
      - ./music:/music
      - ./config:/config
      # Optional SSD scratch mount:
      # - /mnt/ssd/scratch:/scratch
```

### 3. `.env` File
```env
ADMIN_USER=admin
ADMIN_PASSWORD=choose-a-strong-password
```

> [!TIP]
> - If `ADMIN_PASSWORD` is omitted, a random password is generated on first launch and printed once to the container logs (`docker compose logs ytdlp-gui`).
> - Secure this file on Linux servers: `chmod 600 .env`.

### 4. Start the Application
```bash
docker compose pull
docker compose up -d
```
Access the web control deck at `http://<server-ip>:3000`.

---

## ⚙️ Configuration

Pass configuration variables through `.env` or the `environment:` block in `docker-compose.yml`.

### Core Settings

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USER` | `admin` | Web UI login username. |
| `ADMIN_PASSWORD` | random (printed in log) | Web UI login password. |
| `SESSION_SECRET` | generated & persisted | Secret key used to sign session cookies. |
| `PORT` | `3000` | Port the Express server listens on inside the container. |
| `TZ` | `UTC` | Timezone for schedules, timestamps, and cron jobs. |
| `PUID` | `0` (root) | Optional host numeric user ID for permissions drop. |
| `PGID` | `0` (root) | Optional host numeric group ID for permissions drop. |
| `MAX_CONCURRENT_DOWNLOADS` | `2` | Number of simultaneous downloads. |
| `CONCURRENT_FRAGMENTS` | `4` | Parallel fragments for HLS/DASH streams (non-live). |
| `FORCE_KEYFRAMES_AT_CUTS` | `0` (off) | Forces keyframe re-encoding at cuts for SponsorBlock. |
| `JS_RUNTIMES` | `deno,node,quickjs` | Comma-separated list of JavaScript engines for yt-dlp. |
| `TRUST_PROXY` | `0` (off) | Set to `1` when behind a reverse proxy (e.g., Traefik, Nginx). |
| `COOKIE_SECURE` | `0` (off) | Set to `1` when accessing exclusively over HTTPS. |
| `ALLOW_LOCAL_URLS` | `0` (off) | Set to `1` to allow downloading from private/loopback IPs. |

### NAS Post-Processing

| Variable | Default | Description |
|---|---|---|
| `NAS_POSTPROCESSING` | `1` (enabled) | Enables single-pass stream merge and post-processing optimizer. |
| `MAX_CONCURRENT_POSTPROCESSORS` | `1` | Concurrent heavy disk operations (clamped to 1–4). |
| `YTDLP_WORK_DIR` | unset | Container path to fast SSD staging directory for active downloads. |

### Solverr Proxy Variables

| Variable | Default | Description |
|---|---|---|
| `SOLVERR_PROXY_URL` | unset | Solverr forward proxy URL (e.g., `http://USER:PASS@solverr:8192`). |
| `SOLVERR_PROXY_CA_URL` | unset | HTTP URL where entrypoint fetches Solverr's CA cert. |
| `SOLVERR_PROXY_CA_SHA256` | unset | SHA-256 fingerprint of Solverr's CA for verification. |
| `SOLVERR_PROXY_CA_ACTION` | `install` | Set to `remove` to uninstall the CA certificate. |
| `SOLVERR_PROXY_CA_ATTEMPTS` | `5` | Startup retry attempts while Solverr initializes. |

### Timeouts & Watchdogs

| Variable | Default | Description |
|---|---|---|
| `DOWNLOAD_IDLE_TIMEOUT_MS` | `900000` (15m) | Cancels frozen jobs producing no output (except wait-for-live). |
| `LIVE_DOWNLOAD_IDLE_TIMEOUT_MS` | `3600000` (60m) | Extended watchdog allowance for active live stream captures. |
| `PLAYLIST_DOWNLOAD_IDLE_TIMEOUT_MS`| `3600000` (60m) | Watchdog allowance for large playlists during pre-download info checks. |
| `DOWNLOAD_MAX_QUIET_MS` | `14400000` (4h) | Maximum quiet allowance for CPU/IO busy jobs during heavy remuxing. |
| `GETINFO_TIMEOUT_MS` | `120000` (2m) | Timeout for metadata analysis lookups and Watch checks. |

### Binaries & Update Schedules

| Variable | Default | Description |
|---|---|---|
| `YTDLP_BIN` | `yt-dlp` | Path to yt-dlp binary if not on system `PATH`. |
| `FFMPEG_DIR` | auto-detected | Directory containing `ffmpeg` and `ffprobe`. |
| `YTDLP_UPDATE_CRON` | `0 3 * * *` | Nightly check for yt-dlp builds (Nightly channel). |
| `FFMPEG_UPDATE_CRON` | `30 3 * * *` | Nightly check for static FFmpeg build releases. |
| `QUICKJS_UPDATE_CRON` | `45 3 * * *` | Nightly check for QuickJS-ng releases. |
| `DENO_UPDATE_CRON` | `50 3 * * *` | Nightly check for Deno engine updates. |

---

## 📁 File Naming & Output Templates

Customize media file layouts in **Settings → File naming** using [yt-dlp output template syntax](https://github.com/yt-dlp/yt-dlp#output-template).

| Preset Name | Resulting File Layout |
|---|---|
| **Channel folder** *(default)* | `Example Channel/Video title [id].mp4` |
| **Flat** | `Video title [id].mp4` |
| **Channel / Year** | `Example Channel/2026/Video title [id].mp4` |
| **Channel / Date-prefixed** | `Example Channel/2026-09-14 Video title [id].mp4` |
| **TV show structure** | `Example Channel/Season 2026/S2026E0914 - Video title [id].mp4` |
| **Site / Channel** | `Youtube/Example Channel/Video title [id].mp4` |

> [!TIP]
> The **TV show structure** preset produces series folders with season/episode numbers and generates `tvshow.nfo`, `poster.jpg`, and `fanart.jpg` compatible with Kodi, Jellyfin, and Plex.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph Clients["Clients & Mobile Applications"]
        Browser["Cyber-Industrial Deck (React 19 + Vite + PWA)"]
        LidarrApp["Lidarr Server"]
        Webhooks["Discord / Slack / ntfy / Gotify"]
    end

    subgraph Container["yt-dlp GUI Container (Node 24 Alpine)"]
        API["Express 5 REST API & Socket.io"]
        Auth["Session & Rate Limiter"]
        Queue["Concurrency Job Queue & Optimizer"]
        Ledger["SQLite Database (better-sqlite3)"]
        Sched["Cron Scheduler (node-cron)"]

        subgraph Engine["Execution Runtime"]
            Runner["yt-dlp Process Runner"]
            FFmpeg["FFmpeg / FFprobe"]
            Deno["Deno / Node / QuickJS Runtimes"]
            Optimizer["NAS Video Post-Processor"]
        end
    end

    subgraph Storage["Storage Volumes"]
        ConfigDir["/config (app.db, cookies.txt)"]
        DownloadDir["/downloads (Media, .nfo, Artwork)"]
        SSDWork["/scratch (Optional SSD Work Dir)"]
    end

    subgraph Proxy["External Services"]
        Solverr["Solverr MITM Forward Proxy"]
        MediaServers["Jellyfin & Plex Servers"]
    end

    Browser <-->|"WebSocket & REST"| API
    LidarrApp <-->|"Torznab & qBit API"| API
    API --> Auth --> Queue
    Queue <--> Ledger
    Sched --> Queue
    Ledger <--> ConfigDir

    Queue --> Runner
    Runner --> FFmpeg
    Runner --> Deno
    Runner --> Optimizer
    Optimizer --> SSDWork
    Optimizer --> DownloadDir

    Runner -.->|"MITM Proxy"| Solverr
    Queue -->|"Notifications"| Webhooks
    Queue -->|"Sync & Library Refresh"| MediaServers
```

### Architecture Notes
- **Backend**: Express 5 on Node.js 24 with `better-sqlite3` storage, `socket.io` for live WebSocket telemetry, and `node-cron` for scheduling. yt-dlp is executed via `child_process.spawn`, ensuring full compatibility with any site supported by upstream yt-dlp.
- **Frontend**: Modular React 19 single-page application built with Vite, served as static assets from the Express backend in a single lightweight container.
- **Library Playback**: Media streaming utilizes HTTP range requests (`206 Partial Content`) for seekable browser playback directly from disk, protected by admin session authentication.
- **YouTube JS Solver Engine**: Automatically discovers available JavaScript runtimes (`Deno`, `Node.js`, `QuickJS-ng`) and supplies them to yt-dlp via `--js-runtimes` for solving modern YouTube anti-bot challenges.
- **Watch Audit Ledger**: Discovered videos are tracked in `watch_items` and `watch_runs` tables with full filtering decisions, download states, and retry counters.

---

## 🔒 Security Notes

- **Single Admin Authentication**: Protected with `bcrypt` password hashing, rate-limited login endpoints, and automatic session invalidation upon credential changes.
- **Private Network SSRF Guard**: Automatically blocks URLs targeting localhost, loopback, link-local, or private RFC 1918 IP addresses (including DNS resolution rebinding checks). Set `ALLOW_LOCAL_URLS=1` only if intentionally targeting internal mirrors.
- **Secrets Management**: Keep `.env` and `cookies.txt` secured. Do not expose the container directly to public networks without a TLS-terminating reverse proxy and strong authentication.

---

## 🔧 Troubleshooting

<details>
<summary><b>YouTube "Sign in to confirm you're not a bot" or age-restricted videos</b></summary>

Export your browser session cookies using an extension like *Get cookies.txt LOCALLY* and paste them into **Settings → Site Cookies**. Switch your yt-dlp channel to **Nightly** in **Settings → Tools** to incorporate the latest upstream extractor fixes.
</details>

<details>
<summary><b>Progress bars or speeds do not update in real time</b></summary>

Your reverse proxy is dropping WebSocket upgrade headers. Ensure your proxy configuration passes `Upgrade` and `Connection` headers (in Nginx Proxy Manager, toggle on **Websockets Support**).
</details>

<details>
<summary><b>Session logs out immediately or login fails to persist</b></summary>

Verify that `COOKIE_SECURE=1` is only enabled when accessing the application over HTTPS. If running behind a reverse proxy terminating TLS, ensure `TRUST_PROXY=1` is enabled in your environment.
</details>

<details>
<summary><b>A URL to an internal network service is rejected</b></summary>

The built-in SSRF private-address guard rejects loopback and private IP addresses by default. Set `ALLOW_LOCAL_URLS=1` in your container environment to permit internal targets.
</details>

<details>
<summary><b>Solverr proxy reachability check reports disconnected</b></summary>

Verify that `SOLVERR_PROXY_URL` and `SOLVERR_PROXY_CA_URL` are reachable from within the container. If both containers run on Docker, ensure they share the same Docker network bridge and that passwords containing special characters are properly URL-encoded.
</details>

---

## 💻 Local Development

Prerequisites: Node.js 24+, `yt-dlp`, `ffmpeg`, and `qjs` (QuickJS-ng) installed on your system `PATH`.

```bash
# Terminal 1: Backend API (http://localhost:3000)
cd server
npm install
npm run dev

# Terminal 2: Vite React Frontend (http://localhost:5173)
cd client
npm install
npm run dev
```

### Running Tests & Linting
```bash
# Server test suite
cd server
npm run test
npm run lint

# Client test suite
cd client
npm run test
npm run lint
```

```
client/              React 19 (Vite) frontend
  src/components/    Shared UI components, cards, drawers, dialogs
  src/context/       Global state contexts (Downloads, Staging, Toast)
  src/pages/         Top-level pages (Dashboard, Library, History, Watches, Music, Twitch, Links, Settings)
  src/cyberpunk.css  Cyber-Industrial Control Deck theme & HUD styles
  src/styles.css     Design tokens, palette, and base layout
server/
  src/index.js       Express + Socket.io entrypoint
  src/routes/        REST API route handlers
  src/services/      Queue runner, scheduler, music metadata, cleanup, updaters, notifications
  src/plugins/       NAS post-processing optimizer yt-dlp plugin
crawler/             Python CLI forum crawler
Dockerfile           Multi-stage build (Vite client + Node 24 runtime with yt-dlp & FFmpeg)
docker-compose.yml   Docker Compose deployment specification
```

---

## 🙏 Acknowledgements

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — The definitive command-line video and audio downloader.
- [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) — High-performance static FFmpeg binaries.
- [QuickJS-ng](https://github.com/quickjs-ng/quickjs) — Fast, embeddable JavaScript engine for YouTube challenge solving.
- [Deno](https://deno.com) — Modern JavaScript runtime for YouTube signature solving.
- [MusicBrainz](https://musicbrainz.org) & [AcoustID](https://acoustid.org) — Open music encyclopedia and acoustic fingerprinting.
