# Container Update Changelog Design

**Date:** 2026-10-20  
**Status:** Approved in conversation for spec drafting; awaiting written-spec review  
**Repositories:** rpeters1430/yt-dlp-GUI, rpeters1430/Shrinkarr, rpeters1430/solverr, rpeters1430/watchtower

## Goal

After a Docker image update, show users a readable, dismissible changelog the next time they open the app. The notes must describe the deployed image, work without the app reaching GitHub at runtime, and appear again for a later image revision.

## Approved user experience

- A successful image build carries its build revision and rendered Markdown release notes.
- The app exposes its version and notes through a small API response.
- After the authenticated or otherwise protected app UI loads, a modal displays the notes once for that image revision in that browser. Dismissal is remembered per revision; a newer revision prompts again.
- Notes are rendered safely as formatted text. Missing notes or metadata do not block normal app startup.
- A version-tagged release also publishes a GitHub Release using the generated notes.

## Build and release behavior

The three existing GHCR workflows (yt-dlp-GUI, Shrinkarr, Solverr) continue to build and validate their images on main pushes and version tags. Notes for a main push describe the commits in that push. Tagged builds generate release notes across the previous release-to-current-tag range. The generated notes are added to the image only after release metadata is available, and the formal GitHub Release is created only after the image has passed the existing validation gates.

The linked Release Changelog Builder action is designed to generate notes for a tag and use them as a release body. Use its commit mode/configuration as appropriate for repositories whose changes are not consistently represented by merged PRs. Main-branch image notes still need to be produced for each push because those images are published before a version tag. Source: [GitHub Marketplace action guide](https://github.com/marketplace/actions/release-changelog-builder).

Watchtower has two distinct images. Its existing release workflow publishes the Watchtower daemon; the nested `dashboard/` app currently documents a local `docker compose up --build` deployment and has no GHCR publish workflow. Add an independent dashboard image build/publish path so the dashboard can be pulled after a push. Keep the daemon release process intact and attach the generated notes to its versioned release where compatible with the existing GoReleaser workflow.

## App-specific integration points

- **yt-dlp-GUI:** Node/Express API and React shell. The Docker context currently excludes Markdown files, so explicitly permit the generated notes file or use a non-ignored generated metadata file. Preserve login behavior.
- **Shrinkarr:** Fastify API and React UI. Add the metadata endpoint and show the modal inside the existing authenticated app shell.
- **Solverr:** FastAPI service and server-rendered dashboard. Add the metadata endpoint and a lightweight dashboard dialog; do not make the solver API contract depend on the notes endpoint.
- **Watchtower dashboard:** Standalone Go server and embedded static HTML, protected by HTTP Basic auth. Add a protected metadata endpoint, modal in the embedded dashboard, and GHCR image publishing. Do not add Docker socket access or change Watchtower's updater behavior.

## Requirements and constraints

1. Notes and revision metadata must be baked into the image; the UI must not fetch GitHub releases at runtime.
2. The modal is keyed by the image revision, is dismissible, is keyboard accessible, and does not obstruct routine startup when there are no notes.
3. Markdown rendering must be safe against HTML/script injection. Preserve headings, lists, links, and paragraphs in a readable layout.
4. The new metadata endpoint must respect the app's current authentication model. It must not expose secrets, host paths, or build environment values.
5. Notes generation and release creation must not bypass existing tests, image smoke checks, vulnerability scans, digest promotion, or least-privilege workflow permissions.
6. Build and release workflows must remain usable for pull requests, main pushes, manual validation, and tags; pull requests and validation-only runs must not publish releases.
7. Docker Compose examples for the Watchtower dashboard should support a published image and retain an explicit local-build option for development.

## Verification

- Workflow validation confirms: PRs validate only; main pushes publish images with push-specific notes; tags publish validated images and a GitHub Release with matching notes; failed validation publishes no release.
- Container smoke tests confirm the notes endpoint reports the expected revision and content from the image.
- UI tests confirm the modal appears for an unseen revision, stays dismissed for the same revision, and appears for a new revision.
- Security checks confirm notes are rendered as text/allow-listed Markdown and the endpoint follows existing auth rules.
- Watchtower dashboard tests verify Basic auth protects its new endpoint and the GHCR image starts without Docker socket access.

## Out of scope

- Automatically changing semantic versions or creating a Git tag on every push.
- Fetching release notes from GitHub when the app starts.
- Showing the same revision's modal after it has been dismissed in that browser.
- Changing any app's existing update, download, transcode, or Watchtower container-management behavior.
