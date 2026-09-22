const cron = require('node-cron');
const db = require('../db');
const queue = require('./queue');
const ytdlp = require('./ytdlp');

const YTDLP_UPDATE_CRON = process.env.YTDLP_UPDATE_CRON || '0 3 * * *';
const FFMPEG_UPDATE_CRON = process.env.FFMPEG_UPDATE_CRON || '30 3 * * *';
const DENO_UPDATE_CRON = process.env.DENO_UPDATE_CRON || '45 3 * * *';
const STARTUP_DELAY_MS = Math.max(0, parseInt(process.env.DEPENDENCY_UPDATE_STARTUP_DELAY_MS || '30000', 10));

let ytdlpUpdateRunning = false;
let ffmpegUpdateRunning = false;
let denoUpdateRunning = false;

function cronOptions() {
  return process.env.TZ ? { timezone: process.env.TZ } : undefined;
}

function selectedYtdlpChannel() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ytdlpChannel'").get();
  return row && row.value === 'nightly' ? 'nightly' : 'stable';
}

function downloadsAreActive() {
  return queue.getActiveCount && queue.getActiveCount() > 0;
}

async function updateNightlyYtdlp(reason = 'scheduled') {
  if (selectedYtdlpChannel() !== 'nightly') return { skipped: 'stable-channel' };
  if (downloadsAreActive()) {
    console.log(`[dependency-updater] Skipping ${reason} yt-dlp nightly check while downloads are active`);
    return { skipped: 'active-downloads' };
  }
  if (ytdlpUpdateRunning) return { skipped: 'already-running' };

  ytdlpUpdateRunning = true;
  try {
    const before = (await ytdlp.getVersions()).ytdlp;
    await ytdlp.updateYtdlp('nightly');
    const after = (await ytdlp.getVersions()).ytdlp;
    console.log(`[dependency-updater] yt-dlp nightly check complete (${before || 'unknown'} -> ${after || 'unknown'})`);
    return { updated: before !== after, before, after };
  } finally {
    ytdlpUpdateRunning = false;
  }
}

async function updateFfmpegNightly() {
  if (downloadsAreActive()) {
    console.log('[dependency-updater] Skipping FFmpeg nightly check while downloads are active');
    return { skipped: 'active-downloads' };
  }
  if (ffmpegUpdateRunning) return { skipped: 'already-running' };

  ffmpegUpdateRunning = true;
  try {
    const result = await ytdlp.updateFfmpegIfAvailable();
    console.log(`[dependency-updater] FFmpeg nightly check complete (${result.updated ? 'updated' : 'already current'})`);
    return result;
  } finally {
    ffmpegUpdateRunning = false;
  }
}

async function updateDenoNightly() {
  if (downloadsAreActive()) {
    console.log('[dependency-updater] Skipping Deno nightly check while downloads are active');
    return { skipped: 'active-downloads' };
  }
  if (denoUpdateRunning) return { skipped: 'already-running' };

  denoUpdateRunning = true;
  try {
    const result = await ytdlp.updateDenoIfAvailable();
    console.log(`[dependency-updater] Deno nightly check complete (${result.updated ? 'updated' : 'already current'})`);
    return result;
  } finally {
    denoUpdateRunning = false;
  }
}

function logFailure(name, error) {
  console.error(`[dependency-updater] ${name} failed: ${error.message}`);
}

function start() {
  cron.schedule(YTDLP_UPDATE_CRON, () => {
    updateNightlyYtdlp().catch((error) => logFailure('yt-dlp nightly update', error));
  }, cronOptions());

  cron.schedule(FFMPEG_UPDATE_CRON, () => {
    updateFfmpegNightly().catch((error) => logFailure('FFmpeg nightly update', error));
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

  console.log(`[dependency-updater] Scheduled yt-dlp (${YTDLP_UPDATE_CRON}), FFmpeg (${FFMPEG_UPDATE_CRON}), and Deno (${DENO_UPDATE_CRON}) checks`);
}

module.exports = { start, updateNightlyYtdlp, updateFfmpegNightly, updateDenoNightly, selectedYtdlpChannel };
