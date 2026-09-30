import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, History, Radar, Settings, LogOut, Download, Tv, Music, Globe, Library } from 'lucide-react';
import ThemeToggle from './ThemeToggle.jsx';
import DensityToggle from './DensityToggle.jsx';

const LINKS = [
  { to: '/', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/music', label: 'Music', icon: Music },
  { to: '/twitch', label: 'Twitch', icon: Tv },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/history', label: 'History', icon: History },
  { to: '/watches', label: 'Watches', icon: Radar },
  { to: '/sites', label: 'Supported Sites', icon: Globe },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ open, onNavigate, onLogout, username }) {
  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="brand">
        <span className="brand-mark"><Download size={16} /></span>
        yt-dlp GUI
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {LINKS.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            onClick={onNavigate}
          >
            <span className="nav-icon-wrap">
              <Icon size={16} />
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {username && (
          <div className="sidebar-user-pill">
            <span className="user-avatar">{username.charAt(0).toUpperCase()}</span>
            <span className="user-name" title={username}>{username}</span>
          </div>
        )}
        <div className="sidebar-footer-toggles">
          <ThemeToggle />
          <DensityToggle />
        </div>
        <button type="button" className="btn-ghost btn-sm btn-logout" onClick={onLogout} title={username ? `Signed in as ${username}` : undefined}>
          <LogOut size={14} />
          Log out
        </button>
      </div>
    </aside>
  );
}
