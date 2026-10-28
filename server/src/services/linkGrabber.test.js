const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('node:http');
const {
  parseNetscapeCookies,
  parseCookiesContent,
  cookieHeaderFor,
  getCrawlerCookiesStatus,
  saveCrawlerCookies,
  deleteCrawlerCookies,
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
  resolveDirectDownloadUrl,
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

test('detectMaxPage ignores page links that point at other threads', () => {
  const html = `
    <a class="pageNav-page" href="/threads/name.123/page-5">5</a>
    <a href="/threads/name.123/page-6">Next</a>
    <div class="bbWrapper"><a href="https://forum.example.com/threads/other.9/page-400">old thread</a></div>
  `;
  assert.equal(detectMaxPage(html, 1, 'https://forum.example.com/threads/name.123/'), 6);
});

test('crawl in last-N mode only keeps links from the requested pages', async () => {
  const thread = 'https://forum.example.com/threads/t.1/';
  const page = (n) => `<a class="pageNav-page" href="/threads/t.1/page-4">4</a>
    <a href="https://files.example.net/f/${n}">f${n}</a>
    <a href="https://forum.example.com/threads/other.9/page-400">elsewhere</a>`;
  const { fetchImpl, calls } = fakeSite({
    [thread]: page(1),
    [`${thread}page-3`]: page(3),
    [`${thread}page-4`]: page(4),
  });
  const result = await crawl({ url: thread, mode: 'last', lastN: 2, ignoreHistory: true, fetchImpl, assertUrl: async () => {}, delayMs: 0 });
  assert.equal(result.error, null);
  assert.equal(result.maxPage, 4);
  assert.deepEqual(result.pages.map((p) => p.page), [3, 4]);
  assert.deepEqual(result.links.map((l) => l.url).sort(), ['https://files.example.net/f/3', 'https://files.example.net/f/4']);
  assert.equal(result.threadUrl, thread);
  assert.equal(calls.length, 3);
});

test('sendToJDownloader records the thread URL in history, not the JDownloader address', async () => {
  clearHistory();
  const fetchImpl = async () => new Response('success', { status: 200 });
  await sendToJDownloader(['https://a.com/x'], {
    baseUrl: 'http://127.0.0.1:9666',
    packageName: 'Thread',
    threadUrl: 'https://forum.example.com/threads/t.1/',
    fetchImpl,
  });
  const db = require('../db');
  const row = db.prepare('SELECT thread_url FROM linkgrabber_history WHERE url = ?').get('https://a.com/x');
  assert.equal(row.thread_url, 'https://forum.example.com/threads/t.1/');
  clearHistory();
});

test('sendToJDownloader per-page packages carry their own page passwords', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(new URLSearchParams(opts.body));
    return new Response('success', { status: 200 });
  };
  await sendToJDownloader(['https://a.com/1', 'https://a.com/2', 'https://a.com/3'], {
    baseUrl: 'http://127.0.0.1:9666',
    packageName: 'T',
    passwords: ['pw1', 'pw2'],
    pagePasswords: { 1: ['pw1'] },
    packagePerPage: true,
    urlMetadata: [{ url: 'https://a.com/1', page: 1 }, { url: 'https://a.com/2', page: 2 }, { url: 'https://a.com/3', page: 3 }],
    fetchImpl,
  });
  assert.deepEqual(calls.map((b) => b.get('passwords')), ['pw1', null, null]);
  clearHistory();
});

test('sendToJDownloader records the pages JDownloader accepted when a later page fails', async () => {
  clearHistory();
  let n = 0;
  const fetchImpl = async () => new Response('', { status: ++n === 2 ? 500 : 200 });
  await assert.rejects(
    sendToJDownloader(['https://a.com/1', 'https://a.com/2'], {
      baseUrl: 'http://127.0.0.1:9666',
      packageName: 'T',
      packagePerPage: true,
      urlMetadata: [{ url: 'https://a.com/1', page: 1 }, { url: 'https://a.com/2', page: 2 }],
      threadUrl: 'https://forum.example.com/threads/t.1/',
      fetchImpl,
    }),
    /HTTP 500 after 1 of 2 links were sent/
  );
  const db = require('../db');
  const urls = db.prepare('SELECT url FROM linkgrabber_history ORDER BY url').all().map((r) => r.url);
  assert.deepEqual(urls, ['https://a.com/1']);
  clearHistory();
});

