import React from 'react';
import { X } from 'lucide-react';
import Art from '../Art.jsx';
import { useStaging, stagedAction } from '../../context/StagingContext.jsx';
import { summarizeOptions } from '../DownloadOptionsFields.jsx';
import { formatCount, formatDuration, shortDate, siteName } from '../../format.js';

function bestHeight(info) {
  return info?.resolutions?.[0]?.height || null;
}

// "Best 2160p · will get 1080p MP4", or what happens to a playlist / live link.
function formatLine(item, opts) {
  const { info } = item;
  if (!info) return null;
  const type = (opts.container || 'mp4').toUpperCase();
  if (info.isPlaylist) return `Playlist · ${info.videoCount || info.entries?.length || 0} videos · ${opts.audioOnly ? 'audio ' : ''}${type}`;
  if (info.liveStatus === 'is_upcoming') return info.offline ? 'Offline · records when they go live' : 'Scheduled · records when it starts';
  if (opts.audioOnly) return `Audio only · ${type}`;
  const best = bestHeight(info);
  const want = opts.quality ? Number(opts.quality) : null;
  const got = best && want ? Math.min(best, want) : (best || want);
  const bestLabel = best ? `Best ${best}p` : 'Best available';
  const live = info.liveStatus === 'is_live' ? 'Live · ' : '';
  return `${live}${bestLabel} · will get ${got ? `${got}p ` : ''}${type}`;
}

function StagedCard({ item, defaults, onOptions }) {
  const { remove, update } = useStaging();
  const { info, loading, error } = item;
  const opts = item.opts || defaults;
  const site = info?.capabilities?.site?.name || siteName(info?.extractor);
  const meta = info ? [info.uploader, site, info.viewCount ? `${formatCount(info.viewCount)} views` : null].filter(Boolean).join(' · ') : null;
  const isLive = info?.liveStatus === 'is_live';

  return (
    <div className="staged-card">
      <Art src={info?.thumbnail} className="staged-art" label={loading ? 'analyzing…' : null}>
        {isLive && <span className="badge badge-live">● LIVE</span>}
        {!isLive && info?.duration ? <span className="badge badge-duration">{formatDuration(info.duration)}</span> : null}
      </Art>
      <div className="staged-body">
        <div className={`staged-title${loading ? ' mono muted' : ''}`}>{loading || !info ? item.url : (info.title || item.url)}</div>
        {meta && <div className="staged-meta">{meta}</div>}
        {error ? (
          <div className="staged-format text-accent">Couldn&apos;t analyze: {error} · will try anyway</div>
        ) : loading ? (
          <div className="staged-format muted">analyzing…</div>
        ) : (
          <div className="staged-format">{formatLine(item, opts)}{item.opts ? ' · custom options' : ''}</div>
        )}

        {item.dup && !item.watch && (
          <div className="notice notice-warning">
            {item.forceDuplicate ? (
              <>Duplicate · will download again{' '}
                <button type="button" className="btn-link" onClick={() => update(item.id, { forceDuplicate: false })}>Skip it</button>
              </>
            ) : (
              <>Already in your Library since {shortDate(item.dup.completedAt)} · skipping{' '}
                <button type="button" className="btn-link" onClick={() => update(item.id, { forceDuplicate: true })}>Download anyway</button>
              </>
            )}
          </div>
        )}
        {item.watch && (
          <div className="notice notice-info">
            Playlist · will be set up as a Watch and keep grabbing new videos{' '}
            <button type="button" className="btn-link" onClick={() => update(item.id, { watch: false })}>Download once instead</button>
          </div>
        )}
        {!item.watch && info?.isPlaylist && item.watchable && (
          <div className="notice notice-info">
            Downloading this playlist once{' '}
            <button type="button" className="btn-link" onClick={() => update(item.id, { watch: true })}>Watch it instead</button>
          </div>
        )}
      </div>
      <div className="staged-actions">
        <button type="button" className="btn-ghost" onClick={() => onOptions(item.id)} disabled={loading}>Options</button>
        <button type="button" className="icon-plain" onClick={() => remove(item.id)} aria-label="Remove link">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export default function StagingTray({ onOptions, onDefaults, onCommit }) {
  const { staged, defaults, clear, committing } = useStaging();
  if (staged.length === 0) return null;

  const actions = staged.map(stagedAction);
  const loading = actions.includes('loading');
  const downloads = actions.filter((a) => a === 'download').length;
  const watches = actions.filter((a) => a === 'watch').length;
  const dups = staged.filter((it) => it.dup).length;
  const playlists = staged.filter((it) => it.info?.isPlaylist || it.watch).length;

  const summary = [
    `${staged.length} link${staged.length === 1 ? '' : 's'}`,
    dups ? `${dups} duplicate${dups === 1 ? '' : 's'}` : null,
    playlists ? `${playlists} playlist${playlists === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  let label;
  if (committing) label = 'Adding…';
  else if (loading) label = 'Analyzing…';
  else if (!downloads && !watches) label = 'Nothing to download';
  else label = [downloads ? `Download ${downloads}` : null, watches ? `Watch ${watches}` : null].filter(Boolean).join(' · ');

  return (
    <section className="tray" aria-label="Ready to download">
      <div className="tray-head">
        <h2>Ready to download</h2>
        <span className="mono-meta">{summary}</span>
        <button type="button" className="text-btn" onClick={clear}>Clear</button>
      </div>
      <div className="tray-list">
        {staged.map((item) => (
          <StagedCard key={item.id} item={item} defaults={defaults} onOptions={onOptions} />
        ))}
      </div>
      <div className="tray-foot">
        <div className="tray-defaults">
          <span className="tray-defaults-label">Defaults</span>
          <span className="mono-meta">{summarizeOptions(defaults)}</span>
          <button type="button" className="text-btn" onClick={onDefaults}>Edit</button>
        </div>
        <button
          type="button"
          className="btn-primary btn-lg"
          onClick={onCommit}
          disabled={committing || loading || (!downloads && !watches)}
        >
          {label}
        </button>
      </div>
    </section>
  );
}
