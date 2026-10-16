# SimpCity Link Crawler & JDownloader 2 Importer (Pro Suite)

A high-performance link crawler and duplicate-filtering tool built for SimpCity and XenForo forums. Automatically crawls threads, strips bot reposts and quote blocks, decodes Base64 links, extracts archive passwords, tracks history via SQLite, and pushes clean links directly into **JDownloader 2 LinkGrabber**.

---

## What's Included

- **Multi-Page & Whole-Thread Crawling:** Automatically detects max pages in a thread and supports crawling single pages, ranges (`--pages 1-5`), the latest pages (`--last 3`), or the entire thread (`--all-pages`).
- **Incremental Sync (SQLite History DB):** Tracks every crawled link in `crawled_history.db`. When you re-crawl an active thread, it only imports **new links** added since your last run.
- **Smart Duplicate Prevention:**
  - Automatically strips reply quote blocks (`.bbCodeBlock--quote`) so quoted links are not duplicated.
  - Automatically ignores automated mirror bots like `SussyBOT` (Filester re-uploads).
- **Base64 Link Auto-Decoder:** Automatically scans post text and code blocks for Base64-encoded strings and decodes hidden download links.
- **Archive Password Detection:** Automatically discovers archive passwords (`Password: 1234`, `Pass: ...`, `PW: ...`) and sends them directly to JDownloader 2 for automatic archive extraction upon download.
- **Batch Watchlist Processing:** Provide a `threads.txt` file to crawl multiple bookmarked threads sequentially.
- **Rich Terminal UI:** Visual summary tables and multi-page progress bars powered by `rich`.
- **Zero-Prompt JDownloader Integration:** Pushes via Click'n'Load HTTP API (`127.0.0.1:9666/flash/add`) and automatically syncs to Windows clipboard for instant capture.

---

## Usage Guide

### 1. Crawl a Single Page
```bash
python crawler.py "https://simpcity.cr/threads/thread-name.12345/page-27"
```

### 2. Crawl the Whole Thread (Page 1 to End)
```bash
python crawler.py "https://simpcity.cr/threads/thread-name.12345/" --all-pages
```

### 3. Crawl a Page Range
```bash
python crawler.py "https://simpcity.cr/threads/thread-name.12345/" --pages 20-27
```

### 4. Crawl Only the Last N Pages (Great for Daily Updates)
```bash
python crawler.py "https://simpcity.cr/threads/thread-name.12345/" --last 3
```

### 5. Batch Watchlist (Multiple Threads)
Put your thread URLs in `threads.txt` (one per line) and run:
```bash
python crawler.py threads.txt
```
*(You can combine this with `--last 3` to check the latest updates on all watched threads!)*

---

## Useful CLI Flags

| Flag | Description |
| :--- | :--- |
| `--all-pages` / `-a` | Crawl all pages of the thread |
| `--pages START-END` / `-p` | Crawl a specific page range (e.g. `--pages 10-15`) |
| `--last N` / `-l N` | Crawl only the last N pages of the thread |
| `--ignore-history` | Bypass history database and re-extract all links |
| `--history-stats` | Show total links and threads tracked in SQLite |
| `--include-bots` | Include automated mirror bots like SussyBOT |
| `--include-quotes` | Include links quoted inside user replies |
| `--all-external` | Extract all external links, not just known file hosters |
| `--no-jd` | Only save to text file, do not send to JDownloader |
| `--single-package` | Bundle all pages into one package instead of a package per page |
| `--jd-url URL` | Target JDownloader Click'n'Load URL (e.g. `http://192.168.50.114:9666`) |
| `--jd-host IP` | Target JDownloader host IP (default: `127.0.0.1` or `JD_HOST` env) |
| `--jd-port PORT` | Target Click'n'Load port (default: `9666`; note port 5800 is web UI only) |

---

## JDownloader on a NAS (Docker)

If running JDownloader 2 in Docker on a NAS (e.g. `jlesage/docker-jdownloader-2`):
- **Port 5800** is the noVNC **Web UI** for your browser.
- **Port 9666** is the **Click'n'Load HTTP API** used by this crawler and the web app to push links.

To allow link pushing from other computers on your network:
1. Ensure port `9666:9666` is mapped in your Docker compose / container settings.
2. In the JDownloader GUI (accessed via port 5800), go to **Settings** -> **Advanced Settings**.
3. Search for: `RemoteAPI: Extern Interface Localhost Only` and uncheck it (set to `false`).
4. Search for: `RemoteAPIConfig: Extern Interface Auth` and add your local network or IP.
5. In this app or CLI, configure the JDownloader address as `http://192.168.50.114:9666`.

---

## Whitelisting JDownloader (One-time Setup)

To allow JDownloader to accept links with **zero popups or prompts**:
1. In JDownloader 2, go to **Settings** -> **Advanced Settings**.
2. Search for: `externinterfaceauth`
3. Click on **`RemoteAPIConfig: Extern Interface Auth`** and add:
   ```json
   ["127.0.0.1", "localhost", "http://127.0.0.1", "http://localhost", "192.168.50.*"]
   ```
4. Also search for `addeddupes` and set **`LinkgrabberSettings: Default On Added Dupes Links Action`** to **`MERGE`** or **`SKIP`**.
