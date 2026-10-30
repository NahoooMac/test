import { useEffect } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

/** Applies data-theme on <html>. "system" follows the OS setting and updates live (rider night use). */
export function useTheme(preference: ThemePreference = 'system') {
  useEffect(() => {
    const root = document.documentElement;
    if (preference !== 'system') {
      root.dataset.theme = preference;
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => (root.dataset.theme = mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [preference]);
}
