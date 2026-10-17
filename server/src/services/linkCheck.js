// Checks whether crawled links still work before they're sent anywhere. Hosts with a public API
// (Pixeldrain, MEGA) and direct file URLs give a definite online/offline answer, with name and
// size where the host reports them. Any other page is only fetched: a 404/410 means offline,
// a 2xx only that it's "reachable", because many hosts answer 200 with a "file not found" page.
//
// status: online | offline | reachable | unknown (the check itself failed).
const ytdlp = require('./ytdlp');

const MAX_CHECK = 300;
const CONCURRENCY = 4;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DIRECT_FILE = /\.(?:mp4|m4v|webm|mkv|mov|avi|wmv|flv|mp3|m4a|aac|flac|opus|ogg|wav|zip|rar|7z|tar|gz|iso)(?:$|[?#])/i;

// Follows redirects by hand so every hop passes the SSRF guard, like the crawler does.
async function guardedFetch(url, init, { fetchImpl, assertUrl }) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrl(current);
    const res = await fetchImpl(current, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

function filenameFrom(res, url) {
  const disposition = res.headers.get('content-disposition') || '';
  const m = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)|filename="?([^";]+)"?/i);
  if (m) {
    try { return decodeURIComponent((m[1] || m[2]).trim()); } catch { return (m[1] || m[2]).trim(); }
  }
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || undefined; } catch { return undefined; }
}

function sizeFrom(res) {
  const range = (res.headers.get('content-range') || '').match(/\/(\d+)$/);
  const size = Number(range ? range[1] : res.headers.get('content-length'));
  return Number.isFinite(size) && size > 0 ? size : undefined;
}

const byStatus = (res) => (res.status === 404 || res.status === 410 ? { status: 'offline', detail: `HTTP ${res.status}` } : null);

const CHECKERS = [
  {
    // https://pixeldrain.com/u/<id>: the info API answers 404 for removed files.
    match: /^https?:\/\/(?:www\.)?pixeldrain\.com\/u\/([\w-]+)/i,
    async check(m, get) {
      const res = await get(`https://pixeldrain.com/api/file/${m[1]}/info`);
      if (byStatus(res)) return byStatus(res);
      if (!res.ok) return { status: 'unknown', detail: `HTTP ${res.status}` };
      const info = await res.json();
      return { status: 'online', name: info.name, size: info.size };
    },
  },
  {
    match: /^https?:\/\/(?:www\.)?pixeldrain\.com\/l\/([\w-]+)/i,
    async check(m, get) {
      const res = await get(`https://pixeldrain.com/api/list/${m[1]}`);
      if (byStatus(res)) return byStatus(res);
      if (!res.ok) return { status: 'unknown', detail: `HTTP ${res.status}` };
      const list = await res.json();
      const files = Array.isArray(list.files) ? list.files : [];
      return {
        status: files.length ? 'online' : 'offline',
        name: `${list.title || 'List'} (${files.length} file${files.length === 1 ? '' : 's'})`,
        size: files.reduce((sum, f) => sum + (Number(f.size) || 0), 0) || undefined,
      };
    },
  },
  {
    // https://mega.nz/file/<handle>#<key> (or the old #!<handle>!<key>). The size is public;
    // the name is encrypted with the key, so it isn't shown. A negative answer is an error code.
    match: /^https?:\/\/(?:www\.)?mega\.(?:nz|co\.nz)\/(?:file\/|#!)([\w-]{8})(?:[#!]|$)/i,
    async check(m, get) {
      const res = await get('https://g.api.mega.co.nz/cs?id=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ a: 'g', p: m[1] }]),
      });
      if (!res.ok) return { status: 'unknown', detail: `HTTP ${res.status}` };
      const data = await res.json();
      const answer = Array.isArray(data) ? data[0] : data;
      if (typeof answer === 'number') {
        // -3 is MEGA's "try again"; the rest (-9 not found, -16 blocked, ...) mean it's gone.
        return answer === -3 ? { status: 'unknown', detail: 'MEGA asked to retry later' } : { status: 'offline', detail: `MEGA error ${answer}` };
      }
      return { status: 'online', size: answer && Number(answer.s) > 0 ? Number(answer.s) : undefined };
    },
  },
  {
    // A direct file (or catbox, whose links are files): headers give the size and name. Some
    // servers refuse HEAD, so a one-byte ranged GET is the fallback.
    match: { exec: (url) => (DIRECT_FILE.test(url) || /^https?:\/\/files\.catbox\.moe\//i.test(url) ? [url] : null) },
    async check(m, get) {
      let res = await get(m[0], { method: 'HEAD' });
      if (res.status === 405 || res.status === 501) {
        res = await get(m[0], { headers: { Range: 'bytes=0-0' } });
        await res.body?.cancel();
      }
      if (byStatus(res)) return byStatus(res);
      if (!res.ok) return { status: 'unknown', detail: `HTTP ${res.status}` };
      return { status: 'online', name: filenameFrom(res, m[0]), size: sizeFrom(res) };
    },
  },
];

async function checkOne(url, { fetchImpl, assertUrl }) {
  const get = (target, init = {}) => guardedFetch(target, init, { fetchImpl, assertUrl });
  try {
    for (const checker of CHECKERS) {
      const m = checker.match.exec(url);
      if (m) return { url, ...(await checker.check(m, get)) };
    }
    const res = await get(url);
    await res.body?.cancel();
    if (byStatus(res)) return { url, ...byStatus(res) };
    if (res.ok) return { url, status: 'reachable' };
    return { url, status: 'unknown', detail: `HTTP ${res.status}` };
  } catch (err) {
    return { url, status: 'unknown', detail: err.message };
  }
}

// Checks up to MAX_CHECK URLs, CONCURRENCY at a time, in the order given.
async function checkLinks(urls, { fetchImpl = fetch, assertUrl = ytdlp.assertPublicUrlResolved, concurrency = CONCURRENCY } = {}) {
  const list = urls.slice(0, MAX_CHECK);
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      results[i] = await checkOne(list[i], { fetchImpl, assertUrl });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return results;
}

module.exports = { MAX_CHECK, checkLinks };
