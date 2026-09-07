import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import History from './pages/History.jsx';
import Watches from './pages/Watches.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out

  useEffect(() => {
    api.me().then((u) => setUser(u)).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="center-screen">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app-shell">
      <nav className="topnav">
        <div className="brand">yt-dlp GUI</div>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/history">History</NavLink>
        <NavLink to="/watches">Watches</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <button className="logout-btn" onClick={() => api.logout().then(() => setUser(null))}>Log out</button>
      </nav>
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
  );
}
