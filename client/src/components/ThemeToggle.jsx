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

  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
