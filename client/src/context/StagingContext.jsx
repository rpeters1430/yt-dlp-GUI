import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { defaultDownloadOptions, isWatchableUrl, normalizeUrl } from '../components/DownloadOptionsFields.jsx';
import { getStoredDownloadDefaults, storeDownloadDefaults } from '../prefs.js';

// Links pasted on Home wait here ("Ready to download") until they're queued. It lives above
// the routes so the tray survives a trip to another page and back.
const StagingContext = createContext(null);

let nextId = 1;

export function parseLinks(text) {
  return String(text || '')
    .split(/\s+/)
    .map((s) => normalizeUrl(s))
    .filter((u) => /^https?:\/\/\S+\.\S+/i.test(u));
}

// The enqueue API's field names for one set of download options.
export function toEnqueuePayload(urls, opts) {
  return {
    urls,
    audioOnly: opts.audioOnly,
    quality: opts.quality,
    container: opts.container,
    subtitles: opts.subtitles,
    subLangs: opts.subLangs,
    embedThumbnail: opts.embedThumbnail,
    embedMetadata: opts.embedMetadata,
    embedChapters: opts.embedChapters,
    sponsorblockRemove: opts.sponsorblock ? opts.sponsorblockCategories : [],
    isLive: opts.isLive,
    liveFromStart: opts.liveFromStart,
    waitForLive: opts.isLive && opts.liveStatus === 'is_upcoming' ? opts.waitForLive : false,
    waitInterval: opts.waitInterval,
    splitLiveChunks: opts.splitLiveChunks,
    liveChunkDuration: opts.liveChunkDuration,
    ...(opts.downloadSections ? { downloadSections: opts.downloadSections } : {}),
  };
}

// Recording start/join behavior only applies to a link that is live (or scheduled).
function withLiveFlags(opts, info) {
  const live = info?.liveStatus === 'is_live';
  const upcoming = info?.liveStatus === 'is_upcoming';
  return {
    ...opts,
    isLive: live || (upcoming && opts.waitForLive),
    liveStatus: live ? 'is_live' : upcoming ? 'is_upcoming' : null,
  };
}

function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

// What the tray will do with a link once everything is analyzed.
export function stagedAction(item) {
  if (item.loading) return 'loading';
  if (item.watch) return 'watch';
  if (item.dup && !item.forceDuplicate) return 'skip';
  return 'download';
}

