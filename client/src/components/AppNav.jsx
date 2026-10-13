import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, Music, Tv, Library, History, Radar, Globe, Settings, MoreHorizontal } from 'lucide-react';
import { useDownloads } from '../context/DownloadsContext.jsx';

const LINKS = [
  { to: '/', end: true, label: 'Home', icon: Home, badge: 'active' },
  { to: '/music', label: 'Music', icon: Music },
  { to: '/twitch', label: 'Twitch', icon: Tv },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/history', label: 'History', icon: History, badge: 'failed' },
  { to: '/watches', label: 'Watches', icon: Radar },
  { to: '/sites', label: 'Sites', icon: Globe },
  { to: '/settings', label: 'Settings', icon: Settings },
];

// Phones show four tabs plus "More", which lists the rest.
const TAB_PATHS = ['/', '/music', '/library', '/history'];

function useBadges() {
  const { activeJobs, failedCount } = useDownloads();
  return { active: activeJobs.length, failed: failedCount };
}

function Badge({ count }) {
  if (!count) return null;
  return <span className="rail-badge">{count > 99 ? '99+' : count}</span>;
}

// Slim icon rail on desktop; TabBar below replaces it on phones (CSS picks which one shows).
export default function AppNav({ username }) {
  const badges = useBadges();
  return (
    <nav className="rail" aria-label="Main">
      <NavLink to="/" className="rail-logo" aria-label="yt-dlp GUI home">yt</NavLink>
      {LINKS.map(({ to, end, label, icon: Icon, badge }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
          <Icon size={18} strokeWidth={2} />
          <span>{label}</span>
          {badge && <Badge count={badges[badge]} />}
        </NavLink>
      ))}
      <div className="rail-spacer" />
      {username && (
        <NavLink to="/settings?section=account" className="rail-avatar" title={`Signed in as ${username}`}>
          {username.charAt(0).toUpperCase()}
        </NavLink>
      )}
    </nav>
  );
}

export function TabBar() {
  const badges = useBadges();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = LINKS.filter((l) => TAB_PATHS.includes(l.to));
  const moreLinks = LINKS.filter((l) => !TAB_PATHS.includes(l.to));
  const moreActive = moreLinks.some((l) => location.pathname.startsWith(l.to));

  return (
    <>
      {moreOpen && (
        <>
          <div className="tabbar-more-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="tabbar-more-sheet" role="menu">
            {moreLinks.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} role="menuitem" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMoreOpen(false)}>
                <Icon size={18} /> {label}
              </NavLink>
            ))}
          </div>
        </>
      )}
      <nav className="tabbar" aria-label="Main">
        {tabs.map(({ to, end, label, icon: Icon, badge }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `tabbar-item${isActive ? ' active' : ''}`} onClick={() => setMoreOpen(false)}>
            <Icon size={20} />
            <span>{label}</span>
            {badge && <Badge count={badges[badge]} />}
          </NavLink>
        ))}
        <button
          type="button"
          className={`tabbar-item${moreActive || moreOpen ? ' active' : ''}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
        >
          <MoreHorizontal size={20} />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
