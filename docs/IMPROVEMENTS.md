# Improvements & Known Bugs

A running backlog of bugs and improvement ideas for the yt-dlp GUI. Check items off (or
delete them) as they land.

## Fixed

- [x] **Add downloads header overflowed on phones.** The title, "N links ready" badge,
  Paste, Clear and Sites Guide buttons sat in one non-wrapping flex row, so on a narrow
  screen the buttons were pushed past the card edge. The header now wraps the actions onto
  their own row (`client/src/pages/Dashboard.jsx`, `.intake-*` rules in `styles.css`).
- [x] **"Sites Guide" rendered as a blue underlined link** instead of a ghost button,
  because the `.btn-ghost` styles only target `<button>`, not the `<Link>` (`<a>`).
- [x] **Live recordings with chunk splitting were marked Failed after finishing.**
  `server/src/services/queue.js` called `fs.existsSync()` without importing `fs`, so the
  `ReferenceError` was caught by the job's error handler after the download had already
  completed. The file was kept but never split, and the job showed as failed.

## Bugs

- [ ] **Other `<Link className="btn-ghost">` / `btn-*` links have the same styling gap.**
  Button classes are written as `button.btn-*`. Either broaden them to `.btn-*` or audit
  pages for `<Link>`/`<a>` elements that use button classes.
- [ ] **"Default options" count badge looks clipped.** On mobile the accent badge next to
  "Default options" renders as a cramped highlight box with no horizontal padding
  (`.advanced-toggle .count-badge`). Give it padding and a pill radius like the other badges.
- [ ] **Job list is unbounded.** `queue.listJobs()` returns every download ever made, and
  it's sent in full over the socket on every connect (`jobs:init`) and from
  `GET /api/downloads`. With a long history this slows the first load and every reconnect.
  Paginate or cap it (e.g. active + the latest N finished), and load more on the History page.
- [ ] **`processNext()` runs `SELECT *` over all queued rows on every job finish**, including
  the parsed `options_json` for each. Fine for small queues, but a large playlist enqueue
  makes it quadratic-ish. Select only the columns needed and stop once slots are full.

## Improvements

### Downloads & queue

- [ ] **Retry failed downloads.** A normal (non-Watch) failed download can only be deleted.
  Add `POST /api/downloads/:id/retry` that resets the row to `queued`, plus a Retry button
  on failed queue/History items.
- [ ] **Bulk actions for failed/completed items.** "Clear all failed", "Retry all failed"
  and "Clear completed" — the dashboard currently shows 140 failed with no way to deal
  with them in one go.
- [ ] **Group failures by cause.** Show why things failed (bot check, unavailable, private,
  geo-blocked, network) so the user knows whether retrying makes sense.
- [ ] **Reorder / pause the queue.** Move jobs up/down, pause and resume the whole queue.
- [ ] **Configurable concurrency in Settings.** `MAX_CONCURRENT_DOWNLOADS` is env-only.
- [ ] **Duplicate detection.** Warn when a pasted URL (or video ID) was already downloaded.

### Mobile / UI

- [ ] **Audit every page at ~360–400px wide** for other non-wrapping flex rows with inline
  `style={{ display: 'flex' }}` (Dashboard had several). Moving inline layout styles into
  CSS classes makes this easier to fix in one place.
- [ ] **Share target / PWA.** Add a web app manifest with `share_target` so links can be
  shared straight from the phone's YouTube/X app into the GUI, instead of copy → paste.
- [ ] **Auto-analyze on paste** (optional setting) to save a tap on mobile.
- [ ] **Stat cards take a lot of vertical space on phones.** Use a 2-column (or compact
  horizontal) layout below 640px so the Add downloads box is visible without scrolling.

### Code quality & tooling

- [ ] **Code-split the client.** The production bundle is over 500 kB (Vite warns on every
  build); `Music.jsx` alone is ~3,000 lines. Lazy-load routes with `React.lazy`.
- [ ] **Split up large files.** `server/src/services/ytdlp.js` (~2,000 lines),
  `client/src/pages/Music.jsx` (~3,000) and `Twitch.jsx` (~1,000) are hard to review.
- [ ] **Add client linting and tests.** The client has no ESLint config and no tests; a
  basic ESLint setup would have caught the missing `fs` import class of bug on the server
  too (`no-undef`). Add ESLint to both packages and run it in CI.
- [ ] **Queue tests.** `queue.js` has no unit tests; cover the success, failure, removal
  mid-run, subtitle-retry and live-split paths.
