# yt-dlp GUI — Design System & UI Specification

> **Concept:** *Cyber-Industrial Control Deck*  
> A high-density, precision media automation terminal combining the tactile rigor of professional audio/hardware workstations with the razor-sharp polish of modern developer tools (Linear, Raycast).

---

## 1. Vision & Core Principles

1. **Density with Purpose**: Every pixel conveys actionable telemetry (speed, ETA, container, resolution, host, post origin). No empty fluff, no decorative placeholders.
2. **Restrained Sci-Fi / Cyber HUD**: Deep obsidian surfaces with subtle violet depth, laser-etched 1px micro-borders, and crisp neon accents reserved exclusively for state and telemetry. No generic AI gradient washes, no excessive whole-page glass blur.
3. **Tactile Feedback & Speed**: Instant keyboard shortcuts (`⌘V` / `Ctrl+V`, `Enter`, `Esc`), snappy 120–180ms ease-out transitions, live connection pulses, and immediate optimistic updates.
4. **Ergonomic Hierarchy**: High-contrast typography separating primary metadata (titles, speeds) from secondary telemetry (codecs, IDs, timestamps) using clean grotesque and monospace fonts.

---

## 2. Design Tokens & Palette

### 2.1 Color Architecture

The palette uses a 4-tier dark depth model with semantic neon signaling:

| Token | Hex Value | Purpose & Usage |
| :--- | :--- | :--- |
| `--bg` | `#06050b` | Base ground (deep void black with faint violet undertone) |
| `--bg-rail` | `#090812` | Navigation rail / persistent shell backdrop |
| `--surface-1` | `#0d0c18` | Panels, staging tray backdrop, drawer canvas |
| `--surface-2` | `#131126` | Cards, active panels, input backgrounds |
| `--surface-3` | `#1b1736` | Hover states, active chips, dropdown items |
| `--surface-active`| `#241f48` | Selected segmented controls, pressed buttons |
| `--border-subtle` | `#1f1b3d` | Hairline dividers, card outlines |
| `--border-strong` | `#352f66` | Focused elements, active chip outlines |
| `--border-glow` | `#5c52a8` | Active input highlights, focused cards |

### 2.2 Semantic Neon Accents (Targeted Doses)

> [!IMPORTANT]
> Neon accents must be applied with purpose: at most 1–2 key elements per view draw the neon accent. Everything else remains matte.

- **`--neon-cyan` (`#00f0ff`) — Action & Telemetry**: Primary buttons, active tabs, yt-dlp analyzing radar, active filter chips, download progress fill.
- **`--neon-magenta` (`#ff2a6d`) — Live & Signal**: Live broadcast indicators (`● LIVE`), recording beacon, destructive actions (cancel/delete), error badges.
- **`--neon-green` (`#39ff9c`) — Success & Audio**: Completed downloads, online status badges, Music mode highlights, Lidarr verified tags.
- **`--neon-yellow` (`#f5ed00`) — Warning & Offline**: Duplicate link alerts, paused queue state, Cloudflare solver required notice, offline host check.
- **`--neon-violet` (`#b98cff`) — Streamer & Feeds**: Twitch channel monitoring, custom watch tags, archive password callouts.

### 2.3 Typography & Font Hierarchy

- **UI & Display**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif`
  - Crisp, neutral grotesk that avoids quirky geometry at small sizes.
- **Data, Telemetry, URLs & Logs**: `ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`
  - Strict tabular numbers (`font-variant-numeric: tabular-nums`) so progress percentages, speed readouts, and ETA stop jittering.

```
HUD Title (h1):       20px / 1.2  · Uppercase · Letter-spacing: 0.05em · Prefixed with "//"
Section Head (h2):    14px / 1.3  · Uppercase · Letter-spacing: 0.12em · Semibold
Body / Input:         14px / 1.45 · Regular · Color: #ece9ff
Secondary Meta:       12.5px / 1.4 · Color: #a9a6d6
Micro / Badges:       11px / 1.2  · Monospace · Uppercase · Bold
Log / Terminal:       12px / 1.5  · Monospace · Color: #cfcbf2
```

---

## 3. Component Blueprints & Layout Specs

### 3.1 The Dashboard Command Omnibar
```
+-----------------------------------------------------------------------------------+
|  // COMMAND CENTER                                                                |
|  +-------------------------------------------------------------+-------+-------+  |
|  | [Link Icon] Paste links: YouTube, Twitch, Bunkr, 1,700+... | Paste | ANALYZE |  |
|  +-------------------------------------------------------------+-------+-------+  |
|     (•) 2 active   ( ) 4 waiting   (✓) 1,420 done   (⚠) 2 failed                  |
+-----------------------------------------------------------------------------------+
```
- **Appearance**: Floating pill with chamfered 45° cut corners (`corner-shape: angle; border-radius: 4px;`).
- **Input Field**: Deep matte black interior (`#04030a`), 1px subtle purple border, pulsing cyan glow only when focused (`box-shadow: 0 0 0 1px #00f0ff, 0 0 16px rgba(0, 240, 255, 0.25)`).
- **Clipboard Integration**: Quick-action `Paste` button with keyboard hotkey tooltip (`⌘V`). Auto-analyzes upon paste when enabled in Settings.

