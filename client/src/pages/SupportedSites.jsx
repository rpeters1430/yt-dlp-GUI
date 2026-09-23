import React, { useState, useEffect, useMemo } from 'react';
import {
  Globe,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Film,
  Music,
  Captions,
  Radio,
  ShieldAlert,
  Cookie,
  ExternalLink,
  Sparkles,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { api } from '../api.js';

export default function SupportedSites() {
  const [guideData, setGuideData] = useState(null);
  const [loadingGuide, setLoadingGuide] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Interactive URL / Platform checker
  const [testUrl, setTestUrl] = useState('');

  // Extractors directory search
  const [extractorSearch, setExtractorSearch] = useState('');
  const [extractors, setExtractors] = useState([]);
  const [totalExtractors, setTotalExtractors] = useState(0);
  const [loadingExtractors, setLoadingExtractors] = useState(false);

  useEffect(() => {
    api
      .getSiteGuide()
      .then((data) => setGuideData(data))
      .catch((err) => console.error('Failed to load site guide:', err))
      .finally(() => setLoadingGuide(false));
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingExtractors(true);
    const timer = setTimeout(() => {
      api
        .listExtractors(extractorSearch)
        .then((res) => {
          if (!active) return;
          setExtractors(res.extractors || []);
          setTotalExtractors(res.total || 0);
        })
        .catch(() => {
          if (!active) return;
          setExtractors([]);
          setTotalExtractors(0);
        })
        .finally(() => {
          if (active) setLoadingExtractors(false);
        });
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [extractorSearch]);

  const categories = useMemo(() => {
    if (!guideData?.majorSites) return ['all'];
    const set = new Set(guideData.majorSites.map((s) => s.category));
    return ['all', ...Array.from(set)];
  }, [guideData]);

  const filteredSites = useMemo(() => {
    if (!guideData?.majorSites) return [];
    if (categoryFilter === 'all') return guideData.majorSites;
    return guideData.majorSites.filter((s) => s.category === categoryFilter);
  }, [guideData, categoryFilter]);

  // Evaluates the user's typed testUrl against known platforms
  const checkedPlatform = useMemo(() => {
    const raw = testUrl.trim().toLowerCase();
    if (!raw) return null;

    if (!guideData?.majorSites) return null;

    for (const site of guideData.majorSites) {
      if (site.domains.some((d) => raw.includes(d)) || raw.includes(site.id)) {
        return site;
      }
    }

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return {
        id: 'generic',
        name: 'Generic Media Source',
        domains: ['generic stream'],
        category: 'Direct / Other',
        video: true,
        audio: true,
        live: true,
        liveRewind: false,
        subtitles: 'Dependent on stream',
        sponsorblock: false,
        cookies: 'Optional',
        notes: 'yt-dlp uses its generic extractor to grab direct MP4, HLS (.m3u8), or DASH (.mpd) streams.',
      };
    }

    return null;
  }, [testUrl, guideData]);

  return (
    <div className="supported-sites-page">
      <div className="page-header">
        <div>
          <h1>Supported Sites & Capabilities</h1>
          <p>Learn which features, arguments, and requirements apply across yt-dlp extractors.</p>
        </div>
      </div>

      {/* SECTION 1: URL / PLATFORM QUICK CHECKER */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={18} className="text-accent" />
            <h2>Platform Capability Checker</h2>
          </div>
        </div>
        <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
          Paste a link or type a website name (e.g. <code>youtube.com</code>, <code>twitch.tv</code>, <code>soundcloud</code>, <code>vimeo</code>) to see its allowed arguments and requirements.
        </p>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="text"
              placeholder="Paste any URL or platform name (e.g. https://www.twitch.tv/videos/123)..."
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              style={{ width: '100%', paddingLeft: 34 }}
            />
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
          </div>
          {testUrl && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setTestUrl('')}>
              Clear
            </button>
          )}
        </div>

        {checkedPlatform && (
          <div className="platform-check-card" style={{ marginTop: 16 }}>
            <div className="platform-check-header">
              <div>
                <span className="count-badge accent" style={{ marginRight: 8 }}>
                  {checkedPlatform.category}
                </span>
                <strong style={{ fontSize: 16 }}>{checkedPlatform.name}</strong>
              </div>
              <span className="muted small">{checkedPlatform.domains.join(', ')}</span>
            </div>

            <div className="platform-capabilities-grid">
              <div className="capability-item">
                <span className="cap-label">Video</span>
                {checkedPlatform.video ? (
                  <span className="cap-status yes"><CheckCircle2 size={14} /> Supported</span>
                ) : (
                  <span className="cap-status no"><XCircle size={14} /> Audio Only</span>
                )}
              </div>

              <div className="capability-item">
                <span className="cap-label">Audio</span>
                <span className="cap-status yes"><CheckCircle2 size={14} /> Supported</span>
              </div>

              <div className="capability-item">
                <span className="cap-label">Subtitles</span>
                {checkedPlatform.subtitles === 'None' ? (
                  <span className="cap-status no"><XCircle size={14} /> None</span>
                ) : (
                  <span className="cap-status yes"><CheckCircle2 size={14} /> {checkedPlatform.subtitles}</span>
                )}
              </div>

              <div className="capability-item">
                <span className="cap-label">SponsorBlock</span>
                {checkedPlatform.sponsorblock ? (
                  <span className="cap-status yes"><CheckCircle2 size={14} /> Supported</span>
                ) : (
                  <span className="cap-status no" title="SponsorBlock only indexes YouTube videos">
                    <XCircle size={14} /> YouTube Only
                  </span>
                )}
              </div>

              <div className="capability-item">
                <span className="cap-label">Live Broadcasts</span>
                {checkedPlatform.live ? (
                  <span className="cap-status yes">
                    <CheckCircle2 size={14} /> {checkedPlatform.liveRewind ? 'Live + Rewind' : 'Live Edge Only'}
                  </span>
                ) : (
                  <span className="cap-status no"><XCircle size={14} /> No</span>
                )}
              </div>

              <div className="capability-item">
                <span className="cap-label">Cookies / Login</span>
                <span className="cap-status info"><Info size={14} /> {checkedPlatform.cookies}</span>
              </div>
            </div>

            <div className="platform-check-notes">
              <Info size={15} style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-accent)' }} />
              <div>
                <strong>Requirements & Notes: </strong>
                {checkedPlatform.notes}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* SECTION 2: GENERAL RULES BREAKDOWN */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={18} className="text-accent" />
            <h2>Feature Requirements & Limitations Guide</h2>
          </div>
        </div>

        <div className="feature-rules-grid">
          <div className="rule-card">
            <div className="rule-card-header">
              <Sparkles size={16} className="text-accent" />
              <strong>SponsorBlock</strong>
              <span className="badge-tag">YouTube only</span>
            </div>
            <p className="muted small">
              SponsorBlock is powered by the public community database (<strong>sponsor.ajay.app</strong>),
              which specifically tracks YouTube video IDs. Other sites like Twitch, SoundCloud, or Vimeo
              do not have SponsorBlock segments. The GUI automatically prevents sending SponsorBlock arguments to non-YouTube sites to avoid errors.
            </p>
          </div>

          <div className="rule-card">
            <div className="rule-card-header">
              <Captions size={16} className="text-accent" />
              <strong>Subtitles & Captions</strong>
              <span className="badge-tag">Site-specific</span>
            </div>
            <p className="muted small">
              <strong>Auto-generated speech-to-text captions</strong> are only available on YouTube.
              On platforms like Vimeo or TED, subtitles only exist if the creator uploaded manual CC files.
              Audio-only platforms (SoundCloud, Bandcamp) do not support subtitles. The app automatically converts WebVTT subtitles to SRT for clean MP4 embedding.
            </p>
          </div>

          <div className="rule-card">
            <div className="rule-card-header">
              <Radio size={16} className="text-accent" />
              <strong>Live Stream Rewind</strong>
              <span className="badge-tag">YouTube DASH</span>
            </div>
            <p className="muted small">
              Recording an ongoing live stream from its beginning (<code>--live-from-start</code>)
              requires multi-period DASH manifests with archived segment history. Only YouTube Live currently supports this.
              On platforms like Twitch, recording starts strictly from the current moment you join.
            </p>
          </div>

          <div className="rule-card">
            <div className="rule-card-header">
              <Cookie size={16} className="text-accent" />
              <strong>Cookies & Logged-In Sessions</strong>
              <span className="badge-tag">Settings tab</span>
            </div>
            <p className="muted small">
              Content that is age-restricted, subscriber-only (Twitch), or behind login gates (Instagram, private YouTube videos)
              requires Netscape cookies. You can export cookies from your browser and paste them into <strong>Settings &rarr; Cookies</strong>.
            </p>
          </div>

          <div className="rule-card">
            <div className="rule-card-header">
              <ShieldAlert size={16} style={{ color: 'var(--danger, #ef4444)' }} />
              <strong>DRM Protection</strong>
              <span className="badge-tag" style={{ color: 'var(--danger, #ef4444)' }}>Unsupported</span>
            </div>
            <p className="muted small">
              yt-dlp does not bypass DRM encryption. Commercial subscription services (Netflix, Spotify, Hulu, Disney+, Amazon Prime)
              cannot be downloaded by yt-dlp.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 3: MAJOR SITES COMPATIBILITY MATRIX */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Globe size={18} className="text-accent" />
            <h2>Major Platforms Compatibility Matrix</h2>
          </div>

          <div className="segmented-choice">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={categoryFilter === cat ? 'active' : ''}
                onClick={() => setCategoryFilter(cat)}
                style={{ textTransform: 'capitalize' }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrapper">
          <table className="sites-table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Category</th>
                <th>Video</th>
                <th>Audio</th>
                <th>Subtitles</th>
                <th>SponsorBlock</th>
                <th>Live Streams</th>
                <th>Cookies / Auth</th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.map((site) => (
                <tr key={site.id}>
                  <td>
                    <strong>{site.name}</strong>
                    <div className="muted small">{site.domains[0]}</div>
                  </td>
                  <td>
                    <span className="badge-tag">{site.category}</span>
                  </td>
                  <td>
                    {site.video ? (
                      <span className="cap-status yes"><CheckCircle2 size={13} /> Yes</span>
                    ) : (
                      <span className="cap-status no"><XCircle size={13} /> Audio</span>
                    )}
                  </td>
                  <td>
                    <span className="cap-status yes"><CheckCircle2 size={13} /> Yes</span>
                  </td>
                  <td>
                    {site.subtitles === 'None' ? (
                      <span className="cap-status no"><XCircle size={13} /> None</span>
                    ) : (
                      <span className="cap-status yes"><CheckCircle2 size={13} /> {site.subtitles}</span>
                    )}
                  </td>
                  <td>
                    {site.sponsorblock ? (
                      <span className="cap-status yes"><CheckCircle2 size={13} /> Supported</span>
                    ) : (
                      <span className="cap-status no"><XCircle size={13} /> No</span>
                    )}
                  </td>
                  <td>
                    {site.live ? (
                      <span className="cap-status yes">
                        <CheckCircle2 size={13} /> {site.liveRewind ? 'Live + Rewind' : 'Live Edge'}
                      </span>
                    ) : (
                      <span className="cap-status no"><XCircle size={13} /> No</span>
                    )}
                  </td>
                  <td>
                    <span className="muted small">{site.cookies}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* SECTION 4: FULL EXTRACTORS DIRECTORY SEARCH */}
      <section className="panel">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HelpCircle size={18} className="text-accent" />
            <h2>All Supported Extractors Directory</h2>
            {totalExtractors > 0 && (
              <span className="count-badge accent">{totalExtractors.toLocaleString()} extractors</span>
            )}
          </div>

          <div style={{ position: 'relative', width: 260 }}>
            <input
              type="text"
              placeholder="Search 1,700+ extractors..."
              value={extractorSearch}
              onChange={(e) => setExtractorSearch(e.target.value)}
              style={{ width: '100%', paddingLeft: 30, fontSize: 13 }}
            />
            <Search
              size={13}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
          </div>
        </div>

        <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
          yt-dlp includes native support for over 1,700 domains and video services.
          You can also view the official list on GitHub: {' '}
          <a
            href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'none' }}
          >
            yt-dlp Supported Sites <ExternalLink size={11} style={{ verticalAlign: -1 }} />
          </a>
        </p>

        {loadingExtractors ? (
          <p className="muted small">Searching extractors…</p>
        ) : extractors.length === 0 ? (
          <p className="muted small">No extractors match &quot;{extractorSearch}&quot;.</p>
        ) : (
          <div className="extractors-grid">
            {extractors.map((e) => (
              <div key={e.name} className="extractor-pill" title={e.description}>
                <span className="extractor-name">{e.name}</span>
                {e.description && e.description !== e.name && (
                  <span className="extractor-desc">{e.description}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
