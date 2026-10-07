#!/usr/bin/env bash
set -euo pipefail
image=${1:?Usage: docker-smoke.sh IMAGE [PLATFORM]}
platform=${2:-linux/amd64}
name="ytdlp-smoke-${platform##*/}-$$"
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker logs "$name" || true; fi
  docker rm -fv "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm --platform "$platform" --entrypoint sh "$image" -ec '
  yt-dlp --version
  ffmpeg -version
  ffprobe -version
  deno --version
  node -e "require(\"/app/server/node_modules/better-sqlite3\")(\":memory:\").prepare(\"SELECT 1\").get()"
'
docker run -d --platform "$platform" --name "$name" \
  -e ADMIN_USER=ci -e ADMIN_PASSWORD=ci-smoke-password \
  --mount type=volume,destination=/config \
  --mount type=volume,destination=/downloads "$image"

ready=false
for attempt in $(seq 1 60); do
  if docker exec "$name" node -e '
    fetch("http://127.0.0.1:3000/api/health", {signal: AbortSignal.timeout(3000)})
      .then(async r => { if (!r.ok || (await r.json()).status !== "ok") throw new Error("Not ready"); })
      .catch(() => process.exit(1));
  '; then ready=true; break; fi
  sleep 2
done
[ "$ready" = true ] || { echo "Server did not become ready on $platform" >&2; exit 1; }
# Login exercises the native SQLite session adapter, then authenticated routes
# prove module initialization and database migrations succeeded.
docker exec -i "$name" node <<'JS'
async function check() {
  const base = 'http://127.0.0.1:3000';
  const request = (url, options = {}) => fetch(base + url, {signal: AbortSignal.timeout(5000), ...options});
  const health = await request('/api/health');
  if (health.headers.has('set-cookie')) throw new Error('Health created a session');
  const page = await request('/');
  if (!page.ok || !(await page.text()).includes('<html')) throw new Error('Client unavailable');
  const login = await request('/api/auth/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: 'ci', password: 'ci-smoke-password'}),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const cookie = login.headers.get('set-cookie');
  if (!cookie) throw new Error('Missing session cookie');
  for (const route of ['/api/auth/me', '/api/downloads', '/api/watches']) {
    const response = await request(route, {headers: {Cookie: cookie.split(';')[0]}});
    if (!response.ok) throw new Error(`${route}: ${response.status}`);
    await response.json();
  }
}
check().catch(error => { console.error(error); process.exit(1); });
JS
echo "Runtime passed: $platform ($image)"
