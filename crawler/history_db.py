import sqlite3
import os
from typing import List, Tuple, Dict, Set
from datetime import datetime


DB_FILE = os.path.join(os.path.dirname(__file__), "crawled_history.db")
APP_DB_FILE = os.path.join(os.path.dirname(__file__), "..", "config", "app.db")


def get_db_connection() -> sqlite3.Connection:
    """Connect to SQLite history database and ensure schema exists."""
    conn = sqlite3.connect(DB_FILE)
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS links (
                url TEXT PRIMARY KEY,
                thread_title TEXT,
                thread_url TEXT,
                discovered_at TEXT
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_thread_url ON links(thread_url)
        """)
    return conn


def filter_new_links(
    links: List[str],
    ignore_history: bool = False
) -> Tuple[List[str], int]:
    """
    Filter out links that have already been crawled and saved in history.
    Checks both local crawled_history.db and app.db if available.
    
    Returns:
        (new_links, skipped_count)
    """
    if ignore_history or not links:
        return links, 0

    seen: Set[str] = set()

    # 1. Check local crawler DB
    try:
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            placeholders = ",".join("?" for _ in links)
            cur.execute(f"SELECT url FROM links WHERE url IN ({placeholders})", links)
            for row in cur.fetchall():
                seen.add(row[0])
        finally:
            conn.close()
    except Exception:
        pass

    # 2. Check app.db if present
    if os.path.isfile(APP_DB_FILE):
        try:
            app_conn = sqlite3.connect(APP_DB_FILE)
            try:
                cur = app_conn.cursor()
                placeholders = ",".join("?" for _ in links)
                cur.execute(f"SELECT url FROM linkgrabber_history WHERE url IN ({placeholders})", links)
                for row in cur.fetchall():
                    seen.add(row[0])
            finally:
                app_conn.close()
        except Exception:
            pass

    new_links = [l for l in links if l not in seen]
    skipped_count = len(links) - len(new_links)
    return new_links, skipped_count


def record_links(links: List[str], thread_title: str, thread_url: str):
    """Save newly crawled links to database (both crawler DB and app.db if present)."""
    if not links:
        return

    now = datetime.now().isoformat()

    # 1. Save to local crawler DB
    try:
        conn = get_db_connection()
        try:
            with conn:
                conn.executemany(
                    "INSERT OR IGNORE INTO links (url, thread_title, thread_url, discovered_at) VALUES (?, ?, ?, ?)",
                    [(url, thread_title, thread_url, now) for url in links]
                )
        finally:
            conn.close()
    except Exception:
        pass

    # 2. Sync to app.db if available
    if os.path.isfile(APP_DB_FILE):
        try:
            app_conn = sqlite3.connect(APP_DB_FILE)
            try:
                with app_conn:
                    app_conn.executemany(
                        "INSERT OR IGNORE INTO linkgrabber_history (url, thread_title, thread_url, discovered_at) VALUES (?, ?, ?, ?)",
                        [(url, thread_title, thread_url, now) for url in links]
                    )
            finally:
                app_conn.close()
        except Exception:
            pass


def get_history_stats() -> Dict[str, int]:
    """Get total crawled links and threads count."""
    if not os.path.exists(DB_FILE):
        return {"total_links": 0, "total_threads": 0}

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*), COUNT(DISTINCT thread_url) FROM links")
        row = cur.fetchone()
        return {
            "total_links": row[0] if row else 0,
            "total_threads": row[1] if row else 0
        }
    finally:
        conn.close()
