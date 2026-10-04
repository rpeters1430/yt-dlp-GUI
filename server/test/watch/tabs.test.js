const test = require('node:test');
const assert = require('node:assert/strict');
const { entry, setupWatchService } = require('../helpers/watchFixtures');
const tabs = require('../../src/services/watch/tabs');

const ROOT = 'https://www.youtube.com/@example';
const many = (n, prefix) => Array.from({ length: n }, (_, i) => entry(`${prefix}-${i + 1}`));

test('channelRoot recognizes bare channel pages only', () => {
  assert.equal(tabs.channelRoot('https://www.youtube.com/@Veritasium'), 'https://www.youtube.com/@Veritasium');
  assert.equal(tabs.channelRoot('https://youtube.com/@Veritasium/'), 'https://youtube.com/@Veritasium');
  assert.equal(tabs.channelRoot('https://m.youtube.com/channel/UC123_abc-XYZ/featured?x=1'), 'https://m.youtube.com/channel/UC123_abc-XYZ');
  assert.equal(tabs.channelRoot('https://www.youtube.com/c/Name'), 'https://www.youtube.com/c/Name');
  assert.equal(tabs.channelRoot('https://www.youtube.com/@Veritasium/videos'), null);
  assert.equal(tabs.channelRoot('https://www.youtube.com/playlist?list=PL123'), null);
  assert.equal(tabs.channelRoot('https://vimeo.com/@someone'), null);
});

test('content type lists are validated and kept in canonical order', () => {
  assert.deepEqual(tabs.parseContentTypes('streams,videos'), ['videos', 'streams']);
  assert.deepEqual(tabs.parseContentTypes(['Shorts']), ['shorts']);
  assert.equal(tabs.parseContentTypes(null), null);
  assert.equal(tabs.validateContentTypes(['videos']), null);
  assert.match(tabs.validateContentTypes([]), /at least one/);
  assert.match(tabs.validateContentTypes(['podcasts']), /Unknown content type/);
});

test('a channel watch scans each selected tab separately and ignores the others', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ url: ROOT, content_types: 'videos' });
  s.state.byUrl = { [`${ROOT}/videos`]: [entry('v1')], [`${ROOT}/shorts`]: [entry('s1', 'Short', null)] };
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.deepEqual(s.state.urls, [`${ROOT}/videos`]);
  assert.equal(s.getWatch(id).baselined_tabs, 'videos');

  s.state.byUrl = { [`${ROOT}/videos`]: [entry('v2'), entry('v1')], [`${ROOT}/shorts`]: [entry('s2', 'Short', null), entry('s1', 'Short', null)] };
  const second = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(second.newCount, 1);
  assert.equal(s.itemByVideo(id, 's2'), undefined, 'Shorts are not discovered when the Shorts tab is off');
  assert.equal(s.itemByVideo(id, 'v2').download_status, 'queued');
});

test('a channel tab scan pages past the first page to the known boundary', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ url: ROOT, content_types: 'videos', max_scan_entries: 10 });
  s.state.byUrl = { [`${ROOT}/videos`]: [entry('known')] };
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  s.state.byUrl = { [`${ROOT}/videos`]: [...many(25, 'new'), entry('known')] };
  const result = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(result.newCount, 25);
  assert.equal(result.boundaryReached, true);
});

test('a channel without a streams tab is not an error', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ url: ROOT, content_types: 'videos,streams' });
  s.state.byUrl = {
    [`${ROOT}/videos`]: [entry('v1')],
    [`${ROOT}/streams`]: 'ERROR: [youtube:tab] @example: This channel does not have a streams tab',
  };
  const result = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(result.status, 'completed');
  assert.equal(s.getWatch(id).baselined_tabs, 'videos,streams');
});

test('any other tab failure fails the run without recording anything', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ url: ROOT, content_types: 'videos,shorts' });
  s.state.byUrl = { [`${ROOT}/videos`]: [entry('v1')], [`${ROOT}/shorts`]: 'HTTP Error 429: Too Many Requests' };
  await assert.rejects(s.service.checkWatch(s.getWatch(id), { manual: true }), /429/);
  assert.equal(s.itemByVideo(id, 'v1'), undefined);
  assert.equal(s.getWatch(id).last_checked_at, null);
});

test('turning on a tab later records its existing videos as baseline instead of downloading them', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ url: ROOT, content_types: 'videos' });
  s.state.byUrl = { [`${ROOT}/videos`]: [entry('v1')], [`${ROOT}/shorts`]: many(40, 'oldshort') };
  await s.service.checkWatch(s.getWatch(id), { manual: true });

  s.db.prepare("UPDATE watches SET content_types = 'videos,shorts' WHERE id = ?").run(id);
  const enabled = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(enabled.queuedCount, 0);
  assert.equal(enabled.newCount, 0);
  assert.equal(s.itemByVideo(id, 'oldshort-1').discovery_type, 'baseline');
  assert.equal(s.getWatch(id).baselined_tabs, 'videos,shorts');

  s.state.byUrl[`${ROOT}/shorts`] = [entry('newshort'), ...many(40, 'oldshort')];
  const next = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(next.newCount, 1);
  assert.equal(s.itemByVideo(id, 'newshort').download_status, 'queued');
});