test('crawl reports passwords per page', async () => {
  const thread = 'https://forum.example.com/threads/t.1/';
  const { fetchImpl } = fakeSite({
    [thread]: '<a class="pageNav-page" href="/threads/t.1/page-2">2</a> Password: alpha <a href="https://files.example.net/f/1">f</a>',
    [`${thread}page-2`]: 'Password: beta <a href="https://files.example.net/f/2">f</a>',
  });
  const result = await crawl({ url: thread, mode: 'all', ignoreHistory: true, fetchImpl, assertUrl: async () => {}, delayMs: 0 });
  assert.deepEqual(result.pagePasswords, { 1: ['alpha'], 2: ['beta'] });
});

test('parseCookiesContent handles JSON, Netscape and header formats', () => {
  const jsonCookies = JSON.stringify([
    { name: 'xf_user', value: '123_abc', domain: '.simpcity.cr', path: '/' },
    { name: 'xf_session', value: 'xyz', domain: 'simpcity.cr' },
  ]);
  const parsedJson = parseCookiesContent(jsonCookies);
  assert.equal(parsedJson.length, 2);
  assert.equal(parsedJson[0].name, 'xf_user');
  assert.equal(parsedJson[0].value, '123_abc');
  assert.equal(parsedJson[0].domain, 'simpcity.cr');

  const netscapeCookies = '.example.com\tTRUE\t/\tTRUE\t0\tsess\t123';
  const parsedNetscape = parseCookiesContent(netscapeCookies);
  assert.equal(parsedNetscape.length, 1);
  assert.equal(parsedNetscape[0].name, 'sess');

  const spaceSeparatedCookies = 'simpcity.cr   FALSE   /   TRUE   1817954650   xf_user   user_val_123';
  const parsedSpaces = parseCookiesContent(spaceSeparatedCookies);
  assert.equal(parsedSpaces.length, 1);
  assert.equal(parsedSpaces[0].name, 'xf_user');
  assert.equal(parsedSpaces[0].value, 'user_val_123');
  assert.equal(parsedSpaces[0].domain, 'simpcity.cr');

  const headerCookies = 'foo=bar; baz=qux';
  const parsedHeader = parseCookiesContent(headerCookies);
  assert.equal(parsedHeader.length, 2);
  assert.equal(parsedHeader[0].name, 'foo');
  assert.equal(parsedHeader[0].value, 'bar');
});

test('crawler cookie persistence: save, get status, and delete', () => {
  const { CRAWLER_COOKIES_FILE } = require('./ytdlpPaths');
  const backup = fs.existsSync(CRAWLER_COOKIES_FILE) ? fs.readFileSync(CRAWLER_COOKIES_FILE, 'utf8') : null;
  try {
    deleteCrawlerCookies();
    const initStatus = getCrawlerCookiesStatus();
    assert.equal(initStatus.configured, false);

    const sampleCookie = JSON.stringify([
      { name: 'xf_user', value: 'test_token', domain: 'simpcity.cr' },
    ]);
    const saveRes = saveCrawlerCookies(sampleCookie);
    assert.equal(saveRes.ok, true);
    assert.equal(saveRes.cookieCount, 1);
    assert.deepEqual(saveRes.domains, ['simpcity.cr']);

    const afterStatus = getCrawlerCookiesStatus();
    assert.equal(afterStatus.configured, true);
    assert.equal(afterStatus.cookieCount, 1);
    assert.deepEqual(afterStatus.domains, ['simpcity.cr']);

    const delRes = deleteCrawlerCookies();
    assert.equal(delRes.ok, true);
    assert.equal(getCrawlerCookiesStatus().configured, false);
  } finally {
    if (backup !== null) {
      saveCrawlerCookies(backup);
    } else {
      deleteCrawlerCookies();
    }
  }
});

test('resolveDirectDownloadUrl transforms pixeldrain /u/ links', () => {
  assert.equal(
    resolveDirectDownloadUrl('https://pixeldrain.com/u/vW1VQoT5'),
    'https://pixeldrain.com/api/file/vW1VQoT5?download'
  );
  assert.equal(
    resolveDirectDownloadUrl('https://gofile.io/d/123'),
    'https://gofile.io/d/123'
  );
});

