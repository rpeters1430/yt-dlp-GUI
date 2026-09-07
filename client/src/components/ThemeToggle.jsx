import React, { useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { getEffectiveTheme, setTheme } from '../theme.js';

export default function ThemeToggle() {
  const [theme, setThemeState] = useState(getEffectiveTheme);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  }

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="m3-theme-toggle"
      onClick={toggle}
      role="switch"
      aria-checked={isDark}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="m3-toggle-track">
        <span className="m3-toggle-thumb">
          {isDark ? <Moon size={12} className="thumb-icon" /> : <Sun size={12} className="thumb-icon" />}
        </span>
      </span>
      <span className="m3-toggle-label">{isDark ? 'Dark mode' : 'Light mode'}</span>
    </button>
  );
}
