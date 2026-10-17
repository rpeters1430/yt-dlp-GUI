const test = require('node:test');
const assert = require('node:assert/strict');
const { checkLinks } = require('../../src/services/linkCheck');

// routes: "METHOD url" or "url" -> Response factory.
function fakeNet(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, init });
    const route = routes[`${method} ${url}`] || routes[url];
    return route ? route(init) : new Response('', { status: 404 });
  };
  return { fetchImpl, calls, opts: { fetchImpl, assertUrl: async () => {} } };
}

test('Pixeldrain files and lists are checked through the API', async () => {
  const { opts } = fakeNet({
    'https://pixeldrain.com/api/file/ok1/info': () => Response.json({ name: 'clip.mp4', size: 1234 }),
    'https://pixeldrain.com/api/list/L1': () => Response.json({ title: 'Set', files: [{ size: 10 }, { size: 5 }] }),
  });
  const results = await checkLinks([
    'https://pixeldrain.com/u/ok1',
    'https://pixeldrain.com/u/gone',
    'https://pixeldrain.com/l/L1',
  ], opts);
  assert.deepEqual(results.map(({ status, name, size }) => [status, name, size]), [
    ['online', 'clip.mp4', 1234],
    ['offline', undefined, undefined],
    ['online', 'Set (2 files)', 15],
  ]);
});

test('MEGA links report size, or offline for an error code', async () => {
  const { opts, calls } = fakeNet({
    'POST https://g.api.mega.co.nz/cs?id=1': (init) => {
      const [{ p }] = JSON.parse(init.body);
      return Response.json(p === 'AAAAAAAA' ? [{ s: 999, at: 'enc' }] : [-9]);
    },
  });
  const results = await checkLinks(['https://mega.nz/file/AAAAAAAA#key', 'https://mega.nz/#!BBBBBBBB!key'], opts);
  assert.deepEqual(results.map(({ status, size, detail }) => [status, size, detail]), [
    ['online', 999, undefined],
    ['offline', undefined, 'MEGA error -9'],
  ]);
  assert.equal(JSON.parse(calls[1].init.body)[0].p, 'BBBBBBBB');
});

test('direct files use HEAD, falling back to a ranged GET', async () => {
  const { opts } = fakeNet({
    'HEAD https://cdn.example.org/a.mp4': () => new Response(null, { status: 200, headers: { 'content-length': '500', 'content-disposition': 'attachment; filename="Real Name.mp4"' } }),
    'HEAD https://cdn.example.org/b.zip': () => new Response(null, { status: 405 }),
    'GET https://cdn.example.org/b.zip': () => new Response('x', { status: 206, headers: { 'content-range': 'bytes 0-0/7777' } }),
  });
  const results = await checkLinks(['https://cdn.example.org/a.mp4', 'https://cdn.example.org/b.zip', 'https://cdn.example.org/c.rar'], opts);
  assert.deepEqual(results.map(({ status, name, size }) => [status, name, size]), [
    ['online', 'Real Name.mp4', 500],
    ['online', 'b.zip', 7777],
    ['offline', undefined, undefined],
  ]);
});

test('other pages are only "reachable" on 2xx, offline on 404/410', async () => {
  const { opts } = fakeNet({
    'https://gofile.io/d/X': () => new Response('<html>', { status: 200 }),
    'https://host.example/gone': () => new Response('', { status: 410 }),
    'https://host.example/err': () => new Response('', { status: 500 }),
  });
  const results = await checkLinks(['https://gofile.io/d/X', 'https://host.example/gone', 'https://host.example/err'], opts);
  assert.deepEqual(results.map((r) => r.status), ['reachable', 'offline', 'unknown']);
});

test('every redirect hop passes the SSRF guard', async () => {
  const { fetchImpl } = fakeNet({
    'https://short.example/x': () => new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/admin' } }),
  });
  const checked = [];
  const [result] = await checkLinks(['https://short.example/x'], {
    fetchImpl,
    assertUrl: async (u) => { checked.push(u); if (u.includes('192.168')) throw new Error('private address'); },
  });
  assert.deepEqual(checked, ['https://short.example/x', 'http://192.168.1.1/admin']);
  assert.deepEqual([result.status, result.detail], ['unknown', 'private address']);
});

test('results keep the input order under concurrency', async () => {
  const { opts } = fakeNet(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [
    `https://h.example/${i}`,
    () => new Promise((r) => setTimeout(() => r(new Response('', { status: i % 2 ? 404 : 200 })), 10 - i)),
  ])));
  const results = await checkLinks(Array.from({ length: 10 }, (_, i) => `https://h.example/${i}`), opts);
  assert.deepEqual(results.map((r) => r.url), Array.from({ length: 10 }, (_, i) => `https://h.example/${i}`));
  assert.deepEqual(results.map((r) => r.status), results.map((_, i) => (i % 2 ? 'offline' : 'reachable')));
});