test('a watch saved before tabs existed follows every tab and treats them all as baselined', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ url: ROOT, last_checked_at: '2026-01-01 00:00:00' });
  s.repository.upsertItems(id, [{ entry: entry('v1'), discoveryType: 'baseline' }, { entry: entry('s1'), discoveryType: 'baseline' }]);
  s.state.byUrl = {
    [`${ROOT}/videos`]: [entry('v2'), entry('v1')],
    [`${ROOT}/shorts`]: [entry('s2'), entry('s1')],
    [`${ROOT}/streams`]: 'This channel does not have a streams tab',
  };
  const result = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(result.newCount, 2, 'new uploads on every tab are still picked up');
  assert.deepEqual(s.state.urls, [`${ROOT}/videos`, `${ROOT}/shorts`, `${ROOT}/streams`]);
});

test('playlist watches are scanned as-is', async (t) => {
  const s = setupWatchService(t);
  const url = 'https://www.youtube.com/playlist?list=PL123';
  const id = s.addWatch({ url });
  s.state.byUrl = { [url]: [entry('p1')] };
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.deepEqual(s.state.urls, [url]);
  assert.equal(s.getWatch(id).baselined_tabs, null);
});

test('an empty content type list is a validation error, not a crash', () => {
  assert.match(tabs.validateContentTypes(''), /at least one/);
});

test('tabs are merged newest-first by position, or by date when every entry has one', () => {
  const v = [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }];
  const sh = [{ id: 's1' }];
  assert.deepEqual(tabs.mergeNewestFirst([v, sh]).map((e) => e.id), ['v1', 's1', 'v2', 'v3']);
  const dated = tabs.mergeNewestFirst([
    [{ id: 'v1', publishedAt: '2026-09-01' }, { id: 'v2', publishedAt: '2026-08-01' }],
    [{ id: 's1', publishedAt: '2026-10-01' }],
  ]);
  assert.deepEqual(dated.map((e) => e.id), ['s1', 'v1', 'v2']);
});

test('initial backfill picks the newest across tabs, not the whole Videos tab first', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ url: ROOT, content_types: 'videos,shorts' });
  s.state.byUrl = {
    [`${ROOT}/videos`]: [entry('v1'), entry('v2')],
    [`${ROOT}/shorts`]: [entry('s1', 'Short', null), entry('s2', 'Short', null)],
  };
  await s.service.checkWatch(s.getWatch(id), { manual: true, backfillCount: 2 });
  assert.deepEqual(s.downloadsFor(id).map((d) => d.url.split('=')[1]).sort(), ['s1', 'v1']);
});

test('switching a tab off stops its pending backlog from being queued', async (t) => {
  const s = setupWatchService(t);
  const id = s.addWatch({ url: ROOT, content_types: 'videos,shorts', download_limit: 2 });
  s.state.byUrl = { [`${ROOT}/videos`]: [entry('v0')], [`${ROOT}/shorts`]: [entry('s0', 'Short', null)] };
  await s.service.checkWatch(s.getWatch(id), { manual: true });
  s.state.byUrl[`${ROOT}/shorts`] = [...many(5, 'short'), entry('s0', 'Short', null)];
  const first = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(first.queuedCount, 2);
  assert.equal(s.itemByVideo(id, 'short-3').source_tab, 'shorts');

  s.db.prepare("UPDATE watches SET content_types = 'videos' WHERE id = ?").run(id);
  const second = await s.service.checkWatch(s.getWatch(id), { manual: true });
  assert.equal(second.queuedCount, 0, 'pending Shorts are not queued once Shorts is off');
  assert.equal(s.getWatch(id).baselined_tabs, 'videos');
});

test('"all" backfill limit is shared across a channel\'s tabs, newest first', async (t) => {
  const { FULL_BACKFILL_LIMIT } = require('../../src/services/watch/discovery');
  const s = setupWatchService(t);
  const id = s.addWatch({ url: ROOT, content_types: 'videos,shorts', max_scan_entries: 100 });
  const half = FULL_BACKFILL_LIMIT / 2 + 10;
  const dated = (prefix, i) => ({ ...entry(`${prefix}-${i + 1}`), timestamp: 2e9 - i * 10 - (prefix === 's' ? 5 : 0) });
  s.state.byUrl = {
    [`${ROOT}/videos`]: Array.from({ length: half }, (_, i) => dated('v', i)),
    [`${ROOT}/shorts`]: Array.from({ length: half }, (_, i) => dated('s', i)),
  };
  const result = await s.service.checkWatch(s.getWatch(id), { manual: true, backfillCount: 'all', trigger: 'initial' });
  assert.equal(result.queuedCount, FULL_BACKFILL_LIMIT);
  assert.equal(result.baselineCount, 20);
  assert.equal(result.status, 'partial');
});
