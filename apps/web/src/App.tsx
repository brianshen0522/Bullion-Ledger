import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, isApiError, onUnauthorized, type SessionInfo } from './api.js';
import { AppIcon } from './AppIcon.js';
import { PwaUpdateNotice } from './PwaUpdateNotice.js';
import { ThemeSwitcher } from './ThemeSwitcher.js';
import { useInitGate } from './screens/InitGate.js';
import { DashboardScreen } from './screens/Dashboard.js';
import { AssetsScreen } from './screens/Assets.js';
import { ProductsScreen } from './screens/Products.js';
import { PurchaseScreen } from './screens/Purchase.js';
import { MarketScreen } from './screens/Market.js';
import { MovementsScreen } from './screens/Movements.js';
import { SettingsScreen } from './screens/Settings.js';
import { LoginScreen } from './screens/Login.js';
import { InitScreen } from './screens/Init.js';
import { createBrowserScreenHistory, type Screen } from './screen-navigation.js';
import {
  NAV_ENTRIES,
  isOverflowActive,
  navLabel,
  overflowMobileEntries,
  primaryMobileEntries,
} from './nav-model.js';

export default function App() {
  const queryClient = useQueryClient();
  const { initialized, loading, error } = useInitGate();
  const screenHistory = useMemo(() => createBrowserScreenHistory(window), []);
  const [screen, setScreen] = useState<Screen>(() => screenHistory.read());
  const online = useOnlineStatus();

  const navigateScreen = useCallback(
    (next: Screen, mode: 'push' | 'replace' = 'push') => {
      if (screenHistory.read() === next) screenHistory.replace(next);
      else screenHistory[mode](next);
      setScreen(next);
    },
    [screenHistory],
  );

  useEffect(() => {
    // Canonicalize legacy `?purchaseStep=…` links and remove stale Wizard
    // state from non-purchase URLs without adding a history entry.
    screenHistory.replace(screenHistory.read());
    return screenHistory.subscribe(setScreen);
  }, [screenHistory]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [screen]);

  const session = useQuery<SessionInfo | null>({
    queryKey: ['session'],
    enabled: initialized === true,
    retry: false,
    queryFn: async () => {
      try {
        return await api.get<SessionInfo>('/auth/session');
      } catch (requestError) {
        if (isApiError(requestError) && requestError.status === 401) return null;
        throw requestError;
      }
    },
  });

  useEffect(
    () =>
      onUnauthorized(() => {
        queryClient.setQueryData<SessionInfo | null>(['session'], null);
        void queryClient.cancelQueries({ queryKey: ['dashboard-summary'] });
        navigateScreen('dashboard', 'replace');
      }),
    [navigateScreen, queryClient],
  );

  if (loading) return <FullScreen message="Loading…" />;
  if (error) {
    return (
      <FullScreen
        message={
          online
            ? `Health check failed: ${error.message}`
            : '目前離線。資料沒有被刪除；恢復網路後即可重新連線。'
        }
        actionLabel="重新整理"
        onAction={() => window.location.reload()}
      />
    );
  }
  if (!initialized) {
    return (
      <InitScreen
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ['init-status'] });
          void queryClient.invalidateQueries({ queryKey: ['session'] });
        }}
      />
    );
  }

  if (session.isError) {
    return (
      <FullScreen
        message={
          online
            ? `Session check failed: ${session.error.message}`
            : '目前離線。登入與資料同步需要網路連線。'
        }
        actionLabel="Retry"
        onAction={() => void session.refetch()}
      />
    );
  }
  if (session.isPending || session.data === undefined) {
    return <FullScreen message="Checking session…" />;
  }
  if (!session.data?.username) {
    return (
      <LoginScreen
        onDone={async () => {
          const refreshed = await session.refetch();
          if (refreshed.error) throw refreshed.error;
          if (!refreshed.data?.username) throw new Error('The server did not establish a session.');
          navigateScreen('dashboard', 'replace');
        }}
      />
    );
  }

  return (
    <Shell
      screen={screen}
      navigateScreen={navigateScreen}
      username={session.data.username}
      online={online}
      onLoggedOut={() => {
        queryClient.setQueryData<SessionInfo | null>(['session'], null);
        queryClient.removeQueries({ queryKey: ['dashboard-summary'] });
        navigateScreen('dashboard', 'replace');
      }}
    >
      <ScreenErrorBoundary key={screen}>
        {screen === 'dashboard' ? (
          <DashboardScreen />
        ) : screen === 'inventory' ? (
          <AssetsScreen onAddPurchase={() => navigateScreen('purchase')} />
        ) : screen === 'market' ? (
          <MarketScreen />
        ) : screen === 'products' ? (
          <ProductsScreen />
        ) : screen === 'movements' ? (
          <MovementsScreen />
        ) : screen === 'settings' ? (
          <SettingsScreen
            username={session.data.username}
            onUsernameChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ['session'] });
            }}
          />
        ) : (
          <PurchaseScreen onDone={() => navigateScreen('dashboard', 'replace')} />
        )}
      </ScreenErrorBoundary>
    </Shell>
  );
}

