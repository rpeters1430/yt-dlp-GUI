import React, { useState } from 'react';
import { Sun, Moon, Sparkles } from 'lucide-react';
import { getEffectiveTheme, setTheme } from '../theme.js';

export default function ThemeToggle() {
  const [theme, setThemeState] = useState(getEffectiveTheme);

  function toggle() {
    let next;
    if (theme === 'light') next = 'dark';
    else if (theme === 'dark') next = 'midnight';
    else next = 'light';
    setTheme(next);
    setThemeState(next);
  }

  const icon = theme === 'light' ? <Moon size={14} /> : theme === 'dark' ? <Sparkles size={14} /> : <Sun size={14} />;
  const label = theme === 'light' ? 'Dark' : theme === 'dark' ? 'OLED' : 'Light';
  const title = theme === 'light' ? 'Switch to Dark Mode' : theme === 'dark' ? 'Switch to Midnight OLED' : 'Switch to Light Mode';

  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={toggle}
      title={title}
    >
      {icon}
      {label}
    </button>
  );
}
