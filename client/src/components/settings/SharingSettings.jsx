import React, { useMemo, useState } from 'react';
import { Bookmark, Check, Copy, ExternalLink } from 'lucide-react';

export default function SharingSettings() {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const bookmarklet = useMemo(() => {
    const appUrl = `${window.location.origin}/`;
    return `javascript:(()=>{location.href=${JSON.stringify(appUrl)}+'?url='+encodeURIComponent(location.href)})()`;
  }, []);

  async function copyBookmarklet() {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setCopyError('Clipboard access is unavailable. Select the code and copy it manually.');
    }
  }

  return (
    <section className="panel sharing-panel">
      <div className="panel-header">
        <h2><Bookmark size={16} /> Browser bookmarklet</h2>
      </div>
      <p className="panel-description">
        Add this bookmark to your browser. While watching a video, select it to open this app and place the link in the download tray for review.
      </p>
      <div className="sharing-steps">
        <ol>
          <li>Copy the bookmarklet below.</li>
          <li>Create a browser bookmark named <strong>Send to yt-dlp GUI</strong>.</li>
          <li>Edit that bookmark and paste the copied text into its URL or address field.</li>
          <li>While on a video page, click the bookmark. Sign in to this app first if asked.</li>
        </ol>
      </div>
      <div className="sharing-bookmarklet-row">
        <textarea aria-label="Bookmarklet code" readOnly value={bookmarklet} rows={3} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn-primary" onClick={copyBookmarklet}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy bookmarklet'}
        </button>
      </div>
      {copyError && <div className="notice notice-warning" role="status">{copyError}</div>}
      <p className="field-hint sharing-note">
        The bookmarklet only opens this app with the current page URL. It does not contain your password or an API key. Your existing sign-in session protects the queue.
      </p>
      <a className="text-link" href="/" target="_blank" rel="noreferrer">Open the app in another tab <ExternalLink size={13} /></a>
    </section>
  );
}
