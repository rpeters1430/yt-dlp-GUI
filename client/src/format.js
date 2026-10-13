// Shared display formatting for the redesigned pages.

export function formatDuration(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return '';
  const s = Math.floor(Number(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function formatCount(n) {
  if (!n && n !== 0) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC without a timezone suffix.
export function parseUtc(ts) {
  if (!ts) return null;
  const iso = String(ts).includes('T') ? String(ts) : String(ts).replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function relativeTime(ts, now = Date.now()) {
  const d = ts instanceof Date ? ts : parseUtc(ts);
  if (!d) return '';
  const sec = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function shortDate(ts) {
  const d = ts instanceof Date ? ts : parseUtc(ts);
  if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fileName(p) {
  return p ? String(p).split(/[\\/]/).pop() : '';
}

// The last folder plus the file name, e.g. "Bench & Solder/Restoring … .mp4".
export function shortPath(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/');
}

export function siteName(extractor) {
  if (!extractor) return '';
  const lower = extractor.toLowerCase();
  if (lower.startsWith('youtube')) return 'YouTube';
  if (lower.startsWith('twitch')) return 'Twitch';
  if (lower.startsWith('soundcloud')) return 'SoundCloud';
  if (lower.startsWith('vimeo')) return 'Vimeo';
  if (lower.startsWith('bandcamp')) return 'Bandcamp';
  if (lower.startsWith('tiktok')) return 'TikTok';
  if (lower.startsWith('twitter') || lower === 'x') return 'X';
  if (lower.startsWith('instagram')) return 'Instagram';
  const base = extractor.split(':')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
