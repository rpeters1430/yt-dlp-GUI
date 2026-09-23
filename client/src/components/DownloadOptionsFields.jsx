import React from 'react';
import { Captions, Film, Music, Radio, Clock } from 'lucide-react';

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
    ...overrides,
  };
}

export function isYouTubeUrl(url, extractor = null) {
  if (extractor && typeof extractor === 'string') {
    return /^youtube/i.test(extractor);
  }
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/^ytsearch/i.test(raw)) return true;
  try {
    const looksLikeHostWithoutScheme = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw);
    const normalized = raw.startsWith('//')
      ? `https:${raw}`
      : (looksLikeHostWithoutScheme ? `https://${raw}` : raw);
    const parsed = new URL(normalized, 'https://example.invalid');
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

/**
 * Renders the shared "quality / container / subtitles / embed-into-file / SponsorBlock"
 * option controls. Used both for a single video and for each entry in a batch of videos, and
 * for the "apply to all" shared settings, so the same option set/behavior is available
 * everywhere instead of being duplicated and drifting.
 *
 * `caps` is the server's per-link `capabilities` object (or mergeCapabilities of several):
 * options the link can't use are hidden or disabled. Omit it to offer everything.
 */
export default function DownloadOptionsFields({
  values,
  onChange,
  resolutions,
  liveInfo,
  caps = null,
}) {
  const {
    audioOnly, quality, container, subtitles, subLangs,
    embedThumbnail, embedMetadata, embedChapters,
    sponsorblock, sponsorblockCategories,
    liveFromStart, waitForLive, waitInterval,
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
  const isAudioMode = audioOnly || !!c.audioOnlyMedia;

  function set(patch) {
    onChange({ ...values, ...patch });
  }

  function toggleSponsorblockCategory(value) {
    const next = sponsorblockCategories.includes(value)
      ? sponsorblockCategories.filter((c) => c !== value)
      : [...sponsorblockCategories, value];
    set({ sponsorblockCategories: next });
  }

  function selectAllSponsorblockCategories() {
    set({ sponsorblock: true, sponsorblockCategories: SPONSORBLOCK_ALL_VALUES });
  }

  function clearSponsorblockCategories() {
    set({ sponsorblockCategories: [] });
  }

  return (
    <div className="download-options-fields">
      {c.warnings?.length > 0 && (
        <div className="site-caps-warnings">
          {c.warnings.map((w) => (
            <p key={w} className="muted small text-danger">{w}</p>
          ))}
        </div>
      )}

      {isUpcoming && (
        <div className="live-options-panel">
          <div className="segmented-choice">
            <button type="button" className={waitForLive ? 'active' : ''} onClick={() => set({ waitForLive: true })}>
              <Clock size={14} /> Wait for it to start
            </button>
            <button type="button" className={!waitForLive ? 'active' : ''} onClick={() => set({ waitForLive: false })}>
              <Radio size={14} /> Don't wait
            </button>
          </div>
          {waitForLive ? (
            <p className="muted small">
              This broadcast hasn't started yet. Recording will begin automatically the moment it
              goes live — yt-dlp checks every {waitInterval}s in the background, so this job can
              sit queued for a while before it starts.
            </p>
          ) : (
            <p className="muted small text-danger">
              This broadcast hasn't started yet and has no video to download — the job will fail
              immediately unless you enable "Wait for it to start".
            </p>
          )}
        </div>
      )}

      {isLive && (
        <div className="live-options-panel">
          <div className="segmented-choice">
            <button type="button" className={!liveFromStart ? 'active' : ''} onClick={() => set({ liveFromStart: false })}>
              <Radio size={14} /> Join live now
            </button>
            {canLiveFromStart && (
              <button type="button" className={liveFromStart ? 'active' : ''} onClick={() => set({ liveFromStart: true })}>
                <Clock size={14} /> Record from broadcast start
              </button>
            )}
          </div>
          <p className="muted small">
            {liveFromStart && canLiveFromStart
              ? "Downloads the full broadcast from the moment it started, not just from now. May take a while to catch up to the live edge."
              : 'Only what airs from now on will be recorded — anything already broadcast before this point is skipped.'}
          </p>
        </div>
      )}

      <div className="preview-options-grid">
        <div className="segmented">
          <button type="button" className={!audioOnly ? 'active' : ''} onClick={() => set({ audioOnly: false })}>
            <Film size={13} /> Video
          </button>
          <button type="button" className={audioOnly ? 'active' : ''} onClick={() => set({ audioOnly: true })}>
            <Music size={13} /> Audio only
          </button>
        </div>

        {!audioOnly && (
          <label className="field-inline">
            Quality
            <select value={quality} onChange={(e) => set({ quality: e.target.value })}>
              <option value="">Best available</option>
              {resolutions && resolutions.length > 0 ? (
                resolutions.map((r) => (
                  <option key={r.height} value={String(r.height)}>{r.label}</option>
                ))
              ) : (
                <>
                  <option value="2160">Up to 4K (2160p)</option>
                  <option value="1440">Up to 1440p</option>
                  <option value="1080">Up to 1080p</option>
                  <option value="720">Up to 720p</option>
                  <option value="480">Up to 480p</option>
                  <option value="360">Up to 360p</option>
                </>
              )}
            </select>
          </label>
        )}

        {!audioOnly && (
          <label className="field-inline">
            Format
            <select value={container} onChange={(e) => set({ container: e.target.value })}>
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
            </select>
          </label>
        )}

        {!isAudioMode ? (
          <>
            <label className={`checkbox-label ${hasSubtitles === false ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={subtitles && hasSubtitles !== false}
                disabled={hasSubtitles === false}
                onChange={(e) => set({ subtitles: e.target.checked })}
              />
              <Captions size={14} /> Subtitles
              {hasSubtitles === false && <span className="badge-tag">None available</span>}
            </label>

            {subtitles && hasSubtitles !== false && (
              <label className="field-inline">
                <select value={subLangs} onChange={(e) => set({ subLangs: e.target.value })}>
                  {SUBTITLE_LANG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <div className="option-disabled-notice" title="Subtitles cannot be embedded into audio-only files">
            <Captions size={14} />
            <span className="muted small">Subtitles not applicable for audio</span>
          </div>
        )}

        <label className={`checkbox-label ${noThumbnail ? 'disabled' : ''}`}>
          <input
            type="checkbox"
            checked={embedThumbnail && !noThumbnail}
            disabled={noThumbnail}
            onChange={(e) => set({ embedThumbnail: e.target.checked })}
          />
          Embed thumbnail
          {noThumbnail && <span className="badge-tag">None available</span>}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={embedMetadata} onChange={(e) => set({ embedMetadata: e.target.checked })} />
          Embed metadata
        </label>

        {!isAudioMode && (
          <label className={`checkbox-label ${noChapters ? 'disabled' : ''}`}>
            <input
              type="checkbox"
              checked={embedChapters && !noChapters}
              disabled={noChapters}
              onChange={(e) => set({ embedChapters: e.target.checked })}
            />
            Embed chapters
            {noChapters && <span className="badge-tag">None available</span>}
          </label>
        )}

        {canSponsorblock ? (
          <label className="checkbox-label">
            <input type="checkbox" checked={sponsorblock} onChange={(e) => set({ sponsorblock: e.target.checked })} />
            Auto-remove sponsored segments (SponsorBlock)
            <span className="badge-tag">{c.sponsorblockPartial ? 'YouTube links only' : 'YouTube'}</span>
          </label>
        ) : (
          <div className="option-disabled-notice" title="SponsorBlock is only available for YouTube videos">
            <span className="badge-tag">SponsorBlock</span>
            <span className="muted small">
              Only supported on YouTube{siteName ? ` (this is ${siteName})` : ''}
            </span>
          </div>
        )}
      </div>

      {canSponsorblock && sponsorblock && (
        <div className="sponsorblock-categories">
          <div className="sponsorblock-categories-actions">
            <button type="button" className="btn-ghost btn-sm" onClick={selectAllSponsorblockCategories}>
              Select all
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={clearSponsorblockCategories}>
              Clear
            </button>
          </div>
          {SPONSORBLOCK_CATEGORIES.map((cat) => (
            <label key={cat.value} className="checkbox-label">
              <input
                type="checkbox"
                checked={sponsorblockCategories.includes(cat.value)}
                onChange={() => toggleSponsorblockCategory(cat.value)}
              />
              {cat.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
