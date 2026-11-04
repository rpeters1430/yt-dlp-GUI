import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export default function WatchMenu({ watch, plexConfigured, onActivity, onVideos, onEdit, onSyncJellyfin, onSyncPlex, onToggleCleanup, onReset, onDelete, busy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  // Render outside the overflow-hidden card, then fit the menu to the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const anchor = ref.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const gap = 8;
    menu.style.maxWidth = `${Math.max(0, width - gap * 2)}px`;
    const below = Math.max(0, top + height - anchor.bottom - gap * 2);
    const above = Math.max(0, anchor.top - top - gap * 2);
    const opensBelow = menu.scrollHeight <= below || below >= above;
    menu.style.maxHeight = `${opensBelow ? below : above}px`;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(left + gap, Math.min(anchor.right - bounds.width, left + width - bounds.width - gap))}px`;
    menu.style.top = `${opensBelow ? anchor.bottom + gap : anchor.top - gap - bounds.height}px`;
    menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Tab') {
        setOpen(false);
        ref.current?.querySelector('button')?.focus();
        if (e.key === 'Escape') e.preventDefault();
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const items = [...menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
        const current = items.indexOf(document.activeElement);
        const index = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
          : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      }
    }
    function onScroll(e) {
      if (!menuRef.current?.contains(e.target)) setOpen(false);
    }
    function onResize() { setOpen(false); }
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function run(fn) {
    setOpen(false);
    ref.current?.querySelector('button')?.focus();
    fn();
  }

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-plain" onClick={() => setOpen((v) => !v)} aria-label="More actions" aria-expanded={open} aria-haspopup="menu" aria-controls={open ? menuId : undefined}>
        <MoreHorizontal size={18} />
      </button>
      {open && createPortal(
        <div className="menu-pop watch-menu-pop" role="menu" id={menuId} ref={menuRef} aria-label="Watch actions">
          {onVideos && <button type="button" role="menuitem" tabIndex={-1} onClick={() => run(onVideos)}>Playlist videos</button>}
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => run(onActivity)}>Activity</button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => run(onEdit)}>Edit settings</button>
          <a role="menuitem" tabIndex={-1} href={watch.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Open on YouTube</a>
          <button type="button" role="menuitem" tabIndex={-1} disabled={busy || !watch.completed_count} onClick={() => run(onSyncJellyfin)}>Sync to Jellyfin</button>
          {plexConfigured && (
            <button type="button" role="menuitem" tabIndex={-1} disabled={busy || !watch.completed_count} onClick={() => run(onSyncPlex)}>Sync to Plex</button>
          )}
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => run(onToggleCleanup)}>
            {watch.cleanup_exempt ? 'Allow auto-delete' : 'Keep forever (skip auto-delete)'}
          </button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => run(onReset)}>Reset history</button>
          <button type="button" role="menuitem" tabIndex={-1} className="danger" onClick={() => run(onDelete)}>Remove watch</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
