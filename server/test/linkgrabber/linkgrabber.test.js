// Link grabber crawl jobs, thread watches and canonical history, each against a fresh database.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { openFreshDb } = require('../helpers/queueHarness');

const SRC = path.join(__dirname, '..', '..', 'src');

function load(t) {
  const { db } = openFreshDb(t);
  const linkGrabber = require(path.join(SRC, 'services', 'linkGrabber'));
  const crawls = require(path.join(SRC, 'services', 'linkGrabberCrawls'));
  const watches = require(path.join(SRC, 'services', 'linkGrabberWatches'));
  const send = require(path.join(SRC, 'services', 'linkGrabberSend'));
  const events = [];
  const io = { emit: (name, payload) => events.push({ name, payload }) };
  crawls.init(io);
  watches.init(io);
  return { db, linkGrabber, crawls, watches, send, events };
}

// A fake site: url -> html (or a function returning html), served through fetchImpl.
function site(pages) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    if (init.signal?.aborted) throw init.signal.reason;
    const page = typeof pages[url] === 'function' ? await pages[url](init) : pages[url];
    if (page === undefined) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  return { fetchImpl, calls, offline: { fetchImpl, assertUrl: async () => {}, delayMs: 0, retryBaseMs: 0 } };
}

const THREAD = 'https://forum.example.com/threads/t.1/';
const post = (id, body) => `<article class="message--post" data-author="u${id}" data-content="post-${id}"><div class="bbWrapper">${body}</div></article>`;
const nav = (max) => `<a class="pageNav-page" href="/threads/t.1/page-${max}">${max}</a>`;

