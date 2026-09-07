# --- Build client ---
FROM node:24-alpine AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- Final image ---
FROM node:24-bookworm-slim

# python3-pip is kept in the final image (not purged after install) so the Settings page's
# "Update yt-dlp" action can run `pip3 install -U [--pre] yt-dlp` at runtime.
# curl, unzip, and xz-utils are kept so the Settings page's "Update FFmpeg" and "Update yt-dlp"
# actions can download and unpack builds at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ca-certificates build-essential curl unzip xz-utils \
    && pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Install latest static FFmpeg build (amd64 / arm64) from yt-dlp/FFmpeg-Builds
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) FFMPEG_ARCH=linux64 ;; \
      arm64) FFMPEG_ARCH=linuxarm64 ;; \
      *) echo "Unsupported architecture for ffmpeg" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/ffmpeg.tar.xz "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${FFMPEG_ARCH}-gpl.tar.xz"; \
    mkdir -p /tmp/ffmpeg-extracted; \
    tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-extracted; \
    cp /tmp/ffmpeg-extracted/*/bin/ffmpeg /tmp/ffmpeg-extracted/*/bin/ffprobe /usr/local/bin/; \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe; \
    rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-extracted; \
    ffmpeg -version

# yt-dlp requires an external JS runtime to solve YouTube's JS challenges/PO tokens
# (deno is its default/recommended runtime as of yt-dlp 2025.11.12+); install it directly
# from GitHub releases so both amd64 and arm64 NAS builds get the right binary.
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) DENO_ARCH=x86_64-unknown-linux-gnu ;; \
      arm64) DENO_ARCH=aarch64-unknown-linux-gnu ;; \
      *) echo "Unsupported architecture for deno" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_ARCH}.zip"; \
    unzip -o /tmp/deno.zip -d /usr/local/bin; \
    chmod +x /usr/local/bin/deno; \
    rm /tmp/deno.zip; \
    deno --version

WORKDIR /app

# build-essential above lets native deps (better-sqlite3) compile from source when no
# prebuilt binary exists yet for the current Node version.
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev

COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist

ENV NODE_ENV=production \
    PORT=3000 \
    DOWNLOAD_DIR=/downloads \
    CONFIG_DIR=/config \
    YTDLP_BIN=yt-dlp \
    PATH="/config/bin:${PATH}"

RUN mkdir -p /downloads /config
VOLUME ["/downloads", "/config"]

EXPOSE 3000
CMD ["node", "server/src/index.js"]
