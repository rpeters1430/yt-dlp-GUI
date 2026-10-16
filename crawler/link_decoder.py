import base64
import re
from typing import List, Set


# Common password keywords
PASSWORD_PATTERNS = [
    re.compile(r"(?:archive\s*)?pass(?:word)?\s*[:=]\s*[\"']?([^\s\"'\n<>]+)", re.IGNORECASE),
    re.compile(r"\bpw\s*[:=]\s*[\"']?([^\s\"'\n<>]+)", re.IGNORECASE),
    re.compile(r"\bpass\s*[:=]\s*[\"']?([^\s\"'\n<>]+)", re.IGNORECASE),
    re.compile(r"contrase[ñn]a\s*[:=]\s*[\"']?([^\s\"'\n<>]+)", re.IGNORECASE),
    re.compile(r"mot\s*de\s*passe\s*[:=]\s*[\"']?([^\s\"'\n<>]+)", re.IGNORECASE),
]

IGNORE_PASSWORDS = {
    "none", "n/a", "no", "required", "protected", "unknown", "null", "false", "true",
    "password", "pass", "pw", "yes", "link", "download", "here", "mega", "pixeldrain",
}

# Base64 candidate regex (length >= 16, valid Base64 chars)
BASE64_PATTERN = re.compile(r"(?:[A-Za-z0-9+/]{4}){4,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?")


def extract_base64_links(text: str) -> List[str]:
    """Search text for Base64 encoded strings and decode any valid URLs."""
    decoded_urls: List[str] = []
    candidates = BASE64_PATTERN.findall(text)

    for candidate in candidates:
        if len(candidate) < 16:
            continue
        try:
            # Pad if needed
            pad_len = (-len(candidate)) % 4
            padded = candidate + ("=" * pad_len)
            decoded_bytes = base64.b64decode(padded, validate=True)
            decoded_str = decoded_bytes.decode("utf-8", errors="ignore").strip()

            # Check if it contains http(s) URL
            found = re.findall(r"https?://[^\s<>\"'()]+", decoded_str)
            for url in found:
                clean = url.rstrip(".,;!")
                if clean not in decoded_urls:
                    decoded_urls.append(clean)
        except Exception:
            continue

    return decoded_urls


def extract_passwords(text: str) -> List[str]:
    """Search text for archive passwords."""
    passwords: Set[str] = set()

    for pattern in PASSWORD_PATTERNS:
        matches = pattern.findall(text)
        for m in matches:
            clean = m.strip(".,;:\"'!?[]()")
            if (
                clean
                and len(clean) >= 2
                and clean.lower() not in IGNORE_PASSWORDS
                and not clean.startswith("http")
            ):
                passwords.add(clean)

    return list(passwords)