async function waitFor(fn) {
  for (let i = 0; i < 200; i++) {
    const value = fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out');
}

// --- canonical URLs ----------------------------------------------------------------------

test('canonicalUrl folds mirror TLDs, www, trailing slashes and tracking parameters', (t) => {
  const { linkGrabber } = load(t);
  const c = linkGrabber.canonicalUrl;
  assert.equal(c('https://bunkr.si/f/abc'), c('https://bunkr.fi/f/abc'));
  assert.equal(c('https://cdn3.bunkrr.su/v.mp4'), 'bunkr/v.mp4');
  assert.equal(c('http://www.gofile.io/d/X/'), c('https://gofile.io/d/X'));
  assert.equal(c('https://a.example.com/p?id=1&utm_source=x&fbclid=y'), 'a.example.com/p?id=1');
  assert.notEqual(c('https://gofile.io/d/X'), c('https://gofile.io/d/x'), 'paths keep their case');
  assert.equal(linkGrabber.isKnownHoster('bunkr.black'), true);
  assert.equal(linkGrabber.isKnownHoster('dl.pixeldrain.com'), true);
  assert.equal(linkGrabber.isKnownHoster('twitter.com'), false);
});

test('a crawl lists a file once across mirror domains and matches history by canonical URL', async (t) => {
  const { linkGrabber } = load(t);
  linkGrabber.recordCrawledLinks(['https://bunkr.si/f/old']);
  const { offline } = site({
    [THREAD]: post(1, '<a href="https://bunkr.fi/f/old">a</a> <a href="https://bunkr.si/f/new">b</a> <a href="https://bunkr.black/f/new/">c</a>'),
  });
  const result = await linkGrabber.crawl({ url: THREAD, mode: 'single', ...offline });
  assert.deepEqual(result.links.map((l) => [l.url, l.isNew, l.count, l.hoster]), [
    ['https://bunkr.fi/f/old', false, 1, true],
    ['https://bunkr.si/f/new', true, 2, true],
  ]);
});

test('history rows from before the canonical column are matched too', async (t) => {
  const { db, linkGrabber } = load(t);
  db.prepare("INSERT INTO linkgrabber_history (url, thread_title, thread_url) VALUES ('https://www.gofile.io/d/OLD/', '', '')").run();
  const links = linkGrabber.markHistory([{ url: 'https://gofile.io/d/OLD' }, { url: 'https://gofile.io/d/NEW' }]);
  assert.deepEqual(links.map((l) => l.isNew), [false, true]);
});

// --- crawl jobs --------------------------------------------------------------------------

test('a crawl job stores progress and its result, and never stores pasted cookies', async (t) => {
  const { crawls, events } = load(t);
  const { offline } = site({
    [THREAD]: nav(2) + post(1, '<a href="https://gofile.io/d/A">a</a>'),
    [`${THREAD}page-2`]: nav(2) + post(2, '<a href="https://gofile.io/d/B">b</a>'),
  });
  const { id, promise } = crawls.startCrawl({ url: THREAD, mode: 'all', cookiesText: 'xf_session=SECRET', ...offline });
  await promise;

  const progress = events.filter((e) => e.name === 'linkgrabber:progress').map((e) => [e.payload.pagesDone, e.payload.pagesPlanned]);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  const crawl = crawls.getCrawl(id);
  assert.equal(crawl.status, 'done');
  assert.equal(crawl.linkCount, 2);
  assert.equal(crawl.result.links.length, 2);
  assert.equal(crawl.options.mode, 'all');
  assert.equal(JSON.stringify(crawl).includes('SECRET'), false);
  assert.equal(events.at(-1).name, 'linkgrabber:crawl');
  assert.equal(events.at(-1).payload.status, 'done');
});

test('reopening a crawl shows links sent since then as no longer new', async (t) => {
  const { crawls, linkGrabber } = load(t);
  const { offline } = site({ [THREAD]: post(1, '<a href="https://gofile.io/d/A">a</a> <a href="https://gofile.io/d/B">b</a>') });
  const { id, promise } = crawls.startCrawl({ url: THREAD, mode: 'single', ...offline });
  await promise;
  linkGrabber.recordCrawledLinks(['https://gofile.io/d/A']);
  const { result } = crawls.getCrawl(id);
  assert.deepEqual(result.links.map((l) => l.isNew), [false, true]);
  assert.equal(result.newCount, 1);
});

test('cancelling a crawl keeps the pages it already read', async (t) => {
  const { crawls } = load(t);
  let release;
  const { offline } = site({
    [THREAD]: nav(3) + post(1, '<a href="https://gofile.io/d/A">a</a>'),
    // Page 2 hangs until the abort.
    [`${THREAD}page-2`]: (init) => new Promise((resolve, reject) => { release = resolve; init.signal.addEventListener('abort', () => reject(init.signal.reason)); }),
  });
  const { id, promise } = crawls.startCrawl({ url: THREAD, mode: 'all', ...offline });
  await waitFor(() => release);
  assert.equal(crawls.cancelCrawl(id), true);
  await promise;
  const crawl = crawls.getCrawl(id);
  assert.equal(crawl.status, 'cancelled');
  assert.deepEqual(crawl.result.links.map((l) => l.url), ['https://gofile.io/d/A']);
  assert.equal(crawls.cancelCrawl(id), false, 'nothing left to cancel');
});

test('a crawl that fails on its first page is stored as failed', async (t) => {
  const { crawls } = load(t);
  const { offline } = site({});
  const { id, promise } = crawls.startCrawl({ url: THREAD, mode: 'single', ...offline });
  await assert.rejects(promise, /HTTP 404/);
  assert.deepEqual([crawls.getCrawl(id).status, crawls.getCrawl(id).error], ['failed', `HTTP 404 fetching ${THREAD}`]);
});

test('init marks crawls left running by a previous process as interrupted', (t) => {
  const { db, crawls } = load(t);
  db.prepare("INSERT INTO linkgrabber_crawls (id, url, status, created_at) VALUES ('x', 'https://a.example/', 'running', '2026-01-01T00:00:00Z')").run();
  crawls.init(null);
  assert.equal(crawls.getCrawl('x').status, 'failed');
  assert.match(crawls.getCrawl('x').error, /restart/);
});

test('old crawls are pruned, except the newest and each watch\'s latest', async (t) => {
  const { db, crawls } = load(t);
  const insert = db.prepare("INSERT INTO linkgrabber_crawls (id, url, status, created_at) VALUES (?, 'https://a.example/', 'done', ?)");
  for (let i = 0; i < crawls.KEEP_CRAWLS + 5; i++) insert.run(`c${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
  db.prepare("INSERT INTO linkgrabber_watches (url, last_crawl_id) VALUES ('https://a.example/', 'c0')").run();
  const { offline } = site({ [THREAD]: '<p>x</p>' });
  await crawls.startCrawl({ url: THREAD, mode: 'single', ...offline }).promise;
  const ids = new Set(crawls.listCrawls(100).map((c) => c.id));
  assert.equal(ids.size, crawls.KEEP_CRAWLS + 1);
  assert.ok(ids.has('c0'), 'a watch\'s last crawl is kept');
  assert.ok(!ids.has('c1'));
});

test('link check results are kept with the crawl', async (t) => {
  const { crawls } = load(t);
  const { offline } = site({ [THREAD]: post(1, '<a href="https://gofile.io/d/A">a</a>') });
  const { id, promise } = crawls.startCrawl({ url: THREAD, mode: 'single', ...offline });
  await promise;
  crawls.saveCheckResults(id, [{ url: 'https://gofile.io/d/A', status: 'offline', detail: 'HTTP 404' }]);
  assert.equal(crawls.getCrawl(id).result.links[0].check.status, 'offline');
});

// --- thread watches ----------------------------------------------------------------------

test('watch input is validated', (t) => {
  const { watches } = load(t);
  assert.throws(() => watches.createWatch({ url: 'ftp://x' }), /url must be/);
  assert.throws(() => watches.createWatch({ url: THREAD, lastN: 0 }), /lastN/);
  assert.throws(() => watches.createWatch({ url: THREAD, intervalMins: 5 }), /intervalMins/);
  assert.throws(() => watches.createWatch({ url: THREAD, target: 'ftp' }), /target/);
  const w = watches.createWatch({ url: THREAD, lastN: 3, target: 'jdownloader' });
  assert.deepEqual([w.lastN, w.intervalMins, w.target, w.hostersOnly, w.enabled], [3, 360, 'jdownloader', true, true]);
  assert.equal(watches.updateWatch(w.id, { enabled: false }).enabled, false);
  assert.equal(watches.updateWatch(999, { enabled: false }), null);
});

test('a report-only watch counts only links the previous check didn\'t report', async (t) => {
  const { watches } = load(t);
  const pages = { [THREAD]: post(1, '<a href="https://gofile.io/d/A">a</a> <a href="https://twitter.com/x">tw</a>') };
  const { offline } = site(pages);
  const w = watches.createWatch({ url: THREAD, lastN: 1 });

  const first = await watches.checkWatch(w.id, { crawlOptions: offline });
  assert.equal(first.found, 1, 'file hosts only: the twitter link is ignored');
  assert.equal(first.lastError, null);
  assert.ok(first.lastCrawlId);

  pages[THREAD] += post(2, '<a href="https://gofile.io/d/B">b</a>');
  const second = await watches.checkWatch(w.id, { crawlOptions: offline });
  assert.equal(second.found, 1);
  assert.equal((await watches.checkWatch(w.id, { crawlOptions: offline })).found, 0);
});

test('a sending watch sends new links to JDownloader once', async (t) => {
  const { watches, send } = load(t);
  const received = [];
  const jd = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push(new URLSearchParams(body)); res.end('success'); });
  });
  await new Promise((resolve) => jd.listen(0, '127.0.0.1', resolve));
  t.after(() => jd.close());
  send.saveSetting('jdUrl', `http://127.0.0.1:${jd.address().port}`);

  const { offline } = site({ [THREAD]: `<title>Great thread | SimpCity</title>${post(1, 'password: pw1 <a href="https://gofile.io/d/A">a</a>')}` });
  const w = watches.createWatch({ url: THREAD, lastN: 1, target: 'jdownloader', packagePerPage: false });

  const first = await watches.checkWatch(w.id, { crawlOptions: offline });
  assert.equal(first.found, 1);
  assert.equal(first.title, 'Great thread');
  assert.equal(received.length, 1);
  assert.equal(received[0].get('urls'), 'https://gofile.io/d/A');
  assert.equal(received[0].get('package'), 'Great thread');
  assert.equal(received[0].get('passwords'), 'pw1');

  assert.equal((await watches.checkWatch(w.id, { crawlOptions: offline })).found, 0, 'already in history');
  assert.equal(received.length, 1);
});

test('a watch with linkTypes filters down to chosen link types and passes autostart', async (t) => {
  const { watches, send } = load(t);
  const received = [];
  const jd = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push(new URLSearchParams(body)); res.end('success'); });
  });
  await new Promise((resolve) => jd.listen(0, '127.0.0.1', resolve));
  t.after(() => jd.close());
  send.saveSetting('jdUrl', `http://127.0.0.1:${jd.address().port}`);

  const html = post(1, `
    <a href="https://bunkr.si/v/1">bunkr</a>
    <a href="https://gofile.io/d/2">gofile</a>
    <a href="https://pixeldrain.com/u/3">pixeldrain</a>
    <a href="https://mega.nz/file/4">mega</a>
  `);
  const { offline } = site({ [THREAD]: html });
  const w = watches.createWatch({
    url: THREAD,
    lastN: 1,
    target: 'jdownloader',
    linkTypes: 'bunkr, gofile',
    autostart: true,
  });

  const checked = await watches.checkWatch(w.id, { crawlOptions: offline });
  assert.equal(checked.found, 2, 'only bunkr and gofile links are accepted');
  assert.equal(received.length, 1);
  const urls = received[0].get('urls').split('\r\n');
  assert.deepEqual(urls.sort(), ['https://bunkr.si/v/1', 'https://gofile.io/d/2'].sort());
  assert.equal(received[0].get('autostart'), '1');
  assert.equal(received[0].get('autoconfirm'), '1');
});

