# Reliable YouTube Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current seen-ID watcher with a durable, regex-filtered watch ledger that baselines existing videos, downloads new matches exactly once, retries failures, and reports truthful activity.

**Architecture:** Add focused filter, discovery, repository, and orchestration modules under `server/src/services/watch/`. The scheduler delegates checks to an injected watch service, while the queue synchronizes download lifecycle changes back to durable watch items. REST and Socket.IO expose aggregate/item/run state to the existing React watch UI.

**Tech Stack:** Node.js CommonJS, Express 5, better-sqlite3, node-cron, Socket.IO, Node built-in test runner, `safe-regex2`, React 19, Vite 8.

**Spec:** `docs/superpowers/specs/2026-09-08-reliable-youtube-watch-design.md`

## Global Constraints

- Preserve all existing watches, downloads, and downloaded files.
- Treat a first scan with zero requested backfill as baseline: zero new and zero queued.
- Keep regex patterns case-insensitive, delimiter-free, no longer than 200 characters, and reject malformed or unsafe patterns.
- Apply filters in this order: include regex, exclude regex, minimum duration, maximum duration.
- Do not reevaluate queued, downloading, completed, or baseline items after filter edits.
- Limit discovery to 1,000 entries per check and report a partial run when no known boundary is reached.
- Permit three automatic retries after the initial attempt, with minimum delays of 15 minutes, 1 hour, and 6 hours.
- Keep the existing authenticated API and Socket.IO refresh behavior.
- Add no Plex, Jellyfin, Emby, `.m3u`, `.nfo`, import, notification, retention, or Videos/Shorts/Streams features in this phase.
- Do not add or commit `Screenshot 2026-09-08 203800.png`.

## File Map

- Create `server/src/services/watch/filters.js`: regex validation and deterministic filter decisions.
- Create `server/src/services/watch/discovery.js`: normalize and page flat yt-dlp entries to a known boundary.
- Create `server/src/services/watch/repository.js`: watch-item/run persistence, aggregates, migrations, and download state transitions.
- Create `server/src/services/watch/service.js`: per-watch locking and check orchestration.
- Modify `server/src/services/scheduler.js`: due-watch scheduling only; delegate checks to the watch service.
- Modify `server/src/services/ytdlp.js`: support `playlistStart` as well as `playlistEnd` in metadata calls.
- Modify `server/src/services/queue.js`: defer-start job creation and synchronize linked watch items.
- Modify `server/src/db.js`: tables, columns, indexes, and legacy seen-ID migration.
- Modify `server/src/routes/watches.js`: validation, preview, item/run APIs, retry, and aggregates.
- Modify `server/src/index.js`: construct and wire repository/service/scheduler dependencies.
- Modify `server/package.json` and `server/package-lock.json`: test script and `safe-regex2`.
- Create `server/test/helpers/tempDb.js`: isolated SQLite database loader.
- Create tests under `server/test/watch/`: filters, schema/repository, discovery, service, lifecycle, and routes.
- Modify `client/src/api.js`: preview, activity, and retry calls.
- Modify `client/src/components/WatchModal.jsx`: explicit regex fields, validation, and preview.
- Create `client/src/components/WatchActivityModal.jsx`: paginated items and recent runs.
- Modify `client/src/pages/Watches.jsx`: accurate metrics, badges, partial/error actions, and activity modal.
- Modify `client/src/styles.css`: regex preview, state badges, and activity layout.
- Delete `client/src/components/WatchDownloadsModal.jsx` after its caller moves to `WatchActivityModal`.
- Modify `README.md`: document baseline, filtering, pending work, retries, and partial scans.

---

### Task 1: Validated Watch Filter Engine

**Files:**
- Create: `server/src/services/watch/filters.js`
- Create: `server/test/watch/filters.test.js`
- Modify: `server/package.json`
- Modify: `server/package-lock.json`

**Interfaces:**
- Produces: `validatePattern(pattern, label) -> null | string` error message.
- Produces: `validateWatchFilters({ matchTitle, rejectTitle }) -> string[]`.
- Produces: `evaluateEntry(entry, watch) -> { eligible: boolean, reason: string | null }`.

- [ ] **Step 1: Add the test runner and regex-safety dependency**

Run from `server/`:

```powershell
npm install safe-regex2
npm pkg set scripts.test="node --test"
```

Confirm `safe-regex2` is in `dependencies`, `"test": "node --test"` is in `scripts`, and the lockfile changed.

