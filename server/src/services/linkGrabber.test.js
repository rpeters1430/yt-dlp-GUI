const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseNetscapeCookies,
  cookieHeaderFor,
  extractLinks,
  extractPasswords,
  extractBase64Links,
  stripQuotesAndBots,
  cleanThreadTitle,
  parseThreadUrl,
  getThreadPageUrl,
  detectMaxPage,
  findNextPage,
  unwrapRedirect,
  classify,
  crawl,
  cleanUrls,
  recordCrawledLinks,
  getHistoryStats,
  clearHistory,
  sendToJDownloader,
  testJDownloaderConnection,
  sendToAria2,
} = require('./linkGrabber');

const COOKIES = [
  '# Netscape HTTP Cookie File',
  '.example.com\tTRUE\t/\tTRUE\t0\tsession\tabc',
  '#HttpOnly_forum.example.com\tFALSE\t/threads\tFALSE\t0\tuser\t42',
  'other.org\tFALSE\t/\tFALSE\t0\tnope\tx',
  'expired.example.com\tFALSE\t/\tFALSE\t1\told\tx',
].join('\n');

test('cookies only go to matching domain, path, scheme and unexpired', () => {
  const cookies = parseNetscapeCookies(COOKIES);
  assert.equal(cookies.length, 4);
  assert.equal(cookieHeaderFor(cookies, 'https://forum.example.com/threads/1'), 'session=abc; user=42');
  assert.equal(cookieHeaderFor(cookies, 'https://forum.example.com/members'), 'session=abc');
  assert.equal(cookieHeaderFor(cookies, 'http://forum.example.com/threads/1'), 'user=42');
  assert.equal(cookieHeaderFor(cookies, 'https://notexample.com/'), '');
  assert.equal(cookieHeaderFor(cookies, 'https://expired.example.com/'), 'session=abc');
});

test('extractLinks finds anchors, embeds and bare URLs, skipping scripts', () => {
  const html = `
    <a href="/threads/1/page-2">2</a>
    <a href='https://files.example.net/f/abc'>file</a>
    <iframe data-src="//player.example.org/embed/xyz"></iframe>
    <video><source src="https://cdn.example.org/v.mp4?x=1&amp;y=2"></video>
    <p>Mirror: https://mirror.example.io/d/123.</p>
    <a href="javascript:void(0)">x</a><a href="#top">top</a>
    <script>var u = "https://tracker.example.com/t";</script>`;
  const links = extractLinks(html, 'https://forum.example.com/threads/1');
  const urls = links.map((l) => l.url);
  assert.ok(urls.includes('https://forum.example.com/threads/1/page-2'));
  assert.ok(urls.includes('https://files.example.net/f/abc'));
  assert.ok(urls.includes('https://player.example.org/embed/xyz'));
  assert.ok(urls.includes('https://cdn.example.org/v.mp4?x=1&y=2'));
  assert.ok(urls.includes('https://mirror.example.io/d/123'));
  assert.ok(!urls.some((u) => u.includes('tracker')));
  assert.equal(links.find((l) => l.url.includes('player')).source, 'embed');
});

test('redirect wrappers on the page host are unwrapped, outbound query strings are not', () => {
  const b64 = Buffer.from('https://files.example.net/f/abc').toString('base64');
  assert.equal(unwrapRedirect(`https://forum.example.com/redirect?to=${b64}`), 'https://files.example.net/f/abc');
  assert.equal(unwrapRedirect('https://forum.example.com/out?url=https%3A%2F%2Fa.example.net%2Fx'), 'https://a.example.net/x');
  const links = extractLinks('<a href="https://shop.example.net/p?ref=https://forum.example.com/">x</a>', 'https://forum.example.com/');
  assert.equal(links[0].url, 'https://shop.example.net/p?ref=https://forum.example.com/');
});

