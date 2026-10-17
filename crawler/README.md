# Forum Link Crawler (command line)

A command-line front end to the web app's link grabber. Give it a forum thread and it prints the new file-host links, one URL per line, ready to copy. The app does the work: it reads each post, skips quoted replies and mirror-bot reposts, decodes Base64-hidden links, picks up archive passwords and keeps the link history. That history is shared, so a link listed here shows as already sent in the app, and the other way round.

**Nothing is sent anywhere by default.** Links are only printed. Sending to JDownloader (or the app's own queue, or aria2) is opt-in with `--jd` / `--send`, and so is copying to the clipboard (`--copy`).

---

## Setup

```bash
pip install -r requirements.txt
```

The app has to be running. Tell the crawler where it is and how to sign in:

| Setting | Default |
| :--- | :--- |
| `YTDLP_GUI_URL` or `--app-url` | `http://localhost:3000` |
| `YTDLP_GUI_USER` or `--user` | `admin` |
| `YTDLP_GUI_PASSWORD` | asked for when run in a terminal |

Forum cookies are the ones saved in the app under **Crawler cookies**. To use different ones for a run, pass `--cookies cookies.txt` (Netscape or Cookie-Editor JSON, see `cookies.example.json`, or a raw `name=value; ...` string). They're used for that run only and aren't stored.

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

# A list of threads: one URL per line in threads.txt (git-ignored)
python crawler.py threads.txt --last 3
```

One crawl reads at most 25 pages; the summary says when there were more. For threads you check regularly, a **thread watch** in the app does the same on a schedule, without this script.

The link list goes to **stdout** and everything else (progress, tables, passwords) to **stderr**, so you can:

```bash
python crawler.py URL > links.txt        # just the links in a file
python crawler.py URL --copy             # also put them on the clipboard
python crawler.py URL --by-page          # group by page, with passwords as '# ...' lines
```

Ctrl+C cancels the crawl in the app too. If one thread in a list fails, the rest still run and the failures are listed at the end (exit code 1).

### History

Every link listed is recorded in the app's history, so the next run (and the app) only shows **new** links. `--ignore-history` lists everything again; `--no-record` leaves the history untouched for a run. Links sent with `--jd` / `--send` are recorded by the send itself.

---

## Flags

| Flag | Description |
| :--- | :--- |
| `--all-pages` / `-a` | Crawl every page of the thread (up to 25) |
| `--pages RANGE` / `-p` | `10-15`, `20-` (to the last page) or `7` |
| `--last N` / `-l N` | Crawl only the last N pages |
| `--by-page` | Group the list by page with `# title - page N` and `# password:` lines |
| `--copy` | Copy the list to the clipboard (`clip`, `pbcopy`, `wl-copy`, `xclip` or `xsel`). If JDownloader's clipboard monitor is on, it will pick these up |
| `--output FILE` / `-o` | Write the list to FILE |
| `--save` | Write each thread's list to `links_<title>.txt` |
| `--ignore-history` | List links even if they were sent or listed before |
| `--no-record` | Don't add this run's links to the history |
| `--history-stats` | Show how many links and threads the history holds |
| `--include-bots` | Include mirror bots like SussyBOT |
| `--include-quotes` | Include links inside quoted replies |
| `--all-external` | Keep all external links, not just known file hosts |
| `--cookies FILE` / `-c` | Cookies for this run instead of the app's saved crawler cookies |
| `--app-url URL`, `--user NAME` | Where the app is and who to sign in as |

### Sending links (optional)

| Flag / setting | Description |
| :--- | :--- |
| `--jd` | Send the new links to JDownloader (same as `--send jdownloader`) |
| `--send queue\|jdownloader\|aria2` | Send them to that downloader, at the address saved in the app under **Downloaders** |
| `CRAWLER_SEND_TO_JD=1` | Environment setting: send every run to JDownloader without passing `--jd` |
| `--no-jd` | Never send, even when `CRAWLER_SEND_TO_JD` is set |
| `--single-package` | One JDownloader package per thread instead of one per page |

Links go to JDownloader with their archive passwords. The old `--jd-url`, `--jd-host`, `--jd-port` and `--delay` options are still accepted but do nothing: the JDownloader address now lives in the app, and so does the pause between pages.

---

## JDownloader on a NAS (Docker)

If running JDownloader 2 in Docker on a NAS (e.g. `jlesage/docker-jdownloader-2`):
- **Port 5800** is the noVNC **Web UI** for your browser.
- **Port 9666** is the **Click'n'Load HTTP API** the app uses to push links.

To allow link pushing from other computers on your network:
1. Ensure port `9666:9666` is mapped in your Docker compose / container settings.
2. In the JDownloader GUI (accessed via port 5800), go to **Settings** -> **Advanced Settings**.
3. Search for: `RemoteAPI: Extern Interface Localhost Only` and uncheck it (set to `false`).
4. Search for: `RemoteAPIConfig: Extern Interface Auth` and add your local network or IP.
5. In the app, under **Link grabber** -> **Downloaders**, use `http://<nas-ip>:9666` as the JDownloader address.

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
