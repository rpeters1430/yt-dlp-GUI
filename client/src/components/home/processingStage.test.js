import test from 'node:test';
import assert from 'node:assert/strict';
import { processingElapsed, isProcessingStage } from './processingStage.js';

test('processing elapsed uses the persisted timestamp after reconnect', () => {
  const job = { status: 'downloading', stage: 'Embedding metadata…', stage_started_at: '2026-11-04T17:00:00Z' };
  assert.equal(processingElapsed(job, Date.parse('2026-11-04T17:02:05Z')), '2:05');
  assert.equal(processingElapsed({ ...job, stage: 'Downloading video…' }, Date.now()), null);
  assert.equal(processingElapsed({ ...job, status: 'completed' }, Date.now()), null);
  assert.equal(processingElapsed({ ...job, stage_started_at: null }, Date.now()), null);
  assert.equal(isProcessingStage('Waiting for processing slot — merging streams…'), true);
  assert.equal(isProcessingStage('Saving final file…'), true);
  assert.equal(isProcessingStage('Processing FixupM3u8…'), true);
});

test('secondary processing cards show stage time without a fake percentage or LIVE badge', async () => {
  const { createServer } = await import('vite');
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const vite = await createServer({ root: new URL('../../..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { UpNextCard } = await vite.ssrLoadModule('/src/components/home/UpNext.jsx');
    const { ToastProvider } = await vite.ssrLoadModule('/src/context/ToastContext.jsx');
    for (const is_live of [0, 1]) {
      const job = { id: 'processing', status: 'downloading', percent: 99, title: 'Video', stage: 'Embedding metadata…', stage_started_at: '2026-11-04T17:00:00Z', is_live };
      const html = renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(UpNextCard, { job })));
      assert.match(html, /Embedding metadata/);
      assert.doesNotMatch(html, /99%|art-progress|● LIVE/);
    }
  } finally { await vite.close(); }
});
