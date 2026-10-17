import React from 'react';
import { History, Trash2, X } from 'lucide-react';
import { relativeTime } from '../../format.js';

const STATUS_LABELS = { running: 'Crawling…', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };

// The stored crawls, newest first. Opening one shows its links again with today's "new" flags.
export default function RecentCrawls({ crawls, activeId, onOpen, onCancel, onDelete }) {
  if (!crawls.length) return null;
  return (
    <section className="panel">
      <div className="panel-header">
        <h2><History size={16} /> Recent crawls</h2>
      </div>
      <ul className="lg-cards">
        {crawls.map((c) => (
          <li key={c.id} className="lg-card" aria-current={c.id === activeId ? 'true' : undefined}>
            <button type="button" className="lg-card-open lg-card-main" onClick={() => onOpen(c.id)} disabled={c.status === 'running'}>
              <span className="lg-card-title">{c.threadTitle || c.url}</span>
              <span className="muted small">
                {STATUS_LABELS[c.status] || c.status}
                {c.status === 'running' && c.progress ? ` page ${c.progress.pagesDone}/${c.progress.pagesPlanned} · ${c.progress.links} links` : ''}
                {c.status !== 'running' && c.status !== 'failed' ? ` · ${c.linkCount} link${c.linkCount === 1 ? '' : 's'}, ${c.newCount} new at the time` : ''}
                {c.watchId ? ' · thread watch' : ''}
                {' · '}{relativeTime(c.createdAt)}
              </span>
              {c.status === 'failed' && c.error && <span className="small lg-error">{c.error}</span>}
            </button>
            <span className="lg-card-actions">
              {c.status === 'running' ? (
                <button type="button" className="btn-ghost small" onClick={() => onCancel(c.id)}><X size={14} /> Cancel</button>
              ) : (
                <button type="button" className="btn-ghost small" onClick={() => onDelete(c.id)} aria-label="Remove this crawl">
                  <Trash2 size={14} />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
