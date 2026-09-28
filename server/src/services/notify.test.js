const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequest, validateUrl } = require('./notify');

const message = {
  event: 'download_completed',
  title: 'Download completed',
  body: 'Some video',
  link: 'https://www.youtube.com/watch?v=abc',
  thumbnail: 'https://i.ytimg.com/vi/abc/hq.jpg',
};

test('discord payload uses an embed with link and thumbnail', () => {
  const req = buildRequest('discord', 'https://discord.com/api/webhooks/1/x', message);
  const body = JSON.parse(req.body);
  assert.equal(req.url, 'https://discord.com/api/webhooks/1/x');
  assert.equal(body.embeds[0].title, 'Download completed');
  assert.equal(body.embeds[0].url, message.link);
  assert.equal(body.embeds[0].thumbnail.url, message.thumbnail);
});

test('ntfy publishes JSON to the server root with the topic from the URL path', () => {
  const req = buildRequest('ntfy', 'https://ntfy.example.com/sub/path/my-topic', message);
  const body = JSON.parse(req.body);
  assert.equal(req.url, 'https://ntfy.example.com/sub/path');
  assert.equal(body.topic, 'my-topic');
  assert.equal(body.click, message.link);

  const root = buildRequest('ntfy', 'https://ntfy.sh/alerts', message);
  assert.equal(root.url, 'https://ntfy.sh/');
  assert.equal(JSON.parse(root.body).topic, 'alerts');
});

test('gotify keeps the token URL and raises priority for failures', () => {
  const url = 'https://gotify.example.com/message?token=abc';
  const ok = buildRequest('gotify', url, message);
  const failed = buildRequest('gotify', url, { ...message, event: 'download_failed' });
  assert.equal(ok.url, url);
  assert.equal(JSON.parse(ok.body).priority, 5);
  assert.equal(JSON.parse(failed.body).priority, 8);
});

test('slack and generic JSON payloads carry the message', () => {
  assert.match(JSON.parse(buildRequest('slack', 'https://hooks.slack.com/x', message).body).text, /Some video/);
  const generic = JSON.parse(buildRequest('json', 'https://ha.local/api/webhook/x', message).body);
  assert.equal(generic.event, 'download_completed');
  assert.equal(generic.url, message.link);
});

test('discord titles are truncated to the embed limit', () => {
  const req = buildRequest('discord', 'https://discord.com/api/webhooks/1/x', { ...message, title: 'x'.repeat(400) });
  assert.equal(JSON.parse(req.body).embeds[0].title.length, 256);
});

test('validateUrl only accepts http(s) URLs', () => {
  assert.equal(validateUrl('https://ntfy.sh/topic'), null);
  assert.equal(validateUrl('http://192.168.1.5:8080/topic'), null);
  assert.match(validateUrl('ftp://x/y'), /http/);
  assert.match(validateUrl('not a url'), /valid/);
});
