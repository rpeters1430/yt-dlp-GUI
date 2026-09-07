import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y.js';

// Styled stand-in for window.confirm(), used consistently across the app instead of the
// native dialog (which looks and behaves differently per-browser and can't be styled).
export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  danger = true,
  onConfirm,
  onCancel,
}) {
  const containerRef = useModalA11y(open, onCancel);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={containerRef}
        className="modal-container"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <AlertTriangle size={18} className="text-accent" />
            <span>{title}</span>
          </div>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className={danger ? 'btn-danger' : ''} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