test('findNextPage reads rel="next"', () => {
  assert.equal(findNextPage('<link rel="next" href="/t/1/page-3">', 'https://forum.example.com/t/1/page-2'), 'https://forum.example.com/t/1/page-3');
  assert.equal(findNextPage('<a class="x" rel="nofollow next" href="?p=2">', 'https://a.example.com/list'), 'https://a.example.com/list?p=2');
  assert.equal(findNextPage('<a href="/x">x</a>', 'https://a.example.com/'), null);
});

test('classify labels media by extension and embeds by source', () => {
  assert.equal(classify('https://a.example.com/v.webm', 'link'), 'video');
  assert.equal(classify('https://a.example.com/s.m3u8?t=1', 'text'), 'video');
  assert.equal(classify('https://a.example.com/a.flac', 'link'), 'audio');
  assert.equal(classify('https://a.example.com/pack.zip', 'link'), 'archive');
  assert.equal(classify('https://a.example.com/e/1', 'embed'), 'embed');
  assert.equal(classify('https://a.example.com/e/1', 'link'), 'link');
});

function fakeSite(pages) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, cookie: opts.headers.Cookie });
    const page = pages[url];
    if (!page) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
    if (page.redirect) return new Response(null, { status: 302, headers: { location: page.redirect } });
    return new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  return { fetchImpl, calls };
}

test('crawl follows pagination, dedupes, drops site navigation and sends cookies', async () => {
  const { fetchImpl, calls } = fakeSite({
    'https://forum.example.com/t/1': `<title>Thread &amp; stuff</title>
      <a href="/members/me">me</a>
      <a href="https://files.example.net/f/1">f1</a>
      <iframe src="https://player.example.org/e/9"></iframe>
      <link rel="next" href="/t/1/page-2">`,
    'https://forum.example.com/t/1/page-2': `<a href="https://files.example.net/f/1">again</a>
      <a href="/attachments/clip.mp4">clip</a>
      <a rel="next" href="https://elsewhere.example.org/next">offsite next</a>`,
  });
  const result = await crawl({
    url: 'https://forum.example.com/t/1',
    maxPages: 5,
    cookiesText: COOKIES,
    fetchImpl,
    assertUrl: async () => {},
    delayMs: 0,
  });
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].title, 'Thread & stuff');
  const byUrl = Object.fromEntries(result.links.map((l) => [l.url, l]));
  assert.equal(byUrl['https://files.example.net/f/1'].count, 2);
  assert.equal(byUrl['https://player.example.org/e/9'].kind, 'embed');
  assert.equal(byUrl['https://forum.example.com/attachments/clip.mp4'].kind, 'video');
  assert.equal(byUrl['https://forum.example.com/attachments/clip.mp4'].page, 2);
  assert.ok(!byUrl['https://forum.example.com/members/me']);
  assert.equal(calls.length, 2, 'off-site next page is not followed');
  assert.equal(calls[0].cookie, 'session=abc');
});

test('crawl respects maxPages and reports more pages', async () => {
  const { fetchImpl } = fakeSite({
    'https://a.example.com/1': '<link rel="next" href="/2">',
    'https://a.example.com/2': '<link rel="next" href="/3">',
  });
  const result = await crawl({ url: 'https://a.example.com/1', maxPages: 1, fetchImpl, assertUrl: async () => {}, delayMs: 0 });
  assert.equal(result.pages.length, 1);
  assert.equal(result.hasMorePages, true);
});

test('crawl re-checks every redirect hop and keeps cookies per host', async () => {
  const { fetchImpl, calls } = fakeSite({
    'https://forum.example.com/go': { redirect: 'https://other.org/page' },
    'https://other.org/page': '<a href="https://x.example.net/1">x</a>',
  });
  const checked = [];
  const result = await crawl({
    url: 'https://forum.example.com/go',
    cookiesText: COOKIES,
    fetchImpl,
    assertUrl: async (u) => { checked.push(u); },
    delayMs: 0,
  });
  assert.deepEqual(checked, ['https://forum.example.com/go', 'https://other.org/page']);
  assert.equal(calls[1].cookie, 'nope=x');
  assert.equal(result.links.length, 1);
  await assert.rejects(
    crawl({ url: 'https://forum.example.com/go', fetchImpl, assertUrl: async (u) => { if (u.includes('other')) throw new Error('blocked'); }, delayMs: 0 }),
    /blocked/,
  );
});

