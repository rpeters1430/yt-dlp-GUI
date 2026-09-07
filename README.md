# yt-dlp GUI

A self-hosted web app for downloading videos/audio from any site [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports (YouTube, Vimeo, Twitter/X, TikTok, SoundCloud, and hundreds more) — not just YouTube. Paste URLs, watch live progress, browse history, and optionally auto-monitor playlists/channels for new uploads.

## Features

- Paste one or many URLs at once, queued with configurable concurrency
- Live progress bars via WebSocket (percent, speed, ETA)
- Audio-only (MP3) and subtitle download options
- Download history with thumbnails and file paths
- "Watches" — point it at a playlist or channel URL and it checks every 30 minutes for new videos, auto-downloading them
- Simple username/password login (single admin account)

## Quick start (Docker Compose)

1. Copy this project to your NAS (e.g. via `git clone` or `scp`).
2. Copy `.env.example` to `.env` and set:
   - `ADMIN_USER` / `ADMIN_PASSWORD` — your login credentials
   - `SESSION_SECRET` — any random string
   - `.env` is gitignored, so real credentials never get committed — never put them directly in `docker-compose.yml`.
3. In `docker-compose.yml`, optionally set `TZ` to your timezone and change the `3000:3000` port mapping.
4. Build and start:
   ```bash
   docker compose up -d --build
   ```
5. Open `http://<your-nas-ip>:3000` and log in.

Downloaded files land in `./downloads` (host path, mounted into the container). The SQLite database and session store live in `./config`.

### Ugreen NAS

Ugreen's Docker/Container app UI can import a `docker-compose.yml` directly, or you can SSH in and run the `docker compose` commands above from the project directory. Make sure the host paths you mount for `downloads` and `config` are on a volume with enough free space.

## Updating yt-dlp

The `Dockerfile` installs the latest yt-dlp available at build time (sites change frequently and older versions can stop working, e.g. YouTube signature scheme changes). To pick up the newest yt-dlp release, just rebuild without cache:

```bash
docker compose build --no-cache
docker compose up -d
```

If you want reproducible builds instead, pin a version in the `Dockerfile` (`pip3 install yt-dlp==<version>`) — see https://pypi.org/project/yt-dlp/ for release history.

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

You'll also need `yt-dlp` and `ffmpeg` installed locally and on your `PATH`.

## Architecture

- **Backend**: Node.js + Express, `better-sqlite3` for storage, `socket.io` for live progress, `node-cron` for the watch scheduler. yt-dlp is invoked via `child_process.spawn`, not a library binding, so any yt-dlp version/site support works without code changes.
- **Frontend**: React (Vite), built and served as static files by the Express server — one container, one port.
- **Watches**: the first check on a new watch only records existing videos (no bulk backfill); subsequent checks auto-queue anything new.
