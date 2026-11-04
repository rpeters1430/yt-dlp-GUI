import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';

// A menu inside the overflow-hidden watch card loses its lower actions.
test('watch actions escape card clipping and open edit/delete for the selected watch', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent'];
  const previous = new Map(keys.map(key => [key, globalThis[key]]));
  for (const key of keys) globalThis[key] = dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.innerWidth = 393;
  window.innerHeight = 852;
  let anchorTop = 360;
  // jsdom has no layout engine: supply card/menu geometry while running the real positioning effect.
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('menu')) return { top: anchorTop, bottom: anchorTop + 32, right: 370 };
    return { width: 280, height: Math.min(400, parseFloat(this.style.maxHeight) || 400) };
  };
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 400 });
  const vite = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const root = createRoot(document.getElementById('root'));
  const flush = fn => act(async () => { fn(); await new Promise(resolve => setTimeout(resolve, 0)); });
  try {
    const { default: WatchMenu } = await vite.ssrLoadModule('/src/components/WatchMenu.jsx');
    let edited = 0;
    let removed = 0;
    await flush(() => root.render(React.createElement('article', { className: 'watch-tile' },
      React.createElement(WatchMenu, {
        watch: { id: 7, url: 'https://www.youtube.com/playlist?list=PLtest', completed_count: 7 },
        onEdit: () => { edited++; }, onDelete: () => { removed++; },
      }))));
    const trigger = document.querySelector('[aria-label="More actions"]');
    const click = element => flush(() => element.click());
    const item = label => [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent === label);
    await click(trigger);
    const menu = document.querySelector('[role="menu"]');
    assert.ok(menu);
    assert.ok(!menu.closest('.watch-tile'), 'actions must not be clipped by the card');
    assert.equal(menu.style.top, '400px', 'room below the trigger');
    assert.equal(menu.style.left, '90px', 'right aligned inside the viewport');
    await click(item('Edit settings'));
    assert.equal(document.querySelector('[role="menu"]'), null);
    assert.equal(edited, 1);
    await click(trigger);
    await click(item('Remove watch'));
    assert.equal(removed, 1);
    anchorTop = 760;
    await click(trigger);
    assert.equal(document.querySelector('[role="menu"]').style.top, '352px', 'opens above a low card');
    await flush(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    assert.ok(document.activeElement === item('Remove watch'), 'End reaches the delete action');
    await flush(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('[role="menu"]'), null);
    assert.ok(document.activeElement === trigger, 'Escape restores trigger focus');
    await click(trigger);
    await flush(() => document.querySelector('[role="menu"]').dispatchEvent(new Event('scroll')));
    assert.ok(document.querySelector('[role="menu"]'), 'scrolling long menus keeps actions available');
    await flush(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    assert.equal(document.querySelector('[role="menu"]'), null);
    window.innerHeight = 480;
    anchorTop = 220;
    await click(trigger);
    assert.equal(document.querySelector('[role="menu"]').style.maxHeight, '212px', 'short screens get a bounded scroll area');
    await flush(() => document.dispatchEvent(new Event('scroll')));
    assert.equal(document.querySelector('[role="menu"]'), null, 'page scrolling dismisses a stale anchor');
  } finally {
    await flush(() => root.unmount());
    await vite.close();
    dom.window.close();
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