test('extractLinks discovers bare known host URLs and URL-safe base64', () => {
  const html = `
    <div>Post text without protocol: gofile.io/d/LSfcHEWs and pixeldrain.com/u/vW1VQoT5</div>
    <div>Also turbo.cr/embed/V0JRVlNS_Erug and bunkr.sk/f/uvRZKMEfLEHqL</div>
    <div data-url="https://filester.gg/d/4PFZvhT"></div>
    <p>Password is "my cool pass"</p>
  `;
  const links = extractLinks(html, 'https://simpcity.cr/threads/test.123');
  const urls = links.map((l) => l.url);

  assert.ok(urls.includes('https://gofile.io/d/LSfcHEWs'));
  assert.ok(urls.includes('https://pixeldrain.com/u/vW1VQoT5'));
  assert.ok(urls.includes('https://turbo.cr/embed/V0JRVlNS_Erug'));
  assert.ok(urls.includes('https://bunkr.sk/f/uvRZKMEfLEHqL'));
  assert.ok(urls.includes('https://filester.gg/d/4PFZvhT'));
  assert.ok(links.passwords.includes('my cool pass'));

  // URL-safe Base64 test
  const rawUrl = 'https://pixeldrain.com/u/test_123';
  const urlSafeB64 = Buffer.from(rawUrl).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const b64Links = extractBase64Links(`Here is the encoded link: ${urlSafeB64}`);
  assert.ok(b64Links.includes(rawUrl));
});

test('saved cookies are used only when asked, and pasted cookies replace them', async () => {
  const { CRAWLER_COOKIES_FILE } = require('./ytdlpPaths');
  const backup = fs.existsSync(CRAWLER_COOKIES_FILE) ? fs.readFileSync(CRAWLER_COOKIES_FILE, 'utf8') : null;
  try {
    saveCrawlerCookies('forum.example.com\tFALSE\t/\tFALSE\t0\tsaved\t1');
    const cookieSent = async (opts) => {
      const { fetchImpl, calls } = fakeSite({ 'https://forum.example.com/t': '<p>x</p>' });
      await crawl({ url: 'https://forum.example.com/t', mode: 'single', fetchImpl, assertUrl: async () => {}, delayMs: 0, ...opts });
      return calls[0].cookie;
    };
    assert.equal(await cookieSent({ useSavedCookies: true }), 'saved=1');
    assert.equal(await cookieSent({ useSavedCookies: false }), undefined);
    assert.equal(await cookieSent({ useSavedCookies: true, cookiesText: 'temp=2' }), 'temp=2');
  } finally {
    if (backup !== null) saveCrawlerCookies(backup);
    else deleteCrawlerCookies();
  }
});

test('cookies pasted without a domain stay on the crawled site across redirects', async () => {
  const { fetchImpl, calls } = fakeSite({
    'https://forum.example.com/go': { redirect: 'https://other.org/page' },
    'https://other.org/page': '<p>x</p>',
  });
  await crawl({ url: 'https://forum.example.com/go', cookiesText: 'xf_session=SECRET', fetchImpl, assertUrl: async () => {}, delayMs: 0 });
  assert.equal(calls[0].cookie, 'xf_session=SECRET');
  assert.equal(calls[1].cookie, undefined);
});

test('hasMorePages reflects requested pages, not the whole thread', async () => {
  const thread = 'https://forum.example.com/threads/t.1/';
  const pages = {};
  for (let n = 1; n <= 30; n++) {
    pages[n === 1 ? thread : `${thread}page-${n}`] = `<a class="pageNav-page" href="/threads/t.1/page-30">30</a><a href="https://files.example.net/f/${n}">f</a>`;
  }
  const { fetchImpl } = fakeSite(pages);
  const opts = { url: thread, ignoreHistory: true, fetchImpl, assertUrl: async () => {}, delayMs: 0 };

  assert.equal((await crawl({ ...opts, mode: 'last', lastN: 3 })).hasMorePages, false, 'last N got everything it asked for');
  assert.equal((await crawl({ ...opts, mode: 'range', startPage: 5, endPage: 8 })).hasMorePages, false);
  const all = await crawl({ ...opts, mode: 'all' });
  assert.equal(all.pages.length, 25);
  assert.equal(all.hasMorePages, true, 'the 25-page cap left pages out');
  await assert.rejects(crawl({ ...opts, mode: 'range', startPage: 40, endPage: 45 }), /Page 40 is past the end of the thread \(it has 30 pages\)/);
});

