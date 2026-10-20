# Container Update Changelog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a readable, dismissible changelog for each new Docker image in yt-dlp-GUI, Shrinkarr, Solverr, and the Watchtower dashboard, with matching GitHub release notes for versioned releases.

**Architecture:** Each build generates a compact `build-info.json` containing the release version, full revision, and Markdown notes, then copies it into the image. Each app exposes the same `GET /api/release-notes` response and shows an accessible dialog once per revision in the browser. Version tags generate GitHub Releases after image validation; Watchtower reuses its existing GoReleaser release and publishes its dashboard as a separate GHCR image.

**Tech Stack:** GitHub Actions, Docker Buildx/GHCR, Node/Express/React, TypeScript/Fastify/React, Python/FastAPI/static JavaScript, Go/embedded HTML.

**Spec:** `docs/superpowers/specs/2026-10-20-container-update-changelog-design.md`

## Global Constraints

- Image metadata JSON fields are `version`, `revision`, and `notes`; the API returns those same fields from `GET /api/release-notes`.
- Notes and revision metadata are baked into the image; no GitHub network request occurs when the UI starts.
- Modal dismissal is stored per browser and full image revision; a new revision prompts again.
- Render headings, lists, links, and paragraphs safely; never inject untrusted HTML.
- An empty notes value or missing metadata hides the modal and does not prevent startup.
- Existing auth, tests, smoke checks, vulnerability scans, digest promotion, and image tags remain intact.
- Pull requests and validation-only runs publish neither images nor GitHub Releases.
- Watchtower's dashboard remains separate from the daemon, uses Basic auth, and never gains Docker socket access.

## Review Focus

- Malformed or absent build metadata must return safe defaults and keep the app usable (route tests in all four tasks).
- Markdown containing raw HTML or script tags must not execute (renderer tests in all four tasks).
- Empty notes must not show a blank dialog (UI tests in all four tasks).
- A dismissed revision stays dismissed, while a new revision prompts (UI tests in all four tasks).
- Release creation must run only after successful image validation and only for version tags (workflow checks in all four tasks).

---

### Task 1: yt-dlp-GUI release notes

**Files:**
- Modify: `.github/workflows/docker-publish.yml`, `.dockerignore`, `Dockerfile`
- Modify: `server/src/app.js`
- Create: `server/src/routes/releaseNotes.js`, `client/src/components/ReleaseNotesDialog.jsx`
- Modify: `client/src/App.jsx`, `client/src/styles.css`
- Test: `server/test/app/app.test.js`, new `client/src/components/ReleaseNotesDialog.test.js`

**Interfaces:**
- Produces `GET /api/release-notes` with `{ version, revision, notes }`; source file in the container is `/app/build-info.json`.
- Dialog reads this endpoint after login and stores dismissal under a key containing the full revision.

- [ ] Write failing API tests for populated metadata, missing/invalid metadata fallback, and auth behavior.
- [ ] Run `cd server && npm test`; confirm the new route tests fail.
- [ ] Add the endpoint and a testable safe Markdown renderer/dialog; ensure `.dockerignore` permits generated `build-info.json`.
- [ ] Write UI tests for empty notes, hostile HTML, same-revision dismissal, and new-revision prompt; run `cd client && npm test`.
- [ ] Generate push-range notes for main builds and tag-range notes for version tags; copy `build-info.json` into the final image. Add a contents-write release job that runs Release Changelog Builder and creates a GitHub Release only after the validated-image job succeeds.
- [ ] Run `cd server && npm test && npm run lint`, `cd client && npm test && npm run lint && npm run build`, and `actionlint .github/workflows/docker-publish.yml`; run the existing Docker smoke check.
- [ ] Commit `feat: show image release notes in yt-dlp-GUI`.

### Task 2: Shrinkarr release notes

**Files:**
- Modify: `.github/workflows/docker-publish.yml`, `docker/Dockerfile`
- Create: `server/src/api/routes/releaseNotes.ts`, `web/src/components/ReleaseNotesDialog.tsx`
- Modify: `server/src/api/server.ts`, `web/src/main.tsx`, `web/src/styles.css`
- Test: new `server/test/releaseNotesRoute.test.ts`, new `web/test/releaseNotes.test.ts`

**Interfaces:**
- Uses the same metadata JSON and `GET /api/release-notes` schema as Task 1.
- Route remains behind the existing authenticated application boundary; the dialog renders only inside `AuthGate`.