test('crawl rejects non-pages and errors on the first page', async () => {
  const fetchImpl = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(crawl({ url: 'https://a.example.com/', fetchImpl, assertUrl: async () => {} }), /Not a web page/);
  await assert.rejects(crawl({ url: 'ftp://a.example.com/', fetchImpl, assertUrl: async () => {} }), /valid http/);
});

test('cleanUrls keeps unique http(s) URLs', () => {
  assert.deepEqual(cleanUrls(['https://a.example.com/x#y', 'https://a.example.com/x', 'file:///etc/passwd', 'nope']), ['https://a.example.com/x']);
});

test('sendToJDownloader posts a Click\'n\'Load form', async () => {
  let req;
  const fetchImpl = async (url, opts) => { req = { url, opts }; return new Response('success', { status: 200 }); };
  const result = await sendToJDownloader(['https://a.example.com/1', 'https://a.example.com/2'], { baseUrl: 'http://192.168.1.5:9666', packageName: 'Pkg', fetchImpl });
  assert.equal(result.sent, 2);
  assert.equal(req.url, 'http://192.168.1.5:9666/flash/add');
  const form = new URLSearchParams(req.opts.body);
  assert.equal(form.get('urls'), 'https://a.example.com/1\r\nhttps://a.example.com/2');
  assert.equal(form.get('package'), 'Pkg');
  await assert.rejects(sendToJDownloader(['https://a.example.com/1'], { baseUrl: '', fetchImpl }), /not configured/);
});

test('sendToAria2 multicalls addUri with the token and reports faults', async () => {
  let payload;
  const fetchImpl = async (url, opts) => {
    payload = JSON.parse(opts.body);
    return Response.json({ id: 'yt-dlp-gui', jsonrpc: '2.0', result: [['gid1'], { faultCode: 1, faultString: 'bad uri' }] });
  };
  const result = await sendToAria2(['https://a.example.com/1', 'https://a.example.com/2'], { rpcUrl: 'http://nas:6800/jsonrpc', secret: 's3', dir: '/data', fetchImpl });
  assert.equal(payload.method, 'system.multicall');
  assert.deepEqual(payload.params[0][0], { methodName: 'aria2.addUri', params: ['token:s3', ['https://a.example.com/1'], { dir: '/data' }] });
  assert.equal(result.sent, 1);
  assert.deepEqual(result.failed, ['bad uri']);
});

test('extractPasswords finds passwords across various formats and skips common words', () => {
  const text = `
    Download here: https://mega.nz/file/123
    Password: SecretPass123
    pw: my_archive_pw
    Pass: none
    contraseña: password
  `;
  const pws = extractPasswords(text);
  assert.ok(pws.includes('SecretPass123'));
  assert.ok(pws.includes('my_archive_pw'));
  assert.ok(!pws.includes('none'));
  assert.ok(!pws.includes('password'));
});

test('extractBase64Links decodes valid hidden URLs', () => {
  // "https://pixeldrain.com/u/abcdef" in Base64 is "aHR0cHM6Ly9waXhlbGRyYWluLmNvbS91L2FiY2RlZg=="
  const text = 'Here is the download string: aHR0cHM6Ly9waXhlbGRyYWluLmNvbS91L2FiY2RlZg== thanks!';
  const b64 = extractBase64Links(text);
  assert.deepEqual(b64, ['https://pixeldrain.com/u/abcdef']);
});

