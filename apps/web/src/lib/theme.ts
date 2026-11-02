import { useEffect, useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

// Same key as public/theme-init.js, which applies the saved theme before the page first paints.
const KEY = 'dp-theme';
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** The person's choice on this device: follow the phone ("system"), or always light / dark. */
export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => 'system' as const,
  );
  const set = (p: ThemePreference) => {
    try {
      if (p === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
    for (const l of listeners) l();
  };
  return [pref, set];
}

/**
 * Applies data-theme on <html>. Pass a fixed theme to force it (staff screens); otherwise the
 * saved preference applies, and "system" follows the phone's setting live (riders at night).
 */
export function useTheme(forced?: 'light' | 'dark') {
  const [pref] = useThemePreference();
  const preference: ThemePreference = forced ?? pref;
  useEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const set = (theme: 'light' | 'dark') => {
      root.dataset.theme = theme;
      // Browser bars match the page.
      meta?.setAttribute('content', theme === 'dark' ? '#0b1120' : '#f8fafc');
    };
    if (preference !== 'system') {
      set(preference);
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => set(mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [preference]);
}