- [ ] Write failing Fastify route tests for valid, missing, invalid, and unauthenticated metadata access; run `npm test -w server`.
- [ ] Implement metadata loading and the route with no-store response headers; copy generated metadata into the runtime image.
- [ ] Write UI tests for empty notes, safe Markdown, and revision-based dismissal; run `npm test -w web`.
- [ ] Add the dialog to the authenticated shell and implement safe, keyboard-accessible Markdown presentation.
- [ ] Update the Docker workflow to embed per-push or tag-range notes and create a GitHub Release after all existing architecture smoke checks and scans pass.
- [ ] Run `npm test && npm run lint && npm run build` and `actionlint .github/workflows/docker-publish.yml`; run `bash scripts/ci/docker-smoke.sh`.
- [ ] Commit `feat: show image release notes in Shrinkarr`.

### Task 3: Solverr release notes

**Files:**
- Modify: `.github/workflows/docker-publish.yml`, `Dockerfile`
- Create: `app/api/release_notes.py`
- Modify: `app/main.py`, `app/templates/index.html`, `app/static/app.js`, `app/static/style.css`
- Test: `tests/test_api.py` and new focused release-notes tests

**Interfaces:**
- Uses the same metadata JSON and `GET /api/release-notes` schema as Task 1.
- The endpoint is independent of FlareSolverr-compatible `/v1` and `/v2` response contracts.

- [ ] Write failing FastAPI tests for populated and missing metadata; run `python -m unittest tests.test_api`.
- [ ] Add the endpoint and safe defaults; copy generated metadata into the runtime image.
- [ ] Add focused renderer/dialog tests for hostile HTML, empty notes, and per-revision dismissal; ensure the dialog is keyboard accessible.
- [ ] Add push-range notes for main images and tag-range notes for releases. Publish the GitHub Release only after the candidate passes current smoke and security gates.
- [ ] Run `python -m unittest discover -s tests`, `ruff check app/`, and `actionlint .github/workflows/docker-publish.yml`; run the existing Docker publish workflow tests.
- [ ] Commit `feat: show image release notes in Solverr`.

### Task 4: Watchtower dashboard image and release notes

**Files:**
- Modify: `dashboard/main.go`, `dashboard/static/index.html`, `dashboard/Dockerfile`, `dashboard/README.md`, `dashboard/compose.example.yml`
- Create: `dashboard/main_test.go`, `dashboard/compose.local.yml`, `.github/workflows/publish-dashboard.yml`
- Modify: `.github/workflows/build.yaml`, `build/goreleaser/stable.yaml` only as needed to feed the generated notes to the existing GoReleaser release

**Interfaces:**
- Dashboard endpoint uses the same `GET /api/release-notes` schema and metadata fields.
- Basic auth protects the endpoint. `ghcr.io/rpeters1430/watchtower-dashboard` is the published dashboard image; the existing daemon image and updater remain unchanged.

- [ ] Extract or add a testable dashboard handler, then write failing tests for Basic-auth protection, valid metadata, missing metadata, and method handling; run `cd dashboard && go test ./...`.
- [ ] Implement the endpoint and embedded dashboard dialog; verify safe Markdown, empty-note behavior, and per-revision dismissal.
- [ ] Write workflow tests/checks for main and version-tag image tags, candidate startup, and no publish on failed validation.
- [ ] Add a dashboard GHCR workflow that builds from `dashboard/`, includes `build-info.json`, publishes `latest`, short-SHA, and version tags, and uses push-range or tag-range notes.
- [ ] Update the example Compose file to use the published image by default and add a local-build override; document both paths.
- [ ] Feed Release Changelog Builder output to GoReleaser's `--release-notes` input for stable tags, remove `changelog.disable: true` from the stable config so GoReleaser honors the custom file, and keep GoReleaser as the only publisher for that tag.
- [ ] Run `cd dashboard && go test ./... && go build ./...`, `goreleaser check --config build/goreleaser/stable.yaml`, `actionlint .github/workflows/publish-dashboard.yml .github/workflows/release-stable.yaml .github/workflows/build.yaml`, and a local dashboard image smoke test.
- [ ] Commit `feat: publish Watchtower dashboard with release notes`.

---

## Integration Review

- Compare all four API payloads and ensure each returns the same field names and types.
- Confirm the three new release jobs and Watchtower GoReleaser use matching release notes for tags.
- Confirm main-branch note generation includes every commit from the push range, and first-push fallback behavior is covered.
- Run each repository's full CI gate and inspect the published candidate image without changing production NAS Compose deployments.