- [ ] **Step 2: Write failing filter tests**

Create `server/test/watch/filters.test.js` with cases equivalent to:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePattern, evaluateEntry } = require('../../src/services/watch/filters');

test('rejects malformed, unsafe, and oversized patterns', () => {
  assert.match(validatePattern('[', 'Include'), /valid regular expression/i);
  assert.match(validatePattern('(a+)+$', 'Include'), /unsafe/i);
  assert.match(validatePattern('x'.repeat(201), 'Include'), /200/);
});

test('IGN trailer include is case-insensitive and exclude wins', () => {
  const watch = {
    match_title: '\\b(movie|video game|gameplay|official)\\s+trailer\\b',
    reject_title: '\\breaction\\b',
    min_duration: null,
    max_duration: null,
  };
  assert.deepEqual(evaluateEntry({ title: 'New Movie Trailer', duration: 120 }, watch), { eligible: true, reason: null });
  assert.deepEqual(evaluateEntry({ title: 'MOVIE TRAILER reaction', duration: 120 }, watch), { eligible: false, reason: 'Exclude title regex matched' });
  assert.deepEqual(evaluateEntry({ title: 'IGN Daily Fix', duration: 600 }, watch), { eligible: false, reason: 'Include title regex did not match' });
});

test('duration rules allow unknown duration and report first failed rule', () => {
  const watch = { match_title: null, reject_title: null, min_duration: 60, max_duration: 300 };
  assert.equal(evaluateEntry({ title: 'Unknown', duration: null }, watch).eligible, true);
  assert.deepEqual(evaluateEntry({ title: 'Short', duration: 30 }, watch), { eligible: false, reason: 'Shorter than 60 seconds' });
  assert.deepEqual(evaluateEntry({ title: 'Long', duration: 301 }, watch), { eligible: false, reason: 'Longer than 300 seconds' });
});
```

- [ ] **Step 3: Run the focused test and observe RED**

Run: `node --test test/watch/filters.test.js`

Expected: FAIL because `src/services/watch/filters.js` does not exist.

- [ ] **Step 4: Implement the filter module**

Implement `filters.js` with constants `MAX_PATTERN_LENGTH = 200`, `new RegExp(pattern, 'i')`, and `safeRegex(pattern)`. Empty/null patterns return no validation error. `evaluateEntry` assumes persisted patterns were validated, applies the required order, treats a non-number duration as unknown, and returns the exact reasons asserted above.

```js
function validatePattern(pattern, label) {
  if (!pattern) return null;
  if (typeof pattern !== 'string') return `${label} regex must be text`;
  if (pattern.length > MAX_PATTERN_LENGTH) return `${label} regex must be 200 characters or fewer`;
  try { new RegExp(pattern, 'i'); } catch (_) { return `${label} must be a valid regular expression`; }
  if (!safeRegex(pattern)) return `${label} regex is unsafe`;
  return null;
}
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test test/watch/filters.test.js`

Expected: 3 passing tests.

```powershell
git add server/package.json server/package-lock.json server/src/services/watch/filters.js server/test/watch/filters.test.js
git commit -m "feat: validate YouTube watch regex filters"
```

### Task 2: Durable Watch Schema and Repository

**Files:**
- Modify: `server/src/db.js`
- Create: `server/src/services/watch/repository.js`
- Create: `server/test/helpers/tempDb.js`
- Create: `server/test/watch/repository.test.js`

**Interfaces:**
- Consumes: filter decision fields from Task 1.
- Produces: `createRepository(db, { now })`.
- Repository methods: `createRun`, `finishRun`, `knownIds`, `upsertItems`, `queueCandidates`, `linkQueuedJob`, `applyDownloadState`, `resetForManualRetry`, `getItem`, `getWatch`, `listWatches`, `listItems`, `listRuns`, and `aggregateWatch`.

- [ ] **Step 1: Write a temporary database helper**

Create `server/test/helpers/tempDb.js`. It must create a unique directory with `fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-watch-'))`, set `process.env.CONFIG_DIR` before requiring `src/db.js`, clear the db module from `require.cache`, and return `{ db, cleanup }`. `cleanup` closes SQLite, restores the prior environment value, clears the cache again, and removes only the created temp directory.

