# Reliable YouTube Watch System Design

## Purpose

Turn the existing YouTube channel and playlist watcher into a reliable, inspectable download automation system that can replace the user's core Youtarr workflow. This phase focuses on correct discovery, title filtering, durable download decisions, retries, and truthful UI metrics. Media-server synchronization and broader library-management features remain separate later phases.

## Goals

- Treat the first scan as a baseline unless the user explicitly requests a backfill.
- Download every eligible video discovered after the baseline, subject to a per-check queue limit without losing overflow items.
- Support explicit, validated, case-insensitive include and exclude regular expressions.
- Let users preview filter results against recent channel or playlist entries before saving.
- Preserve a durable record of every discovered item and the reason it was queued, skipped, or failed.
- Prevent duplicate watch downloads during overlapping checks, refreshes, and server restarts.
- Retry failed automatic downloads in a controlled and visible way.
- Report baseline, matched, queued, completed, filtered, and failed counts accurately.
- Detect when a scan cannot establish a known-video boundary instead of silently reporting success.
- Add automated coverage for the watch engine's critical decisions.

## Non-goals for This Phase

- Plex, Jellyfin, or Emby API integration and watched-state synchronization.
- Native media-server playlist synchronization or `.m3u` generation.
- `.nfo` sidecars, channel posters, or TV-series library layouts.
- Google Takeout subscription import.
- YouTube search and full in-app channel catalog browsing.
- Retention rules, disk quotas, notifications, and automatic deletion.
- Independent Videos, Shorts, and Streams subscriptions.

These are useful Youtarr-parity features, but each has a separate data model and failure surface. They should build on the reliable item ledger introduced here.

## Current Problems

1. The initial scan increments `last_new_count` for every baseline entry even though it deliberately queues no downloads. This produces the misleading `+89 New` badge shown in the reported screenshot.
2. `download_count` counts every associated download row, including queued, downloading, and failed jobs, while the UI labels the value "downloaded."
3. A newly discovered ID is inserted into `watch_seen_ids` before its download succeeds. A failure therefore becomes permanently seen and is not retried automatically.
4. When more eligible items are discovered than `download_limit`, all IDs are marked seen but only the first limited set is queued. The remaining eligible videos are silently abandoned.
5. Concurrent manual and scheduled checks can process the same watch because the global scheduler lock does not protect direct `checkWatch` calls.
6. A fixed scan depth can miss videos after a large upload burst. No run status tells the user that discovery stopped before reaching a known entry.
7. Invalid regular expressions silently become substring searches, so a typo changes semantics without warning.
8. The UI does not explain why a particular video was filtered, queued, or failed.

## Recommended Architecture

Keep the existing Express, SQLite, Socket.IO, React, and yt-dlp structure. Introduce a small watch domain layer between the scheduler/routes and the queue:

- `watchFilters`: compiles, validates, and evaluates title and duration rules.
- `watchDiscovery`: normalizes yt-dlp entries and scans until it reaches already known content or a hard safety ceiling.
- `watchRepository`: owns transactions and persistence for watch items and runs.
- `watchService`: coordinates a single watch check, baseline handling, filtering, backlog selection, and queue submission.
- `scheduler`: decides which watches are due and delegates to `watchService`; it no longer contains the business rules.
- `queue`: accepts a durable `watch_item_id` and reports lifecycle transitions back to the watch repository.

This separation keeps regular-expression evaluation and state transitions testable without spawning yt-dlp or running the HTTP server.

## Data Model

### `watch_items`

One row represents one source video discovered by one watch.

- `id`: integer primary key.
- `watch_id`: owning watch.
- `video_id`: normalized source ID.
- `url`, `title`, `duration`, `thumbnail`, `published_at`: last known metadata.
- `discovery_type`: `baseline`, `new`, or `backfill`.
- `filter_status`: `eligible` or `excluded`.
- `filter_reason`: human-readable reason such as `include regex did not match`, `exclude regex matched`, or `shorter than 60 seconds`.
- `download_status`: `none`, `queued`, `downloading`, `completed`, or `failed`.
- `download_id`: current or most recent download job.
- `attempt_count`, `last_error`, `next_retry_at`: retry state.
- `first_seen_at`, `updated_at`, `completed_at`: lifecycle timestamps.
- Unique constraint on `(watch_id, video_id)`.

The row is the durable source of truth. An item being discovered is separate from it being eligible, and eligibility is separate from download success.

### `watch_runs`

One row represents one attempted check.

