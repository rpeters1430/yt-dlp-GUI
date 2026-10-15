// Approximate client-side rendering of a yt-dlp output template, so the Settings page and
// Watch dialog can show what a filename will look like without running yt-dlp. Covers the
// syntax people actually use in templates: alternatives (a,b), defaults (|x), strftime
// dates (>%Y), replacements (&x) and byte/char truncation (.80B). yt-dlp is authoritative.

const SAMPLE = {
  title: 'Building a Treehouse in 48 Hours',
  fulltitle: 'Building a Treehouse in 48 Hours',
  id: 'dQw4w9WgXcQ',
  ext: 'mp4',
  uploader: 'Example Channel',
  channel: 'Example Channel',
  uploader_id: '@examplechannel',
  channel_id: 'UC1234567890',
  extractor: 'youtube',
  extractor_key: 'Youtube',
  upload_date: '20260914',
  release_date: '20260914',
  timestamp: 1789401600,
  duration: 754,
  duration_string: '12:34',
  resolution: '1920x1080',
  height: 1080,
  width: 1920,
  playlist: 'Weekend Builds',
  playlist_title: 'Weekend Builds',
  playlist_index: 3,
  artist: 'Example Artist',
  album: 'Example Album',
  track: 'Example Track',
  track_number: 3,
};

function formatDate(yyyymmdd, fmt) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(yyyymmdd));
  if (!m) return null;
  return fmt.replace(/%([YmdyBb])/g, (_, c) => {
    if (c === 'Y') return m[1];
    if (c === 'y') return m[1].slice(2);
    if (c === 'm') return m[2];
    if (c === 'd') return m[3];
    const month = new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleString('en', { month: c === 'B' ? 'long' : 'short', timeZone: 'UTC' });
    return month;
  });
}

function renderField(inner, conversion) {
  // inner: "a,b>fmt&repl|default" or "a>fmt,b>fmt|default" ; conversion: e.g. ".80B", "s", "03d"
  let expr = inner;
  let fallback = 'NA';
  const pipe = expr.indexOf('|');
  if (pipe !== -1) {
    fallback = expr.slice(pipe + 1);
    expr = expr.slice(0, pipe);
  }
  let replacement = null;
  const amp = expr.indexOf('&');
  if (amp !== -1) {
    replacement = expr.slice(amp + 1);
    expr = expr.slice(0, amp);
  }

  // Shared trailing >fmt if only the last alternative has >, or per-alternative key>fmt
  const parts = expr.split(',');
  let sharedDateFmt = null;
  if (parts.length > 1 && !parts[0].includes('>') && parts[parts.length - 1].includes('>')) {
    const lastGt = parts[parts.length - 1].indexOf('>');
    sharedDateFmt = parts[parts.length - 1].slice(lastGt + 1);
    parts[parts.length - 1] = parts[parts.length - 1].slice(0, lastGt);
  }

  let value;
  let matchedDateFmt = sharedDateFmt;
  for (const rawKey of parts) {
    const gt = rawKey.indexOf('>');
    const key = (gt !== -1 ? rawKey.slice(0, gt) : rawKey).trim();
    const localDateFmt = gt !== -1 ? rawKey.slice(gt + 1) : sharedDateFmt;
    const v = SAMPLE[key];
    if (v !== undefined && v !== null && v !== '') {
      value = v;
      matchedDateFmt = localDateFmt;
      break;
    }
  }
  if (value === undefined) return fallback;
  if (replacement !== null) return replacement.replace(/\{[^}]*\}/g, String(value));
  if (matchedDateFmt) value = formatDate(value, matchedDateFmt) ?? value;

  const pad = /^0?(\d+)d$/.exec(conversion);
  if (pad && typeof value === 'number') return String(value).padStart(Number(pad[1]), '0');
  const trunc = /^\.(\d+)[BsS]?$/.exec(conversion);
  let str = String(value).replace(/[/\\]/g, '_');
  if (trunc) str = str.slice(0, Number(trunc[1]));
  return str;
}

export function previewTemplate(template) {
  if (!template) return '';
  return template.replace(/%\(([^)]*)\)([-#0 +]*\d*(?:\.\d+)?[a-zA-Z])/g, (_, inner, conv) => renderField(inner, conv));
}
