import sys
import json

def main():
    try:
        from curl_cffi import requests
    except ImportError:
        sys.stderr.write(json.dumps({"error": "curl_cffi not installed"}))
        sys.exit(1)

    try:
        payload = sys.stdin.read()
        if not payload:
            sys.exit(0)
        data = json.loads(payload)
        url = data.get("url")
        headers = data.get("headers", {})
        cookies_list = data.get("cookies", [])
        cookies = {}
        for c in cookies_list:
            if isinstance(c, dict) and c.get("name"):
                # Filter out stale __ddg9_ IP cookies if they belong to a different IP
                cookies[c["name"]] = c.get("value", "")

        timeout = int(data.get("timeout", 25))
        impersonate = data.get("impersonate", "chrome124")
        resp = requests.get(url, headers=headers, cookies=cookies, impersonate=impersonate, timeout=timeout)
        set_cookies = []
        for k, v in resp.cookies.items():
            set_cookies.append({"name": k, "value": v})

        sys.stdout.write(json.dumps({
            "status": resp.status_code,
            "headers": dict(resp.headers),
            "cookies": set_cookies,
            "html": resp.text,
        }))
    except Exception as e:
        sys.stderr.write(json.dumps({"error": str(e)}))
        sys.exit(2)

if __name__ == "__main__":
    main()
