import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
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
    <>
      <div className="page-title-row">
        <h1>Supported sites</h1>
      </div>

      <section className="panel site-check">
        <h2 className="panel-title">Check a link or site</h2>
        <div className="site-check-input">
          <input
            className="mono"
            type="text"
            placeholder="twitch.tv/riotgames, soundcloud, a full link…"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            aria-label="Link or site name"
          />
          {testUrl && <button type="button" className="text-btn" onClick={() => setTestUrl('')}>Clear</button>}
        </div>
        {checkedPlatform ? (
          <>
            <div className="site-check-result">
              <strong className="site-check-name">{checkedPlatform.name}</strong>
              {capabilityPills(checkedPlatform).map((c) => (
                <span key={c.label} className={`cap-pill cap-${c.tone}`}>{c.label}: {c.value}</span>
              ))}
            </div>
            <p className="site-check-note">{checkedPlatform.notes}</p>
          </>
        ) : testUrl.trim() ? (
          <p className="site-check-note">
            Not one of the major platforms below. Paste a full link (https://…) to check it with yt-dlp&apos;s generic rules, or search the extractor directory.
          </p>
        ) : null}
      </section>

      <section>
        <div className="section-head">
          <h2>Major platforms</h2>
          {categories.length > 2 && (
            <div className="chip-row section-head-actions">
              {categories.map((cat) => (
                <button key={cat} type="button" className={`chip${categoryFilter === cat ? ' active' : ''}`} onClick={() => setCategoryFilter(cat)}>
                  {cat === 'all' ? 'All' : cat}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="table-wrapper platform-table-wrap">
          <table className="platform-table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Video</th>
                <th>Audio</th>
                <th>Live</th>
                <th>Subs</th>
                <th>SponsorBlock</th>
                <th>Cookies</th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">{loadingGuide ? 'Loading site guide…' : 'Could not load the site guide.'}</td>
                </tr>
              )}
              {filteredSites.map((site) => {
                const caps = Object.fromEntries(capabilityPills(site).map((c) => [c.label, c]));
                return (
                  <tr key={site.id}>
                    <td>
                      <div className="platform-name">{site.name}</div>
                      <div className="mono-meta">{site.domains[0]}</div>
                    </td>
                    {['Video', 'Audio', 'Live', 'Subtitles', 'SponsorBlock', 'Cookies'].map((k) => (
                      <td key={k} className={`mono cap-cell cap-text-${caps[k].tone}`} title={k === 'Cookies' ? site.cookies : undefined}>
                        {caps[k].tone === 'off' && k !== 'Cookies' ? '—' : caps[k].value}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="section-head"><h2>How features differ by site</h2></div>
        <div className="rule-rows">
          <div className="rule-row">
            <div className="rule-row-title">SponsorBlock <span className="cap-pill cap-partial">YouTube only</span></div>
            <p>The community SponsorBlock database only tracks YouTube video IDs, so the app never sends SponsorBlock options to other sites.</p>
          </div>
          <div className="rule-row">
            <div className="rule-row-title">Subtitles <span className="cap-pill cap-partial">site-specific</span></div>
            <p>Auto-generated captions exist only on YouTube. Elsewhere subtitles exist only if the uploader added them; audio sites have none. WebVTT is converted to SRT so it embeds cleanly in MP4.</p>
          </div>
          <div className="rule-row">
            <div className="rule-row-title">Recording live from the start <span className="cap-pill cap-partial">site-specific</span></div>
            <p>
              Needs the site to expose the stream&apos;s history. Your installed yt-dlp supports it for{' '}
              <strong>{guideData?.liveFromStartSites?.join(', ') || 'YouTube'}</strong>. Everywhere else, recording starts when you join.
            </p>
          </div>
          <div className="rule-row">
            <div className="rule-row-title">Cookies <span className="cap-pill cap-off">Settings › Cookies</span></div>
            <p>Age-restricted, members-only and login-gated videos need browser cookies. Export a cookies.txt and paste it in <Link to="/settings?section=cookies">Settings › Cookies</Link>.</p>
          </div>
          <div className="rule-row">
            <div className="rule-row-title">DRM <span className="cap-pill cap-danger">unsupported</span></div>
            <p>yt-dlp does not bypass DRM, so Netflix, Spotify, Hulu, Disney+ and Prime Video can&apos;t be downloaded.</p>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>All extractors</h2>
          <span className="mono-meta">{totalExtractors > 0 ? `${totalExtractors.toLocaleString()} ${extractorSearch ? 'match' : 'total'}` : ''}</span>
          <a className="text-btn section-head-actions" href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md" target="_blank" rel="noopener noreferrer">
            Official list
          </a>
        </div>
        <input
          className="toolbar-search extractor-search"
          type="text"
          placeholder="Search 1,700+ extractors"
          value={extractorSearch}
          onChange={(e) => setExtractorSearch(e.target.value)}
          aria-label="Search extractors"
        />
        {loadingExtractors ? (
          <p className="empty-line">Searching extractors…</p>
        ) : extractors.length === 0 ? (
          <p className="empty-line">
            {extractorSearch ? <>No extractors match &quot;{extractorSearch}&quot;.</> : "Couldn't load the extractor list from yt-dlp."}
          </p>
        ) : (
          <div className="extractor-grid">
            {extractors.map((e) => (
              <div key={e.name} className="extractor-item" title={e.description}>
                <span className="mono">{e.name}</span>
                {e.description && e.description !== e.name && <span className="extractor-item-desc">{e.description}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// Capability pills for a guide site: tone 'yes' (green), 'partial' (amber), 'off' (grey).
function capabilityPills(site) {
  const subs = site.subtitles || 'None';
  const cookies = String(site.cookies || '');
  let cookieValue = 'not needed';
  let cookieTone = 'off';
  if (/^required/i.test(cookies)) { cookieValue = 'required'; cookieTone = 'partial'; }
  else if (/^recommended/i.test(cookies)) { cookieValue = 'recommended'; cookieTone = 'partial'; }
  else if (/^optional/i.test(cookies)) { cookieValue = 'sometimes'; cookieTone = 'partial'; }
  else if (cookies && !/^not needed/i.test(cookies)) { cookieValue = cookies.toLowerCase(); cookieTone = 'partial'; }
  return [
    { label: 'Video', value: site.video ? 'Yes' : 'audio only', tone: site.video ? 'yes' : 'off' },
    { label: 'Audio', value: 'Yes', tone: 'yes' },
    { label: 'Live', value: site.live ? (site.liveRewind ? 'from start' : 'Yes') : 'No', tone: site.live ? 'yes' : 'off' },
    { label: 'Subtitles', value: subs === 'None' ? 'None' : /^manual & auto/i.test(subs) ? 'Yes' : subs.toLowerCase(), tone: subs === 'None' ? 'off' : /^manual & auto/i.test(subs) ? 'yes' : 'partial' },
    { label: 'SponsorBlock', value: site.sponsorblock ? 'Yes' : 'No', tone: site.sponsorblock ? 'yes' : 'off' },
    { label: 'Cookies', value: cookieValue, tone: cookieTone },
  ];
}
