import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';

import {
  getThemePreferenceForTarget,
  normalizeThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from './theme.js';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function getSystemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredPreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark);
  const resolvedTheme = resolveTheme(preference, systemPrefersDark);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolvedTheme;
    root.style.backgroundColor = resolvedTheme === 'dark' ? '#020617' : '#f8fafc';
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#020617' : '#f8fafc');
    document
      .querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? 'black-translucent' : 'default');
  }, [preference, resolvedTheme]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(media.matches);
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    const legacyMedia = media as MediaQueryList & {
      addListener: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    legacyMedia.addListener(update);
    return () => legacyMedia.removeListener(update);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        setPreferenceState(normalizeThemePreference(event.newValue));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      document.documentElement.classList.add('theme-transition');
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference: (nextPreference) => {
        const storedPreference =
          nextPreference === 'system'
            ? nextPreference
            : getThemePreferenceForTarget(nextPreference, systemPrefersDark);
        setPreferenceState(storedPreference);
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, storedPreference);
        } catch {
          // The in-memory preference still works when storage is blocked.
        }
      },
    }),
    [preference, resolvedTheme, systemPrefersDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
