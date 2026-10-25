// Hands link grabber results to a downloader (this app's yt-dlp queue, JDownloader or aria2)
// and records what each one accepted in the link history. Shared by the send route and
// thread watches.
const db = require('../db');
const queue = require('./queue');
const ytdlp = require('./ytdlp');
const linkGrabber = require('./linkGrabber');

const TARGETS = ['queue', 'jdownloader', 'aria2'];
const SETTING_KEYS = {
  jdUrl: 'linkgrabber_jd_url',
  aria2Url: 'linkgrabber_aria2_url',
  aria2Secret: 'linkgrabber_aria2_secret',
  aria2Dir: 'linkgrabber_aria2_dir',
  userAgent: 'linkgrabber_user_agent',
  solverUrl: 'linkgrabber_solver_url',
};

function getSetting(name) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEYS[name]);
  return row ? row.value : '';
}

function saveSetting(name, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(SETTING_KEYS[name], String(value));
}

// A 400 for the caller's mistakes; anything else thrown is the downloader failing (502).
class SendError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Package details come from the stored crawl when there is one, so the client only says which
// links; otherwise from what the caller passed.
function packageDetails(crawl, given) {
  if (!crawl) {
    return {
      packageName: typeof given.packageName === 'string' ? given.packageName.slice(0, 200) : '',
      threadUrl: typeof given.threadUrl === 'string' ? given.threadUrl.slice(0, 2000) : '',
      passwords: given.passwords,
      pagePasswords: given.pagePasswords && typeof given.pagePasswords === 'object' && !Array.isArray(given.pagePasswords)
        ? given.pagePasswords : undefined,
      urlMetadata: Array.isArray(given.urlMetadata) ? given.urlMetadata : [],
    };
  }
  return {
    packageName: (crawl.threadTitle || crawl.pages?.[0]?.title || '').slice(0, 200),
    threadUrl: crawl.threadUrl || '',
    passwords: crawl.passwords || [],
    pagePasswords: crawl.pagePasswords || undefined,
    urlMetadata: (crawl.links || []).map((l) => ({ url: l.url, page: l.page })),
  };
}

// Returns { sent, failed: [message], seen: [url recorded in history], ids? }.
async function sendLinks({ target, urls, crawl = null, packagePerPage = false, ...given }) {
  const list = linkGrabber.cleanUrls(urls);
  if (list.length === 0) throw new SendError('At least one URL is required');
  if (list.length > linkGrabber.MAX_LINKS) throw new SendError(`Too many URLs in one request (max ${linkGrabber.MAX_LINKS})`);
  if (!TARGETS.includes(target)) throw new SendError('target must be queue, jdownloader or aria2');
  const pkg = packageDetails(crawl, given);

  if (target === 'queue') {
    const ids = [];
    const seen = [];
    const failed = [];
    for (const rawUrl of list) {
      const u = linkGrabber.resolveDirectDownloadUrl(rawUrl);
      try {
        await ytdlp.assertPublicUrlResolved(u);
        ids.push(queue.enqueue(u, {}));
        seen.push(rawUrl);
      } catch (err) {
        failed.push(`${rawUrl}: ${err.message}`);
      }
    }
    linkGrabber.recordCrawledLinks(seen, pkg.packageName, pkg.threadUrl);
    return { sent: ids.length, ids, failed, seen };
  }

  if (target === 'jdownloader') {
    const result = await linkGrabber.sendToJDownloader(list, {
      baseUrl: getSetting('jdUrl'),
      packageName: pkg.packageName,
      passwords: pkg.passwords,
      pagePasswords: pkg.pagePasswords,
      packagePerPage: !!packagePerPage,
      urlMetadata: pkg.urlMetadata,
      threadUrl: pkg.threadUrl,
      autostart: !!given.autostart,
    });
    return { ...result, failed: [], seen: list };
  }

  const aria2Urls = list.map(linkGrabber.resolveDirectDownloadUrl);
  const { accepted, ...result } = await linkGrabber.sendToAria2(aria2Urls, {
    rpcUrl: getSetting('aria2Url'),
    secret: getSetting('aria2Secret'),
    dir: getSetting('aria2Dir'),
  });
  // History keeps the crawled URL, not the direct-download form aria2 was given.
  const acceptedSet = new Set(accepted);
  const seen = list.filter((u, i) => acceptedSet.has(aria2Urls[i]));
  linkGrabber.recordCrawledLinks(seen, pkg.packageName, pkg.threadUrl);
  return { ...result, seen };
}

module.exports = { TARGETS, getSetting, saveSetting, sendLinks, SendError };