```js
function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-watch-'));
  const previous = process.env.CONFIG_DIR;
  process.env.CONFIG_DIR = dir;
  const dbPath = require.resolve('../../src/db');
  delete require.cache[dbPath];
  const db = require(dbPath);
  return {
    db,
    cleanup() {
      db.close();
      delete require.cache[dbPath];
      if (previous === undefined) delete process.env.CONFIG_DIR;
      else process.env.CONFIG_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 2: Write failing schema, migration, and aggregate tests**

Create tests that insert one watch, three legacy `watch_seen_ids`, and downloads in `completed` and `failed` states. Reload the database and assert:

```js
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM watch_items').get().n, 3);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM watch_items WHERE discovery_type = 'baseline'").get().n, 3);
assert.equal(repo.aggregateWatch(watchId).completed_count, 1);
assert.equal(repo.aggregateWatch(watchId).failed_count, 1);
assert.equal(repo.aggregateWatch(watchId).new_count, 0);
```

Also assert the `(watch_id, video_id)` uniqueness constraint and that reloading the module does not duplicate migrated rows.

- [ ] **Step 3: Run the repository test and observe RED**

Run: `node --test test/watch/repository.test.js`

Expected: FAIL because `watch_items`, `watch_runs`, and `repository.js` do not exist.

- [ ] **Step 4: Add schema and repository implementation**

In `db.js`, create `watch_items` and `watch_runs` using the exact columns and enums from the spec. Add indexes on `watch_items(watch_id, download_status, next_retry_at)`, `watch_runs(watch_id, started_at)`, and `downloads(watch_item_id)`. Add `downloads.watch_item_id` through `ensureColumn`.

Run an idempotent startup transaction that:

```sql
INSERT OR IGNORE INTO watch_items
  (watch_id, video_id, title, discovery_type, filter_status, filter_reason, download_status)
SELECT watch_id, video_id, title, 'baseline', 'eligible', 'Migrated from seen history', 'none'
FROM watch_seen_ids;
```

Then link each migrated item to its most recent matching `downloads` row by `(watch_id, video_id)` and map `queued`, `downloading`, `completed`, and `failed` exactly. Do not infer completion for unmatched rows.

In `repository.js`, keep all SQL behind `createRepository`. `finishRun(id, fields)` must set `finished_at`; `linkQueuedJob(itemId, downloadId)` must require the current state to be `none` or retryable `failed`; `aggregateWatch` must count item states rather than all download rows.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test test/watch/repository.test.js`

Expected: all repository tests pass on a fresh and re-opened temp database.

```powershell
git add server/src/db.js server/src/services/watch/repository.js server/test/helpers/tempDb.js server/test/watch/repository.test.js
git commit -m "feat: add durable YouTube watch ledger"
```

### Task 3: Boundary-Aware Discovery

**Files:**
- Modify: `server/src/services/ytdlp.js`
- Create: `server/src/services/watch/discovery.js`
- Create: `server/test/watch/discovery.test.js`

**Interfaces:**
- Produces: `normalizeEntries(info) -> NormalizedEntry[]`.
- Produces: `scanToBoundary({ getInfo, url, knownIds, pageSize, hardLimit }) -> { entries, boundaryReached, saturated }`.
- Extends: `ytdlp.getInfo(url, { flatPlaylist, playlistStart, playlistEnd })`.

- [ ] **Step 1: Write failing discovery tests**

Use a fake `getInfo` that records `playlistStart`/`playlistEnd` and returns slices of a known array. Cover nested entries, duplicate IDs, a known ID on page two, and 1,000 unknown entries.

```js
const result = await scanToBoundary({
  getInfo: fakePagedInfo(entries),
  url: 'https://youtube.example/channel',
  knownIds: new Set(['known-40']),
  pageSize: 30,
  hardLimit: 1000,
});
assert.equal(result.boundaryReached, true);
assert.equal(result.saturated, false);
assert.equal(new Set(result.entries.map((e) => e.id)).size, result.entries.length);
assert.deepEqual(calls, [[1, 30], [31, 60]]);
```

For 1,000 unknown entries assert `boundaryReached === false`, `saturated === true`, and no request ends above 1,000.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test test/watch/discovery.test.js`

Expected: FAIL because the discovery module is absent and `getInfo` has no `playlistStart` option.

- [ ] **Step 3: Extend yt-dlp metadata arguments**

Change `getInfo` to accept `playlistStart = null`. For a positive start add `--playlist-start <value>` before `--playlist-end`. Preserve all current callers and timeout behavior.

- [ ] **Step 4: Implement normalized paged scanning**

Move recursive entry walking into `discovery.js`. Normalize to `{ id, url, title, duration, thumbnail, publishedAt }`, deduplicate by ID while preserving newest-first source order, and stop after the page containing the first known ID. `saturated` is true only when the hard limit is reached without a known boundary.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test test/watch/discovery.test.js`

