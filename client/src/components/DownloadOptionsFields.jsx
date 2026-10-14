import React from 'react';
import { Radio, Clock } from 'lucide-react';

export const SUBTITLE_LANG_OPTIONS = [
  { value: 'en.*', label: 'English' },
  { value: 'es.*', label: 'Spanish' },
  { value: 'fr.*', label: 'French' },
  { value: 'de.*', label: 'German' },
  { value: 'it.*', label: 'Italian' },
  { value: 'pt.*', label: 'Portuguese' },
  { value: 'ja.*', label: 'Japanese' },
  { value: 'ko.*', label: 'Korean' },
  { value: 'zh.*', label: 'Chinese' },
  { value: 'ru.*', label: 'Russian' },
  { value: 'ar.*', label: 'Arabic' },
  { value: 'hi.*', label: 'Hindi' },
  { value: 'all', label: 'All available languages' },
];

export const SPONSORBLOCK_CATEGORIES = [
  { value: 'sponsor', label: 'Sponsor' },
  { value: 'selfpromo', label: 'Unpaid/self promotion' },
  { value: 'interaction', label: 'Interaction reminder' },
  { value: 'intro', label: 'Intermission/intro' },
  { value: 'outro', label: 'Endcards/credits' },
  { value: 'preview', label: 'Preview/recap' },
  { value: 'music_offtopic', label: 'Non-music section' },
  { value: 'filler', label: 'Filler tangent' },
];

export const SPONSORBLOCK_ALL_VALUES = SPONSORBLOCK_CATEGORIES.map((c) => c.value);

// Defaults used whenever a fresh set of per-video/shared download options is created, so
// thumbnails/metadata get embedded directly into the video file without requiring the user to
// opt in every time (per issue: "no need for separate files; embed them all automatically").
export function defaultDownloadOptions(overrides = {}) {
  return {
    audioOnly: false,
    quality: '',
    container: 'mp4',
    subtitles: false,
    subLangs: 'en.*',
    embedThumbnail: true,
    embedMetadata: true,
    embedChapters: true,
    sponsorblock: false,
    sponsorblockCategories: [],
    liveFromStart: false,
    waitForLive: true,
    waitInterval: 15,
    splitLiveChunks: false,
    liveChunkDuration: 30,
    ...overrides,
  };
}

