#!/bin/sh
set -eu

PUID="${PUID:-0}"
PGID="${PGID:-0}"
CONFIG_DIR="${CONFIG_DIR:-/config}"

case "$PUID" in
  ''|*[!0-9]*) echo "PUID must be a non-negative integer" >&2; exit 1 ;;
esac
case "$PGID" in
  ''|*[!0-9]*) echo "PGID must be a non-negative integer" >&2; exit 1 ;;
esac

# Trust the Solverr forward proxy's CA (see README "Solverr proxy"). Needs root, so it runs
# before dropping privileges. Solverr may still be starting, so the download is retried a few
# times. A failure is logged but doesn't stop the app: the GUI then just won't route yt-dlp
# through the proxy.
if [ -n "${SOLVERR_PROXY_CA_URL:-}" ] || [ "${SOLVERR_PROXY_CA_ACTION:-}" = "remove" ]; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "Skipping Solverr proxy CA setup: the container must start as root to install it." >&2
  else
    attempt=1
    until /usr/local/bin/install_proxy_ca.sh; do
      if [ "$attempt" -ge "${SOLVERR_PROXY_CA_ATTEMPTS:-5}" ]; then
        echo "Solverr proxy CA setup failed; yt-dlp will connect directly." >&2
        break
      fi
      attempt=$((attempt + 1))
      sleep 3
    done
  fi
fi

# Preserve normal Docker behavior unless an alternate container identity was requested.
if [ "$(id -u)" -ne 0 ] || { [ "$PUID" = 0 ] && [ "$PGID" = 0 ]; }; then
  exec "$@"
fi

mkdir -p "$CONFIG_DIR"
chown -R "$PUID:$PGID" "$CONFIG_DIR"

# Chown mount points only; recursively changing a media library could be very expensive.
for dir in "${DOWNLOAD_DIR:-/downloads}" "${VIDEO_DIR:-}" "${MUSIC_DIR:-}"; do
  [ -n "$dir" ] || continue
  mkdir -p "$dir"
  chown "$PUID:$PGID" "$dir"
done

exec gosu "$PUID:$PGID" "$@"
