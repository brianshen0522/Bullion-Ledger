import { PURCHASE_WIZARD_STEP_PARAM, readWizardStepFromSearch } from './purchase-wizard/history.js';

export const SCREEN_PARAM = 'screen';
export const SCREENS = [
  'dashboard',
  'market',
  'inventory',
  'products',
  'purchase',
  'movements',
  'settings',
] as const;

export type Screen = (typeof SCREENS)[number];

export function isScreen(value: unknown): value is Screen {
  return typeof value === 'string' && (SCREENS as readonly string[]).includes(value);
}

/** Reads the current screen, including legacy Wizard-only URLs. */
export function readScreenFromSearch(search: string): Screen {
  const requested = new URLSearchParams(search).get(SCREEN_PARAM);
  if (requested !== null) return isScreen(requested) ? requested : 'dashboard';
  return readWizardStepFromSearch(search) ? 'purchase' : 'dashboard';
}

/**
 * Produces a reloadable app URL. Wizard steps are retained only while the
 * purchase screen is active so stale step state cannot leak into other pages.
 */
export function urlForScreen(href: string, screen: Screen, parameter = SCREEN_PARAM): string {
  const url = new URL(href, 'http://localhost');
  if (screen === 'dashboard') url.searchParams.delete(parameter);
  else url.searchParams.set(parameter, screen);
  if (screen !== 'purchase') url.searchParams.delete(PURCHASE_WIZARD_STEP_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface ScreenHistoryAdapter {
  read(): Screen;
  push(screen: Screen): void;
  replace(screen: Screen): void;
  subscribe(listener: (screen: Screen) => void): () => void;
}

export function createBrowserScreenHistory(browserWindow: Window = window): ScreenHistoryAdapter {
  const write = (method: 'pushState' | 'replaceState', screen: Screen) => {
    browserWindow.history[method](
      { ...(browserWindow.history.state as object | null), appScreen: screen },
      '',
      urlForScreen(browserWindow.location.href, screen),
    );
  };

  return {
    read: () => readScreenFromSearch(browserWindow.location.search),
    push: (screen) => write('pushState', screen),
    replace: (screen) => write('replaceState', screen),
    subscribe: (listener) => {
      const onPopState = () => listener(readScreenFromSearch(browserWindow.location.search));
      browserWindow.addEventListener('popstate', onPopState);
      return () => browserWindow.removeEventListener('popstate', onPopState);
    },
  };
}