- `id`, `watch_id`, `trigger`: `initial`, `scheduled`, or `manual`.
- `status`: `running`, `completed`, `partial`, or `failed`.
- `scanned_count`, `baseline_count`, `new_count`, `matched_count`, `excluded_count`, `queued_count`, `pending_count`, `failed_count`.
- `scan_boundary_reached`: whether discovery found a previously known entry.
- `error`, `started_at`, `finished_at`.

The latest run supplies the card badge. Initial baseline rows never contribute to `new_count`; explicitly selected backfill rows are reported separately as backfill.

### Existing Tables

- Add `watch_item_id` to `downloads` and index it.
- Retain `watch_seen_ids` during migration, but stop using it for new decisions.
- On startup, migrate existing seen IDs into `watch_items` as baseline items. Where an existing download can be matched by `watch_id` and `video_id`, carry over its current status and link it. Unmatched historical rows remain baseline rather than being guessed as completed.
- Existing watches and downloads remain intact; no files are deleted or moved.

## Discovery and Scheduling Flow

1. Acquire an in-memory per-watch lock. If the same watch is already running, return its current run rather than starting another check.
2. Create a `watch_runs` row with `running` status and emit a watch update.
3. Fetch flat playlist/channel entries in bounded pages. Begin with the configured scan depth and continue until either:
   - at least one known item is reached, or
   - a hard ceiling of 1,000 entries is reached.
4. Normalize and deduplicate entries by source video ID.
5. In a transaction, upsert metadata and classify unseen items:
   - First check with no requested backfill: `baseline`.
   - Explicit initial backfill selection: selected newest items are `backfill`; the rest are `baseline`.
   - Later checks: `new`.
6. Evaluate filters for new/backfill items and store both result and reason.
7. Select eligible items with `download_status` equal to `none`, plus failed items whose retry time has arrived. Queue at most `download_limit` during the run. Items beyond the limit remain pending and are eligible on the next run rather than being lost.
8. Insert each download job, link it to its watch item, and move the item to `queued` in one database transaction. Start queue processing only after that transaction commits.
9. Complete the run. If the hard scan ceiling was reached without a known boundary, mark it `partial`, retain all discovered work, and show a warning.
10. Emit the final watch/run metrics through Socket.IO.

The queue processes pending items newest-first by default, matching the current expectation that recent uploads matter most. Older overflow remains pending and drains on later runs.

## Download Lifecycle and Retry Policy

- Queue start changes the linked item from `queued` to `downloading`.
- Successful completion changes it to `completed` and sets `completed_at`.
- Failure changes it to `failed`, records the error, and increments `attempt_count`. Failures after the initial attempt become eligible for automatic retry no earlier than 15 minutes, 1 hour, and 6 hours respectively.
- Automatic retry stops after three retries (four total attempts including the initial attempt). The item remains visibly failed and can be retried manually. A due retry is picked up by the next scheduler or manual check, so the delay is a lower bound rather than an exact execution time.
- A server restart restores queued/downloading download jobs as it does today, while preserving their watch-item links.
- The unique watch-item constraint and state transition transaction make repeated discovery idempotent.
- Manual retry reuses the watch item but creates a new download attempt, retaining prior job history.

## Filter Semantics

Each watch has these rules:

- Include title regex: optional. If supplied, the title must match.
- Exclude title regex: optional. If supplied, a match excludes the item even when the include rule matched.
- Minimum and maximum duration: unchanged, evaluated after title rules.

Regex rules are case-insensitive. Patterns are stored without JavaScript literal delimiters; for example:

```text
\b(movie|video game|gameplay|official)\s+trailer\b
```

The server is authoritative. Create and update requests reject malformed or unsafe patterns with a clear `400` response. Pattern length is limited to 200 characters and the pure-JavaScript `safe-regex2` package screens patterns for catastrophic-backtracking risk. The UI performs syntax validation for immediate feedback but does not replace server validation.

Filter order is include, exclude, minimum duration, maximum duration. The first failed rule becomes `filter_reason`. Missing duration does not fail a duration rule; it is recorded as unknown and title rules still apply.

Changing filters affects future items and items whose `download_status` is `none` or `failed`, not queued, downloading, completed, or baseline items. During the next check, those eligible-to-reconsider items are reevaluated so a corrected rule can admit or exclude them. A preview does not persist changes. Existing valid regular expressions continue unchanged; if a legacy pattern is invalid or fails the safety screen, the watch enters a visible configuration-error state and queues nothing until the pattern is corrected rather than silently changing its meaning.