test('following next links from a later thread page keeps the thread\'s page numbers', async () => {
  const thread = 'https://forum.example.com/threads/t.1/';
  const { fetchImpl } = fakeSite({
    [`${thread}page-27`]: `<a class="pageNav-page" href="/threads/t.1/page-29">29</a><link rel="next" href="${thread}page-28">`,
    [`${thread}page-28`]: `<link rel="next" href="${thread}page-29">`,
  });
  const result = await crawl({ url: `${thread}page-27`, mode: 'follow', maxPages: 2, ignoreHistory: true, fetchImpl, assertUrl: async () => {}, delayMs: 0 });
  assert.deepEqual(result.pages.map((p) => p.page), [27, 28]);
  assert.equal(result.hasMorePages, true);
});

test('follow-mode requests send the immediately previous page as Referer', async () => {
  const page1 = 'https://forum.example.com/list';
  const page2 = 'https://forum.example.com/list?page=2';
  const page3 = 'https://forum.example.com/list?page=3';
  const pages = {
    [page1]: `<link rel="next" href="${page2}">`,
    [page2]: `<link rel="next" href="${page3}">`,
    [page3]: '<p>done</p>',
  };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, referer: opts.headers.Referer });
    return htmlOk(pages[url]);
  };

  await crawl({ url: page1, mode: 'follow', maxPages: 3, ignoreHistory: true, fetchImpl, assertUrl: async () => {}, delayMs: 0 });

  assert.deepEqual(calls, [
    { url: page1, referer: undefined },
    { url: page2, referer: page1 },
    { url: page3, referer: page2 },
  ]);
});

test('numbered thread-page requests send the immediately previous page as Referer', async () => {
  const thread = 'https://forum.example.com/threads/t.1/';
  const page2 = `${thread}page-2`;
  const page3 = `${thread}page-3`;
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, referer: opts.headers.Referer });
    const navigation = url === thread
      ? '<a class="pageNav-page" href="/threads/t.1/page-3">3</a>'
      : '';
    return htmlOk(navigation);
  };

  await crawl({ url: thread, mode: 'all', ignoreHistory: true, fetchImpl, assertUrl: async () => {}, delayMs: 0 });

  assert.deepEqual(calls, [
    { url: thread, referer: undefined },
    { url: page2, referer: thread },
    { url: page3, referer: page2 },
  ]);
});

test('sendToAria2 reports which URLs aria2 accepted', async () => {
  const fetchImpl = async () => Response.json({ result: [['gid1'], { faultCode: 1, faultString: 'bad uri' }, ['gid3']] });
  const result = await sendToAria2(['https://a.com/1', 'https://a.com/2', 'https://a.com/3'], { rpcUrl: 'http://nas:6800/jsonrpc', fetchImpl });
  assert.deepEqual(result.accepted, ['https://a.com/1', 'https://a.com/3']);
});

const xfPost = (id, author, body) => `<article class="message message--post" data-author="${author}" data-content="post-${id}">
  <header class="message-attribution"><a href="https://forum.example.com/threads/t.1/post-${id}">#</a></header>
  <div class="bbWrapper">${body}</div>
  <aside class="message-signature"><a href="https://sig.example.org/shop">my shop</a></aside>
</article>`;

test('nested quotes are removed whole, including the outer quote\'s own links', () => {
  const html = `<div class="bbCodeBlock bbCodeBlock--quote"><div class="q">
      <div class="bbCodeBlock bbCodeBlock--quote"><div>inner <a href="https://gofile.io/d/INNER">x</a></div></div>
      outer <a href="https://gofile.io/d/OUTER">y</a></div></div>
    <a href="https://pixeldrain.com/u/REAL">r</a>`;
  assert.deepEqual(extractLinks(html, 'https://forum.example.com/threads/a.1/').map((l) => l.url), ['https://pixeldrain.com/u/REAL']);
});

