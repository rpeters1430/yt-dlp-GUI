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
