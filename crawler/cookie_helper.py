import json
import os
from typing import Dict
from http.cookiejar import MozillaCookieJar


def parse_cookie_string(raw: str) -> Dict[str, str]:
    """Parse raw Header-style cookie string (e.g. 'key1=val1; key2=val2')."""
    cookies = {}
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, val = part.split("=", 1)
        cookies[key.strip()] = val.strip()
    return cookies


def load_cookies(source: str = "cookies.json") -> Dict[str, str]:
    """
    Load cookies from a file path or raw string.
    Supports:
      - .json file (Cookie-Editor export or key-value dict)
      - .txt file (Netscape cookies.txt format)
      - raw cookie string (e.g. 'xf_user=...; xf_session=...')
    """
    if not source:
        return {}

    # Check if source is a file path
    if os.path.isfile(source):
        ext = os.path.splitext(source)[1].lower()

        if ext == ".json":
            with open(source, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            # Format 1: List of cookie objects (Cookie-Editor extension format)
            if isinstance(data, list):
                cookies = {}
                for item in data:
                    name = item.get("name")
                    value = item.get("value")
                    if name and value is not None:
                        cookies[name] = str(value)
                return cookies
            
            # Format 2: Dict of {name: value}
            elif isinstance(data, dict):
                return {k: str(v) for k, v in data.items()}

        elif ext in [".txt", ""]:
            # Try parsing as Netscape format first
            try:
                jar = MozillaCookieJar(source)
                jar.load(ignore_discard=True, ignore_expires=True)
                cookies = {c.name: c.value for c in jar}
                if cookies:
                    return cookies
            except Exception:
                pass

            # Fallback: check if it's a raw cookie header string inside the text file
            with open(source, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if ";" in content or "=" in content:
                    return parse_cookie_string(content)

    # Check if raw string provided directly
    if "=" in source:
        return parse_cookie_string(source)

    return {}


def find_default_cookie_file() -> Dict[str, str]:
    """Auto-detect common cookie files in current directory."""
    for filename in ["cookies.json", "cookies.txt", "simpcity_cookies.json", "simpcity_cookies.txt"]:
        if os.path.isfile(filename):
            cookies = load_cookies(filename)
            if cookies:
                print(f"[Info] Found and loaded cookie file: {filename} ({len(cookies)} cookies)")
                return cookies
    return {}
