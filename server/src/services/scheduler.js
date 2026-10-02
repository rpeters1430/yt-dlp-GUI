const cron = require('node-cron');
const db = require('../db');

// Decides which watches are due; the check itself (discovery, filtering, queueing) lives in
// services/watch/service.js and is injected by index.js.
let watchService = null;
let running = false;

function init(service) {
  watchService = service;
}

function getService() {
  if (!watchService) throw new Error('Watch scheduler used before init()');
  return watchService;
}

function checkWatch(watch, options = {}) {
  return getService().checkWatch(watch, options);
}

function startCheck(watch, options = {}) {
  return getService().startCheck(watch, options);
}

async function checkAllWatches({ force = false } = {}) {
  if (running) {
    console.log('[scheduler] Previous watch check still in progress, skipping');
    return;
  }
  running = true;
  try {
    const watches = db.prepare('SELECT * FROM watches WHERE enabled = 1').all();
    const now = Date.now();

    for (const watch of watches) {
      if (!force && watch.last_checked_at) {
        const lastCheckedMs = new Date(watch.last_checked_at + 'Z').getTime();
        const intervalMs = (watch.check_interval_mins || 30) * 60 * 1000;
        if (now - lastCheckedMs < intervalMs) {
          continue; // Not due yet
        }
      }
      try {
        await checkWatch(watch, { manual: force });
      } catch (_) {
        // Recorded on the watch's run and logged by the service; keep checking the others.
      }
    }
  } finally {
    running = false;
  }
}

function start() {
  // Tick every 5 minutes to evaluate watches whose check_interval_mins has elapsed
  cron.schedule('*/5 * * * *', () => {
    checkAllWatches({ force: false }).catch((e) => console.error('[scheduler] Run failed:', e.message));
  });
}

module.exports = { init, start, checkAllWatches, checkWatch, startCheck };