Expected: all discovery tests pass.

```powershell
git add server/src/services/ytdlp.js server/src/services/watch/discovery.js server/test/watch/discovery.test.js
git commit -m "feat: scan watch sources to a known boundary"
```

### Task 4: Transactional Watch Check Orchestration

**Files:**
- Create: `server/src/services/watch/service.js`
- Modify: `server/src/services/scheduler.js`
- Modify: `server/src/index.js`
- Create: `server/test/watch/service.test.js`

**Interfaces:**
- Consumes: `evaluateEntry`, `scanToBoundary`, and repository methods from Tasks 1-3.
- Produces: `createWatchService({ repository, ytdlp, queue, emitWatchUpdate, now })`.
- Service methods: `checkWatch(watch, { manual = false, backfillCount = 0, trigger })` and `isRunning(watchId)`.
- Scheduler methods remain `init`, `start`, `checkAllWatches`, and `checkWatch` for route compatibility.

- [ ] **Step 1: Write failing orchestration regression tests**

Build fakes for discovery (`ytdlp.getInfo`) and queue creation. Use the temp repository. Required assertions:

```js
const initial = await service.checkWatch(watch, { manual: true, backfillCount: 0, trigger: 'initial' });
assert.equal(initial.baselineCount, 89);
assert.equal(initial.newCount, 0);
assert.equal(initial.queuedCount, 0);

const second = await service.checkWatch(reloadedWatch, { manual: true, trigger: 'manual' });
assert.equal(second.newCount, 2);
assert.equal(second.matchedCount, 1);
assert.equal(second.queuedCount, 1);
```

Add cases for exact initial backfill count, exclude precedence, more eligible videos than `download_limit` remaining pending, partial scan status, a discovery exception preserving prior items, and two simultaneous calls returning one shared/already-running result without duplicate jobs.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test test/watch/service.test.js`

Expected: FAIL because `service.js` does not exist.

- [ ] **Step 3: Implement check orchestration**

Use `Map<number, Promise>` for per-watch locks. Determine `initial` from `!watch.last_checked_at`. Persist all item classification before selecting candidates. For initial backfill, mark exactly the newest `backfillCount` eligible items as `backfill`, mark the rest baseline, and use `backfillCount` as that run's queue budget. Normal runs use `watch.download_limit`.

For normal runs, reevaluate only `none` and `failed` items against the current filters, then queue eligible `download_status = 'none'` items newest-first followed by due failed retries, up to the budget. Finish a scan at `partial` when discovery returns `saturated`; otherwise `completed`. On an exception, finish the run as `failed`, store the error, emit once, and rethrow to the route/scheduler boundary. Log every run and item transition with watch ID, run ID, item ID, and video ID; never include cookies or request headers.

- [ ] **Step 4: Reduce scheduler to timing and dependency wiring**

Construct the repository and watch service once in `index.js`, pass the service to `scheduler.init`, and make scheduler `checkWatch` delegate to it. Keep the five-minute cron tick and per-watch due-time calculation. A disabled watch remains skipped unless manually triggered.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test test/watch/service.test.js`

Expected: baseline, filtering, backlog, lock, partial, and failure tests pass.

```powershell
git add server/src/services/watch/service.js server/src/services/scheduler.js server/src/index.js server/test/watch/service.test.js
git commit -m "feat: orchestrate reliable YouTube watch checks"
```

### Task 5: Queue Lifecycle and Automatic Retry

**Files:**
- Modify: `server/src/services/queue.js`
- Modify: `server/src/services/watch/repository.js`
- Create: `server/test/watch/lifecycle.test.js`
- Modify: `server/test/watch/service.test.js`

**Interfaces:**
- Produces: `queue.createQueuedJob(url, options) -> { id, job }` without emitting or starting.
- Produces: `queue.startQueuedJobs(ids)` to emit committed jobs and wake workers.
- Preserves: `queue.enqueue(url, options) -> id` for manual and Twitch callers.
- Consumes: `options.watchItemId`; persists it as `downloads.watch_item_id`.

- [ ] **Step 1: Write failing lifecycle tests**

