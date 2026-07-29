export const THEME_STORAGE_KEY = 'bullion-ledger-theme';

export const THEME_PREFERENCES = ['light', 'system', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

export function normalizeThemePreference(value: unknown): ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : 'system';
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
}

export function getThemeToggleTarget(resolvedTheme: ResolvedTheme): ResolvedTheme {
  return resolvedTheme === 'dark' ? 'light' : 'dark';
}

export function getThemePreferenceForTarget(
  targetTheme: ResolvedTheme,
  systemPrefersDark: boolean,
): ThemePreference {
  return targetTheme === resolveTheme('system', systemPrefersDark) ? 'system' : targetTheme;
}
