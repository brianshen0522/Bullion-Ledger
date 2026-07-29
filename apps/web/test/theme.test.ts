import { describe, expect, it } from 'vitest';

import {
  getThemePreferenceForTarget,
  getThemeToggleTarget,
  normalizeThemePreference,
  resolveTheme,
} from '../src/theme.js';

describe('theme preference', () => {
  it('defaults missing or invalid stored values to system', () => {
    expect(normalizeThemePreference(null)).toBe('system');
    expect(normalizeThemePreference('sepia')).toBe('system');
  });

  it.each(['light', 'system', 'dark'] as const)('accepts %s as an explicit choice', (choice) => {
    expect(normalizeThemePreference(choice)).toBe(choice);
  });

  it('follows browser preference only in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('toggles from the currently resolved theme', () => {
    expect(getThemeToggleTarget('light')).toBe('dark');
    expect(getThemeToggleTarget('dark')).toBe('light');
  });

  it('returns to system preference when the target matches the browser', () => {
    expect(getThemePreferenceForTarget('dark', true)).toBe('system');
    expect(getThemePreferenceForTarget('light', false)).toBe('system');
    expect(getThemePreferenceForTarget('light', true)).toBe('light');
    expect(getThemePreferenceForTarget('dark', false)).toBe('dark');
  });
});
