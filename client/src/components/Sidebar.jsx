import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, History, Radar, Settings, LogOut, Download, Tv } from 'lucide-react';
import ThemeToggle from './ThemeToggle.jsx';

const LINKS = [
  { to: '/', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/twitch', label: 'Twitch', icon: Tv },
  { to: '/history', label: 'History', icon: History },
  { to: '/watches', label: 'Watches', icon: Radar },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ open, onNavigate, onLogout, username }) {
  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="brand">
        <span className="brand-mark"><Download size={16} /></span>
        yt-dlp GUI
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {LINKS.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            onClick={onNavigate}
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <ThemeToggle />
        <button type="button" className="btn-ghost btn-sm" onClick={onLogout} title={username ? `Signed in as ${username}` : undefined}>
          <LogOut size={15} />
          Log out
        </button>
      </div>
    </aside>
  );
}