export function StagingProvider({ children }) {
  const [staged, setStaged] = useState([]);
  const [defaults, setDefaultsState] = useState(() => defaultDownloadOptions(getStoredDownloadDefaults() || {}));
  const [committing, setCommitting] = useState(false);
  // The tray as of the last render, read by analyze/commit without re-creating them.
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  // The saved live-chunk default from Settings applies unless the user already chose one here.
  useEffect(() => {
    if (getStoredDownloadDefaults()) return;
    api.getSettings().then((s) => {
      const mins = parseInt(s?.default_live_chunk_mins, 10);
      if (mins > 0) setDefaultsState((prev) => ({ ...prev, splitLiveChunks: true, liveChunkDuration: mins }));
    }).catch(() => {});
  }, []);

  const setDefaults = useCallback((next) => {
    setDefaultsState(next);
    storeDownloadDefaults(next);
  }, []);

  const update = useCallback((id, patch) => {
    setStaged((prev) => prev.map((it) => (it.id === id ? { ...it, ...(typeof patch === 'function' ? patch(it) : patch) } : it)));
  }, []);

  const analyze = useCallback((text) => {
    const known = new Set(stagedRef.current.map((it) => it.url));
    const fresh = [];
    for (const url of parseLinks(text)) {
      if (known.has(url)) continue;
      known.add(url);
      fresh.push({
        id: nextId++,
        url,
        loading: true,
        error: '',
        info: null,
        dup: null,
        forceDuplicate: false,
        watchable: isWatchableUrl(url),
        watch: isWatchableUrl(url),
        opts: null,
      });
    }
    if (fresh.length === 0) return 0;
    stagedRef.current = [...stagedRef.current, ...fresh];
    setStaged((prev) => [...prev, ...fresh]);

    for (const item of fresh) {
      api.getInfo(item.url)
        .then((info) => {
          update(item.id, { loading: false, info });
          if (info.isPlaylist) return;
          api.checkDuplicates([{ url: item.url, id: info.id, extractor: info.extractor }])
            .then(({ duplicates }) => {
              const dup = duplicates?.[item.url];
              if (dup) update(item.id, { dup });
            })
            .catch(() => {});
        })
        .catch((err) => update(item.id, { loading: false, error: err.message || 'Could not analyze this link' }));
    }
    return fresh.length;
  }, [update]);

  const remove = useCallback((id) => setStaged((prev) => prev.filter((it) => it.id !== id)), []);
  const clear = useCallback(() => setStaged([]), []);

  // Queues downloads (grouped by identical options), sets up Watches, and skips duplicates.
  // Returns the toast text. Links that fail stay in the tray.
  const commit = useCallback(async () => {
    const items = stagedRef.current.filter((it) => !it.loading);
    const groups = new Map();
    const watches = [];
    const skipped = [];
    for (const it of items) {
      const action = stagedAction(it);
      if (action === 'skip') skipped.push(it);
      else if (action === 'watch') watches.push(it);
      else {
        const opts = withLiveFlags(it.opts || defaults, it.info);
        const key = JSON.stringify(opts);
        if (!groups.has(key)) groups.set(key, { opts, items: [] });
        groups.get(key).items.push(it);
      }
    }

    setCommitting(true);
    const done = new Set(skipped.map((it) => it.id));
    let queued = 0;
    let watched = 0;
    let firstError = '';
    try {
      for (const { opts, items: groupItems } of groups.values()) {
        try {
          await api.enqueue(toEnqueuePayload(groupItems.map((it) => it.url), opts));
          queued += groupItems.length;
          for (const it of groupItems) done.add(it.id);
        } catch (err) {
          firstError ||= err.message;
        }
      }
      for (const it of watches) {
        const opts = it.opts || defaults;
        try {
          await api.addWatch({
            url: it.url,
            name: it.info?.title || null,
            channelName: it.info?.uploader || null,
            thumbnail: it.info?.thumbnail || null,
            backfillCount: 'all',
            checkIntervalMins: 360,
            audioOnly: opts.audioOnly,
            quality: opts.quality,
            container: opts.container,
            subtitles: opts.subtitles,
            subLangs: opts.subLangs,
            embedThumbnail: opts.embedThumbnail,
            embedMetadata: opts.embedMetadata,
            embedChapters: opts.embedChapters,
            sponsorblock: opts.sponsorblock,
            sponsorblockCategories: opts.sponsorblock ? opts.sponsorblockCategories : [],
          });
          watched += 1;
          done.add(it.id);
        } catch (err) {
          firstError ||= err.message;
        }
      }
    } finally {
      setCommitting(false);
    }
    setStaged((prev) => prev.filter((it) => !done.has(it.id)));

    const parts = [];
    if (queued) parts.push(`Queued ${queued}`);
    if (watched) parts.push(`watching ${plural(watched, 'playlist')}`);
    if (skipped.length) parts.push(`skipped ${plural(skipped.length, 'duplicate')}`);
    const summary = parts.join(' · ');
    return { summary: summary ? summary.charAt(0).toUpperCase() + summary.slice(1) : '', error: firstError };
  }, [defaults]);

  const value = useMemo(() => ({
    staged, defaults, setDefaults, analyze, update, remove, clear, commit, committing,
  }), [staged, defaults, setDefaults, analyze, update, remove, clear, commit, committing]);

  return <StagingContext.Provider value={value}>{children}</StagingContext.Provider>;
}

export function useStaging() {
  const ctx = useContext(StagingContext);
  if (!ctx) throw new Error('useStaging must be used within a StagingProvider');
  return ctx;
}
