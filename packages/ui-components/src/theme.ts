import { useCallback, useEffect, useState } from 'react';

/**
 * Theme resolution.
 *
 * The user picks light, dark, or "match system". Whatever they pick, this hook
 * writes a concrete `light` or `dark` onto `<html data-theme>`, so the CSS only
 * ever needs two palettes and never a `prefers-color-scheme` duplicate that
 * could drift from the explicit one.
 *
 * "Match system" stays live: if the OS flips at sunset, so does the desktop.
 */

export const THEME_PREFERENCES = ['light', 'dark', 'auto'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sairios.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStored(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'auto';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
}

function systemTheme(): ResolvedTheme {
  if (typeof matchMedia !== 'function') return 'light';
  return matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'auto' ? systemTheme() : preference;
}

export interface ThemeControl {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

export function useTheme(): ThemeControl {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStored()));

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
    setResolved(resolveTheme(next));
  }, []);

  // Keep "auto" live rather than sampling once at startup.
  useEffect(() => {
    if (preference !== 'auto') return undefined;
    if (typeof matchMedia !== 'function') return undefined;
    const query = matchMedia(DARK_QUERY);
    const onChange = (): void => setResolved(query.matches ? 'dark' : 'light');
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);

  return { preference, resolved, setPreference };
}
