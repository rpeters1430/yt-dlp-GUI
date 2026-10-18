#!/usr/bin/env python3
"""
Forum link crawler: a command-line front end to the yt-dlp GUI app's link grabber.

The app does the crawling (post by post, skipping quotes and mirror bots, decoding Base64
links, finding archive passwords) and keeps the one link history, so a link sent or listed
here shows as already seen in the app too, and the other way round. Run with a thread URL,
or a text file of thread URLs, and the new file-host links print to stdout, one per line.
Nothing is sent anywhere unless you ask: --jd (or --send) hands them to a downloader through
the app, using the addresses saved under Downloaders there.

Connection: YTDLP_GUI_URL (default http://localhost:3000), YTDLP_GUI_USER and
YTDLP_GUI_PASSWORD, or --app-url / --user and a password prompt.
"""

import argparse
import getpass
import os
import re
import shutil
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from rich.console import Console
from rich.table import Table

# Status, tables and progress go to stderr; stdout carries only the link list.
console = Console(stderr=True)

POLL_SECONDS = 1.0
TARGETS = ("queue", "jdownloader", "aria2")


class AppError(Exception):
    """The app refused a request or couldn't be reached; the message says why."""


class App:
    """A signed-in session with the yt-dlp GUI app."""

    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self.http = requests.Session()

    def request(self, method: str, path: str, **kwargs) -> Any:
        try:
            res = self.http.request(method, f"{self.base}/api{path}", timeout=60, **kwargs)
        except requests.RequestException as e:
            raise AppError(f"could not reach the app at {self.base}: {e}") from e
        try:
            data = res.json()
        except ValueError:
            data = None
        if not res.ok:
            message = data.get("error") if isinstance(data, dict) else None
            raise AppError(message or f"HTTP {res.status_code} from {path}")
        return data

    def login(self, user: str, password: str) -> None:
        self.request("POST", "/auth/login", json={"username": user, "password": password})

    def crawl(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Starts a crawl and waits for it, showing progress. Ctrl+C cancels it on the server."""
        crawl_id = self.request("POST", "/linkgrabber/crawl", json=options)["id"]
        try:
            with console.status("[bold yellow]Fetching the first page...[/bold yellow]") as status:
                while True:
                    crawl = self.request("GET", f"/linkgrabber/crawls/{crawl_id}")
                    if crawl["status"] != "running":
                        return crawl
                    p = crawl.get("progress")
                    if p:
                        status.update(f"[bold yellow]Page {p['pagesDone']} of {p['pagesPlanned']}, {p['links']} links so far...[/bold yellow]")
                    time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            self.request("POST", f"/linkgrabber/crawls/{crawl_id}/cancel", json={})
            console.print("[yellow]Cancelled.[/yellow]")
            raise


def parse_page_range(raw: str) -> Optional[Tuple[int, Optional[int]]]:
    """'20-27' -> (20, 27); '5' -> (5, 5); '20-' -> (20, None) meaning through the last page."""
    match = re.match(r"^\s*(\d+)\s*(?:-\s*(\d*)\s*)?$", raw)
    if not match:
        return None
    start = int(match.group(1))
    if match.group(2) is None:
        return start, start
    end = int(match.group(2)) if match.group(2) else None
    if end is not None and end < start:
        return None
    return start, end


def crawl_options(url: str, args: argparse.Namespace, page_range, cookies_text: str) -> Dict[str, Any]:
    options: Dict[str, Any] = {
        "url": url,
        "skipQuotes": not args.include_quotes,
        "skipBots": not args.include_bots,
        "ignoreHistory": args.ignore_history,
        "useSavedCookies": True,
    }
    if cookies_text:
        options["cookies"] = cookies_text
    if getattr(args, "user_agent", None):
        options["userAgent"] = args.user_agent
    if getattr(args, "solver_url", None):
        options["solverUrl"] = args.solver_url
    if args.all_pages:
        options["mode"] = "all"
    elif args.last:
        options.update(mode="last", lastN=args.last)
    elif page_range:
        options.update(mode="range", startPage=page_range[0])
        if page_range[1] is not None:
            options["endPage"] = page_range[1]
    else:
        options["mode"] = "single"
    return options


def new_links(result: Dict[str, Any], all_external: bool) -> List[Dict[str, Any]]:
    return [l for l in result["links"] if l["isNew"] and (all_external or l.get("hoster"))]


def print_summary(result: Dict[str, Any], links: List[Dict[str, Any]]) -> None:
    title = result.get("threadTitle") or (result["pages"][0]["title"] if result["pages"] else "?")
    table = Table(title=f"Results: {title}", show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="dim", width=28)
    table.add_column("Value", style="bold")
    table.add_row("Pages scanned", f"{len(result['pages'])} (thread has {result['maxPage']})")
    table.add_row("Links found", str(len(result["links"])))
    table.add_row("New links", f"[green]{len(links)}[/green]")
    table.add_row("Already seen (history)", f"[yellow]{result['historyCount']}[/yellow]")
    if result["passwords"]:
        table.add_row("Archive passwords", f"[cyan]{', '.join(result['passwords'])}[/cyan]")
    console.print(table)
    if result.get("error"):
        console.print(f"[bold red]Stopped early: {result['error']}. Keeping the pages fetched so far.[/bold red]")
    if result.get("hasMorePages"):
        console.print("[yellow]There are more pages than this crawl read (at most 25 per crawl).[/yellow]")

    if links:
        counts: Dict[str, int] = {}
        for link in links:
            counts[link["host"]] = counts.get(link["host"], 0) + 1
        hosts = Table(title="New links by host", show_header=True, header_style="bold green")
        hosts.add_column("Host", style="cyan")
        hosts.add_column("Count", justify="right", style="bold white")
        for host, count in sorted(counts.items(), key=lambda x: x[1], reverse=True):
            hosts.add_row(host, str(count))
        console.print(hosts)


def format_links(crawled: List[Tuple[Dict[str, Any], List[Dict[str, Any]]]], by_page: bool = False) -> str:
    """Plain text for copying: one URL per line, optionally with '# ...' headers per page."""
    lines: List[str] = []
    for result, links in crawled:
        if not by_page:
            lines.extend(l["url"] for l in links)
            continue
        pages: Dict[int, List[str]] = {}
        for link in links:
            pages.setdefault(link["page"], []).append(link["url"])
        for page, urls in pages.items():
            if lines:
                lines.append("")
            lines.append(f"# {result.get('threadTitle') or 'thread'} - page {page}")
            pws_map = result.get("pagePasswords") or {}
            passwords = pws_map.get(str(page)) or pws_map.get(page)
            if passwords:
                lines.append(f"# password: {', '.join(passwords)}")
            lines.extend(urls)
    return "\n".join(lines)


def copy_to_clipboard(text: str) -> bool:
    """Copy text with the platform's clipboard tool. Returns False if none is available."""
    candidates = [
        ["clip"],
        ["pbcopy"],
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
        ["xsel", "--clipboard", "--input"],
    ]
    for cmd in candidates:
        if shutil.which(cmd[0]):
            try:
                # clip.exe needs a UTF-16 BOM to read non-ASCII; the others take UTF-8
                data = text.encode("utf-16" if cmd[0] == "clip" else "utf-8")
                subprocess.run(cmd, input=data, check=True, timeout=10)
                return True
            except Exception:
                continue
    return False


def safe_filename(title: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", title)[:50] or "thread"


def read_cookies(value: Optional[str]) -> str:
    """--cookies takes a cookies.txt / cookies.json file, or a raw 'name=value; ...' string.
    If omitted, checks common crawler and config locations for a cookies.txt file."""
    if value:
        if os.path.isfile(value):
            with open(value, "r", encoding="utf-8") as f:
                return f.read()
        return value
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "cookies.txt"),
        os.path.join(here, "..", "config", "crawler_cookies.txt"),
        os.path.join(here, "..", "config", "cookies.txt"),
    ]
    for c in candidates:
        if os.path.isfile(c) and os.path.getsize(c) > 0:
            try:
                with open(c, "r", encoding="utf-8") as f:
                    content = f.read()
                if content.strip():
                    console.print(f"[dim]Using local cookies from {os.path.relpath(c, here)}[/dim]")
                    return content
            except Exception:
                pass
    return ""


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def connect(args: argparse.Namespace) -> App:
    app = App(args.app_url)
    user = args.user or os.environ.get("YTDLP_GUI_USER") or "admin"
    password = getattr(args, "password", None) or os.environ.get("YTDLP_GUI_PASSWORD")
    if not password:
        if not sys.stdin.isatty():
            raise AppError("set YTDLP_GUI_PASSWORD (no terminal to ask for it)")
        password = getpass.getpass(f"Password for {user} at {app.base}: ", stream=sys.stderr)
    app.login(user, password)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Crawl forum threads for download links through the yt-dlp GUI app.",
        epilog="Links print to stdout one per line; everything else goes to stderr.",
    )
    parser.add_argument("target", nargs="?", help="Thread URL, or a text file with one thread URL per line")
    parser.add_argument("--app-url", default=os.environ.get("YTDLP_GUI_URL", "http://localhost:3000"),
                        help="The app's address (or YTDLP_GUI_URL; default http://localhost:3000)")
    parser.add_argument("--user", default=None, help="App username (or YTDLP_GUI_USER; default admin). The password comes from --password, YTDLP_GUI_PASSWORD or a prompt")
    parser.add_argument("--password", "-P", default=None, help="App password (or YTDLP_GUI_PASSWORD)")

    pages = parser.add_argument_group("pages (one page by default; at most 25 per crawl)")
    pages.add_argument("--all-pages", "-a", action="store_true", help="Crawl every page of the thread")
    pages.add_argument("--pages", "-p", default=None, help="Page range: 20-27, 20- (to the end) or 5")
    pages.add_argument("--last", "-l", type=int, default=None, help="Crawl only the last N pages")

    filters = parser.add_argument_group("filtering")
    filters.add_argument("--all-external", action="store_true", help="Keep all external links, not just known file hosts")
    filters.add_argument("--include-quotes", action="store_true", help="Include links inside quoted replies")
    filters.add_argument("--include-bots", action="store_true", help="Include mirror bots like SussyBOT")
    filters.add_argument("--ignore-history", action="store_true", help="List links even if they were sent or listed before")
    filters.add_argument("--no-record", action="store_true", help="Don't add this run's links to the history")

    output = parser.add_argument_group("output")
    output.add_argument("--by-page", action="store_true", help="Group the list by page with '# ...' headers and passwords")
    output.add_argument("--copy", action="store_true", help="Also copy the link list to the clipboard")
    output.add_argument("--output", "-o", default=None, help="Write the link list to this file")
    output.add_argument("--save", action="store_true", help="Write each thread's links to links_<title>.txt")

    send = parser.add_argument_group("sending (off unless --jd, --send or CRAWLER_SEND_TO_JD=1)")
    send.add_argument("--jd", action="store_true", help="Send the new links to JDownloader (same as --send jdownloader)")
    send.add_argument("--send", choices=TARGETS, default=None, help="Send the new links to this downloader, as set up in the app")
    send.add_argument("--no-jd", action="store_true", help="Never send, even if CRAWLER_SEND_TO_JD is set")
    send.add_argument("--single-package", action="store_true", help="One JDownloader package per thread instead of per page")
    # Older options whose job moved into the app: still accepted so scripts keep running.
    for old in ("--jd-url", "--jd-host", "--jd-port", "--delay"):
        send.add_argument(old, default=None, help=argparse.SUPPRESS)

    parser.add_argument("--cookies", "-c", default=None, help="Cookie file or string for these crawls, instead of the app's saved crawler cookies")
    parser.add_argument("--user-agent", default=None, help="Custom User-Agent to send when crawling")
    parser.add_argument("--solver-url", default=None, help="Challenge Solver (Solverr/FlareSolverr) URL (e.g. http://192.168.50.114:8191)")
    parser.add_argument("--history-stats", action="store_true", help="Show the app's link history stats and exit")

    args = parser.parse_args()
    for old in ("jd_url", "jd_host", "jd_port", "delay"):
        if getattr(args, old) is not None:
            where = "the page delay is fixed by the app" if old == "delay" else "set the JDownloader address in the app under Downloaders"
            console.print(f"[yellow]--{old.replace('_', '-')} is ignored now: {where}.[/yellow]")

    page_range = None
    if args.pages:
        page_range = parse_page_range(args.pages)
        if page_range is None:
            console.print("[red]Invalid --pages value. Use e.g. 1-5, 20- or 7.[/red]")
            sys.exit(2)
    if args.last is not None and args.last < 1:
        console.print("[red]--last must be at least 1.[/red]")
        sys.exit(2)

    target_downloader = None if args.no_jd else (args.send or ("jdownloader" if args.jd or env_flag("CRAWLER_SEND_TO_JD") else None))

    try:
        app = connect(args)
    except AppError as e:
        console.print(f"[bold red]Could not sign in: {e}[/bold red]")
        sys.exit(1)

    if args.history_stats:
        stats = app.request("GET", "/linkgrabber/history/stats")
        console.print(f"Links saved : [cyan]{stats['totalLinks']}[/cyan]\nThreads     : [cyan]{stats['totalThreads']}[/cyan]")
        return

    target = args.target or console.input("[bold cyan]Thread URL or path to threads.txt:[/bold cyan] ").strip()
    if not target:
        console.print("[red]No target provided.[/red]")
        sys.exit(2)
    if os.path.isfile(target) and not target.startswith("http"):
        with open(target, "r", encoding="utf-8") as f:
            urls = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]
        console.print(f"[bold green]Watchlist:[/bold green] {target} ({len(urls)} threads)\n")
    else:
        urls = [target]
    cookies_text = read_cookies(args.cookies)

    crawled: List[Tuple[Dict[str, Any], List[Dict[str, Any]]]] = []
    failed: List[str] = []
    try:
        for i, url in enumerate(urls, 1):
            if len(urls) > 1:
                console.rule(f"[bold yellow]Thread {i} of {len(urls)}[/bold yellow]")
            try:
                crawl = app.crawl(crawl_options(url, args, page_range, cookies_text))
            except AppError as e:
                console.print(f"[bold red]Skipping {url}: {e}[/bold red]")
                failed.append(url)
                continue
            if crawl["status"] == "failed" or not crawl.get("result"):
                console.print(f"[bold red]Skipping {url}: {crawl.get('error') or crawl['status']}[/bold red]")
                failed.append(url)
                continue
            result = crawl["result"]
            if not result.get("pages") and result.get("error"):
                console.print(f"[bold red]Failed {url}: {result['error']}[/bold red]")
                failed.append(url)
                continue
            links = new_links(result, args.all_external)
            print_summary(result, links)
            crawled.append((result, links))

            if args.save:
                out_name = f"links_{safe_filename(result.get('threadTitle') or '')}.txt"
                with open(out_name, "w", encoding="utf-8") as f:
                    f.write(format_links([(result, links)], by_page=args.by_page) + "\n")
                console.print(f"[dim]Saved to {out_name}[/dim]")

            urls_new = [l["url"] for l in links]
            if urls_new and target_downloader:
                try:
                    sent = app.request("POST", "/linkgrabber/send", json={
                        "target": target_downloader,
                        "crawlId": crawl["id"],
                        "urls": urls_new,
                        "packagePerPage": not args.single_package,
                    })
                    console.print(f"[bold green][OK] Sent {sent['sent']} links to {target_downloader}.[/bold green]")
                    for failure in sent.get("failed", [])[:5]:
                        console.print(f"  [red][!][/red] {failure}")
                except AppError as e:
                    console.print(f"[bold red]Failed to send links to {target_downloader}: {e}[/bold red]")
            elif urls_new and not args.no_record:
                # Listed links count as handed off, like copying them in the app does.
                app.request("POST", "/linkgrabber/history", json={
                    "urls": urls_new,
                    "threadTitle": result.get("threadTitle") or "",
                    "threadUrl": result.get("threadUrl") or crawl.get("url") or url,
                })
    except KeyboardInterrupt:
        sys.exit(130)

    text = format_links(crawled, by_page=args.by_page)
    total_new = sum(len(links) for _, links in crawled)

    if text:
        if sys.stdout.isatty():
            console.rule(f"[bold green]{total_new} new link{'s' if total_new != 1 else ''}[/bold green]")
        print(text, flush=True)
    else:
        console.print("[yellow]No new links found.[/yellow]")

    if text and args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        console.print(f"[dim]Saved to {args.output}[/dim]")
    if text and args.copy:
        if copy_to_clipboard(text):
            console.print(f"[green]Copied {total_new} links to the clipboard.[/green]")
        else:
            console.print("[yellow]No clipboard tool found (clip, pbcopy, wl-copy, xclip or xsel).[/yellow]")

    if failed:
        console.print(f"[bold red]{len(failed)} thread(s) failed:[/bold red] " + ", ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
