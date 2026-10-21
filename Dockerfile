# --- Resolve nightly yt-dlp and the latest FFmpeg autobuild ---
# CI resolves once and passes the same manifest to both architectures. Local
# builds resolve here; use --no-cache-filter tool-versions to check again.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS tool-versions
ARG TOOL_MANIFEST=
COPY scripts/ci/resolve-tools.mjs /resolve-tools.mjs
RUN node /resolve-tools.mjs --manifest-base64 "$TOOL_MANIFEST" --output /out

# --- Build client ---
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# --- Build QuickJS-ng ---
# yt-dlp needs an external JS runtime to solve YouTube's JS challenges. QuickJS-ng's `qjs` is
# built from a pinned, verified release commit and cross-compiled on the build host (so arm64
# doesn't compile under QEMU) into a static binary for the target architecture.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4 AS quickjs-build
ARG TARGETARCH
ARG BUILDARCH
# Update the version and its tag's commit together.
ARG QUICKJS_VERSION=0.17.0
ARG QUICKJS_COMMIT=6d46d07d04041b40f4f49eaa7fdebe44c314c699
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) QJS_TRIPLE=x86_64-linux-gnu; QJS_PROCESSOR=x86_64 ;; \
      arm64) QJS_TRIPLE=aarch64-linux-gnu; QJS_PROCESSOR=aarch64 ;; \
      *) echo "Unsupported architecture for QuickJS-ng" >&2; exit 1 ;; \
    esac; \
    if [ "$TARGETARCH" = "$BUILDARCH" ]; then TOOLCHAIN="gcc libc6-dev"; else TOOLCHAIN="crossbuild-essential-$TARGETARCH"; fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates git cmake make $TOOLCHAIN; \
    git clone --depth 1 --branch "v${QUICKJS_VERSION}" https://github.com/quickjs-ng/quickjs /tmp/quickjs; \
    test "$(git -C /tmp/quickjs rev-parse HEAD)" = "$QUICKJS_COMMIT"; \
    cmake -S /tmp/quickjs -B /tmp/quickjs/build -DCMAKE_BUILD_TYPE=Release -DQJS_BUILD_CLI_STATIC=ON \
      -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR="$QJS_PROCESSOR" -DCMAKE_C_COMPILER="${QJS_TRIPLE}-gcc"; \
    cmake --build /tmp/quickjs/build --target qjs_exe -j"$(nproc)"; \
    mkdir -p /out; \
    "${QJS_TRIPLE}-strip" -o /out/qjs /tmp/quickjs/build/qjs

# --- Final image ---
FROM node:24-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4

# The resolved source/archive hashes are also retained for diagnostics.
COPY --from=tool-versions /out/requirements-docker.txt /tmp/requirements-docker.txt
COPY --from=tool-versions /out/tool-versions.json /usr/local/share/yt-dlp-gui/tool-versions.json

# CI sets this to the Debian security archive's publish date so the cached
# `apt-get upgrade` layer is rebuilt whenever new security fixes ship.
ARG APT_REFRESH=

# python3-pip is kept in the final image (not purged after install) so the Settings page's
# "Update yt-dlp" action can run `pip3 install -U [--pre] yt-dlp` at runtime.
# curl, unzip, xz-utils, and gosu are kept so runtime binary updates and optional PUID/PGID
# privilege dropping work out of the box.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    python3 python3-pip ca-certificates build-essential curl unzip xz-utils gosu \
    && pip3 install --no-cache-dir --break-system-packages -r /tmp/requirements-docker.txt \
    && rm /tmp/requirements-docker.txt \
    && rm -rf /var/lib/apt/lists/*

# Install a checksum-verified static FFmpeg build (amd64 / arm64).
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) FFMPEG_ARCH=amd64 ;; \
      arm64) FFMPEG_ARCH=arm64 ;; \
      *) echo "Unsupported architecture for ffmpeg" >&2; exit 1 ;; \
    esac; \
    FFMPEG_URL=$(python3 -c 'import json,sys; print(json.load(open("/usr/local/share/yt-dlp-gui/tool-versions.json"))["ffmpeg"][sys.argv[1]]["url"])' "$FFMPEG_ARCH"); \
    FFMPEG_SHA256=$(python3 -c 'import json,sys; print(json.load(open("/usr/local/share/yt-dlp-gui/tool-versions.json"))["ffmpeg"][sys.argv[1]]["sha256"])' "$FFMPEG_ARCH"); \
    curl --retry 3 -fsSL -o /tmp/ffmpeg.tar.xz "$FFMPEG_URL"; \
    echo "${FFMPEG_SHA256}  /tmp/ffmpeg.tar.xz" | sha256sum -c -; \
    mkdir -p /tmp/ffmpeg-extracted; \
    tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-extracted; \
    cp /tmp/ffmpeg-extracted/*/bin/ffmpeg /tmp/ffmpeg-extracted/*/bin/ffprobe /usr/local/bin/; \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe; \
    rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-extracted; \
    ffmpeg -version

# QuickJS-ng (built above) is the JS runtime yt-dlp uses for YouTube; Settings can update it.
COPY --from=quickjs-build /out/qjs /usr/local/bin/qjs
RUN qjs --version

WORKDIR /app
COPY build-info.json /app/build-info.json

# build-essential above lets native deps (better-sqlite3) compile from source when no
# prebuilt binary exists yet for the current Node version.
COPY server/package.json server/package-lock.json ./server/
#
# --omit=optional drops connect-sqlite3's optional `sqlite3` dependency (and the node-gyp/
# tar/http-proxy-agent toolchain it pulls in to build from source). It's dead weight here:
# index.js always passes connect-sqlite3 a `db` option backed by better-sqlite3, so the
# store never falls back to requiring the `sqlite3` package. Skipping its install removes a
# long-unpatched, unused native dependency chain from the final image.
#
# build-essential is then purged: it was only needed above to compile better-sqlite3, and
# it hard-depends on libc6-dev, which hard-depends on the linux-libc-dev kernel headers —
# together the single largest CVE surface in this image. Nothing at runtime needs a
# compiler: the "Update yt-dlp" pip install pulls curl-cffi's prebuilt manylinux/musllinux
# wheels for amd64/arm64, never a source build.
RUN cd server && npm ci --omit=dev --omit=optional --no-audit --no-fund \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*

# Runtime tool updates use pip/curl, not npm. Do not ship the unused npm/corepack
# dependency trees and their vulnerability surface in the production container.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist

ENV NODE_ENV=production \
    PORT=3000 \
    DOWNLOAD_DIR=/downloads \
    CONFIG_DIR=/config \
    PYTHONUSERBASE=/config/python \
    YTDLP_BIN=yt-dlp \
    PATH="/config/bin:/config/python/bin:${PATH}"

RUN mkdir -p /downloads /config /config/bin /config/python
VOLUME ["/downloads", "/config"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/src/index.js"]
