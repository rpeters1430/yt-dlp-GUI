const ytdlp = require('./ytdlp');

const YTDLP_UPDATE_CRON = process.env.YTDLP_UPDATE_CRON || '0 3 * * *';
const FFMPEG_UPDATE_CRON = process.env.FFMPEG_UPDATE_CRON || '30 3 * * *';
const QUICKJS_UPDATE_CRON = process.env.QUICKJS_UPDATE_CRON || '45 3 * * *';
const DENO_UPDATE_CRON = process.env.DENO_UPDATE_CRON || '50 3 * * *';
const STARTUP_DELAY_MS = Math.max(0, parseInt(process.env.DEPENDENCY_UPDATE_STARTUP_DELAY_MS || '30000', 10));

let ytdlpUpdateRunning = false;
let ffmpegUpdateRunning = false;
let quickjsUpdateRunning = false;
let denoUpdateRunning = false;

function getDb() {
  return require('../db');
}

function getQueue() {
  return require('./queue');
}

function cronOptions() {
  return process.env.TZ ? { timezone: process.env.TZ } : undefined;
}

function selectedYtdlpChannel(deps = {}) {
  if (typeof deps.getChannel === 'function') return deps.getChannel();
  const db = deps.db || getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ytdlpChannel'").get();
  return row && row.value === 'nightly' ? 'nightly' : 'stable';
}

function downloadsAreActive(deps = {}) {
  if (typeof deps.getActiveCount === 'function') return deps.getActiveCount() > 0;
  const queue = deps.queue || getQueue();
  return queue.getActiveCount && queue.getActiveCount() > 0;
}

async function updateNightlyYtdlp(reason = 'scheduled', deps = {}) {
  const ytdlpSvc = deps.ytdlp || ytdlp;
  if (selectedYtdlpChannel(deps) !== 'nightly') return { skipped: 'stable-channel' };
  if (downloadsAreActive(deps)) {
    console.log(`[dependency-updater] Skipping ${reason} yt-dlp nightly check while downloads are active`);
    return { skipped: 'active-downloads' };
  }
  if (ytdlpUpdateRunning) return { skipped: 'already-running' };

  ytdlpUpdateRunning = true;
  try {
    const before = (await ytdlpSvc.getVersions()).ytdlp;
    await ytdlpSvc.updateYtdlp('nightly');
    const after = (await ytdlpSvc.getVersions()).ytdlp;
    console.log(`[dependency-updater] yt-dlp nightly check complete (${before || 'unknown'} -> ${after || 'unknown'})`);
    return { updated: before !== after, before, after };
  } finally {
    ytdlpUpdateRunning = false;
  }
}

async function updateFfmpegNightly(deps = {}) {
  const ytdlpSvc = deps.ytdlp || ytdlp;
  if (downloadsAreActive(deps)) {
    console.log('[dependency-updater] Skipping FFmpeg nightly check while downloads are active');
    return { skipped: 'active-downloads' };
  }
  if (ffmpegUpdateRunning) return { skipped: 'already-running' };

  ffmpegUpdateRunning = true;
  try {
    const result = await ytdlpSvc.updateFfmpegIfAvailable();
    console.log(`[dependency-updater] FFmpeg nightly check complete (${result.updated ? 'updated' : 'already current'})`);
    return result;
  } finally {
    ffmpegUpdateRunning = false;
  }
}

async function updateQuickjsNightly(deps = {}) {
  const ytdlpSvc = deps.ytdlp || ytdlp;
  if (downloadsAreActive(deps)) {
    console.log('[dependency-updater] Skipping QuickJS nightly check while downloads are active');
    return { skipped: 'active-downloads' };
  }
  if (quickjsUpdateRunning) return { skipped: 'already-running' };

  quickjsUpdateRunning = true;
  try {
    const result = await ytdlpSvc.updateQuickjsIfAvailable();
    console.log(`[dependency-updater] QuickJS nightly check complete (${result.updated ? 'updated' : 'already current'})`);
    return result;
  } finally {
    quickjsUpdateRunning = false;
  }
}

async function updateDenoNightly(deps = {}) {
  const ytdlpSvc = deps.ytdlp || ytdlp;
  if (downloadsAreActive(deps)) {
    console.log('[dependency-updater] Skipping Deno nightly check while downloads are active');
    return { skipped: 'active-downloads' };
  }
  if (denoUpdateRunning) return { skipped: 'already-running' };

  denoUpdateRunning = true;
  try {
    const result = await ytdlpSvc.updateDenoIfAvailable();
    if (result.skipped !== 'not-installed') {
      console.log(`[dependency-updater] Deno nightly check complete (${result.updated ? 'updated' : 'already current'})`);
    }
    return result;
  } finally {
    denoUpdateRunning = false;
  }
}

function logFailure(name, error) {
  console.error(`[dependency-updater] ${name} failed: ${error.message}`);
}

function start() {
  const cron = require('node-cron');
  cron.schedule(YTDLP_UPDATE_CRON, () => {
    updateNightlyYtdlp().catch((error) => logFailure('yt-dlp nightly update', error));
  }, cronOptions());

  cron.schedule(FFMPEG_UPDATE_CRON, () => {
    updateFfmpegNightly().catch((error) => logFailure('FFmpeg nightly update', error));
  }, cronOptions());

  cron.schedule(QUICKJS_UPDATE_CRON, () => {
    updateQuickjsNightly().catch((error) => logFailure('QuickJS nightly update', error));
  }, cronOptions());

  cron.schedule(DENO_UPDATE_CRON, () => {
    updateDenoNightly().catch((error) => logFailure('Deno nightly update', error));
  }, cronOptions());

  // A rebuilt/recreated container starts with the image's stable pip package. Re-apply a
  // persisted nightly preference shortly after boot so an app update cannot silently switch
  // the running yt-dlp back to stable until the next 03:00 job.
  const startupTimer = setTimeout(() => {
    updateNightlyYtdlp('startup').catch((error) => logFailure('startup yt-dlp reconciliation', error));
  }, STARTUP_DELAY_MS);
  if (startupTimer.unref) startupTimer.unref();

  console.log(`[dependency-updater] Scheduled yt-dlp (${YTDLP_UPDATE_CRON}), FFmpeg (${FFMPEG_UPDATE_CRON}), QuickJS (${QUICKJS_UPDATE_CRON}), and Deno (${DENO_UPDATE_CRON}) checks`);
}

module.exports = { start, updateNightlyYtdlp, updateFfmpegNightly, updateQuickjsNightly, updateDenoNightly, selectedYtdlpChannel };
