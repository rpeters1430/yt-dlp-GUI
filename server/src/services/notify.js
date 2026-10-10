// Push notifications to a single webhook: Discord, Slack-compatible (Slack, Mattermost,
// Rocket.Chat), ntfy, Gotify, or a generic JSON POST for anything else (Home Assistant,
// n8n, Node-RED, …). Delivery is best-effort — a failed notification is logged and never
// affects the download or watch check that triggered it.

const FORMATS = ['discord', 'slack', 'ntfy', 'gotify', 'json'];

const EVENTS = {
  download_completed: { label: 'Download completed', setting: 'notify_on_completed', default: '1' },
  download_failed: { label: 'Download failed', setting: 'notify_on_failed', default: '1' },
  watch_new_videos: { label: 'Watch found new videos', setting: 'notify_on_watch_new', default: '0' },
  watch_error: { label: 'Watch check started failing', setting: 'notify_on_watch_error', default: '1' },
};

const REQUEST_TIMEOUT_MS = 10000;

function getSetting(key, fallback = '') {
  // Required lazily so buildRequest can be unit-tested without opening the database.
  const db = require('../db');
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== undefined ? row.value : fallback;
}

function getConfig() {
  const events = {};
  for (const [name, def] of Object.entries(EVENTS)) {
    events[name] = getSetting(def.setting, def.default) === '1';
  }
  const format = getSetting('notify_format', 'discord');
  return {
    enabled: getSetting('notify_enabled', '0') === '1',
    url: getSetting('notify_url', ''),
    format: FORMATS.includes(format) ? format : 'discord',
    // Limits completion/failure notices to Watch downloads, so hand-queued jobs you're
    // already looking at don't ping you.
    watchOnly: getSetting('notify_watch_only', '0') === '1',
    events,
  };
}

function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return 'Webhook URL is not a valid URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Webhook URL must be http(s)';
  return null;
}