test('forum pages are read post by post, skipping page chrome and signatures', () => {
  const html = `<nav><a href="https://twitter.com/forum">tw</a></nav>
    ${xfPost(11, 'alice', 'Password: alpha <a href="https://gofile.io/d/A">a</a>')}
    ${xfPost(12, 'bob', 'pw: beta<br>https://pixeldrain.com/u/B')}
    <aside><a href="https://ads.example/promo">ad</a></aside>
    <footer><a href="https://discord.gg/x">discord</a></footer>`;
  const links = extractLinks(html, 'https://forum.example.com/threads/t.1/');
  assert.deepEqual(links.map((l) => [l.url, l.postId, l.author, l.passwords]), [
    ['https://gofile.io/d/A', '11', 'alice', ['alpha']],
    ['https://pixeldrain.com/u/B', '12', 'bob', ['beta']],
  ]);
  assert.deepEqual(links.passwords.sort(), ['alpha', 'beta']);
});

test('pages without posts are read whole, minus navigation and footers', () => {
  const html = `<header><a href="https://social.example/me">me</a></header>
    <main><a href="https://files.example.net/f/1">f</a> <iframe src="https://player.example.org/e/1"></iframe></main>
    <footer><a href="https://ads.example/x">ad</a></footer>`;
  const links = extractLinks(html, 'https://blog.example.com/post');
  assert.deepEqual(links.map((l) => [l.url, l.source, l.postId]), [
    ['https://player.example.org/e/1', 'embed', ''],
    ['https://files.example.net/f/1', 'link', ''],
  ]);
});

test('password labels need a word boundary', () => {
  assert.deepEqual(extractPasswords('Use a VPN to bypass: regionlock. Password: hunter2'), ['hunter2']);
});

test('crawl keeps the post each link was first shared in', async () => {
  const thread = 'https://forum.example.com/threads/t.1/';
  const { fetchImpl } = fakeSite({
    [thread]: xfPost(1, 'alice', 'pass: one <a href="https://gofile.io/d/A">a</a>') + xfPost(2, 'bob', '<a href="https://gofile.io/d/A">again</a>'),
  });
  const result = await crawl({ url: thread, mode: 'single', ignoreHistory: true, fetchImpl, assertUrl: async () => {}, delayMs: 0 });
  assert.equal(result.links.length, 1);
  assert.deepEqual([result.links[0].postId, result.links[0].author, result.links[0].passwords, result.links[0].count], ['1', 'alice', ['one'], 2]);
});

function flakySite(responses) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}
const htmlOk = (body = '<a href="https://files.example.net/f/1">f</a>') => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

test('rate limits, server errors and network failures are retried', async () => {
  const opts = { url: 'https://forum.example.com/t', mode: 'single', ignoreHistory: true, assertUrl: async () => {}, delayMs: 0, retryBaseMs: 0 };
  let site = flakySite([new Response('', { status: 429, headers: { 'retry-after': '0' } }), new Response('', { status: 502 }), htmlOk()]);
  assert.equal((await crawl({ ...opts, fetchImpl: site.fetchImpl })).links.length, 1);
  assert.equal(site.calls.length, 3);

  site = flakySite([new TypeError('fetch failed'), htmlOk()]);
  assert.equal((await crawl({ ...opts, fetchImpl: site.fetchImpl })).links.length, 1);

  site = flakySite([new Response('', { status: 503 }), new Response('', { status: 503 }), new Response('', { status: 503 })]);
  await assert.rejects(crawl({ ...opts, fetchImpl: site.fetchImpl }), /HTTP 503/);
  assert.equal(site.calls.length, 3, 'gives up after two retries');
});

test('a Cloudflare challenge is reported as one and not retried', async () => {
  const challenge = () => new Response('<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x.js"></script></html>', {
    status: 403, headers: { 'content-type': 'text/html', server: 'cloudflare' },
  });
  const site = flakySite([challenge(), challenge()]);
  await assert.rejects(
    crawl({ url: 'https://forum.example.com/t', mode: 'single', fetchImpl: site.fetchImpl, assertUrl: async () => {}, delayMs: 0, retryBaseMs: 0 }),
    /Cloudflare challenge on forum\.example\.com.*User-Agent/,
  );
  assert.equal(site.calls.length, 1);
});

