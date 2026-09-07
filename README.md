# yt-dlp GUI

A self-hosted web app for downloading videos/audio from any site [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports (YouTube, Vimeo, Twitter/X, TikTok, SoundCloud, and hundreds more) — not just YouTube. Paste URLs, watch live progress, browse history, and optionally auto-monitor playlists/channels for new uploads.

## Features

- Paste one or many URLs at once, queued with configurable concurrency
- Live progress bars via WebSocket (percent, speed, ETA)
- Audio-only (MP3) and subtitle download options
- Download history with thumbnails and file paths
- "Watches" — point it at a playlist or channel URL and it checks every 30 minutes for new videos, auto-downloading them
- Simple username/password login (single admin account)
- YouTube cookie support (Settings page) for age-restricted/members-only/private videos
- Ships with the Deno JS runtime yt-dlp now requires to solve YouTube's JS challenges

## Quick start (Docker Compose)

A prebuilt image is published automatically to GitHub Container Registry on every merge to `main` (see [Automatic image builds](#automatic-image-builds)), so your NAS never needs to build anything itself — just pull.

1. Copy `docker-compose.yml` and `.env.example` to your NAS (a `git clone` or `scp` is the easiest way; you don't need the rest of the source).
2. Copy `.env.example` to `.env` and set:
   - `ADMIN_USER` / `ADMIN_PASSWORD` — your login credentials
   - `SESSION_SECRET` — any random string
   - `.env` is gitignored, so real credentials never get committed — never put them directly in `docker-compose.yml`.
3. In `docker-compose.yml`, optionally set `TZ` to your timezone and change the `3000:3000` port mapping.
4. Pull and start:
   ```bash
   docker compose pull
   docker compose up -d
   ```
5. Open `http://<your-nas-ip>:3000` and log in.

To pick up a newer image later (after a fix or update lands on `main`), just re-run `docker compose pull && docker compose up -d` — no rebuild needed.

Downloaded files land in `./downloads` (host path, mounted into the container). The SQLite database and session store live in `./config`.

### Ugreen NAS

Ugreen's Docker/Container app UI can import a `docker-compose.yml` directly, or you can SSH in and run the `docker compose` commands above from the project directory. Make sure the host paths you mount for `downloads` and `config` are on a volume with enough free space.

### Building locally instead

If you'd rather build the image yourself (e.g. to test an unmerged change), `docker-compose.yml` also has a `build: .` line, so `docker compose up -d --build` from a full clone of this repo builds and runs it locally instead of pulling.

## Automatic image builds

`.github/workflows/docker-publish.yml` builds and pushes a multi-arch (amd64 + arm64) image to `ghcr.io/rpeters1430/yt-dlp-gui:latest` on every push to `main` — including every merged PR — using GitHub Actions, so a new image is always available shortly after a change lands. It's also tagged with the short commit SHA if you ever need to pin to a specific build.

The first time this runs, the resulting GHCR package may default to private — if `docker pull` fails on the NAS with an auth error, go to the package's settings on GitHub and set its visibility to public (or `docker login ghcr.io` on the NAS with a personal access token that has `read:packages`).

If you want reproducible yt-dlp versions instead of always-latest, pin a version in the `Dockerfile` (`pip3 install yt-dlp==<version>`) — see https://pypi.org/project/yt-dlp/ for release history.

## YouTube JS runtime (Deno)

As of yt-dlp 2025.11.12+, full YouTube support requires an external JavaScript runtime to solve YouTube's JS challenges and generate PO tokens — the bundled `yt-dlp-ejs` component can't do this on its own. The `Dockerfile` installs [Deno](https://deno.com) (yt-dlp's default/recommended runtime) automatically for both amd64 and arm64, so no setup is needed. If you run the server outside Docker (see below), install Deno yourself and make sure it's on `PATH`.

## YouTube cookies

Some videos (age-restricted, members-only, private, or anything YouTube is being extra suspicious about) need you to be "logged in." Go to **Settings** in the app, export `cookies.txt` from a browser where you're signed into YouTube (e.g. the "Get cookies.txt LOCALLY" extension), and paste its contents in. It's saved to `./config/cookies.txt` with owner-only file permissions and used for every yt-dlp call. Treat that file like a password — anyone with it is logged in as you.

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
