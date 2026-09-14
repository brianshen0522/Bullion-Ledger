import type { Screen } from './screen-navigation.js';

export interface NavEntry {
  key: Screen;
  /** Full label, used by the desktop bar and the overflow sheet. */
  label: string;
  /** Two characters at most: the bottom bar has five columns on a 320px phone. */
  shortLabel: string;
}

/** Every destination, in the order the desktop bar shows them. */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { key: 'dashboard', label: '總覽', shortLabel: '總覽' },
  { key: 'market', label: '市場與買點', shortLabel: '市場' },
  { key: 'inventory', label: '持有庫存', shortLabel: '庫存' },
  { key: 'products', label: '商品規格', shortLabel: '規格' },
  { key: 'purchase', label: '新增入庫', shortLabel: '入庫' },
  { key: 'movements', label: '異動紀錄', shortLabel: '異動' },
  { key: 'settings', label: '設定', shortLabel: '設定' },
];

/**
 * The phone bar shows four destinations plus an overflow button. Seven buttons
 * wrapped across four rows used to sit above the page content, so the top of
 * every screen was navigation rather than data.
 */
export const PRIMARY_MOBILE_SCREENS: readonly Screen[] = [
  'dashboard',
  'market',
  'inventory',
  'purchase',
];

export function primaryMobileEntries(): NavEntry[] {
  return PRIMARY_MOBILE_SCREENS.map((key) => NAV_ENTRIES.find((entry) => entry.key === key)!);
}

export function overflowMobileEntries(): NavEntry[] {
  return NAV_ENTRIES.filter((entry) => !PRIMARY_MOBILE_SCREENS.includes(entry.key));
}

/**
 * Whether the overflow button should read as the active destination. Without
 * this, opening a screen from the sheet leaves the bar with nothing marked and
 * the user cannot tell where they are.
 */
export function isOverflowActive(screen: Screen): boolean {
  return !PRIMARY_MOBILE_SCREENS.includes(screen);
}

export function navLabel(screen: Screen): string {
  return NAV_ENTRIES.find((entry) => entry.key === screen)?.label ?? '總覽';
}
