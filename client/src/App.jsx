import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Menu, Download } from 'lucide-react';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import History from './pages/History.jsx';
import Watches from './pages/Watches.jsx';
import Settings from './pages/Settings.jsx';
import Sidebar from './components/Sidebar.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    api.me().then((u) => setUser(u)).catch(() => setUser(null));
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
  if (!user) return <Login onLogin={setUser} />;

  function handleLogout() {
    api.logout().then(() => setUser(null));
  }

  return (
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
          <button type="button" className="icon-btn-neutral" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="brand">
            <Download size={15} style={{ marginRight: 6, verticalAlign: -2 }} />
            yt-dlp GUI
          </div>
        </div>

        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/history" element={<History />} />
            <Route path="/watches" element={<Watches />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