### 3.2 Staging Tray (Prep Desk)
- **Role**: Sits immediately below the command bar once links are analyzed.
- **Card Anatomy**:
  - **Left**: 16:9 Thumbnail preview with live scanning frame during metadata lookup.
  - **Badges overlaid**: Duration, Resolution tag (`4K 60fps`, `1080p`), or `● LIVE`.
  - **Middle**: Title, extractor tag (`[YouTube]`, `[SoundCloud]`), file size preview, duplicate detector banner with inline *"Download anyway"* button.
  - **Right**: Quality selector dropdown, custom options drawer button, remove icon (`×`).
- **Batch Bar**: Persistent bottom strip displaying:
  `[ 3 links ready · 2 video · 1 playlist ] [ Options ] [ DOWNLOAD ALL (3) ]`

### 3.3 Now Downloading — Hero Telemetry Module
- **Dual Column Cockpit**:
  - **Left (Preview & Gauges)**: High-resolution media art, progress bar with glowing cyan leading edge, numerical readout (`68.4%`), speed gauge (`24.8 MB/s` smoothed), and dynamic ETA countdown (`1m 42s`).
  - **Right (Live Telemetry Terminal)**: Sleek black box terminal showing yt-dlp/ffmpeg stage lines (`[download] Destination: ...`, `[ffmpeg] Merging formats...`).
  - **Action Header**: One-click `Stop / Cancel`, `Folder Open`, `View Log` expansion.

### 3.4 LinkGrabber & Forum Crawler Interface
- **Multi-Select Filter Chips**:
  - Horizontal chip bar with host counters:
    `[ All Hosts ] [ ✓ Bunkr (18) ] [ ✓ Gofile (7) ] [ Pixeldrain (4) ] [ Mega (2) ]`
  - Multiple chips can be active simultaneously, filtering the view in real-time.
- **Grouped Post Architecture**:
  - Each post has a header: `Avatar / Author · Page 4 · Post #142 · Archive Passwords: [secret123 (Copy)]`.
  - Checkboxes allow selecting individual posts, specific link types, or the entire crawl.
- **Dispatch Footer (Floating Action Bar)**:
  - Sticky bottom controls:
    `[ 25 links selected (bunkr + gofile) · ~4.2 GB ] [ Target: JDownloader ▾ ] [ Auto-download ☑ ] [ Package per page ☑ ] [ SEND TO CLIENT ]`

### 3.5 Forum Watch Scheduler (Thread Watches)
- **Card Representation**:
  - Header: Thread Title or URL with external link arrow.
  - Cadence Badge: `Every 6 hours` (pulsing status dot: green for idle/ok, cyan for checking now, amber for warning).
  - Scope Badge: `Last 2 pages + new pages` (clarifies that as threads grow, newly discovered pages are crawled automatically).
  - Target Badge: `JDownloader (Auto-Download Enabled)`.
  - Link Types: `Types: bunkr, gofile`.
- **Inline Controls**: `[ On/Off Toggle ] [ Check Now Button ] [ View Latest Links ] [ Delete ]`.

---

## 4. Tactile Micro-Interactions & Motion

| Interaction | Duration | Easing | Visual Cue |
| :--- | :--- | :--- | :--- |
| **Button Click / Press** | `120ms` | `ease-out` | Transform scale `0.98`, subtle cyan border flash |
| **Card Hover** | `150ms` | `ease-out` | Border elevation from `--border-subtle` to `--border-strong`, background lift |
| **Drawer Slide (Options)** | `200ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | Slide in from right with subtle shadow backdrop |
| **Analyze Scanning** | `1.8s loop`| `cubic-bezier(0.45, 0, 0.55, 1)` | Vertical cyan beam sweeps over media art |
| **Live Broadcast Beacon**| `1.4s loop`| `ease-in-out` | Magenta pulse dot on active Twitch/YouTube streams |
| **Progress Bar Fill** | `200ms` | `linear` | Glowing head element smoothly interpolates progress |

---

## 5. Responsive Form Factors & Navigation

- **Desktop (1024px+)**:
  - Collapsible left navigation rail (`64px` icon-only or `220px` expanded with labels).
  - Main scroll canvas centered with max-width `1280px`.
  - Telemetry and statistics displayed inline alongside command controls.
- **Mobile & Tablet (< 1024px)**:
  - Persistent bottom Cyber TabBar (`54px` height) with touch-optimized 44px tap targets.
  - Floating action buttons collapse into bottom sheets.
  - Single-column cards with swipe gestures for removal/options.

---

## 6. Implementation Roadmap

1. **Phase 1 — Token Consolidation & Contrast Audit**:
   - Verify WCAG AA contrast on all muted text (`#a9a6d6` on `#0d0c18` = 7.1:1 ratio).
   - Ensure consistent 4px / 8px / 12px / 16px / 24px spacing grid across all screens.
2. **Phase 2 — Omnibar & Staging Tray Refinement**:
   - Modernize input bar styling with subtle chamfered corners and laser focus borders.
   - Enhance Analyze scanning animations and format picker pills.
3. **Phase 3 — LinkGrabber & Telemetry Polish**:
   - Implement multi-select chip toggle animations and bottom sticky dispatch bar.
   - Add live pulse telemetry to Thread Watch cards.
4. **Phase 4 — Responsive Density & Touch Polish**:
   - Optimize drawer transitions and touch tap-targets for mobile and PWA installs.
