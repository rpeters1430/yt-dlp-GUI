# NAS Processing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce repeated disk processing and identify the actual stage running on a NAS.
**Architecture:** Bundled yt-dlp postprocessor plugin plus shared Node semaphore; conservative metadata fusion, intermediate fast-start reduction, optional VOD scratch path, persistent stage clocks.
**Tech Stack:** Node CommonJS, Python standard library/yt-dlp, React.
**Spec:** docs/superpowers/specs/2026-11-04-nas-processing-design.md

## Global Constraints
Preserve media quality and user options. One heavy processor by default. No NAS deployment or runtime settings changes. No new runtime pip dependency. Existing live stop and retry semantics remain valid.

## Review Focus
- Killed/disconnected processes release permits, including queued acquisitions.
- Waiting for a processing slot is not treated as a download stall.
- Metadata fusion never loses subtitles, chapters, SponsorBlock changes or user arguments.
- Optional work paths retain final destinations and leave recoverable partials intact.
- Stage timestamps survive socket refresh and reset only on an actual stage change.

### Task 1: Processing gate and plugin
- [x] Write failing tests for serialized permits, disconnect release, and plugin processing events/fusion.
- [x] Implement server/src/services/processingGate.js and bundled plugin under server/yt-dlp-plugins/nas/yt_dlp_plugins/postprocessor/.
- [x] Verify focused Node/Python tests with actual yt-dlp and FFmpeg fixtures.

### Task 2: Download integration and safe I/O reductions
- [x] Test CLI plugin injection, metadata fusion eligibility, final fast-start preservation, and optional work directories.
- [x] Integrate gate lifecycle in ytdlp.js; route fallback artwork and liveSplitter through shared permits.
- [x] Replace unavailable percentage templates with named stage boundary events and duration logging.
- [x] Verify existing live, cancellation, retry and download tests.

### Task 3: Persistent timing, documentation, full verification
- [x] Test stage clocks and client elapsed formatting.
- [x] Add stage_started_at migration, queue updates and active-job UI elapsed display.
- [x] Document deployment options and the scope of safe fusion/work-directory support.
- [x] Run full server/client suites, Python integration tests, client build, lint and diff checks.
- [x] Obtain an independent branch review, address important findings, open a PR.
