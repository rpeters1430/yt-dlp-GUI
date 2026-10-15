import React from 'react';
import { Globe, FileText, Cpu, Database, Film, Captions, Image, ListVideo, KeyRound, Link2, Sparkles, Search, Check } from 'lucide-react';
import { siteName } from '../../format.js';

// Turns a yt-dlp status line into something readable. Order matters: the first match wins.
const STAGES = [
  { test: /^Reading formats|^Using metadata/i, icon: Sparkles, label: 'Finishing up' },
  { test: /^Resolving link/i, icon: Link2, label: 'Resolving the link' },
  { test: /^Extracting URL/i, icon: Globe, label: 'Recognizing the site' },
  { test: /login|cookie|auth|token/i, icon: KeyRound, label: 'Checking sign-in' },
  { test: /player|challenge|\bjs\b|signature|nsig|n param/i, icon: Cpu, label: 'Solving the player challenge' },
  { test: /^Extracting information/i, icon: Search, label: 'Reading video details' },
  { test: /m3u8|mpd|manifest|\bformats?\b/i, icon: Film, label: 'Listing video formats' },
  { test: /subtitle|caption/i, icon: Captions, label: 'Checking subtitles' },
  { test: /thumbnail/i, icon: Image, label: 'Fetching thumbnails' },
  { test: /playlist|page \d+|\btab\b|entries/i, icon: ListVideo, label: 'Reading the playlist' },
  { test: /api|json|graphql|gql|client config|initial data|metadata/i, icon: Database, label: "Asking the site's API" },
  { test: /webpage|html/i, icon: FileText, label: 'Reading the page' },
];

function describe(step) {
  const match = STAGES.find((s) => s.test.test(step.message));
  return match ? { icon: match.icon, label: match.label } : { icon: Search, label: step.message };
}

// The site yt-dlp has matched the link to, once it has said so.
function detectedSite(steps) {
  const step = steps.find((s) => s.source && !['app', 'info', 'generic'].includes(s.source));
  return step ? siteName(step.source) : '';
}

// Shown in place of the thumbnail while a link is being analyzed: a scanning frame with the
// icon for what yt-dlp is doing right now.
export function AnalyzeArt({ steps = [] }) {
  const current = steps[steps.length - 1];
  const { icon: Icon } = current ? describe(current) : { icon: Search };
  return (
    <div className="analyze-art" aria-hidden="true">
      <div className="analyze-scan" />
      <div className="analyze-orbit" />
      <div className="analyze-icon" key={current ? current.at : 'start'}>
        <Icon size={26} strokeWidth={1.75} />
      </div>
    </div>
  );
}

// The live step list under the link: finished steps get a check, the current one pulses.
export default function AnalyzeSteps({ steps = [] }) {
  const site = detectedSite(steps);
  // Collapse runs of the same friendly label ("Asking the site's API" × 4) into one row.
  const rows = [];
  for (const step of steps) {
    const { icon, label } = describe(step);
    const last = rows[rows.length - 1];
    if (last && last.label === label) {
      last.count++;
      last.detail = step.message;
    } else {
      rows.push({ key: `${step.at}-${rows.length}`, icon, label, detail: step.message, count: 1 });
    }
  }
  const visible = rows.slice(-4);

  return (
    <div className="analyze-steps" role="status" aria-live="polite">
      <div className="analyze-head">
        <span className="analyze-dot" />
        Analyzing{site ? ` · ${site}` : '…'}
      </div>
      {visible.length === 0 ? (
        <div className="analyze-step current"><Search size={13} /> <span>Starting yt-dlp</span></div>
      ) : (
        <ul>
          {visible.map((row, i) => {
            const isCurrent = i === visible.length - 1;
            const Icon = isCurrent ? row.icon : Check;
            return (
              <li key={row.key} className={`analyze-step${isCurrent ? ' current' : ' done'}`}>
                <Icon size={13} />
                <span>{row.label}{row.count > 1 ? ` ×${row.count}` : ''}</span>
                {isCurrent && row.detail !== row.label && <span className="analyze-detail mono">{row.detail}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
