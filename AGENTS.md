# AGENTS.md

Self-hosted web GUI for yt-dlp: an Express 5 + Socket.io backend that spawns `yt-dlp`/`ffmpeg`,
a React 19 + Vite single-page client, a Python forum-crawler CLI, and a bundled yt-dlp
post-processor plugin for NAS transcoding.

## Layout

```
client/                     React 19 SPA (ESM + JSX, react-router-dom 7)
  src/pages/                route screens; all but Dashboard/Login are lazy() in src/App.jsx
  src/components/           shared UI, colocated *.test.js next to the unit under test
  src/context/              Downloads / Staging / Toast providers
server/                     Express 5 API (CommonJS), entrypoint src/index.js
  src/app.js                builds the app (session, routers, static client) without listening
  src/routes/               REST handlers, mounted in src/app.js
  src/services/             queue, scheduler, yt-dlp runner, music, watches, link grabber, sync
  src/db.js                 better-sqlite3 schema; DB lives in $CONFIG_DIR/app.db
  test/                     integration tests; also src/**/*.test.js are discovered
  yt-dlp-plugins/nas/       NAS optimizer plugin, passed to yt-dlp via --plugin-dirs
  test/python/              unittest suite for that plugin
crawler/                    standalone Python CLI, talks to a running app over its REST API
scripts/ci/                 tool pinning, container smoke test, integration harness
docs/                       design notes, plans, release/rollback docs
Dockerfile                  multi-stage: Vite client build + Node runtime with yt-dlp/ffmpeg/qjs
build-info.json             version/revision/notes read by /api/release-notes; CI rewrites it
```

## Toolchain

- Node 26 is pinned in the Dockerfile and GitHub Actions; Node 24+ is enough for local work.
- Server code is CommonJS (`require`); client code is ESM with JSX. Both use ESLint 10 flat
  configs (`server/eslint.config.js`, `client/eslint.config.js`).
- There is no Prettier or other formatter: ESLint (`--max-warnings 0`) is the only style gate.
  Match the surrounding file. `_`-prefixed unused parameters and `catch (_) {}` are accepted
  idioms; the client linter also ignores capitalised unused imports because JSX hides usage.
- Python 3 is needed for audio tagging (`server/src/services/music/tag_audio.py`) and the NAS
  plugin; there is no Python linter in CI.

## Commands

Install (the `--omit=optional` flag matches CI and the Dockerfile; it skips an unused native
`sqlite3` chain):

```bash
cd server && npm ci --omit=optional --no-audit --no-fund
cd client && npm ci --no-audit --no-fund
```

```bash
# server (port 3000)
cd server && npm run dev      # same as start: node src/index.js
cd server && npm run lint
cd server && npm test         # node --test, auto-discovers **/*.test.js
cd server && npm run test:coverage

# client (port 5173, proxies /api and /socket.io to :3000)
cd client && npm run dev
cd client && npm run lint
cd client && npm test
cd client && npm run build    # writes client/dist, which the server serves statically

# NAS postprocessor plugin
python3 -m venv /tmp/nas && /tmp/nas/bin/pip install --pre 'yt-dlp[default]'
/tmp/nas/bin/python -m unittest discover -s server/test/python -v

# crawler CLI (needs a running app)
cd crawler && pip install -r requirements.txt
```

## Gotchas

- The server suite needs `ffmpeg`, `python3-mutagen` and `fpcalc` on `PATH`. Without ffmpeg
  roughly 55 music/tagging tests fail with `spawnSync ffmpeg ENOENT` while everything else
  passes. `PYTHON_BIN` selects the interpreter used for tagging (CI sets `/usr/bin/python3`).
- Tests must not share a database: `server/test/helpers/tempDb.js` re-requires `src/db.js`
  against a fresh `CONFIG_DIR`. Set `CONFIG_DIR` to a temp path for any manual run too,
  otherwise `app.db` is written to `./config` in the repo (git-ignored).
- Startup takes ~20s (tool/dependency probing) before `server listening`; `/api/health` is
  the readiness check. `ADMIN_USER`/`ADMIN_PASSWORD` only seed the first user — with no
  `ADMIN_PASSWORD` a random one is logged once at first boot.
- `better-sqlite3` is native: it compiles from source when no prebuilt binary matches the Node
  version, so a C toolchain is required on a fresh install.
- `npm test` in `client/` runs an explicit file list from `client/package.json`; a new client
  `*.test.js` will not run until it is added there. The server runner auto-discovers.
- CI (`.github/workflows/docker-publish.yml`) runs on PRs: server lint + tests with coverage +
  the Python plugin tests, then client lint/test/build. Image builds are validated with
  `scripts/ci/docker-smoke.sh` and only pushed to GHCR for `main` and `v*.*.*` tags.
  `.dockerignore` excludes `*.md` and `.github`, so docs never reach the image.
- The README's directory tree is out of date in places (it lists `server/src/plugins/`); the
  plugin really lives in `server/yt-dlp-plugins/`.
