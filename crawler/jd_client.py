import os
import requests
from typing import List, Optional
from urllib.parse import urlparse


class JDownloaderClient:
    """Client to send links to JDownloader 2 via Click'n'Load HTTP API."""

    def __init__(self, host: Optional[str] = None, port: Optional[int] = None, url: Optional[str] = None):
        # Allow URL override (e.g. from CLI or env)
        raw_url = url or os.environ.get("JD_URL")
        if raw_url:
            parsed = urlparse(raw_url if "://" in raw_url else f"http://{raw_url}")
            self.host = parsed.hostname or "127.0.0.1"
            self.port = parsed.port or 9666
        else:
            self.host = host or os.environ.get("JD_HOST", "127.0.0.1")
            self.port = int(port or os.environ.get("JD_PORT", 9666))

        if self.port == 5800:
            print("[Warning] Port 5800 is JDownloader's Web UI (noVNC). Click'n'Load API is on port 9666.")
            print("          If running in Docker on your NAS, ensure port 9666 is mapped (-p 9666:9666).")

        self.base_url = f"http://{self.host}:{self.port}"
        self.add_url = f"{self.base_url}/flash/add"

    def is_running(self) -> bool:
        """Check if JDownloader 2 is running and responding to Click'n'Load."""
        try:
            r = requests.get(f"{self.base_url}/jdcheck.js", timeout=3)
            if r.status_code == 200:
                return True
        except Exception:
            pass

        # Fallback probe to /flash/add for containers that don't serve jdcheck.js
        try:
            r = requests.post(self.add_url, data={"urls": ""}, timeout=3)
            return r.status_code in (200, 204)
        except Exception:
            return False

    def add_links(
        self,
        links: List[str],
        package_name: Optional[str] = None,
        passwords: Optional[str] = None,
    ) -> bool:
        """
        Send a list of URLs to JDownloader 2.
        
        Args:
            links: List of URL strings
            package_name: Optional package folder name in JDownloader LinkGrabber
            passwords: Optional archive passwords
        """
        if not links:
            return False

        data = {
            "urls": "\n".join(links),
            "source": f"http://{self.host}",
        }
        if package_name:
            data["package"] = package_name
        if passwords:
            data["passwords"] = passwords

        headers = {
            "Origin": f"http://{self.host}",
            "Referer": f"http://{self.host}",
        }

        try:
            response = requests.post(self.add_url, data=data, headers=headers, timeout=15)
        except Exception:
            return False
        return response.status_code in (200, 204) and "failed" not in response.text.lower()