test('crawl sends the configured User-Agent', async () => {
  let ua;
  const fetchImpl = async (url, opts) => { ua = opts.headers['User-Agent']; return htmlOk(); };
  await crawl({ url: 'https://forum.example.com/t', mode: 'single', userAgent: 'MyBrowser/1.0', fetchImpl, assertUrl: async () => {}, delayMs: 0 });
  assert.equal(ua, 'MyBrowser/1.0');
});

test('cookies a site sets are sent on the rest of the crawl', async () => {
  const thread = 'https://forum.example.com/threads/t.1/';
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, cookie: opts.headers.Cookie });
    const headers = new Headers({ 'content-type': 'text/html' });
    if (url === thread) {
      headers.append('set-cookie', '__ddg8_=abc; Domain=.forum.example.com; Path=/');
      headers.append('set-cookie', 'evil=1; Domain=other.org; Path=/');
      headers.append('set-cookie', 'old=gone; Max-Age=0');
      return new Response('<a class="pageNav-page" href="/threads/t.1/page-2">2</a>', { status: 200, headers });
    }
    return new Response('<p>2</p>', { status: 200, headers });
  };
  await crawl({
    url: thread, mode: 'all', cookiesText: 'old=1; xf_user=9', ignoreHistory: true, fetchImpl, assertUrl: async () => {}, delayMs: 0,
  });
  assert.equal(calls[0].cookie, 'old=1; xf_user=9');
  assert.equal(calls[1].cookie, 'xf_user=9; __ddg8_=abc', 'kept the new cookie, dropped the deleted one, ignored the foreign one');
});

test('a Solverr clearance cookie and User-Agent are reused on later forum pages', async (t) => {
  const thread = 'https://forum.example.com/threads/t.1/';
  const solver = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume request */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      solution: {
        url: thread,
        status: 200,
        response: '<a class="pageNav-page" href="/threads/t.1/page-2">2</a>',
        cookies: [{ name: 'cf_clearance', value: 'clear', domain: '.forum.example.com', path: '/', secure: true }],
        userAgent: 'SolverBrowser/1.0',
      },
    }));
  });
  await new Promise((resolve) => solver.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => solver.close(resolve)));

  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, userAgent: opts.headers['User-Agent'], cookie: opts.headers.Cookie });
    if (url === thread) {
      return new Response('<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x.js"></script>', {
        status: 403,
        headers: { 'content-type': 'text/html', server: 'cloudflare' },
      });
    }
    return htmlOk();
  };

  await crawl({
    url: thread,
    mode: 'all',
    ignoreHistory: true,
    solverUrl: `http://127.0.0.1:${solver.address().port}`,
    fetchImpl,
    assertUrl: async () => {},
    delayMs: 0,
  });

  assert.equal(calls[1].userAgent, 'SolverBrowser/1.0');
  assert.equal(calls[1].cookie, 'cf_clearance=clear');
});

test('a 403 says which cookies were sent', async () => {
  const forbidden = async () => new Response('<title>Forbidden</title>', { status: 403, headers: { 'content-type': 'text/html', server: 'ddos-guard' } });
  const opts = { url: 'https://forum.example.com/threads/t.1/', mode: 'single', fetchImpl: forbidden, assertUrl: async () => {}, delayMs: 0 };
  await assert.rejects(crawl(opts), /no cookies for forum\.example\.com were sent/);
  await assert.rejects(crawl({ ...opts, cookiesText: 'xf_session=1; xf_csrf=2' }), /2 cookies sent \(xf_session, xf_csrf\)\. There is no xf_user/);
  await assert.rejects(crawl({ ...opts, cookiesText: 'xf_user=1' }), /probably expired or been signed out/);
});

test('a DDoS-Guard check page is reported as one', async () => {
  const fetchImpl = async () => new Response('<html><title>DDoS-Guard</title><script src="https://check.ddos-guard.net/check.js"></script>', {
    status: 403, headers: { 'content-type': 'text/html', server: 'ddos-guard' },
  });
  await assert.rejects(
    crawl({ url: 'https://forum.example.com/t', mode: 'single', fetchImpl, assertUrl: async () => {}, delayMs: 0 }),
    /DDoS-Guard check on forum\.example\.com/,
  );
});