function Shell({
  children,
  screen,
  navigateScreen,
  username,
  online,
  onLoggedOut,
}: {
  children: ReactNode;
  screen: Screen;
  navigateScreen: (screen: Screen) => void;
  username: string;
  online: boolean;
  onLoggedOut: () => void;
}) {
  const [overflowOpen, setOverflowOpen] = useState(false);

  // Close the sheet on navigation, and whenever the phone bar is no longer the
  // nav in use, so it can never be left open behind the desktop bar.
  useEffect(() => setOverflowOpen(false), [screen]);

  return (
    <div className="flex min-h-screen min-h-dvh min-w-0 flex-col">
      <header className="safe-area-header flex min-w-0 items-center gap-3 border-b border-slate-200 bg-white/95 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <span className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
          <AppIcon className="h-8 w-8 shrink-0 shadow-sm" />
          <span className="truncate">Bullion Ledger</span>
        </span>
        {/* Phones get the bottom bar instead; putting seven destinations here
            pushed every screen's own content a third of the way down. */}
        <nav aria-label="Primary" className="ml-auto hidden min-w-0 gap-1 sm:flex">
          {NAV_ENTRIES.map((item) => (
            <button
              type="button"
              key={item.key}
              onClick={() => navigateScreen(item.key)}
              aria-current={screen === item.key ? 'page' : undefined}
              className={`min-w-0 rounded-lg px-2 py-1 text-sm font-medium sm:px-3 ${
                screen === item.key
                  ? 'bg-accent text-white shadow-sm'
                  : 'interactive-muted bg-transparent'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:gap-2">
          <button
            type="button"
            onClick={() => navigateScreen('settings')}
            className="hidden max-w-32 truncate text-sm text-slate-500 underline-offset-4 hover:underline dark:text-slate-400 md:inline"
            title={`${username} — 帳號與安全性`}
          >
            {username}
          </button>
          <LogoutButton onLoggedOut={onLoggedOut} />
          <ThemeSwitcher />
        </div>
      </header>
      {!online && (
        <div
          role="status"
          className="safe-area-inline border-b border-amber-300 bg-amber-50 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <div className="mx-auto w-full max-w-6xl">
            目前離線：可繼續編輯本機入庫草稿，恢復網路後再同步與送出。
          </div>
        </div>
      )}
      {screen === 'dashboard' && <PwaUpdateNotice />}
      <main className="safe-area-main app-main mx-auto w-full min-w-0 max-w-6xl flex-1 py-4 sm:py-6">
        {children}
      </main>
      <MobileNav
        screen={screen}
        navigateScreen={navigateScreen}
        overflowOpen={overflowOpen}
        onToggleOverflow={() => setOverflowOpen((open) => !open)}
      />
    </div>
  );
}

/**
 * Phone navigation. Four destinations sit in the thumb zone and the rest live
 * behind one overflow button, so no screen starts below four rows of buttons.
 */
function MobileNav({
  screen,
  navigateScreen,
  overflowOpen,
  onToggleOverflow,
}: {
  screen: Screen;
  navigateScreen: (screen: Screen) => void;
  overflowOpen: boolean;
  onToggleOverflow: () => void;
}) {
  const primary = primaryMobileEntries();
  const overflow = overflowMobileEntries();
  const overflowActive = isOverflowActive(screen);

  return (
    <div className="sm:hidden">
      {overflowOpen && (
        <button
          type="button"
          aria-label="關閉選單"
          className="fixed inset-0 z-30 h-full w-full cursor-default bg-slate-950/30"
          onClick={onToggleOverflow}
        />
      )}
      {/*
        The sheet is a sibling stacked directly above the bar inside one fixed
        container, rather than a separate fixed box offset by the bar's height.
        Doing the arithmetic meant reproducing the home-indicator inset that the
        bar adds itself, and getting it wrong left the last row — 設定 — behind
        the bar on every phone with an indicator.
      */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col">
        {overflowOpen && (
          <div
            id="app-nav-overflow"
            className="surface mx-2 mb-2 grid max-h-[60dvh] gap-1 overflow-y-auto overscroll-contain rounded-2xl p-2 shadow-xl"
          >
            {overflow.map((item) => (
              <button
                type="button"
                key={item.key}
                onClick={() => navigateScreen(item.key)}
                aria-current={screen === item.key ? 'page' : undefined}
                className={`rounded-xl px-4 text-left font-medium ${
                  screen === item.key ? 'bg-accent text-white' : 'interactive-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        <nav
          aria-label="Primary"
          className="grid grid-cols-5 gap-1 border-t border-slate-200 bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"
        >
          {primary.map((item) => (
            <button
              type="button"
              key={item.key}
              onClick={() => navigateScreen(item.key)}
              aria-current={screen === item.key ? 'page' : undefined}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium ${
                screen === item.key
                  ? 'text-accent dark:text-teal-300'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span aria-hidden="true" className="text-base leading-none">
                {NAV_GLYPHS[item.key]}
              </span>
              <span className="truncate">{item.shortLabel}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onToggleOverflow}
            aria-expanded={overflowOpen}
            aria-controls="app-nav-overflow"
            aria-current={overflowActive ? 'page' : undefined}
            className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium ${
              overflowActive
                ? 'text-accent dark:text-teal-300'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <span aria-hidden="true" className="text-base leading-none">
              ☰
            </span>
            <span className="truncate">{overflowActive ? navLabel(screen) : '更多'}</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

const NAV_GLYPHS: Record<Screen, string> = {
  dashboard: '◎',
  market: '↗',
  inventory: '▦',
  products: '◈',
  purchase: '＋',
  movements: '⇄',
  settings: '⚙',
};

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);
  return online;
}

function LogoutButton({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        className="rounded-lg px-2 text-sm font-medium text-slate-600 underline-offset-4 hover:underline disabled:opacity-50 dark:text-slate-300"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.post('/auth/logout');
            onLoggedOut();
          } catch (requestError) {
            if (isApiError(requestError) && requestError.status === 401) {
              onLoggedOut();
              return;
            }
            setError(requestError instanceof Error ? requestError.message : '登出失敗。');
            setBusy(false);
          }
        }}
      >
        {busy ? '登出中…' : '登出'}
      </button>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function FullScreen({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="safe-area-screen flex min-h-screen min-h-dvh flex-col">
      <div className="self-end">
        <ThemeSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center py-6 text-center">
        <div className="max-w-lg">
          <p className="text-lg">{message}</p>
          {actionLabel && onAction && (
            <button
              type="button"
              className="mt-3 rounded-lg px-4 font-medium text-accent underline-offset-4 hover:underline dark:text-teal-400"
              onClick={onAction}
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { Screen };

class ScreenErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  override state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : '頁面發生未預期錯誤。' };
  }

  override render() {
    if (!this.state.message) return this.props.children;
    return (
      <div role="alert" className="surface rounded-xl px-4 py-10 text-center">
        <h1 className="text-lg font-semibold">這個頁面暫時無法顯示</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{this.state.message}</p>
        <button
          type="button"
          className="mt-4 rounded-lg bg-accent px-5 py-2 font-medium text-white"
          onClick={() => window.location.reload()}
        >
          重新載入
        </button>
      </div>
    );
  }
}
