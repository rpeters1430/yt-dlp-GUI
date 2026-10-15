import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AppNav, { TabBar } from './components/AppNav.jsx';
import { DownloadsProvider } from './context/DownloadsContext.jsx';
import { StagingProvider } from './context/StagingContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';

// Home ships in the main bundle; every other page loads when first opened.
const History = lazy(() => import('./pages/History.jsx'));
const Library = lazy(() => import('./pages/Library.jsx'));
const Watches = lazy(() => import('./pages/Watches.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Twitch = lazy(() => import('./pages/Twitch.jsx'));
const Music = lazy(() => import('./pages/Music.jsx'));
const SupportedSites = lazy(() => import('./pages/SupportedSites.jsx'));

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// Pasting a link anywhere outside a text field jumps to Home and analyzes it.
function useGlobalPaste() {
  const navigate = useNavigate();
  useEffect(() => {
    function onPaste(e) {
      if (isEditable(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const text = e.clipboardData?.getData('text') || '';
      if (!/\S+\.\S+/.test(text)) return;
      e.preventDefault();
      navigate('/', { state: { paste: text, nonce: Date.now() } });
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [navigate]);
}

function Shell({ user }) {
  useGlobalPaste();
  return (
    <div className="app-shell">
      <AppNav username={user.username} />
      <div className="main-area">
        <div className="main-scroll" id="main-scroll">
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
                <Route path="/settings" element={<Settings username={user.username} onLogout={user.onLogout} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
        <TabBar />
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
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
      <ToastProvider>
        <StagingProvider>
          <Shell user={{ ...user, onLogout: handleLogout }} />
        </StagingProvider>
      </ToastProvider>
    </DownloadsProvider>
  );
}
