"""
Forum thread link crawler.

Crawls XenForo threads (SimpCity and similar), pulls file-hoster links out of the
posts and prints them as a plain list, one URL per line, ready to copy. Status
output goes to stderr, so `python crawler.py URL > links.txt` captures only links.

Nothing is sent anywhere unless asked: pass --jd (or set CRAWLER_SEND_TO_JD=1) to
push the links to JDownloader, or --copy to put them on the clipboard.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
from urllib.parse import urlparse, parse_qs, unquote, urljoin
from typing import Any, List, Set, Tuple, Dict, Optional

import requests as std_requests
try:
    from curl_cffi import requests as curl_requests
except ImportError:
    curl_requests = None

from bs4 import BeautifulSoup
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.panel import Panel

from jd_client import JDownloaderClient
from cookie_helper import load_cookies, find_default_cookie_file
from history_db import filter_new_links, record_links, get_history_stats
from link_decoder import extract_base64_links, extract_passwords


# Status, tables and progress go to stderr; stdout carries only the link list.
console = Console(stderr=True)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
FETCH_RETRIES = 2
RETRY_STATUSES = {429, 500, 502, 503, 504, 520, 521, 522, 524}


class CrawlError(Exception):
    """A page could not be fetched; the message says why."""


KNOWN_HOSTERS = [
    "mega.nz",
    "mega.co.nz",
    "pixeldrain.com",
    "gofile.io",
    "bunkr.",
    "cyberdrop.",
    "saint2.su",
    "1fichier.com",
    "rapidgator.net",
    "mediafire.com",
    "drive.google.com",
    "dropbox.com",
    "krakenfiles.com",
    "workupload.com",
    "send.cm",
    "qiwi.gg",
    "terabox.com",
    "teraboxapp.com",
    "katfile.com",
    "coomer.su",
    "coomer.party",
    "kemono.su",
    "kemono.party",
    "filedm.com",
    "streamtape.com",
    "doodstream.com",
    "vidoza.net",
    "turbo.cr",
    "filester.gg",
    "filester.me",
    "filester.ai",
    "filester.si",
    "filester.",
    "filecrypt.cc",
    "filecrypt.co",
    "buzzheavier.com",
    "fastupload.io",
    "catbox.moe",
    "quax.is",
]

# File extensions that indicate direct download links
ARCHIVE_EXTENSIONS = (
    ".zip", ".rar", ".7z", ".tar", ".gz",
    ".mp4", ".mkv", ".mov", ".avi", ".wmv",
    ".iso", ".bin"
)

# Forum internal domains to always exclude
IGNORED_DOMAINS = [
    "simpcity.cr",
    "simpcity.su",
    "turbostats.xyz",
    "goonbox.cr"
]

BARE_HOST_PATTERN = re.compile(
    r"\b((?:(?:https?://)?(?:[a-z0-9-]+\.)?(?:pixeldrain\.com|gofile\.io|turbo\.cr|saint2\.su|1fichier\.com|rapidgator\.net|mediafire\.com|krakenfiles\.com|workupload\.com|send\.cm|qiwi\.gg|terabox\.com|teraboxapp\.com|katfile\.com|filecrypt\.(?:cc|co)|buzzheavier\.com|fastupload\.io|catbox\.moe|quax\.is|mega\.(?:nz|co\.nz)|(?:bunkr|filester|cyberdrop)\.[a-z]{2,8}))/[^\s<>\"'()]+)",
    re.IGNORECASE,
)


def unwrap_proxy_url(url: str) -> str:
    """Unwrap XenForo redirect/proxy links (e.g., /proxy.php?link=...)."""
    if "proxy.php" in url and "link=" in url:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        target = params.get("link", [""])[0]
        if target:
            return unquote(target)
    return url


def clean_thread_title(title: str) -> str:
    """Sanitize title for use as JD2 package name and filename."""
    title = re.sub(r"\s*\|\s*SimpCity.*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+", " ", title).strip()
    clean = re.sub(r'[\\/*?:"<>|]', "", title)
    return clean or "SimpCity_Thread"


def is_target_link(url: str, filter_known_hosts: bool = True) -> bool:
    """Check if URL is a valid target download link."""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    if not domain or not parsed.scheme.startswith("http"):
        return False

    if any(ignored in domain for ignored in IGNORED_DOMAINS):
        return False

    path = parsed.path.lower()

    # Drop web page furniture (scripts, styles, icons, fonts)
    if path.endswith((".css", ".js", ".mjs", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot")):
        return False

    if not filter_known_hosts:
        return True

    if any(host in domain for host in KNOWN_HOSTERS):
        return True

    if any(path.endswith(ext) for ext in ARCHIVE_EXTENSIONS):
        return True

    return False


def parse_thread_url(raw_url: str) -> Tuple[str, int]:
    """
    Parse a XenForo thread URL into (base_url, page_number).
    Example:
      https://simpcity.cr/threads/name.123/page-27 -> ('https://simpcity.cr/threads/name.123/', 27)
      https://simpcity.cr/threads/name.123/        -> ('https://simpcity.cr/threads/name.123/', 1)
    """
    url = raw_url.split("?")[0].split("#")[0].rstrip("/")
    match = re.match(r"^(https?://[^/]+/threads/[^/]+)(?:/page-(\d+))?$", url, re.IGNORECASE)
    if match:
        base = match.group(1).rstrip("/") + "/"
        page = int(match.group(2)) if match.group(2) else 1
        return base, page
    return raw_url.rstrip("/") + "/", 1


def get_page_url(base_url: str, page_num: int) -> str:
    """Construct URL for a specific page number."""
    base = base_url.rstrip("/") + "/"
    if page_num <= 1:
        return base
    return f"{base}page-{page_num}"


def detect_max_page(soup: BeautifulSoup, current_page: int = 1) -> int:
    """Extract maximum page number from XenForo pagination elements."""
    pages = [current_page]
    for el in soup.select(".pageNav-page, .pageNav-main a, ul.pageNav-main li"):
        txt = el.get_text(strip=True)
        if txt.isdigit():
            pages.append(int(txt))
    return max(pages)


def _http_get(url: str, cookies: Dict[str, str], headers: Dict[str, str]) -> Tuple[int, str]:
    """GET with Chrome TLS fingerprinting when curl_cffi is installed, plain requests otherwise."""
    if curl_requests is not None:
        try:
            resp = curl_requests.get(url, headers=headers, cookies=cookies, impersonate="chrome124", timeout=20)
            return resp.status_code, resp.text
        except Exception:
            pass  # TLS/impersonation trouble: fall back to plain requests
    resp = std_requests.get(url, headers=headers, cookies=cookies, timeout=20)
    return resp.status_code, resp.text


def fetch_page_html(url: str, cookies: Dict[str, str], retries: int = FETCH_RETRIES) -> str:
    """Fetch a page, retrying rate limits, server errors and network failures with backoff."""
    parsed = urlparse(url)
    headers = {
        "User-Agent": USER_AGENT,
        "Referer": f"{parsed.scheme}://{parsed.netloc}/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    last_error = ""
    for attempt in range(retries + 1):
        if attempt:
            time.sleep(2 ** attempt)
        try:
            status, text = _http_get(url, cookies, headers)
        except Exception as e:
            last_error = f"network error: {e}"
            continue
        if status == 200:
            return text
        if status == 403:
            raise CrawlError("403 Forbidden - your cookies are missing or expired; export fresh ones while logged in")
        if status in RETRY_STATUSES:
            last_error = f"HTTP {status}"
            continue
        raise CrawlError(f"HTTP {status}")
    raise CrawlError(f"{last_error} (after {retries + 1} attempts)")


def parse_page_content(
    html: str,
    base_url: str,
    filter_hosts: bool = True,
    skip_quotes: bool = True,
    skip_bots: bool = True,
) -> Tuple[str, List[str], List[str], int]:
    """
    Parse thread HTML to extract title, download links, archive passwords, and max page.
    
    Returns:
        (title, links, passwords, max_page)
    """
    soup = BeautifulSoup(html, "html.parser")

    # Title
    h1 = soup.select_one("h1.p-title-value")
    if h1:
        raw_title = h1.get_text(separator=" ", strip=True)
    else:
        title_tag = soup.find("title")
        raw_title = title_tag.get_text(strip=True) if title_tag else "Unknown_Thread"
    title = clean_thread_title(raw_title)

    # Max Page
    max_page = detect_max_page(soup)

    # Posts
    posts = soup.select("article.message--post")
    if not posts:
        posts = soup.select(".message-inner") or soup.select(".bbWrapper") or [soup]

    collected_links: List[str] = []
    collected_passwords: Set[str] = set()

    for post in posts:
        author = post.get("data-author", "").strip().lower()
        if skip_bots and author in ["sussybot"]:
            continue

        if skip_quotes:
            for quote_block in post.select(".bbCodeBlock--quote, blockquote"):
                quote_block.decompose()

        post_text = post.get_text(separator=" ")

        # 1. Archive Passwords
        passwords = extract_passwords(post_text)
        collected_passwords.update(passwords)

        # 2. Extract from <a> tags
        for a_tag in post.find_all("a", href=True):
            href = a_tag["href"].strip()
            full_url = urljoin(base_url, href)
            clean_url = unwrap_proxy_url(full_url)
            if is_target_link(clean_url, filter_known_hosts=filter_hosts):
                collected_links.append(clean_url)

        # 3. Extract embedded video/stream players
        for embed in post.find_all(["iframe", "embed", "source"]):
            src = embed.get("src") or embed.get("data-src") or embed.get("data-original")
            if src:
                clean_url = unwrap_proxy_url(urljoin(base_url, src.strip()))
                if is_target_link(clean_url, filter_known_hosts=filter_hosts):
                    collected_links.append(clean_url)

        # 4. XenForo data attributes
        for el in post.find_all(attrs={"data-url": True}):
            data_url = el["data-url"].strip()
            clean_url = unwrap_proxy_url(urljoin(base_url, data_url))
            if is_target_link(clean_url, filter_known_hosts=filter_hosts):
                collected_links.append(clean_url)

        # 5. Plain-text regex URLs
        raw_urls = re.findall(r"https?://[^\s<>\"'()]+", post_text)
        for raw in raw_urls:
            clean_url = unwrap_proxy_url(raw.rstrip(".,;!"))
            if is_target_link(clean_url, filter_known_hosts=filter_hosts):
                collected_links.append(clean_url)

        # 5b. Bare known hoster URLs in plain text (e.g. gofile.io/d/..., turbo.cr/embed/...)
        for match in BARE_HOST_PATTERN.findall(post_text):
            full = match if match.startswith("http") else f"https://{match}"
            clean_url = unwrap_proxy_url(full.rstrip(".,;!"))
            if is_target_link(clean_url, filter_known_hosts=filter_hosts):
                collected_links.append(clean_url)

        # 6. Base64 decoded links
        b64_urls = extract_base64_links(post_text)
        for b64_url in b64_urls:
            clean_url = unwrap_proxy_url(b64_url)
            if is_target_link(clean_url, filter_known_hosts=filter_hosts):
                collected_links.append(clean_url)

    # Deduplicate preserving order
    seen = set()
    unique_links = []
    for link in collected_links:
        if link not in seen:
            seen.add(link)
            unique_links.append(link)

    return title, unique_links, list(collected_passwords), max_page


def select_pages(
    start_page: int,
    max_page: int,
    all_pages: bool = False,
    page_range: Optional[Tuple[int, Optional[int]]] = None,
    last_n_pages: Optional[int] = None,
) -> List[int]:
    """Pick the page numbers to crawl from the CLI options."""
    if all_pages:
        return list(range(1, max_page + 1))
    if last_n_pages:
        return list(range(max(1, max_page - last_n_pages + 1), max_page + 1))
    if page_range:
        start = max(1, page_range[0])
        end = min(page_range[1] or max_page, max_page)
        return list(range(start, end + 1))
    return [start_page]


def dedupe(items: List[str]) -> List[str]:
    return list(dict.fromkeys(items))


def crawl_thread(
    input_url: str,
    cookies: Dict[str, str],
    filter_hosts: bool = True,
    skip_quotes: bool = True,
    skip_bots: bool = True,
    all_pages: bool = False,
    page_range: Optional[Tuple[int, Optional[int]]] = None,
    last_n_pages: Optional[int] = None,
    ignore_history: bool = False,
    delay: float = 0.5,
) -> Dict[str, Any]:
    """
    Crawl the selected pages of one thread. Raises CrawlError if the first page fails;
    a later page failing stops the crawl but keeps what was found so far.
    """
    base_url, start_page = parse_thread_url(input_url)
    console.print(Panel(f"[bold cyan]Crawling thread:[/bold cyan] {base_url}", expand=False))

    # The starting page tells us the title and how many pages the thread has.
    with console.status(f"[bold yellow]Fetching page {start_page}...[/bold yellow]"):
        first_html = fetch_page_html(get_page_url(base_url, start_page), cookies)

    def parse(html: str) -> Tuple[str, List[str], List[str], int]:
        return parse_page_content(html, base_url, filter_hosts=filter_hosts, skip_quotes=skip_quotes, skip_bots=skip_bots)

    title, first_links, first_passwords, max_page = parse(first_html)
    pages_to_crawl = select_pages(start_page, max_page, all_pages, page_range, last_n_pages)
    if not pages_to_crawl:
        console.print(f"[yellow]No pages in the requested range (thread has {max_page} pages).[/yellow]")

    page_data: Dict[int, Dict[str, List[str]]] = {
        start_page: {"links": first_links, "passwords": first_passwords},
    }
    to_fetch = [p for p in pages_to_crawl if p not in page_data]
    error = None

    if to_fetch:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Crawling pages...", total=len(to_fetch))
            for p_num in to_fetch:
                progress.update(task, description=f"Crawling page {p_num}/{max_page}...")
                time.sleep(delay)
                try:
                    html = fetch_page_html(get_page_url(base_url, p_num), cookies)
                except CrawlError as e:
                    error = f"page {p_num}: {e}"
                    break
                _, p_links, p_pw, _ = parse(html)
                page_data[p_num] = {"links": p_links, "passwords": p_pw}
                progress.advance(task)

    if error:
        console.print(f"[bold red]Stopped early - {error}. Keeping the pages fetched so far.[/bold red]")

    crawled = [p for p in pages_to_crawl if p in page_data]
    unique_links = dedupe([link for p in crawled for link in page_data[p]["links"]])
    passwords = dedupe([pw for p in crawled for pw in page_data[p]["passwords"]])
    new_links, skipped_history = filter_new_links(unique_links, ignore_history=ignore_history)
    new_set = set(new_links)

    return {
        "title": title,
        "base_url": base_url,
        "max_page": max_page,
        "pages": {p: {"links": [l for l in page_data[p]["links"] if l in new_set], "passwords": page_data[p]["passwords"]} for p in crawled},
        "all_links": unique_links,
        "new_links": new_links,
        "skipped_history": skipped_history,
        "passwords": passwords,
        "error": error,
    }


def print_summary(result: Dict[str, Any]) -> None:
    table = Table(title=f"Results: {result['title']}", show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="dim", width=28)
    table.add_column("Value", style="bold")
    table.add_row("Pages scanned", f"{len(result['pages'])} (thread has {result['max_page']})")
    table.add_row("Links found", str(len(result["all_links"])))
    table.add_row("New links", f"[green]{len(result['new_links'])}[/green]")
    table.add_row("Already seen (history)", f"[yellow]{result['skipped_history']}[/yellow]")
    if result["passwords"]:
        table.add_row("Archive passwords", f"[cyan]{', '.join(result['passwords'])}[/cyan]")
    console.print(table)

    if result["new_links"]:
        counts: Dict[str, int] = {}
        for link in result["new_links"]:
            domain = urlparse(link).netloc.lower()
            counts[domain] = counts.get(domain, 0) + 1
        d_table = Table(title="New links by host", show_header=True, header_style="bold green")
        d_table.add_column("Host", style="cyan")
        d_table.add_column("Count", justify="right", style="bold white")
        for domain, count in sorted(counts.items(), key=lambda x: x[1], reverse=True):
            d_table.add_row(domain, str(count))
        console.print(d_table)


def format_links(results: List[Dict[str, Any]], by_page: bool = False) -> str:
    """Plain text for copying: one URL per line, optionally with '# ...' headers per page."""
    lines: List[str] = []
    for result in results:
        if not by_page:
            lines.extend(result["new_links"])
            continue
        for p_num, info in result["pages"].items():
            if not info["links"]:
                continue
            if lines:
                lines.append("")
            lines.append(f"# {result['title']} - page {p_num}")
            if info["passwords"]:
                lines.append(f"# password: {', '.join(info['passwords'])}")
            lines.extend(info["links"])
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


def send_to_jdownloader(result: Dict[str, Any], jd: JDownloaderClient, single_package: bool) -> None:
    if not result["new_links"]:
        console.print("[yellow]No new links to send to JDownloader.[/yellow]")
        return
    if single_package:
        package = f"[SimpCity] {result['title']}"
        pw = ",".join(result["passwords"]) or None
        if jd.add_links(result["new_links"], package_name=package, passwords=pw):
            console.print(f"[bold green][OK] Sent {len(result['new_links'])} links to JDownloader as '{package}'[/bold green]")
        else:
            console.print("[bold red]Failed to send links to JDownloader.[/bold red]")
        return

    total = 0
    for p_num, info in result["pages"].items():
        if not info["links"]:
            continue
        # [Page N] goes first so it isn't cut off in the LinkGrabber column
        package = f"[Page {p_num}] {result['title']}"
        pw = ",".join(info["passwords"]) or None
        if jd.add_links(info["links"], package_name=package, passwords=pw):
            console.print(f"  [green][OK][/green] Page {p_num}: {len(info['links'])} links -> '{package}'")
            total += len(info["links"])
        else:
            console.print(f"  [red][!][/red] Page {p_num}: failed to send {len(info['links'])} links")
        time.sleep(0.3)
    if total:
        console.print(f"[bold green][OK] Sent {total} links to JDownloader.[/bold green]")


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


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def main():
    parser = argparse.ArgumentParser(
        description="Crawl forum threads and list their download links (SimpCity / XenForo).",
        epilog="Links print to stdout one per line; everything else goes to stderr.",
    )
    parser.add_argument("target", nargs="?", help="Thread URL, or a text file with one thread URL per line")

    pages = parser.add_argument_group("pages")
    pages.add_argument("--all-pages", "-a", action="store_true", help="Crawl every page of the thread")
    pages.add_argument("--pages", "-p", default=None, help="Page range: 20-27, 20- (to the end) or 5")
    pages.add_argument("--last", "-l", type=int, default=None, help="Crawl only the last N pages")
    pages.add_argument("--delay", type=float, default=0.5, help="Seconds to wait between page requests (default 0.5)")

    filters = parser.add_argument_group("filtering")
    filters.add_argument("--all-external", action="store_true", help="Keep all external links, not just known file hosts")
    filters.add_argument("--include-quotes", action="store_true", help="Include links inside quoted replies")
    filters.add_argument("--include-bots", action="store_true", help="Include mirror bots like SussyBOT")
    filters.add_argument("--ignore-history", action="store_true", help="List links even if a previous run already found them")
    filters.add_argument("--no-record", action="store_true", help="Don't add this run's links to the history database")

    output = parser.add_argument_group("output")
    output.add_argument("--by-page", action="store_true", help="Group the list by page with '# ...' headers and passwords")
    output.add_argument("--copy", action="store_true", help="Also copy the link list to the clipboard")
    output.add_argument("--output", "-o", default=None, help="Write the link list to this file")
    output.add_argument("--save", action="store_true", help="Write each thread's links to links_<title>.txt")

    jd_group = parser.add_argument_group("JDownloader (off unless --jd or CRAWLER_SEND_TO_JD=1)")
    jd_group.add_argument("--jd", action="store_true", help="Send the new links to JDownloader via Click'n'Load")
    jd_group.add_argument("--no-jd", action="store_true", help="Never send to JDownloader, even if CRAWLER_SEND_TO_JD is set")
    jd_group.add_argument("--single-package", action="store_true", help="One JDownloader package per thread instead of per page")
    jd_group.add_argument("--jd-url", default=None, help="Click'n'Load URL, e.g. http://192.168.1.10:9666 (or JD_URL env)")
    jd_group.add_argument("--jd-host", default=None, help="JDownloader host (or JD_HOST env, default 127.0.0.1)")
    jd_group.add_argument("--jd-port", type=int, default=None, help="Click'n'Load port (or JD_PORT env, default 9666)")

    parser.add_argument("--cookies", "-c", default=None, help="Cookie file (cookies.json / cookies.txt)")
    parser.add_argument("--history-stats", action="store_true", help="Show history database stats and exit")

    args = parser.parse_args()

    if args.history_stats:
        stats = get_history_stats()
        console.print(Panel(
            f"Links saved : [cyan]{stats['total_links']}[/cyan]\n"
            f"Threads     : [cyan]{stats['total_threads']}[/cyan]",
            title="Crawler history",
        ))
        return

    page_range = None
    if args.pages:
        page_range = parse_page_range(args.pages)
        if page_range is None:
            console.print("[red]Invalid --pages value. Use e.g. 1-5, 20- or 7.[/red]")
            sys.exit(2)
    if args.last is not None and args.last < 1:
        console.print("[red]--last must be at least 1.[/red]")
        sys.exit(2)

    send_jd = (args.jd or env_flag("CRAWLER_SEND_TO_JD")) and not args.no_jd

    target = args.target or console.input("[bold cyan]Thread URL or path to threads.txt:[/bold cyan] ").strip()
    if not target:
        console.print("[red]No target provided.[/red]")
        sys.exit(2)

    cookies = load_cookies(args.cookies) if args.cookies else find_default_cookie_file()
    if not cookies and sys.stdin.isatty():
        console.print("\n[yellow]No cookies.json or cookies.txt found.[/yellow]")
        cookie_input = console.input("Paste cookie string (or press Enter to try without): ").strip()
        if cookie_input:
            cookies = load_cookies(cookie_input)

    if os.path.isfile(target) and not target.startswith("http"):
        with open(target, "r", encoding="utf-8") as f:
            urls = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]
        console.print(f"[bold green]Watchlist:[/bold green] {target} ({len(urls)} threads)\n")
    else:
        urls = [target]

    jd = JDownloaderClient(host=args.jd_host, port=args.jd_port, url=args.jd_url) if send_jd else None
    if jd and not jd.is_running():
        console.print(f"[bold red]JDownloader is not responding on {jd.base_url}; links will only be listed.[/bold red]")
        console.print("    Check that it is running, port 9666 is reachable and remote Click'n'Load is allowed.")
        jd = None

    results: List[Dict[str, Any]] = []
    failed: List[str] = []
    for i, url in enumerate(urls, 1):
        if len(urls) > 1:
            console.rule(f"[bold yellow]Thread {i} of {len(urls)}[/bold yellow]")
        try:
            result = crawl_thread(
                url,
                cookies=cookies,
                filter_hosts=not args.all_external,
                skip_quotes=not args.include_quotes,
                skip_bots=not args.include_bots,
                all_pages=args.all_pages,
                page_range=page_range,
                last_n_pages=args.last,
                ignore_history=args.ignore_history,
                delay=args.delay,
            )
        except CrawlError as e:
            console.print(f"[bold red]Skipping {url}: {e}[/bold red]")
            failed.append(url)
            continue
        print_summary(result)
        results.append(result)

        if args.save:
            out_name = f"links_{safe_filename(result['title'])}.txt"
            with open(out_name, "w", encoding="utf-8") as f:
                f.write(format_links([result], by_page=args.by_page) + "\n")
            console.print(f"[dim]Saved to {out_name}[/dim]")
        if jd:
            send_to_jdownloader(result, jd, args.single_package)
        if not args.no_record and result["new_links"]:
            record_links(result["new_links"], result["title"], result["base_url"])
        if i < len(urls):
            time.sleep(1)

    text = format_links(results, by_page=args.by_page)
    total_new = sum(len(r["new_links"]) for r in results)

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
