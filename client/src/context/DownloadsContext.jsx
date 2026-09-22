import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api.js';

const DownloadsContext = createContext(null);

export function DownloadsProvider({ children, isAuthenticated }) {
  const [jobs, setJobs] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setJobs([]);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Initial fetch
    api.listDownloads().then(setJobs).catch(() => {});

    // WebSocket connection for real-time updates across all pages
    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('jobs:init', (initialJobs) => setJobs(initialJobs || []));
    socket.on('job:update', (job) => {
      setJobs((prev) => {
        const exists = prev.some((j) => j.id === job.id);
        if (exists) return prev.map((j) => (j.id === job.id ? job : j));
        return [job, ...prev];
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated]);

  // Polling fallback while active jobs exist to prevent stalls if socket disconnects
  useEffect(() => {
    if (!isAuthenticated) return;
    const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'downloading');
    if (!hasActive) return;

    const interval = setInterval(() => {
      api.listDownloads().then(setJobs).catch(() => {});
    }, 2000);

    return () => clearInterval(interval);
  }, [jobs, isAuthenticated]);

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === 'queued' || j.status === 'downloading'),
    [jobs]
  );
  const downloadingJobs = useMemo(
    () => jobs.filter((j) => j.status === 'downloading'),
    [jobs]
  );
  const queuedJobs = useMemo(
    () => jobs.filter((j) => j.status === 'queued'),
    [jobs]
  );

  const completedCount = useMemo(
    () => jobs.filter((j) => j.status === 'completed').length,
    [jobs]
  );
  const failedCount = useMemo(
    () => jobs.filter((j) => j.status === 'failed').length,
    [jobs]
  );

  const currentJob = downloadingJobs[0] || activeJobs[0] || null;

  const value = {
    jobs,
    setJobs,
    activeJobs,
    downloadingJobs,
    queuedJobs,
    completedCount,
    failedCount,
    currentJob,
    hasActive: activeJobs.length > 0,
    isDownloading: downloadingJobs.length > 0,
    refreshJobs: () => api.listDownloads().then(setJobs).catch(() => {}),
  };

  return (
    <DownloadsContext.Provider value={value}>
      {children}
    </DownloadsContext.Provider>
  );
}

export function useDownloads() {
  const ctx = useContext(DownloadsContext);
  if (!ctx) {
    throw new Error('useDownloads must be used within a DownloadsProvider');
  }
  return ctx;
}
