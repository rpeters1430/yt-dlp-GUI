import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api.js';

const DownloadsContext = createContext(null);

// The server sends every active job plus the newest finished ones, without each job's log
// and command line (they're large). Live socket updates carry those only when they change,
// so keep any we already have when a row is replaced.
function keepLog(job, old) {
  if (!old || job.log !== undefined || old.log === undefined) return job;
  return { ...job, log: old.log, command_args: old.command_args };
}

function mergeList(prev, list) {
  if (!Array.isArray(list)) return prev;
  const byId = new Map(prev.map((j) => [j.id, j]));
  return list.map((job) => keepLog(job, byId.get(job.id)));
}

function applyUpdate(prev, job) {
  const index = prev.findIndex((j) => j.id === job.id);
  if (index === -1) return [job, ...prev];
  const next = prev.slice();
  next[index] = keepLog({ ...prev[index], ...job }, prev[index]);
  return next;
}

function countStatuses(jobs) {
  const counts = { queued: 0, downloading: 0, completed: 0, failed: 0 };
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
  return counts;
}

export function DownloadsProvider({ children, isAuthenticated }) {
  const [jobs, setJobs] = useState([]);
  // False until the first job list arrives, so pages can show a loading state instead of zeros.
  const [loaded, setLoaded] = useState(false);
  // Status counts across the whole history (the job list only holds the recent part of it).
  const [counts, setCounts] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setJobs([]);
      setLoaded(false);
      setCounts(null);
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
    api.getDownloadStats().then(setCounts).catch(() => {});

    // WebSocket connection for real-time updates across all pages. jobs:init is sent again on
    // every (re)connect, so a dropped connection resyncs by itself.
    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('jobs:init', (initialJobs) => applyList(initialJobs || []));
    socket.on('jobs:counts', (next) => { if (next) setCounts(next); });
    socket.on('job:update', (job) => {
      if (!job || !job.id) return;
      setJobs((prev) => applyUpdate(prev, job));
    });
    socket.on('job:removed', ({ id } = {}) => {
      if (id) setJobs((prev) => prev.filter((j) => j.id !== id));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [isAuthenticated]);

  const hasActiveJobs = jobs.some((j) => j.status === 'queued' || j.status === 'downloading');

  // Fallback while the socket is down and jobs are running, so progress doesn't freeze.
  useEffect(() => {
    if (!isAuthenticated || connected || !hasActiveJobs) return undefined;
    const interval = setInterval(() => {
      api.listDownloads().then((list) => setJobs((prev) => mergeList(prev, list))).catch(() => {});
      api.getDownloadStats().then(setCounts).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated, connected, hasActiveJobs]);

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

  const effectiveCounts = useMemo(() => counts || countStatuses(jobs), [counts, jobs]);

  const currentJob = downloadingJobs[0] || activeJobs[0] || null;

  const value = {
    jobs,
    setJobs,
    loaded,
    activeJobs,
    downloadingJobs,
    queuedJobs,
    counts: effectiveCounts,
    completedCount: effectiveCounts.completed || 0,
    failedCount: effectiveCounts.failed || 0,
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
