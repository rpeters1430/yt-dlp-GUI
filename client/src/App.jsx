import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Menu, Download } from 'lucide-react';
import { api, setUnauthorizedHandler } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Sidebar from './components/Sidebar.jsx';
import QueueStatusWidget from './components/QueueStatusWidget.jsx';
import { DownloadsProvider } from './context/DownloadsContext.jsx';

// The dashboard ships in the main bundle; every other page loads when first opened.
const History = lazy(() => import('./pages/History.jsx'));
const Library = lazy(() => import('./pages/Library.jsx'));
const Watches = lazy(() => import('./pages/Watches.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Twitch = lazy(() => import('./pages/Twitch.jsx'));
const Music = lazy(() => import('./pages/Music.jsx'));
const SupportedSites = lazy(() => import('./pages/SupportedSites.jsx'));

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    api.me().then((u) => setUser(u)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser((prev) => {
        if (prev) setSessionExpired(true); // only flag as "expired" if we were actually logged in
        return null;
      });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  if (user === undefined) {
    return (
      <div className="center-screen">
        <div className="loading-screen">
          <div className="spinner" />
          Loading…
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <Login
        onLogin={(u) => {
          setSessionExpired(false);
          setUser(u);
        }}
        sessionExpired={sessionExpired}
      />
    );
  }

  function handleLogout() {
    api.logout().then(() => setUser(null));
  }

  return (
    <DownloadsProvider isAuthenticated={Boolean(user)}>
      <div className="app-shell">
        <Sidebar
          open={sidebarOpen}
          onNavigate={() => setSidebarOpen(false)}
          onLogout={handleLogout}
          username={user.username}
        />
        <div className={`sidebar-backdrop${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />

        <div className="main-area">
          <div className="topbar">
            <button
              type="button"
              className="icon-btn-neutral sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <div className="brand">
              <Download size={15} style={{ marginRight: 6, verticalAlign: -2 }} />
              yt-dlp GUI
            </div>
            <div className="topbar-right">
              <QueueStatusWidget />
            </div>
          </div>

          <main className="content">
            <Suspense fallback={<div className="empty-state"><div className="spinner" /></div>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/music" element={<Music />} />
                <Route path="/twitch" element={<Twitch />} />
                <Route path="/library" element={<Library />} />
                <Route path="/history" element={<History />} />
                <Route path="/watches" element={<Watches />} />
                <Route path="/sites" element={<SupportedSites />} />
                <Route path="/supported-sites" element={<SupportedSites />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </DownloadsProvider>
  );
}