## API Changes

- Existing watch create/update/check/list endpoints remain compatible.
- `POST /api/watches/preview-filter` accepts a URL and candidate filter settings, inspects recent entries, and returns per-entry match status and reason.
- `GET /api/watches/:id/runs` returns recent run summaries.
- `GET /api/watches/:id/items` supports status filtering and pagination.
- `POST /api/watches/:id/items/:itemId/retry` manually retries a failed item.
- Check endpoints return a run identifier and an `alreadyRunning` indicator.
- Watch list responses provide explicit `baseline_count`, `pending_count`, `queued_count`, `completed_count`, `failed_count`, and latest-run fields. The old aggregate properties remain during the UI transition.

All new routes use the existing authentication middleware. Watch/item ownership is checked in SQL using both IDs.

## User Interface

### Watch Editor

- Rename fields to `Include title regex` and `Exclude title regex`.
- Add concise syntax help and the IGN trailer example.
- Show inline syntax/safety errors and prevent save while invalid.
- Add `Preview against recent videos`, displaying matched/excluded badges and reasons without changing the watch.

### Watch Card

- Replace the ambiguous `seen` and `downloaded` presentation with `cataloged`, `pending`, `queued`, `completed`, and `failed` values.
- The latest-run badge says `89 baseline`, `3 new / 2 queued`, `No new videos`, or `Partial scan` as appropriate.
- Initial baseline discovery never uses a green `+N New` badge.
- Failed and partial states receive visible actions instead of being hidden in logs.

### Activity Detail

- The downloads modal becomes an activity view with Items and Runs tabs.
- Items show title, discovery type, filter decision/reason, download state, attempts, last error, and retry where applicable.
- Runs show trigger, timestamps, scan boundary, and all counters.

## Error Handling and Observability

- A yt-dlp discovery error fails the run without altering existing item state.
- A per-entry metadata omission is stored as unknown rather than crashing the run.
- A database transaction failure leaves neither an item falsely queued nor an unlinked download.
- Partial scans are warnings, not successes and not total failures.
- Logs include watch ID, run ID, item ID, video ID, and state transition, without cookies or credentials.
- Socket.IO updates are advisory; reloading from the REST API always reconstructs the authoritative state.

## Testing and Verification

Use Node's built-in test runner for the server and add a `test` script. Pure filter and state-transition tests avoid external calls. Service tests use a temporary SQLite database plus fake discovery and queue adapters.

Required regression cases:

- A first scan of 89 entries creates 89 baseline items, zero new items, and zero downloads.
- An explicit backfill queues only the requested newest count.
- A later matching upload is queued once.
- Include and exclude regex precedence is correct and case-insensitive.
- Invalid and unsafe regex patterns are rejected by create, update, and preview endpoints.
- The IGN trailer example matches intended titles and rejects unrelated IGN uploads.
- Missing durations do not incorrectly exclude an otherwise matching title.
- Eligible overflow beyond `download_limit` remains pending and queues on a later run.
- A failed download retries according to policy and stops after three automatic retries.
- Manual retry works after automatic retries stop.
- Concurrent checks for one watch do not create duplicate items or jobs.
- Restart recovery preserves the watch-item/download relationship.
- A saturated scan without a known boundary is reported as partial.
- Watch card API counts only completed jobs as completed.
- Existing `watch_seen_ids` migrate without triggering a mass download.

Verification commands after implementation:

```text
cd server && npm test
cd client && npm run build
```

A manual verification will create a no-backfill watch, confirm the baseline badge, preview an include regex, publish or simulate one new matching and one nonmatching entry, and confirm only the matching entry is queued.

## Delivery Sequence

1. Add tests and the watch filter/domain modules.
2. Add schema migrations and repositories for items and runs.
3. Move scheduler behavior into the watch service and add per-watch locking.
4. Link queue lifecycle events to watch items and implement retries.
5. Add APIs and accurate aggregate queries.
6. Update the editor, filter preview, cards, and activity detail.
7. Run migration, regression, build, and manual checks.
8. Update the README to document filtering, baseline behavior, retries, and partial-scan warnings.

## Follow-on Phases

Once this ledger is stable, Youtarr-parity work can be added without guessing download history:

1. Videos/Shorts/Streams controls and richer channel catalog browsing.
2. Media-ready folder templates, sidecar metadata, channel artwork, and `.m3u` playlists.
3. Plex/Jellyfin/Emby refresh, playlist, and watched-state integration.
4. Subscription imports, notifications, retention policies, and storage management.
