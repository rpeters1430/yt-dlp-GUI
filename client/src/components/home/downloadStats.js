const SMOOTHING_TIME_CONSTANT_MS = 3000;

function parseSpeed(speed) {
  if (typeof speed !== 'string') return null;
  const match = speed.trim().match(/^(\\d+(?:\\.\\d+)?)\\s*(B|kB|MB|GB|TB|KiB|MiB|GiB|TiB)\\/s$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2];
  const power = ['B', 'kB', 'MB', 'GB', 'TB', 'KiB', 'MiB', 'GiB', 'TiB']
    .findIndex((candidate) => candidate.toLowerCase() === unit.toLowerCase());
  if (power < 0) return null;
  const base = unit.toLowerCase().includes('i') ? 1024 : 1000;
  return value * (base ** power);
}

function parseEta(eta) {
  if (typeof eta !== 'string') return null;
  const match = eta.trim().match(/^(\\d+):(\\d{1,2})(?::(\\d{1,2}))?$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] == null ? null : Number(match[3]);
  return third == null ? first * 60 + second : first * 3600 + second * 60 + third;
}

function formatSpeed(bytesPerSecond) {
  return `${(bytesPerSecond / (1024 ** 2)).toFixed(1)} MiB/s`;
}

function formatEta(seconds) {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function blend(previous, sample, alpha) {
  return previous == null ? sample : previous + ((sample - previous) * alpha);
}

// yt-dlp reports short-interval throughput and ETA estimates. A 3-second exponential
// average damps network bursts while still following sustained changes quickly.
export function smoothDownloadStats(previous, job, now = Date.now()) {
  if (!job) return { jobId: null, lastAt: now, percent: 0, speed: null, eta: null, speedBps: null, etaSeconds: null };

  const percent = Number(job.percent) || 0;
  const restarted = !previous
    || previous.jobId !== job.id
    || percent < (previous.percent || 0) - 1;
  const elapsed = restarted ? 0 : Math.max(0, now - previous.lastAt);
  const alpha = restarted ? 1 : 1 - Math.exp(-elapsed / SMOOTHING_TIME_CONSTANT_MS);
  const sampleSpeed = parseSpeed(job.speed);
  const sampleEta = parseEta(job.eta);
  const speedBps = sampleSpeed == null
    ? null
    : blend(restarted ? null : previous.speedBps, sampleSpeed, alpha);
  const etaSeconds = sampleEta == null
    ? null
    : blend(restarted ? null : previous.etaSeconds, sampleEta, alpha);

  return {
    jobId: job.id,
    lastAt: now,
    percent,
    speedBps,
    etaSeconds,
    speed: speedBps == null ? (job.speed || null) : formatSpeed(speedBps),
    eta: etaSeconds == null ? (job.eta || null) : formatEta(etaSeconds),
  };
}

export { formatEta, formatSpeed, parseEta, parseSpeed };
