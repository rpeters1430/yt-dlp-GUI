import React from 'react';
import { Captions, Film, Music } from 'lucide-react';

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
    ...overrides,
  };
}

/**
 * Renders the shared "quality / container / subtitles / embed-into-file / SponsorBlock"
 * option controls. Used both for a single video and for each entry in a batch of videos, and
 * for the "apply to all" shared settings, so the same option set/behavior is available
 * everywhere instead of being duplicated and drifting.
 */
export default function DownloadOptionsFields({ values, onChange, resolutions }) {
  const {
    audioOnly, quality, container, subtitles, subLangs,
    embedThumbnail, embedMetadata, embedChapters,
    sponsorblock, sponsorblockCategories,
  } = values;

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

        <label className="checkbox-label">
          <input type="checkbox" checked={subtitles} onChange={(e) => set({ subtitles: e.target.checked })} />
          <Captions size={14} /> Subtitles
        </label>

        {subtitles && (
          <label className="field-inline">
            <select value={subLangs} onChange={(e) => set({ subLangs: e.target.value })}>
              {SUBTITLE_LANG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        )}

        <label className="checkbox-label">
          <input type="checkbox" checked={embedThumbnail} onChange={(e) => set({ embedThumbnail: e.target.checked })} />
          Embed thumbnail
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={embedMetadata} onChange={(e) => set({ embedMetadata: e.target.checked })} />
          Embed metadata
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={embedChapters} onChange={(e) => set({ embedChapters: e.target.checked })} />
          Embed chapters
        </label>

        <label className="checkbox-label">
          <input type="checkbox" checked={sponsorblock} onChange={(e) => set({ sponsorblock: e.target.checked })} />
          Auto-remove sponsored segments (SponsorBlock)
        </label>
      </div>

      {sponsorblock && (
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
