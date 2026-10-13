import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { api } from '../api.js';

// The "$ yt-dlp …" command plus the log lines of one download. Job lists arrive without
// logs, so it's fetched on open; live socket updates carry job.log, which takes over.
export default function JobLog({ job }) {
  const [fetched, setFetched] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const preRef = useRef(null);
  const inline = job.log !== undefined;

  useEffect(() => {
    if (inline) return undefined;
    let cancelled = false;
    setFetched(null);
    api.getDownloadLog(job.id)
      .then((row) => { if (!cancelled) setFetched(row); })
      .catch((err) => { if (!cancelled) setFetched({ error: err.message || 'Failed to load log.' }); });
    return () => { cancelled = true; };
  }, [inline, job.id, attempt]);

  const log = inline ? job.log : fetched?.log;
  const command = inline ? job.command_args : fetched?.command_args;
  const loading = !inline && !fetched;
  const error = !inline && fetched?.error;

  useEffect(() => {
    if (preRef.current && job.status === 'downloading') preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [log, job.status]);

  function copy() {
    const text = `${command ? `$ ${command}\n` : ''}${log || ''}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => {});
  }

  return (
    <div className="log-box">
      <button type="button" className="log-copy" onClick={copy} disabled={loading || !!error} aria-label="Copy command and log">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {error ? (
        <div className="log-error">
          {error} <button type="button" className="btn-link" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
      ) : (
        <pre ref={preRef}>
          {command && <span className="log-cmd">$ {command}{'\n'}</span>}
          {loading ? 'Loading log…' : (log || 'No log output recorded yet.')}
        </pre>
      )}
    </div>
  );
}
