import React from 'react';
import { X } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y.js';

// Right-side panel over a backdrop (full width on phones). Closes with ×, Escape or a
// backdrop click. `header` sits flush at the top (e.g. a thumbnail); `footer` is pinned.
export default function Drawer({ open, onClose, label, header = null, footer = null, children }) {
  const ref = useModalA11y(open, onClose);
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        <div className="drawer-scroll">
          {header}
          <div className="drawer-body">{children}</div>
        </div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </div>
  );
}
