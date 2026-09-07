# --- Build client ---
FROM node:24-alpine AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- Final image ---
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg ca-certificates build-essential \
    && pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
    && apt-get purge -y --auto-remove python3-pip \
    && rm -rf /var/lib/apt/lists/*

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
    YTDLP_BIN=yt-dlp

RUN mkdir -p /downloads /config
VOLUME ["/downloads", "/config"]

EXPOSE 3000
CMD ["node", "server/src/index.js"]
