import argparse
import os
import re
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
from urllib.parse import urlparse, parse_qs, unquote, urljoin
from typing import List, Set, Tuple, Dict, Optional

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


console = Console()

# Target file/video hosters
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
    if path.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js")):
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


def fetch_page_html(url: str, cookies: Dict[str, str]) -> str:
    """Fetch thread page HTML with automatic fallback on TLS/SSL error."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://simpcity.cr/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    # Attempt 1: curl_cffi with Chrome fingerprinting
    if curl_requests is not None:
        try:
            session = curl_requests.Session(impersonate="chrome124")
            for k, v in cookies.items():
                session.cookies.set(k, v, domain="simpcity.cr")
            resp = session.get(url, headers=headers, timeout=20)
            if resp.status_code == 200:
                return resp.text
            if resp.status_code == 403:
                console.print("[bold red]403 Forbidden received from SimpCity.[/bold red]")
                console.print("  -> Please make sure your cookies.txt or cookies.json are fresh and logged in.")
                sys.exit(1)
        except Exception:
            pass

    # Attempt 2: Standard requests fallback
    session = std_requests.Session()
    session.headers.update(headers)
    for k, v in cookies.items():
        session.cookies.set(k, v, domain="simpcity.cr")

    try:
        resp = session.get(url, timeout=20)
        if resp.status_code == 403:
            console.print("[bold red]403 Forbidden received from SimpCity.[/bold red]")
            sys.exit(1)
        if resp.status_code != 200:
            console.print(f"[bold red]HTTP {resp.status_code} while fetching page.[/bold red]")
            sys.exit(1)
        return resp.text
    except Exception as e:
        console.print(f"[bold red]Network error fetching {url}: {e}[/bold red]")
        sys.exit(1)


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


def crawl_thread(
    input_url: str,
    cookies: Dict[str, str],
    filter_hosts: bool = True,
    skip_quotes: bool = True,
    skip_bots: bool = True,
    all_pages: bool = False,
    page_range: Optional[Tuple[int, int]] = None,
    last_n_pages: Optional[int] = None,
    ignore_history: bool = False,
    no_jd: bool = False,
    single_package: bool = False,
    jd_host: Optional[str] = None,
    jd_port: Optional[int] = None,
    jd_url: Optional[str] = None,
):
    """Crawl a thread with multi-page handling, deduplication, and JD2 ingestion."""
    base_url, start_page = parse_thread_url(input_url)

    console.print(Panel(f"[bold cyan]Crawling Thread:[/bold cyan] {base_url}", expand=False))

    # Fetch initial page to discover title and total page count
    initial_url = get_page_url(base_url, start_page)
    with console.status(f"[bold yellow]Fetching page {start_page}...[/bold yellow]"):
        first_html = fetch_page_html(initial_url, cookies)

    title, first_links, first_passwords, detected_max_page = parse_page_content(
        first_html,
        base_url,
        filter_hosts=filter_hosts,
        skip_quotes=skip_quotes,
        skip_bots=skip_bots,
    )

    # Determine pages to crawl
    if all_pages:
        pages_to_crawl = list(range(1, detected_max_page + 1))
    elif last_n_pages:
        start_p = max(1, detected_max_page - last_n_pages + 1)
        pages_to_crawl = list(range(start_p, detected_max_page + 1))
    elif page_range:
        start_p = max(1, page_range[0])
        end_p = min(page_range[1], detected_max_page)
        pages_to_crawl = list(range(start_p, end_p + 1))
    else:
        # Single page crawl
        pages_to_crawl = [start_page]

    # Store per-page links and passwords
    page_data: Dict[int, Dict[str, Any]] = {}
    page_data[start_page] = {
        "links": first_links,
        "passwords": first_passwords,
    }

    # Execute crawl with progress bar if multiple pages
    if len(pages_to_crawl) > 1:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task(f"Crawling {len(pages_to_crawl)} pages...", total=len(pages_to_crawl))

            for p_num in pages_to_crawl:
                progress.update(task, description=f"Crawling page {p_num}/{detected_max_page}...")
                if p_num != start_page:
                    p_url = get_page_url(base_url, p_num)
                    html = fetch_page_html(p_url, cookies)
                    _, p_links, p_pw, _ = parse_page_content(
                        html,
                        base_url,
                        filter_hosts=filter_hosts,
                        skip_quotes=skip_quotes,
                        skip_bots=skip_bots,
                    )
                    page_data[p_num] = {
                        "links": p_links,
                        "passwords": p_pw,
                    }
                    time.sleep(0.5)  # Gentle rate limiting
                progress.advance(task)

    # Collect all links while preserving order
    all_links: List[str] = []
    all_passwords: Set[str] = set()
    for p_num in pages_to_crawl:
        p_info = page_data.get(p_num, {})
        all_links.extend(p_info.get("links", []))
        all_passwords.update(p_info.get("passwords", []))

    # Deduplicate all links across pages
    seen = set()
    unique_links = []
    for link in all_links:
        if link not in seen:
            seen.add(link)
            unique_links.append(link)

    # Filter with SQLite History Database
    new_links, skipped_history = filter_new_links(unique_links, ignore_history=ignore_history)
    new_links_set = set(new_links)

    # Display Rich Results Table
    table = Table(title=f"Results: {title}", show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="dim", width=25)
    table.add_column("Value", style="bold")

    table.add_row("Pages Scanned", f"{len(pages_to_crawl)} (Total in thread: {detected_max_page})")
    table.add_row("Total Links Found", str(len(unique_links)))
    table.add_row("New Links (Unseen)", f"[green]{len(new_links)}[/green]")
    table.add_row("Previously Crawled (History)", f"[yellow]{skipped_history}[/yellow]")
    if all_passwords:
        table.add_row("Detected Passwords", f"[cyan]{', '.join(all_passwords)}[/cyan]")

    console.print(table)

    # Domain breakdown table
    if new_links:
        domain_counts: Dict[str, int] = {}
        for link in new_links:
            domain = urlparse(link).netloc.lower()
            domain_counts[domain] = domain_counts.get(domain, 0) + 1

        d_table = Table(title="New Links Breakdown by Hoster", show_header=True, header_style="bold green")
        d_table.add_column("Host Domain", style="cyan")
        d_table.add_column("Count", justify="right", style="bold white")
        for domain, count in sorted(domain_counts.items(), key=lambda x: x[1], reverse=True):
            d_table.add_row(domain, str(count))
        console.print(d_table)

    # Save to file
    safe_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", title)[:50]
    out_filename = f"links_{safe_name}.txt"
    with open(out_filename, "w", encoding="utf-8") as f:
        f.write("\n".join(new_links if new_links else unique_links) + "\n")
    console.print(f"[dim]Saved links to {out_filename}[/dim]")

    # Record newly crawled links in SQLite DB
    if new_links:
        record_links(new_links, title, base_url)

    # Send to JDownloader 2
    if not no_jd:
        if not new_links:
            console.print("[yellow]No new links to send to JDownloader (all links previously crawled).[/yellow]")
        else:
            jd = JDownloaderClient(host=jd_host, port=jd_port, url=jd_url)
            if not jd.is_running():
                console.print(f"[bold red][!] JDownloader 2 is not responding on {jd.base_url}.[/bold red]")
                console.print("    Ensure JDownloader is running, port 9666 is mapped, and RemoteAPI allows external connections.")
            else:
                if single_package:
                    package_name = f"[SimpCity] {title}"
                    pw_str = ",".join(all_passwords) if all_passwords else None
                    success = jd.add_links(new_links, package_name=package_name, passwords=pw_str)
                    if success:
                        console.print(f"[bold green][OK] Added {len(new_links)} new links to JDownloader 2 LinkGrabber under package '{package_name}'![/bold green]")
                    else:
                        console.print("[bold red]Failed to send links to JDownloader.[/bold red]")
                else:
                    # Package Per Page Mode (Default)
                    console.print(f"[bold cyan]Sending links to JDownloader (Package per Page):[/bold cyan]")
                    total_sent = 0
                    for p_num in pages_to_crawl:
                        p_info = page_data.get(p_num, {})
                        # Filter to only links that are new
                        p_new = [l for l in p_info.get("links", []) if l in new_links_set]
                        if not p_new:
                            continue

                        # Format with [Page N] at front so it is never cut off in LinkGrabber
                        pkg_name = f"[Page {p_num}] {title}"
                        p_pw = p_info.get("passwords", [])
                        pw_str = ",".join(p_pw) if p_pw else None

                        success = jd.add_links(p_new, package_name=pkg_name, passwords=pw_str)
                        if success:
                            console.print(f"  [bold green][OK][/bold green] Page {p_num}: Added {len(p_new)} links to package '[cyan]{pkg_name}[/cyan]'")
                            total_sent += len(p_new)
                        else:
                            console.print(f"  [bold red][!][/bold red] Page {p_num}: Failed to send {len(p_new)} links.")
                        time.sleep(0.3)
                    if total_sent > 0:
                        console.print(f"[bold green][OK] Finished sending all {total_sent} links in packages per page![/bold green]")


def main():
    parser = argparse.ArgumentParser(
        description="SimpCity Thread Crawler & JDownloader 2 Importer (Pro Suite)"
    )
    parser.add_argument(
        "target",
        nargs="?",
        help="SimpCity thread URL OR path to a text file with URLs (e.g. threads.txt)"
    )
    parser.add_argument(
        "--all-pages",
        "-a",
        action="store_true",
        help="Crawl all pages of the thread from page 1 to the end"
    )
    parser.add_argument(
        "--pages",
        "-p",
        default=None,
        help="Crawl a page range, e.g. --pages 20-27"
    )
    parser.add_argument(
        "--last",
        "-l",
        type=int,
        default=None,
        help="Crawl only the last N pages of the thread (e.g. --last 3)"
    )
    parser.add_argument(
        "--cookies",
        "-c",
        default=None,
        help="Path to cookies file (cookies.json / cookies.txt)"
    )
    parser.add_argument(
        "--all-external",
        action="store_true",
        help="Extract all external links, not just known file hosters"
    )
    parser.add_argument(
        "--include-quotes",
        action="store_true",
        help="Include links inside user quotes (default: excluded)"
    )
    parser.add_argument(
        "--include-bots",
        action="store_true",
        help="Include automated mirror bots like SussyBOT (default: excluded)"
    )
    parser.add_argument(
        "--ignore-history",
        action="store_true",
        help="Ignore history DB and re-extract all links"
    )
    parser.add_argument(
        "--no-jd",
        action="store_true",
        help="Do not send links to JDownloader 2 (only save to text file)"
    )
    parser.add_argument(
        "--single-package",
        action="store_true",
        help="Put all links into a single JDownloader package instead of a package per page"
    )
    parser.add_argument(
        "--history-stats",
        action="store_true",
        help="Show crawler history database stats and exit"
    )
    parser.add_argument(
        "--jd-url",
        default=None,
        help="JDownloader Click'n'Load URL (e.g. http://192.168.50.114:9666)"
    )
    parser.add_argument(
        "--jd-host",
        default=None,
        help="JDownloader host IP (e.g. 192.168.50.114)"
    )
    parser.add_argument(
        "--jd-port",
        type=int,
        default=None,
        help="JDownloader port (default: 9666; note port 5800 is web UI only)"
    )

    args = parser.parse_args()

    # Show History Stats
    if args.history_stats:
        stats = get_history_stats()
        console.print(Panel(
            f"[bold green]History DB Stats:[/bold green]\n"
            f"  • Total Unique Links Saved: [cyan]{stats['total_links']}[/cyan]\n"
            f"  • Total Threads Tracked   : [cyan]{stats['total_threads']}[/cyan]",
            title="Crawler Database"
        ))
        return

    # Parse Range
    page_range = None
    if args.pages:
        try:
            parts = args.pages.split("-")
            page_range = (int(parts[0]), int(parts[1]))
        except Exception:
            console.print("[red]Invalid --pages format. Use: --pages 1-5[/red]")
            sys.exit(1)

    # Get target (URL or file)
    target = args.target
    if not target:
        target = console.input("[bold cyan]Enter SimpCity thread URL or path to threads.txt:[/bold cyan] ").strip()

    if not target:
        console.print("[red]No target provided.[/red]")
        sys.exit(1)

    # Load cookies
    cookies = {}
    if args.cookies:
        cookies = load_cookies(args.cookies)
    else:
        cookies = find_default_cookie_file()

    if not cookies:
        console.print("\n[yellow]No cookies.txt or cookies.json found.[/yellow]")
        cookie_input = console.input("Paste cookie string (or press Enter to try without): ").strip()
        if cookie_input:
            cookies = load_cookies(cookie_input)

    filter_hosts = not args.all_external
    skip_quotes = not args.include_quotes
    skip_bots = not args.include_bots

    # Batch file mode
    if os.path.isfile(target) and not target.startswith("http"):
        console.print(f"[bold green]Loading threads from watchlist file:[/bold green] {target}")
        with open(target, "r", encoding="utf-8") as f:
            urls = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]

        console.print(f"Found [cyan]{len(urls)}[/cyan] thread URLs to crawl.\n")
        for i, u in enumerate(urls, 1):
            console.rule(f"[bold yellow]Thread {i} of {len(urls)}[/bold yellow]")
            crawl_thread(
                u,
                cookies=cookies,
                filter_hosts=filter_hosts,
                skip_quotes=skip_quotes,
                skip_bots=skip_bots,
                all_pages=args.all_pages,
                page_range=page_range,
                last_n_pages=args.last,
                ignore_history=args.ignore_history,
                no_jd=args.no_jd,
                single_package=args.single_package,
                jd_host=args.jd_host,
                jd_port=args.jd_port,
                jd_url=args.jd_url,
            )
            time.sleep(1)
    else:
        # Single thread URL mode
        crawl_thread(
            target,
            cookies=cookies,
            filter_hosts=filter_hosts,
            skip_quotes=skip_quotes,
            skip_bots=skip_bots,
            all_pages=args.all_pages,
            page_range=page_range,
            last_n_pages=args.last,
            ignore_history=args.ignore_history,
            no_jd=args.no_jd,
            single_package=args.single_package,
            jd_host=args.jd_host,
            jd_port=args.jd_port,
            jd_url=args.jd_url,
        )


if __name__ == "__main__":
    main()