test('a thread watch checking new pages crawls the new pages and the last couple', async (t) => {
  const { watches } = load(t);
  const p1 = `${THREAD}page-1`;
  const p2 = `${THREAD}page-2`;
  const p3 = `${THREAD}page-3`;
  const p4 = `${THREAD}page-4`;

  // Start with 2 pages
  const pages = {
    [THREAD]: `${nav(2)}${post(1, '<a href="https://gofile.io/d/P1">1</a>')}`,
    [p1]: `${nav(2)}${post(1, '<a href="https://gofile.io/d/P1">1</a>')}`,
    [p2]: `${nav(2)}${post(2, '<a href="https://bunkr.si/v/P2">2</a>')}`,
  };
  const { offline, calls } = site(pages);
  const w = watches.createWatch({ url: THREAD, lastN: 2, target: 'none' });

  const first = await watches.checkWatch(w.id, { crawlOptions: offline });
  assert.equal(first.found, 2);
  assert.equal(first.lastMaxPage, 2);

  // Now thread grows to 4 pages (new pages: 3 and 4)
  pages[THREAD] = `${nav(4)}${post(1, '<a href="https://gofile.io/d/P1">1</a>')}`;
  pages[p3] = `${nav(4)}${post(3, '<a href="https://bunkr.si/v/P3">3</a>')}`;
  pages[p4] = `${nav(4)}${post(4, '<a href="https://gofile.io/d/P4">4</a>')}`;

  calls.length = 0;
  const second = await watches.checkWatch(w.id, { crawlOptions: offline });
  assert.equal(second.found, 2); // P3 and P4
  assert.equal(second.lastMaxPage, 4);
  // Checked pages should include page 1 or 2 (last couple of prev check) plus 3 and 4
  assert.ok(calls.includes(p3), 'crawled new page 3');
  assert.ok(calls.includes(p4), 'crawled new page 4');
});

