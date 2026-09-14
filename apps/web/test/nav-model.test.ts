import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  NAV_ENTRIES,
  isOverflowActive,
  navLabel,
  overflowMobileEntries,
  primaryMobileEntries,
} from '../src/nav-model.js';
import { SCREENS } from '../src/screen-navigation.js';

const appSource = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
const cssSource = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');

describe('navigation model', () => {
  it('covers every screen exactly once', () => {
    expect(NAV_ENTRIES.map((entry) => entry.key).sort()).toEqual([...SCREENS].sort());
  });

  it('splits the phone bar into four destinations plus an overflow', () => {
    // Five columns is what fits a 320px-wide phone with 44px touch targets.
    expect(primaryMobileEntries()).toHaveLength(4);
    expect([...primaryMobileEntries(), ...overflowMobileEntries()]).toHaveLength(
      NAV_ENTRIES.length,
    );
  });

  it('never lists a destination in both the bar and the sheet', () => {
    const primary = new Set(primaryMobileEntries().map((entry) => entry.key));
    expect(overflowMobileEntries().some((entry) => primary.has(entry.key))).toBe(false);
  });

  it('marks the overflow button active for screens it holds', () => {
    expect(isOverflowActive('settings')).toBe(true);
    expect(isOverflowActive('products')).toBe(true);
    expect(isOverflowActive('dashboard')).toBe(false);
    // …and names the current screen there, so the user can still tell where
    // they are when the active destination is hidden behind the sheet.
    expect(navLabel('settings')).toBe('設定');
  });
});

describe('app shell layout', () => {
  it('keeps the seven-button block off the top of every phone screen', () => {
    // The header nav previously rendered as `grid-cols-2` on phones: seven
    // destinations wrapped onto four rows above the page content.
    expect(appSource).not.toContain('grid w-full min-w-0 grid-cols-2 gap-1');
    expect(appSource).toContain('className="ml-auto hidden min-w-0 gap-1 sm:flex"');
    expect(appSource).toContain('<MobileNav');
  });

  it('reserves room for the bottom bar instead of covering content with it', () => {
    expect(cssSource).toContain('--app-bottom-nav: 0px');
    expect(cssSource).toContain('--app-bottom-nav: 3.5rem');
    expect(cssSource).toContain(
      'padding-bottom: calc(1rem + var(--app-bottom-nav) + env(safe-area-inset-bottom))',
    );
  });

  it('gives every full-screen wizard the same chrome, over the tab bar', () => {
    // It covers the tab bar rather than sitting above it, and locks the body so
    // the page behind cannot scroll out from under the panel being filled in.
    const shell = readFileSync(
      fileURLToPath(new URL('../src/WizardShell.tsx', import.meta.url)),
      'utf8',
    );
    expect(shell).toContain('fixed inset-0 z-50 flex h-dvh flex-col');
    expect(shell).toContain('min-h-0 flex-1 overflow-y-auto');
    expect(shell).toContain("document.body.style.overflow = 'hidden'");

    // Both wizards use it, so neither can drift into its own chrome.
    for (const file of ['screens/AssetEditWizard.tsx', 'purchase-wizard/PurchaseWizard.tsx']) {
      const source = readFileSync(
        fileURLToPath(new URL(`../src/${file}`, import.meta.url)),
        'utf8',
      );
      expect(source).toContain('<WizardShell');
      // A wizard that covers the tab bar needs no bar of its own to clear it.
      expect(source).not.toContain('sticky-action-bar');
      expect(source).not.toContain('sticky bottom-0 z-20');
    }
    expect(cssSource).not.toContain('.sticky-action-bar');
  });
});