// Pasted links often lack a scheme ("www.tiktok.com/@user/live"). Give anything that looks
// like a host an https:// prefix so it's treated as a link; mirrors the server's normalizeUrl.
export function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (raw.startsWith('//')) return `https:${raw}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:[/?#]|$)/i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}

// A YouTube playlist or channel link (not a single video, even one opened from a playlist):
// something worth following as a Watch rather than downloading once.
export function isWatchableUrl(url) {
  if (!isYouTubeUrl(url) || /^ytsearch/i.test(String(url).trim())) return false;
  try {
    const parsed = new URL(normalizeUrl(url));
    if (parsed.pathname === '/playlist' && parsed.searchParams.get('list')) return true;
    return /^\/(?:@[^/]+|channel\/[\w-]+|c\/[^/]+|user\/[^/]+)(?:\/(?:featured|home|videos|shorts|streams))?\/?$/i.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

export function isYouTubeUrl(url, extractor = null) {
  if (extractor && typeof extractor === 'string') {
    return /^youtube/i.test(extractor);
  }
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/^ytsearch/i.test(raw)) return true;
  try {
    const parsed = new URL(normalizeUrl(raw), 'https://example.invalid');
    const host = parsed.hostname.toLowerCase();
    return /(^|\.)youtube\.com$/i.test(host) || host === 'youtu.be' || /(^|\.)youtube-nocookie\.com$/i.test(host);
  } catch (_) {
    return false;
  }
}

// Used when nothing is known about the link(s) yet: every option is offered, and the server
// drops whatever turns out not to apply once the download's own metadata probe runs.
const UNKNOWN_CAPS = {
  site: null,
  sponsorblock: true,
  liveFromStart: true,
  hasSubtitles: null,
  audioOnlyMedia: null,
  chapters: null,
  thumbnail: null,
  warnings: [],
};

// Pre-analysis guess from the URL alone. Only site-level features can be guessed; media facts
// (subtitles, chapters, ...) stay unknown until the server's `capabilities` arrive.
export function capsFromUrl(url) {
  return { ...UNKNOWN_CAPS, sponsorblock: isYouTubeUrl(url) };
}

// An analyzed item's server capabilities, or the URL guess if its metadata lookup failed.
export function capsForItem(item) {
  return item?.data?.capabilities ?? capsFromUrl(item?.url);
}

// Combines several links' capabilities for the shared "apply to all" options. A site feature
// is offered if *any* link supports it (the server skips it for the others and says so in
// that job's log); a media option is only shown as unavailable when *every* link lacks it.
export function mergeCapabilities(list) {
  const all = (list || []).filter(Boolean);
  if (all.length === 0) return null;
  if (all.length === 1) return all[0];
  const tri = (key) => (all.some((c) => c[key] === true) ? true : all.every((c) => c[key] === false) ? false : null);
  const siteIds = new Set(all.map((c) => c.site?.id ?? null));
  return {
    site: siteIds.size === 1 && all[0].site ? all[0].site : { id: 'mixed', name: 'multiple sites' },
    sponsorblock: all.some((c) => c.sponsorblock),
    sponsorblockPartial: all.some((c) => c.sponsorblock) && !all.every((c) => c.sponsorblock),
    liveFromStart: all.some((c) => c.liveFromStart),
    hasSubtitles: tri('hasSubtitles'),
    audioOnlyMedia: all.every((c) => c.audioOnlyMedia === true),
    chapters: tri('chapters'),
    thumbnail: tri('thumbnail'),
    warnings: [...new Set(all.flatMap((c) => c.warnings || []))],
  };
}

const QUALITY_CHOICES = [
  { value: '', label: 'Best' },
  { value: '2160', label: '2160p' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
];
const VIDEO_TYPES = ['mp4', 'mkv', 'webm'];
const AUDIO_TYPES = ['m4a', 'mp3', 'opus', 'flac'];
const CHUNK_CHOICES = [
  { value: 0, label: 'Off' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
];

// A small on/off switch (36×20), used for every toggle row in the redesign.
export function Switch({ checked, onChange, disabled = false, label, size = 'sm' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? ' on' : ''}${size === 'lg' ? ' switch-lg' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

// A row with a label (and optional description) on the left and a control on the right.
export function ToggleRow({ label, description, checked, onChange, disabled, note }) {
  return (
    <div className={`toggle-row${disabled ? ' disabled' : ''}`}>
      <div className="toggle-row-text">
        <span className="toggle-row-label">{label}</span>
        {description && <span className="toggle-row-desc">{description}</span>}
      </div>
      {note && <span className="toggle-row-note">{note}</span>}
      <Switch checked={checked && !disabled} onChange={onChange} disabled={disabled} label={typeof label === 'string' ? label : undefined} />
    </div>
  );
}

// Segmented control: [{ value, label }] with one selected.
export function Segmented({ options, value, onChange, className = '', size }) {
  return (
    <div className={`seg${size === 'sm' ? ' seg-sm' : ''} ${className}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
          disabled={o.disabled}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function subLangLabel(value) {
  if (value === 'all') return 'all';
  return value.replace('.*', '');
}

/**
 * The shared download option controls: Video / Audio only, quality, file type, and the
 * subtitle / embed / SponsorBlock switches, plus live-stream choices when the link is live.
 * Used by Home's options drawer (per link and for the defaults) and Settings > Downloads.
 *
 * `caps` is the server's per-link `capabilities` object (or mergeCapabilities of several):
 * options the link can't use are hidden or disabled. Omit it to offer everything.
 */