test('a failing watch records the error', async (t) => {
  const { watches } = load(t);
  const { offline } = site({});
  const w = watches.createWatch({ url: THREAD });
  const checked = await watches.checkWatch(w.id, { crawlOptions: offline });
  assert.match(checked.lastError, /HTTP 404/);
  assert.equal(checked.lastCrawlId, null);
});

test('checkDueWatches checks enabled watches whose interval has passed', async (t) => {
  const { db, watches } = load(t);
  const due = watches.createWatch({ url: 'https://due.example/' });
  const recent = watches.createWatch({ url: 'https://recent.example/' });
  const off = watches.createWatch({ url: 'https://off.example/', enabled: false });
  db.prepare('UPDATE linkgrabber_watches SET last_checked_at = ? WHERE id = ?').run(new Date(Date.now() - 7 * 3600e3).toISOString(), due.id);
  db.prepare('UPDATE linkgrabber_watches SET last_checked_at = ? WHERE id = ?').run(new Date().toISOString(), recent.id);

  const never = watches.createWatch({ url: 'https://never.example/' });

  const checked = [];
  await watches.checkDueWatches({ check: async (id) => { checked.push(id); } });
  assert.deepEqual(checked.sort(), [due.id, never.id].sort());
  assert.ok(!checked.includes(recent.id) && !checked.includes(off.id));
});
