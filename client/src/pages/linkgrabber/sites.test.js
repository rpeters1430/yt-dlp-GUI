import test from 'node:test';
import assert from 'node:assert/strict';
import { siteName } from './sites.js';

test('mirror domains and subdomains of a host share one site name', () => {
  for (const host of ['bunkr.si', 'bunkr.fi', 'bunkr.ai', 'bunkr.black', 'cdn3.bunkr.ru', 'bunkrr.su', 'www.bunkr.cr']) {
    assert.equal(siteName(host), 'bunkr', host);
  }
  for (const host of ['filester.gg', 'filester.me', 'filester.si']) assert.equal(siteName(host), 'filester', host);
  assert.equal(siteName('coomer.su'), siteName('coomer.party'));
  assert.equal(siteName('pixeldra.in'), 'pixeldrain');
  assert.equal(siteName('teraboxapp.com'), 'terabox');
});

test('two-part country endings are dropped whole', () => {
  assert.equal(siteName('mega.co.nz'), 'mega');
  assert.equal(siteName('mega.nz'), 'mega');
  assert.equal(siteName('shop.example.com.au'), 'example');
  assert.equal(siteName('co.uk'), 'co', 'a bare ending has nothing else to name it by');
});

test('addresses without a domain ending are kept as they are', () => {
  assert.equal(siteName('192.168.1.5'), '192.168.1.5');
  assert.equal(siteName('localhost'), 'localhost');
  assert.equal(siteName(''), '');
});