export default function DownloadOptionsFields({
  values,
  onChange,
  liveInfo,
  caps = null,
}) {
  const {
    audioOnly, quality, container, subtitles, subLangs,
    embedThumbnail, embedMetadata, embedChapters,
    sponsorblock, sponsorblockCategories,
    liveFromStart, waitForLive, waitInterval,
    splitLiveChunks, liveChunkDuration,
  } = values;
  const c = caps || UNKNOWN_CAPS;
  const siteName = c.site?.name || null;
  const hasSubtitles = c.hasSubtitles;
  const canSponsorblock = !!c.sponsorblock;
  const canLiveFromStart = !!c.liveFromStart;
  const noChapters = c.chapters === false;
  const noThumbnail = c.thumbnail === false;
  const isLive = liveInfo?.liveStatus === 'is_live';
  const isUpcoming = liveInfo?.liveStatus === 'is_upcoming';
  // A channel's live page while nobody is broadcasting (e.g. a TikTok user who is offline).
  const isOffline = isUpcoming && !!liveInfo?.offline;
  const isAudioMode = audioOnly || !!c.audioOnlyMedia;
  const showLiveSplit = isLive || isUpcoming || values.isLive;

  function set(patch) {
    onChange({ ...values, ...patch });
  }

  function toggleSponsorblockCategory(value) {
    const next = sponsorblockCategories.includes(value)
      ? sponsorblockCategories.filter((v) => v !== value)
      : [...sponsorblockCategories, value];
    set({ sponsorblockCategories: next });
  }

  const sbSummary = sponsorblockCategories.length
    ? sponsorblockCategories.slice(0, 3).join(', ') + (sponsorblockCategories.length > 3 ? ', …' : '')
    : '';
  const chunkValue = splitLiveChunks ? liveChunkDuration : 0;

  return (
    <div className="dl-options">
      {c.warnings?.length > 0 && (
        <div className="notice notice-warning">
          {c.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}

      {isUpcoming && (
        <div className="dl-options-group">
          <span className="field-caption">{isOffline ? 'Channel is offline' : 'Scheduled broadcast'}</span>
          <Segmented
            value={!!waitForLive}
            onChange={(v) => set({ waitForLive: v })}
            options={[
              { value: true, label: <><Clock size={14} /> {isOffline ? 'Wait for them to go live' : 'Wait for it to start'}</> },
              { value: false, label: <><Radio size={14} /> Don&apos;t wait</> },
            ]}
          />
          <p className={`field-hint${waitForLive ? '' : ' text-danger'}`}>
            {waitForLive
              ? `Recording starts automatically once it goes live. yt-dlp checks every ${waitInterval}s, so this can sit queued for a while.`
              : 'There is nothing to record yet, so the download will fail unless you wait for it.'}
          </p>
        </div>
      )}

      {isLive && (
        <div className="dl-options-group">
          <span className="field-caption">Start from</span>
          <Segmented
            value={canLiveFromStart && liveFromStart}
            onChange={(v) => set({ liveFromStart: v })}
            options={[
              ...(canLiveFromStart ? [{ value: true, label: 'Beginning of stream' }] : []),
              { value: false, label: 'Right now' },
            ]}
          />
        </div>
      )}

      {showLiveSplit && (
        <div className="dl-options-group">
          <span className="field-caption">Split recording into chunks</span>
          <div className="choice-grid choice-grid-4">
            {CHUNK_CHOICES.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`choice mono${chunkValue === o.value ? ' active' : ''}`}
                onClick={() => set(o.value ? { splitLiveChunks: true, liveChunkDuration: o.value } : { splitLiveChunks: false })}
              >
                {o.label}
              </button>
            ))}
          </div>
          {splitLiveChunks && ![30, 60, 120].includes(liveChunkDuration) && (
            <p className="field-hint">Currently every {liveChunkDuration} min.</p>
          )}
        </div>
      )}

      <Segmented
        className="seg-full"
        value={!!audioOnly}
        onChange={(v) => set({
          audioOnly: v,
          container: v
            ? (AUDIO_TYPES.includes(container) ? container : 'mp3')
            : (VIDEO_TYPES.includes(container) ? container : 'mp4'),
        })}
        options={[{ value: false, label: 'Video' }, { value: true, label: 'Audio only' }]}
      />

      {!audioOnly && (
        <div className="dl-options-group">
          <span className="field-caption">Quality · closest available at or below is used</span>
          <div className="choice-grid choice-grid-6">
            {QUALITY_CHOICES.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`choice choice-accent mono${(quality || '') === o.value ? ' active' : ''}`}
                onClick={() => set({ quality: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dl-options-group">
        <span className="field-caption">File type</span>
        <div className="choice-row">
          {(audioOnly ? AUDIO_TYPES : VIDEO_TYPES).map((t) => (
            <button
              key={t}
              type="button"
              className={`choice mono${container === t ? ' active' : ''}`}
              onClick={() => set({ container: t })}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="toggle-list">
        {!isAudioMode && (
          <ToggleRow
            label={`Subtitles (${subLangLabel(subLangs)})`}
            checked={subtitles}
            disabled={hasSubtitles === false}
            note={hasSubtitles === false ? 'None available' : null}
            onChange={(v) => set({ subtitles: v })}
          />
        )}
        {!isAudioMode && subtitles && hasSubtitles !== false && (
          <div className="toggle-sub">
            <select value={subLangs} onChange={(e) => set({ subLangs: e.target.value })} aria-label="Subtitle language">
              {SUBTITLE_LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        <ToggleRow
          label="Embed thumbnail"
          checked={embedThumbnail}
          disabled={noThumbnail}
          note={noThumbnail ? 'None available' : null}
          onChange={(v) => set({ embedThumbnail: v })}
        />
        <ToggleRow label="Embed metadata" checked={embedMetadata} onChange={(v) => set({ embedMetadata: v })} />
        {!isAudioMode && (
          <ToggleRow
            label="Chapters"
            checked={embedChapters}
            disabled={noChapters}
            note={noChapters ? 'None available' : null}
            onChange={(v) => set({ embedChapters: v })}
          />
        )}
        <ToggleRow
          label={canSponsorblock && sbSummary ? `SponsorBlock (${sbSummary})` : 'SponsorBlock'}
          checked={sponsorblock}
          disabled={!canSponsorblock}
          note={!canSponsorblock ? `YouTube only${siteName ? ` · this is ${siteName}` : ''}` : (c.sponsorblockPartial ? 'YouTube links only' : null)}
          onChange={(v) => set({
            sponsorblock: v,
            sponsorblockCategories: v && sponsorblockCategories.length === 0 ? ['sponsor', 'intro'] : sponsorblockCategories,
          })}
        />
        {canSponsorblock && sponsorblock && (
          <div className="toggle-sub chip-row">
            {SPONSORBLOCK_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                className={`chip${sponsorblockCategories.includes(cat.value) ? ' active' : ''}`}
                onClick={() => toggleSponsorblockCategory(cat.value)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// One-line summary of a set of options, e.g. "1080p · MP4 · SponsorBlock · Subs".
export function summarizeOptions(o) {
  const parts = [];
  if (o.audioOnly) parts.push('Audio only');
  else parts.push(o.quality ? `${o.quality}p` : 'Best');
  parts.push((o.container || 'mp4').toUpperCase());
  if (o.sponsorblock) parts.push('SponsorBlock');
  if (o.subtitles && !o.audioOnly) parts.push('Subs');
  if (o.splitLiveChunks) parts.push(`${o.liveChunkDuration >= 60 ? `${o.liveChunkDuration / 60}h` : `${o.liveChunkDuration}m`} chunks`);
  return parts.join(' · ');
}
