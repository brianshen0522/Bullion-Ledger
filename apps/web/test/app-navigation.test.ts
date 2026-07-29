import { describe, expect, it } from 'vitest';

import { readScreenFromSearch, urlForScreen } from '../src/screen-navigation.js';

describe('application screen URL state', () => {
  it('restores every known screen and rejects unknown screen names', () => {
    expect(readScreenFromSearch('')).toBe('dashboard');
    expect(readScreenFromSearch('?screen=dashboard')).toBe('dashboard');
    expect(readScreenFromSearch('?screen=inventory')).toBe('inventory');
    expect(readScreenFromSearch('?screen=products')).toBe('products');
    expect(readScreenFromSearch('?screen=purchase')).toBe('purchase');
    expect(readScreenFromSearch('?screen=settings')).toBe('settings');
    expect(readScreenFromSearch('?screen=admin')).toBe('dashboard');
  });

  it('restores legacy Wizard links only when no explicit screen is present', () => {
    expect(readScreenFromSearch('?purchaseStep=items')).toBe('purchase');
    expect(readScreenFromSearch('?purchaseStep=unknown')).toBe('dashboard');
    expect(readScreenFromSearch('?screen=products&purchaseStep=items')).toBe('products');
  });

  it('preserves unrelated URL state and removes stale Wizard steps off the purchase screen', () => {
    expect(urlForScreen('/app?tab=recent&purchaseStep=items#top', 'products')).toBe(
      '/app?tab=recent&screen=products#top',
    );
    expect(
      urlForScreen('/app?tab=recent&screen=products&purchaseStep=items#top', 'dashboard'),
    ).toBe('/app?tab=recent#top');
    expect(urlForScreen('/app?tab=recent&purchaseStep=documents#top', 'purchase')).toBe(
      '/app?tab=recent&purchaseStep=documents&screen=purchase#top',
    );
  });
});
