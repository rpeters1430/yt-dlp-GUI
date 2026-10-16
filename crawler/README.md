# Forum Link Crawler (SimpCity / XenForo)

Crawls forum threads and lists the file-hoster links found in the posts as a plain list, one URL per line, ready to copy. It strips quoted replies and mirror-bot reposts, decodes Base64-hidden links, picks up archive passwords and remembers which links it has already shown you.

**Nothing is sent anywhere by default.** Links are only printed. Sending to JDownloader is opt-in (`--jd`), and so is copying to the clipboard (`--copy`).

---

## Setup

```bash
pip install -r requirements.txt
```

Export your forum cookies while logged in (e.g. with the Cookie-Editor extension) to `cookies.json` or `cookies.txt` next to where you run the crawler. See `cookies.example.json`. Both names are git-ignored.

---

## Usage

```bash
# Links from one page
python crawler.py "https://simpcity.cr/threads/thread-name.12345/page-27"

# Whole thread / a range / everything from page 20 on / the last 3 pages
python crawler.py "https://simpcity.cr/threads/thread-name.12345/" --all-pages
python crawler.py "https://simpcity.cr/threads/thread-name.12345/" --pages 20-27
python crawler.py "https://simpcity.cr/threads/thread-name.12345/" --pages 20-
python crawler.py "https://simpcity.cr/threads/thread-name.12345/" --last 3

# A watchlist: one thread URL per line in threads.txt (git-ignored)
python crawler.py threads.txt --last 3
```

The link list goes to **stdout** and everything else (progress, tables, passwords) to **stderr**, so you can:

```bash
python crawler.py URL > links.txt        # just the links in a file
python crawler.py URL --copy             # also put them on the clipboard
python crawler.py URL --by-page          # group by page, with passwords as '# ...' lines
```

If one thread in a watchlist fails, the rest still run and the failures are listed at the end (exit code 1).

### History

Every link listed is recorded in `crawled_history.db` (and in the web app's history when `../config/app.db` exists), so the next run only lists **new** links. Use `--ignore-history` to list everything again, or `--no-record` to leave the history untouched for a run.

---

## Flags

| Flag | Description |
| :--- | :--- |
| `--all-pages` / `-a` | Crawl every page of the thread |
| `--pages RANGE` / `-p` | `10-15`, `20-` (to the last page) or `7` |
| `--last N` / `-l N` | Crawl only the last N pages |
| `--delay SECONDS` | Wait between page requests (default 0.5) |
| `--by-page` | Group the list by page with `# title - page N` and `# password:` lines |
| `--copy` | Copy the list to the clipboard (`clip`, `pbcopy`, `wl-copy`, `xclip` or `xsel`). If JDownloader's clipboard monitor is on, it will pick these up |
| `--output FILE` / `-o` | Write the list to FILE |
| `--save` | Write each thread's list to `links_<title>.txt` |
| `--ignore-history` | List links even if a previous run already found them |
| `--no-record` | Don't add this run's links to the history |
| `--history-stats` | Show how many links and threads the history holds |
| `--include-bots` | Include mirror bots like SussyBOT |
| `--include-quotes` | Include links inside quoted replies |
| `--all-external` | Keep all external links, not just known file hosts |
| `--cookies FILE` / `-c` | Cookie file to use instead of auto-detecting `cookies.json` / `cookies.txt` |

### Sending to JDownloader (optional)

| Flag / setting | Description |
| :--- | :--- |
| `--jd` | Send the new links to JDownloader via Click'n'Load |
| `CRAWLER_SEND_TO_JD=1` | Environment setting: send every run without passing `--jd` |
| `--no-jd` | Never send, even when `CRAWLER_SEND_TO_JD` is set |
| `--single-package` | One package per thread instead of one per page |
| `--jd-url URL` / `JD_URL` | Click'n'Load URL, e.g. `http://192.168.1.10:9666` |
| `--jd-host` / `JD_HOST`, `--jd-port` / `JD_PORT` | Host and port instead of a URL (defaults `127.0.0.1`, `9666`) |

Links are sent with their archive passwords. If JDownloader isn't reachable, the links are still listed.

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
5. In the web app or with `--jd-url`, use `http://<nas-ip>:9666` as the JDownloader address.

---

## Whitelisting JDownloader (One-time Setup)

To allow JDownloader to accept links with **zero popups or prompts**:
1. In JDownloader 2, go to **Settings** -> **Advanced Settings**.
2. Search for: `externinterfaceauth`
3. Click on **`RemoteAPIConfig: Extern Interface Auth`** and add:
   ```json
   ["127.0.0.1", "localhost", "http://127.0.0.1", "http://localhost", "192.168.1.*"]
   ```
4. Also search for `addeddupes` and set **`LinkgrabberSettings: Default On Added Dupes Links Action`** to **`MERGE`** or **`SKIP`**.
