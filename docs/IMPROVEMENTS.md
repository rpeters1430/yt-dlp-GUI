# Improvements & Known Bugs

A running backlog of bugs and improvement ideas for the yt-dlp GUI. Check items off (or
delete them) as they land.

## Fixed

### Bugs
- [x] **Add downloads header overflowed on phones.** The action buttons were pushed past the
  card edge; the header now wraps them onto their own row.
- [x] **Live recordings with chunk splitting were marked Failed after finishing**, for two
  separate reasons: `queue.js` used `fs` and `notify.js` used `path` without importing them.
  Both threw after the download had completed. Covered by queue tests now.
- [x] **Signed-out sessions could still receive job updates over the socket.** The socket
  handshake only checked `session.userId`, so a session invalidated by a password change
  kept streaming the job list. It now uses `validateSession` like the HTTP API.
- [x] **Music page never matched jobs by track metadata**: it read `job.optionsJson`, which
  doesn't exist (the column is `options_json`). It now matches by artist/album/title and
  reads `job.percent` instead of the non-existent `job.progress`.
- [x] **Lidarr dispatched queue badge never showed "Ready for Lidarr Import".** `lidarr.js`
  reports completed tasks as `pausedUP` (`100%`) and failed tasks as `error`, while `Music.jsx`
  only checked `task.state === 'uploading'`. Fixed to handle `pausedUP`, `error`, and `queuedDL`.
- [x] **Multi-part (`split_parts`) live stream recordings only played or downloaded Part 1 in
  Library.** `GET /api/library/:id/stream` and `/file` now accept `?part=<index>`, `withFileInfo`
  sums sizes across parts, and `PlayerOverlay` renders part selector chips with auto-advance.
- [x] **Deleting a download from History left files or `.part` fragments on disk.** Aborted
  downloads now clean up `.part`/`.ytdl` files immediately, and History's delete confirmation
  offers an option to also delete the downloaded media file, sidecars, and split parts.
- [x] **WebM container was offered in WatchModal but ignored by `ytdlp.js`.** `ytdlp.js`,
  `DownloadOptionsFields.jsx`, and `DownloadsSettings.jsx` now support `webm` consistently.
- [x] **"Watch Artist" in Music Hub pre-filled a `youtube.com/results?search_query=` URL.**
  Added `/api/music/artist-channel` (and automatic fallback resolution in `POST /api/music/watches`)
  to resolve the artist's canonical YouTube / Topic channel URL.
- [x] **Dead `api.getTwitchVods` client helper** targeting a non-existent endpoint was removed.
- [x] **Badges outside panel headers were unstyled** (the cramped "Default options 3"), and
  router `<Link>`s with `btn-*` classes rendered as plain underlined links.
- [x] **No feedback when opening an album's tracklist** or while the Sites guide loads.

### Performance
- [x] **The full download history was sent everywhere.** The job list (socket `jobs:init`
  and `GET /api/downloads`) is now every active job plus the newest 200 finished ones.
  Dashboard totals come from `GET /api/downloads/stats` / the `jobs:counts` socket event,
  so they stay exact.
- [x] **Every progress tick sent the full 500-line log** over the socket (up to 5×/second
  per job). Updates now carry the log only when it changed (≤1×/second).
- [x] **The client re-fetched the full history every 2s** while anything was downloading.
  It now polls only while the socket is disconnected (the socket resyncs on reconnect).
- [x] **The Twitch and Watches pages opened their own second socket.** Both now share the
  single Socket.IO connection managed by `DownloadsContext`.
- [x] **History filtered thousands of rows in the browser.** Search, status filter and
  paging ("Load more") now run on the server (`GET /api/downloads/history`).
- [x] **`processNext()` read every queued row on every finished download.** It now reads only
  as many as there are free slots, backed by an index on `(status, created_at)`.
- [x] **Client bundle was 614 kB.** Pages other than the dashboard load on first visit; the
  main bundle is 393 kB.
- [x] **Retry failed downloads & bulk actions** (`POST /api/downloads/:id/retry`,
  `POST /api/downloads/retry-failed`, `POST /api/downloads/clear-failed`), **configurable
  concurrency in Settings**, **duplicate detection**, and **auto-analyze on paste** are all
  implemented.

### Code quality & testing
- [x] **ESLint** for server and client (`npm run lint`, zero warnings), run in CI.
- [x] **`ytdlp.js` split** into `ytdlpPaths.js`, `ytdlpCookies.js` and `ytdlpTools.js`
  (2,000 → 1,300 lines); `ytdlp.js` re-exports everything, so callers are unchanged.
- [x] **Express app built in `src/app.js`** so tests exercise the real session/auth/router
  wiring; `index.js` only adds the server, socket.io and background jobs.
- [x] **Tests went from 146 to 216**, covering the queue lifecycle, `ytdlp.download()` (run
  against a fake yt-dlp binary in `test/fixtures`), auto-delete rules and file deletion,
  auth, the downloads API including `/info`, notification delivery, and a check that every
  API router rejects requests without a session. `npm run test:coverage` prints a report
  and runs in CI.

## Still open

### Bugs / risks
- [ ] **No socket.io handshake test.** The auth check is one call to the tested
  `validateSession`, but an end-to-end socket test would need `socket.io-client` on the server.
- [ ] **`GET /api/library` loads every completed row** and filters/sorts in JS before paging.
  Fine for thousands of rows; move filtering/sorting into SQL if libraries get much larger.

### Downloads & queue
- [ ] **Clear completed** bulk action in History.
- [ ] **Group failures by cause** (bot check, unavailable, private, geo-blocked, network).
- [ ] **Reorder / pause the queue.**

### Mobile / UI
- [ ] **Audit every page at ~360–400px** for other non-wrapping flex rows; many components
  still use inline `style={{ display: 'flex' }}`, which is hard to fix responsively.
- [ ] **Share target / PWA** so links can be shared straight from the YouTube/X app.
- [ ] **Compact stat cards on phones** so Add downloads is visible without scrolling.

### Code quality & testing
- [ ] **Split `client/src/pages/Music.jsx`** (~2,700 lines) into components, and
  `Twitch.jsx` (~1,150).
- [ ] **Client tests.** None yet; start with the downloads context (merge/update logic) and
  History paging using Vitest + Testing Library.
- [ ] **Remaining low-coverage server areas**: `music.js` (YouTube matching, ~14%),
  `jellyfinSync.js` / `plexSync.js` (~25%), `dependencyUpdater.js`, and the settings,
  library, music and Twitch routes beyond their read endpoints.
- [ ] **Some older tests write into the repo's `server/config/`** (e.g. the cookies test in
  `ytdlp.test.js`); move them onto a temp `CONFIG_DIR` like the newer tests.