test('stripQuotesAndBots removes quoted text and bot replies', () => {
  const html = `
    <article data-author="sussybot"><p>bot mirror: https://mirror.example.com/bot</p></article>
    <div class="bbCodeBlock bbCodeBlock--quote"><blockquote>https://quoted.example.com/old</blockquote></div>
    <p>Real link: https://mega.nz/file/real</p>
  `;
  const cleaned = stripQuotesAndBots(html, { skipQuotes: true, skipBots: true });
  assert.ok(!cleaned.includes('mirror.example.com/bot'));
  assert.ok(!cleaned.includes('quoted.example.com/old'));
  assert.ok(cleaned.includes('https://mega.nz/file/real'));
});

test('parseThreadUrl and XenForo pagination helpers work accurately', () => {
  const parsed = parseThreadUrl('https://simpcity.cr/threads/artist-name.12345/page-27');
  assert.equal(parsed.isThread, true);
  assert.equal(parsed.baseUrl, 'https://simpcity.cr/threads/artist-name.12345/');
  assert.equal(parsed.page, 27);

  assert.equal(getThreadPageUrl(parsed.baseUrl, 1), 'https://simpcity.cr/threads/artist-name.12345/');
  assert.equal(getThreadPageUrl(parsed.baseUrl, 5), 'https://simpcity.cr/threads/artist-name.12345/page-5');

  const html = `
    <div class="pageNav-main">
      <a class="pageNav-page" href="/threads/name.123/page-2">2</a>
      <a class="pageNav-page" href="/threads/name.123/page-52">52</a>
    </div>
  `;
  assert.equal(detectMaxPage(html, 1), 52);
  assert.equal(cleanThreadTitle('Artist Name | SimpCity'), 'Artist Name');
});

test('sendToJDownloader handles passwords and packages per page', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: new URLSearchParams(opts.body) });
    return new Response('success', { status: 200 });
  };

  const urls = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'];
  const urlMetadata = [
    { url: 'https://a.com/1', page: 1 },
    { url: 'https://a.com/2', page: 2 },
    { url: 'https://a.com/3', page: 2 },
  ];

  const res = await sendToJDownloader(urls, {
    baseUrl: 'http://192.168.50.114:9666',
    packageName: 'MyThread',
    passwords: ['secretPW'],
    packagePerPage: true,
    urlMetadata,
    fetchImpl,
  });

  assert.equal(res.sent, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.get('package'), '[Page 1] MyThread');
  assert.equal(calls[0].body.get('passwords'), 'secretPW');
  assert.equal(calls[1].body.get('package'), '[Page 2] MyThread');
});

test('sendToJDownloader and testJDownloaderConnection diagnose port 5800 vs 9666', async () => {
  await assert.rejects(
    sendToJDownloader(['https://a.com/1'], { baseUrl: 'http://192.168.50.114:5800', fetchImpl: async () => {} }),
    /Port 5800 is JDownloader's Web UI/
  );

  const mockWebUiFetch = async () => new Response('<html><title>noVNC JDownloader 2</title></html>', { status: 200 });
  const diag = await testJDownloaderConnection('http://192.168.50.114:5800', { fetchImpl: mockWebUiFetch });
  assert.equal(diag.ok, false);
  assert.equal(diag.isWebUi, true);
  assert.ok(diag.message.includes('Click\'n\'Load requires port 9666'));

  const mockJdFetch = async () => new Response('jdownloader running', { status: 200 });
  const successDiag = await testJDownloaderConnection('http://192.168.50.114:9666', { fetchImpl: mockJdFetch });
  assert.equal(successDiag.ok, true);
});

test('history records and reports stats', () => {
  clearHistory();
  const added = recordCrawledLinks(['https://host.com/f/1', 'https://host.com/f/2'], 'Test Thread', 'https://forum.com/thread/1');
  assert.equal(added, 2);

  const stats = getHistoryStats();
  assert.equal(stats.totalLinks, 2);
  assert.equal(stats.totalThreads, 1);
});
