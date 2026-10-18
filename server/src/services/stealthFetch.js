const { spawn } = require('child_process');
const path = require('path');

const PY_SCRIPT = path.join(__dirname, 'stealthFetch.py');

async function solveWithFlareSolverr(solverUrl, targetUrl, cookies, { signal, timeoutMs = 30000 } = {}) {
  const base = String(solverUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Solver URL is empty');
  const endpoint = base.endsWith('/v1') ? base : `${base}/v1`;
  let targetHost = '';
  try { targetHost = new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  const payload = {
    cmd: 'request.get',
    url: targetUrl,
    maxTimeout: timeoutMs,
    cookies: (cookies || []).map((c) => {
      let domain = c.domain ? (c.domain.startsWith('.') ? c.domain : `.${c.domain}`) : undefined;
      if (!domain && targetHost) domain = `.${targetHost}`;
      return {
        name: c.name,
        value: c.value,
        domain,
        path: c.path || '/',
      };
    }),
  };
  const timeoutSignal = AbortSignal.timeout(timeoutMs + 5000);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
  if (!res.ok) throw new Error(`Solver error: HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'ok' || !data.solution?.response) {
    throw new Error(data.message || 'Solver challenge solving failed');
  }
  return {
    url: data.solution.url || targetUrl,
    html: data.solution.response,
    cookies: data.solution.cookies || [],
    status: data.solution.status || 200,
  };
}

function fetchWithCurlCffi(targetUrl, { headers = {}, cookies = [], signal, timeout = 25 } = {}) {
  return new Promise((resolve, reject) => {
    const py = spawn('python', [PY_SCRIPT], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const onAbort = () => {
      py.kill();
      reject(signal.reason);
    };
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });

    py.stdout.on('data', (d) => { stdout += d; });
    py.stderr.on('data', (d) => { stderr += d; });

    py.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Failed to spawn python for curl_cffi: ${err.message}`));
    });

    py.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `curl_cffi exited with code ${code}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (err) {
        reject(new Error(`Invalid JSON from curl_cffi: ${stdout.slice(0, 200)}`));
      }
    });

    py.stdin.write(JSON.stringify({
      url: targetUrl,
      headers,
      cookies,
      timeout,
    }));
    py.stdin.end();
  });
}

async function testSolverConnection(rawUrl) {
  const base = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, message: 'No URL provided' };
  try {
    const healthUrl = `${base}/health`;
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      return { ok: true, message: `Connected to Solverr (${data?.version || 'active'})` };
    }
  } catch { /* try /v1 */ }
  try {
    const endpoint = base.endsWith('/v1') ? base : `${base}/v1`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'sessions.list' }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.status === 'ok') return { ok: true, message: `Connected to FlareSolverr (${data.version || 'v1'})` };
    }
  } catch (err) {
    return { ok: false, message: `Could not reach solver: ${err.message}` };
  }
  return { ok: false, message: `Solver at ${base} did not respond with OK status` };
}

module.exports = {
  solveWithFlareSolverr,
  fetchWithCurlCffi,
  testSolverConnection,
};