const COLORS = { download_completed: 0x159a66, download_failed: 0xe3435e, watch_new_videos: 0x5b6df8, watch_error: 0xb3781a, test: 0x5b6df8 };
const NTFY_TAGS = { download_completed: 'white_check_mark', download_failed: 'x', watch_new_videos: 'new', watch_error: 'warning', test: 'bell' };

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Builds the HTTP request for one notification. Exported for tests.
function buildRequest(format, url, message) {
  const { event, title, body, link, thumbnail } = message;
  const json = (payload, target = url) => ({ url: target, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  switch (format) {
    case 'discord':
      return json({
        username: 'yt-dlp GUI',
        embeds: [{
          title: truncate(title, 256),
          description: truncate(body, 4000),
          ...(link ? { url: link } : {}),
          color: COLORS[event] || COLORS.test,
          ...(thumbnail ? { thumbnail: { url: thumbnail } } : {}),
          timestamp: new Date().toISOString(),
        }],
      });
    case 'slack':
      return json({ text: `*${title}*\n${body}${link ? `\n${link}` : ''}` });
    case 'ntfy': {
      // ntfy's JSON publishing goes to the server root with the topic in the body, which
      // (unlike header-based publishing) handles non-ASCII titles. The topic is the last
      // path segment of the configured URL, e.g. https://ntfy.sh/my-topic.
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const topic = segments.pop() || '';
      parsed.pathname = `/${segments.join('/')}`;
      parsed.search = '';
      return json({
        topic,
        title: truncate(title, 250),
        message: truncate(body, 4000),
        tags: [NTFY_TAGS[event] || 'bell'],
        ...(link ? { click: link } : {}),
        ...(thumbnail ? { attach: thumbnail } : {}),
      }, parsed.toString());
    }
    case 'gotify':
      // The configured URL is the full message endpoint including the app token,
      // e.g. https://gotify.example.com/message?token=XXXX.
      return json({ title, message: body, priority: event === 'download_failed' || event === 'watch_error' ? 8 : 5 });
    default:
      return json({ event, title, message: body, url: link || null, thumbnail: thumbnail || null, timestamp: new Date().toISOString() });
  }
}

async function deliver(config, message) {
  const req = buildRequest(config.format, config.url, message);
  let res;
  try {
    res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // undici reports every network failure as "fetch failed"; the cause says why.
    const reason = err.name === 'TimeoutError' ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s` : (err.cause && (err.cause.code || err.cause.message)) || err.message;
    throw new Error(`Could not reach the webhook: ${reason}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Webhook returned HTTP ${res.status}${text ? `: ${truncate(text, 200)}` : ''}`);
  }
}

// Fire-and-forget: never throws, never blocks the caller.
function send(event, message, { watchId = null } = {}) {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    console.error(`[notify] Could not read settings: ${err.message}`);
    return;
  }
  if (!config.enabled || !config.url || !config.events[event]) return;
  if (config.watchOnly && !watchId && (event === 'download_completed' || event === 'download_failed')) return;
  if (validateUrl(config.url)) return;

  deliver(config, { event, ...message })
    .catch((err) => console.error(`[notify] Failed to send "${event}" notification: ${err.message}`));
}

// Used by the Settings page's "Send test" button; throws so the error can be shown there.
async function sendTest(overrides = {}) {
  const config = { ...getConfig(), ...overrides };
  if (!config.url) throw new Error('Set a webhook URL first');
  const urlError = validateUrl(config.url);
  if (urlError) throw new Error(urlError);
  if (!FORMATS.includes(config.format)) throw new Error(`Unknown format: ${config.format}`);
  await deliver(config, {
    event: 'test',
    title: 'yt-dlp GUI test notification',
    body: 'Notifications are working. You will get messages here for the events you enabled.',
  });
}

function downloadCompleted(job, { filepath = null, stoppedByUser = false, completedWithErrors = false, splitParts = null } = {}) {
  const name = job.title || job.url;
  const count = splitParts && splitParts.length > 1 ? splitParts.length : null;
  const title = count
    ? (stoppedByUser ? `Recording saved (${count} chunks)` : `Download completed (${count} chunks)`)
    : (stoppedByUser ? 'Recording saved' : completedWithErrors ? 'Download finished with errors' : 'Download completed');
  const lines = [name];
  if (count) {
    lines.push(`Split into ${count} chunk files:`);
    lines.push(...splitParts.slice(0, 5).map((p) => `• ${path.basename(p)}`));
    if (splitParts.length > 5) lines.push(`…and ${splitParts.length - 5} more`);
  } else if (filepath) {
    lines.push(filepath);
  }
  send('download_completed', { title, body: lines.join('\n'), link: job.url, thumbnail: job.thumbnail }, { watchId: job.watch_id });
}

function downloadFailed(job, error) {
  const name = job.title || job.url;
  send('download_failed', {
    title: 'Download failed',
    body: `${name}\n\n${truncate(String(error || 'Unknown error').split('\n')[0], 500)}`,
    link: job.url,
    thumbnail: job.thumbnail,
  }, { watchId: job.watch_id });
}

function watchNewVideos(watch, titles) {
  const name = watch.name || watch.channel_name || watch.url;
  const list = titles.slice(0, 10).map((t) => `• ${t}`).join('\n');
  const more = titles.length > 10 ? `\n…and ${titles.length - 10} more` : '';
  send('watch_new_videos', {
    title: `${name}: ${titles.length} new video${titles.length === 1 ? '' : 's'} queued`,
    body: `${list}${more}`,
    link: watch.url,
    thumbnail: watch.thumbnail,
  }, { watchId: watch.id });
}

function watchError(watch, error) {
  const name = watch.name || watch.channel_name || watch.url;
  send('watch_error', {
    title: `Watch check failed: ${name}`,
    body: truncate(String(error || 'Unknown error').split('\n')[0], 500),
    link: watch.url,
    thumbnail: watch.thumbnail,
  }, { watchId: watch.id });
}

module.exports = {
  FORMATS,
  EVENTS,
  getConfig,
  validateUrl,
  buildRequest,
  sendTest,
  downloadCompleted,
  downloadFailed,
  watchNewVideos,
  watchError,
};
