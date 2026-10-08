import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api.js';

const DownloadsContext = createContext(null);

// The job list from the server leaves out each job's log and command line (they're large);
// live socket updates still carry them, so keep any we already have when the list refreshes.
function mergeList(prev, list) {
  if (!Array.isArray(list)) return prev;
  const byId = new Map(prev.map((j) => [j.id, j]));
  return list.map((job) => {
    const old = byId.get(job.id);
    if (!old || job.log !== undefined || old.log === undefined) return job;
    return { ...job, log: old.log, command_args: old.command_args };
  });
}

export function DownloadsProvider({ children, isAuthenticated }) {
  const [jobs, setJobs] = useState([]);
  // False until the first job list arrives, so pages can show a loading state instead of zeros.
  const [loaded, setLoaded] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setJobs([]);
      setLoaded(false);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const applyList = (list) => {
      setJobs((prev) => mergeList(prev, list));
      setLoaded(true);
    };

    // Initial fetch; the socket's jobs:init carries the same list, so whichever lands first wins.
    api.listDownloads().then(applyList).catch(() => {});

    // WebSocket connection for real-time updates across all pages
    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('jobs:init', (initialJobs) => applyList(initialJobs || []));
    socket.on('job:update', (job) => {
      if (!job || !job.id) return;
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
      api.listDownloads().then((list) => setJobs((prev) => mergeList(prev, list))).catch(() => {});
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
    loaded,
    activeJobs,
    downloadingJobs,
    queuedJobs,
    completedCount,
    failedCount,
    currentJob,
    hasActive: activeJobs.length > 0,
    isDownloading: downloadingJobs.length > 0,
    refreshJobs: () => api.listDownloads().then((list) => setJobs((prev) => mergeList(prev, list))).catch(() => {}),
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