Test repository state transitions directly and service retry selection with a fixed clock:

```js
repo.applyDownloadState(itemId, 'downloading', { downloadId });
repo.applyDownloadState(itemId, 'failed', { downloadId, error: 'network' });
let item = repo.getItem(itemId);
assert.equal(item.attempt_count, 1);
assert.equal(item.next_retry_at, '2026-09-08 20:15:00');

// After retries at +15m, +1h, and +6h:
assert.equal(item.attempt_count, 4);
assert.equal(item.next_retry_at, null);
assert.equal(repo.queueCandidates(watchId, now).some((x) => x.id === itemId), false);
```

Also assert completed state, manual retry eligibility after attempt four, restart preservation of `watch_item_id`, and deletion of the current failed job leaving the item visible and manually retryable.

- [ ] **Step 2: Run lifecycle tests and observe RED**

Run: `node --test test/watch/lifecycle.test.js`

Expected: FAIL because transition/retry behavior and deferred queue creation are missing.

- [ ] **Step 3: Implement atomic queue linking**

Split existing enqueue behavior:

```js
function createQueuedJob(url, options = {}) {
  const id = uuidv4();
  const optionsJson = options.optionsJson
    ? (typeof options.optionsJson === 'string' ? options.optionsJson : JSON.stringify(options.optionsJson))
    : null;
  db.prepare(`
    INSERT INTO downloads
      (id, url, status, format_selector, audio_only, subtitles, quality, container,
       sub_langs, watch_id, watch_item_id, is_live, options_json, command_args, log)
    VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(
    id, url, options.formatSelector || null, options.audioOnly ? 1 : 0,
    options.subtitles ? 1 : 0, options.quality || null, options.container || 'mp4',
    options.subLangs || null, options.watchId || null, options.watchItemId || null,
    options.isLive ? 1 : 0, optionsJson
  );
  return { id, job: getJob(id) };
}
function startQueuedJobs(ids) { ids.forEach((id) => emit(getJob(id))); processNext(); }
function enqueue(url, options = {}) {
  const { id } = createQueuedJob(url, options);
  startQueuedJobs([id]);
  return id;
}
```

The watch service wraps `createQueuedJob` plus `repository.linkQueuedJob` in one better-sqlite3 transaction and calls `startQueuedJobs` after commit. Add `watch_item_id` to the download insert.

- [ ] **Step 4: Synchronize download transitions and retries**

After every persisted queue status change, call `repository.applyDownloadState` only when `job.watch_item_id` is set. Map queue states exactly: `queued`, `downloading`, `completed`, `failed`. Compute retry thresholds from `attempt_count`; only service checks queue due failures automatically. Add a repository method `resetForManualRetry(itemId)` that changes a terminal failure to retryable `failed` with `next_retry_at = now` without erasing attempt/error history.

- [ ] **Step 5: Verify lifecycle and full server tests, then commit**

Run: `npm test`

Expected: all filter, repository, discovery, service, and lifecycle tests pass.

```powershell
git add server/src/services/queue.js server/src/services/watch/repository.js server/test/watch/lifecycle.test.js server/test/watch/service.test.js
git commit -m "feat: link watch items to download retries"
```

### Task 6: Watch REST APIs and Truthful Aggregates

**Files:**
- Modify: `server/src/routes/watches.js`
- Modify: `server/src/index.js`
- Create: `server/test/watch/routes.test.js`

**Interfaces:**
- Consumes: watch service and repository injected through a route factory.
- Produces: `createWatchesRouter({ repository, watchService, ytdlp })`.
- Produces endpoints: `POST /preview-filter`, `GET /:id/runs`, `GET /:id/items`, and `POST /:id/items/:itemId/retry`.

- [ ] **Step 1: Make the router testable and write failing API tests**

Convert the current singleton export to a factory and mount it from `index.js`. Use a small Express app with authentication stubbed at the factory boundary or a logged-in test session. Test:

- create/update return 400 with the filter validator's exact error;
- initial create returns immediately and schedules an `initial` run with `backfillCount`;
- preview returns `{ id, title, eligible, reason }` rows and persists nothing;
- run/item list endpoints enforce both watch and item IDs;
- retry rejects a nonfailed or foreign item and accepts a terminal failed item;
- list aggregates distinguish baseline, pending, queued, completed, and failed;
- check returns `{ runId, alreadyRunning }`.

Example aggregate assertion:

```js
assert.deepEqual(body[0], assert.objectContaining({
  baseline_count: 89,
  new_count: 0,
  pending_count: 1,
  queued_count: 1,
  completed_count: 2,
  failed_count: 1,
}));
```

- [ ] **Step 2: Run route tests and observe RED**

Run: `node --test test/watch/routes.test.js`

Expected: FAIL because the router is not injectable and the new endpoints/fields do not exist.

- [ ] **Step 3: Implement validation, preview, activity, and retry routes**

Call `validateWatchFilters` before every create/update. Preview fetches at most 20 recent flat entries, normalizes them, and runs `evaluateEntry`; it never calls repository mutation methods. Parse `limit`/`offset` with maximum limit 100. Scope item and retry queries with `WHERE watch_id = ? AND id = ?`. Deleting a watch deletes its item/run rows and sets `watch_id` plus `watch_item_id` to null on retained download-history rows in one transaction.

- [ ] **Step 4: Replace duplicated list queries with repository aggregates**

Use one repository list method for initial REST responses and Socket.IO updates. Preserve `seen_count` as cataloged count and `download_count` as completed count during compatibility; add all explicit fields and latest-run status/counters. Reset history must delete non-completed items/runs and rebaseline on the next scan while retaining completed item evidence, preventing re-download of existing completed files.

- [ ] **Step 5: Verify API and server suite, then commit**

Run: `npm test`

Expected: all server tests pass, including the 89-baseline regression and endpoint authorization cases.

```powershell
git add server/src/routes/watches.js server/src/index.js server/test/watch/routes.test.js
git commit -m "feat: expose reliable watch activity APIs"
```

### Task 7: Explicit Regex Editor and Match Preview

**Files:**
- Modify: `client/src/api.js`
- Modify: `client/src/components/WatchModal.jsx`
- Modify: `client/src/styles.css`

**Interfaces:**
- Consumes: `POST /api/watches/preview-filter` from Task 6.
- Produces: `api.previewWatchFilters(payload)`.
- Preserves payload keys: `matchTitle`, `rejectTitle`, `minDuration`, and `maxDuration`.

- [ ] **Step 1: Add the API method and local validation state**

Add:

```js
previewWatchFilters: (payload) => request('/watches/preview-filter', {
  method: 'POST',
  body: JSON.stringify(payload),
}),
```

In `WatchModal`, add `filterErrors`, `previewing`, `previewRows`, and `previewError`. Validate regex syntax with `new RegExp(value, 'i')` on change; server safety errors are displayed from preview/save responses.

- [ ] **Step 2: Replace ambiguous filter copy**

Use labels `Include title regex` and `Exclude title regex`. Explain that exclude wins, matching is case-insensitive, and delimiters such as `/.../i` must not be entered. Include this exact example in a copy button or example control:

```text
\b(movie|video game|gameplay|official)\s+trailer\b
```

Disable Save and Preview while local syntax errors exist.

- [ ] **Step 3: Implement recent-video preview**

Send the current URL and all four filter values. Render each returned entry with `Matches` or `Excluded`, plus the server reason. Preview must work in create and edit modes and must not modify form values or save the watch.

- [ ] **Step 4: Style validation and preview states**

Add focused classes for field errors, the preview toolbar/list, match/excluded chips, long title truncation, empty results, and mobile stacking. Reuse existing theme variables and button styles.

- [ ] **Step 5: Build and commit**

Run from `client/`: `npm run build`

Expected: Vite production build completes without JSX, import, or lint-time transform errors.

```powershell
git add client/src/api.js client/src/components/WatchModal.jsx client/src/styles.css
git commit -m "feat: preview YouTube watch regex filters"
```

### Task 8: Watch Metrics and Activity UI

**Files:**
- Create: `client/src/components/WatchActivityModal.jsx`
- Delete: `client/src/components/WatchDownloadsModal.jsx`
- Modify: `client/src/pages/Watches.jsx`
- Modify: `client/src/styles.css`

**Interfaces:**
- Consumes: `api.getWatchItems(id, params)`, `api.getWatchRuns(id)`, and `api.retryWatchItem(watchId, itemId)`.
- Produces: `WatchActivityModal({ open, onClose, watch, onChanged })`.

- [ ] **Step 1: Add activity API methods**

Extend `client/src/api.js`:

```js
getWatchRuns: (id) => request(`/watches/${id}/runs`),
getWatchItems: (id, query = '') => request(`/watches/${id}/items${query}`),
retryWatchItem: (watchId, itemId) => request(`/watches/${watchId}/items/${itemId}/retry`, { method: 'POST' }),
```

- [ ] **Step 2: Create the Items activity tab**

Fetch the first 100 items when opened. Add status filters for All, Pending, Queued, Completed, Filtered, and Failed. Each row shows title, discovery type, filter reason, download status, attempts, last error, and a Retry button only for failed items. Retry refreshes activity and invokes `onChanged` so the card reloads.

- [ ] **Step 3: Create the Runs tab**

Render trigger, status, start/finish time, scanned, baseline, new, matched, excluded, queued, pending, and failed counts. A partial run shows `Scan limit reached before known content` and a warning icon. A failed run shows its stored error.

- [ ] **Step 4: Replace misleading card metrics and badge rules**

In `Watches.jsx`, compute totals from explicit fields. Card labels become Cataloged, Pending, Queued, Completed, and Failed. Badge selection order is:

```js
if (latest_run_status === 'partial') return 'Partial scan';
if (latest_run_status === 'failed') return 'Check failed';
if (latest_run_trigger === 'initial' && latest_baseline_count > 0) return `${latest_baseline_count} baseline`;
if (latest_new_count > 0) return `${latest_new_count} new / ${latest_queued_count} queued`;
return 'No new videos';
```

The original 89-item case must render `89 baseline`, never `+89 New`. Replace the Downloads modal import and state with the Activity modal.

- [ ] **Step 5: Build, manually inspect responsive states, and commit**

Run: `npm run build`

Expected: production build passes. At desktop and narrow viewport widths, open both tabs and confirm no clipped actions or horizontal page overflow.

```powershell
git add client/src/api.js client/src/components/WatchActivityModal.jsx client/src/pages/Watches.jsx client/src/styles.css
git add -u client/src/components/WatchDownloadsModal.jsx
git commit -m "feat: show truthful YouTube watch activity"
```

### Task 9: Migration, Documentation, and End-to-End Verification

**Files:**
- Modify: `README.md`
- Modify: tests from Tasks 2, 4, 5, and 6 only if an end-to-end gap is found.

**Interfaces:**
- Consumes: all prior task interfaces.
- Produces: documented operator behavior and fresh verification evidence.

- [ ] **Step 1: Add the migration regression scenario**

Extend the repository/service test to create an old-style database with one watch, 89 seen IDs, and no watch ledger. Reopen through `db.js`, run a manual check returning the same 89 IDs, and assert:

```js
assert.equal(result.baselineCount, 0);
assert.equal(result.newCount, 0);
assert.equal(result.queuedCount, 0);
assert.equal(repo.aggregateWatch(watchId).cataloged_count, 89);
```

This proves upgrading cannot trigger a mass download.

- [ ] **Step 2: Run the migration test and fix only integration defects**

Run: `node --test --test-name-pattern="migration"`

Expected: PASS. If it fails, change only the migration/wiring responsible and rerun this command before continuing.

- [ ] **Step 3: Update operator documentation**

In `README.md`, document:

- first check baseline versus explicit backfill;
- include/exclude regex semantics and the IGN example;
- pending items surviving per-check queue limits;
- four total attempts with three automatic retries;
- partial-scan warning at the 1,000-entry ceiling;
- Cataloged/Pending/Queued/Completed/Failed meanings;
- legacy seen-history migration and no automatic mass download.

- [ ] **Step 4: Run complete fresh verification**

From `server/` run:

```powershell
npm test
```

From `client/` run:

```powershell
npm run build
```

From the repository root run:

```powershell
git diff --check
git status --short
```

Expected: every server test passes, the client build succeeds, no whitespace errors appear, and the only unrelated untracked file remains `Screenshot 2026-09-08 203800.png`.

- [ ] **Step 5: Perform the bypass self-check and commit docs**

Exercise these adjacent variants with tests or the local UI/API:

- 89 baseline entries plus one matching new entry queues exactly one;
- 89 baseline entries plus one excluded new entry queues zero and records the reason;
- ten matching new entries with limit five leave five pending, then queue them on the next check;
- a repeated concurrent refresh creates no duplicate item or job;
- an invalid legacy regex creates a visible configuration error and queues nothing.

```powershell
git add README.md server/test
git commit -m "docs: document reliable YouTube watch automation"
```

Record the final test counts and Vite build result in the completion report. Do not claim completion if any required command failed.
