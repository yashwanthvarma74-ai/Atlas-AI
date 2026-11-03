'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// Light, dark and high contrast are switched by one attribute on <html>. The design system's tokens
// define the colours for each value of data-theme, so changing it repaints the page and re-renders
// nothing. The design system's own ThemeProvider does the same job under the same storage key; it is
// written out here because the package does not export it on its own, and importing the package root
// would pull every component into the first load (see ADR 0002).
export type ThemeName = 'light' | 'dark' | 'high-contrast';
export type ThemePreference = ThemeName | 'system';

const STORAGE_KEY = 'meridian-theme';
const THEMES: ThemeName[] = ['light', 'dark', 'high-contrast'];

interface ThemeValue {
  preference: ThemePreference;
  setTheme: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function systemTheme(): ThemeName {
  if (window.matchMedia('(prefers-contrast: more)').matches) return 'high-contrast';
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function stored(): ThemePreference | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'system' || THEMES.includes(value as ThemeName)
      ? (value as ThemePreference)
      : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>('system');
  // follows the system setting while the preference is "system"
  const [system, setSystem] = useState<ThemeName>('light');

  useEffect(() => {
    const saved = stored();
    if (saved) setPreference(saved);
    setSystem(systemTheme());
    const queries = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)'].map((query) =>
      window.matchMedia(query),
    );
    const onChange = () => setSystem(systemTheme());
    queries.forEach((query) => query.addEventListener?.('change', onChange));
    return () => queries.forEach((query) => query.removeEventListener?.('change', onChange));
  }, []);

  const theme = preference === 'system' ? system : preference;
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage can be blocked; the choice then lasts until the page is closed
    }
  }, []);

  const value = useMemo(() => ({ preference, setTheme }), [preference, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return value;
}

// Runs in <head> before the first paint, so a saved dark or high contrast choice never flashes light.
export function getThemeInitScript(): string {
  return `(function(){try{var s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var m=window.matchMedia;var t=s&&s!=="system"?s:(m("(prefers-contrast: more)").matches?"high-contrast":m("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;
}
