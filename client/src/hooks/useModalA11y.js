import { useEffect, useRef } from 'react';

// Minimal modal accessibility: Escape closes it, and focus moves into the dialog on open
// and returns to whatever triggered it on close, instead of staying wherever it was
// (typically the button that opened the modal, invisible behind the backdrop).
export function useModalA11y(active, onClose) {
  const containerRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    previouslyFocused.current = document.activeElement;
    containerRef.current?.focus();

    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused.current && previouslyFocused.current.focus) {
        previouslyFocused.current.focus();
      }
    };
  }, [active, onClose]);

  return containerRef;
}
