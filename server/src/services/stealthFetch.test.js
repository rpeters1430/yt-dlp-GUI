const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { solveWithFlareSolverr } = require('./stealthFetch');

async function startSolver(t, onRequest, solution = {}) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    onRequest(req, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      solution: {
        url: 'https://forum.example/threads/example.1/',
        status: 200,
        response: '<html>solved</html>',
        cookies: [],
        userAgent: 'SolverBrowser/1.0',
        ...solution,
      },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('forum challenge solves allow enough time for a cold Camoufox launch', async (t) => {
  let request;
  const solverUrl = await startSolver(t, (req, payload) => { request = { req, payload }; });

  const result = await solveWithFlareSolverr(
    solverUrl,
    'https://forum.example/threads/example.1/',
    []
  );

  assert.equal(request.req.url, '/v1');
  assert.equal(request.payload.maxTimeout, 120_000);
  assert.equal(result.html, '<html>solved</html>');
  assert.equal(result.userAgent, 'SolverBrowser/1.0');
});

test('an explicit solver timeout is preserved', async (t) => {
  let payload;
  const solverUrl = await startSolver(t, (_req, body) => { payload = body; });

  await solveWithFlareSolverr(
    solverUrl,
    'https://forum.example/threads/example.1/',
    [],
    { timeoutMs: 45_000 }
  );

  assert.equal(payload.maxTimeout, 45_000);
});

test('a solver response that is still blocked is rejected', async (t) => {
  const solverUrl = await startSolver(t, () => {}, {
    status: 403,
    response: '<html><title>Just a moment...</title></html>',
  });

  await assert.rejects(
    solveWithFlareSolverr(solverUrl, 'https://forum.example/threads/example.1/', []),
    /HTTP 403/
  );
});
