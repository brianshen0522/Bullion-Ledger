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
  const nav: { key: Screen; label: string }[] = [
    { key: 'dashboard', label: '總覽' },
    { key: 'market', label: '市場與買點' },
    { key: 'inventory', label: '持有庫存' },
    { key: 'products', label: '商品規格' },
    { key: 'purchase', label: '新增入庫' },
    { key: 'movements', label: '異動紀錄' },
    { key: 'settings', label: '設定' },
  ];

  return (
    <div className="flex min-h-screen min-h-dvh min-w-0 flex-col">
      <header className="safe-area-header flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <span className="mr-auto flex min-w-0 items-center gap-2 whitespace-nowrap font-semibold tracking-tight">
          <AppIcon className="h-8 w-8 shadow-sm" />
          <span>Bullion Ledger</span>
        </span>
        <nav
          aria-label="Primary"
          className="order-3 grid w-full min-w-0 grid-cols-2 gap-1 sm:order-none sm:flex sm:w-auto"
        >
          {nav.map((item) => (
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
        <div className="order-2 ml-auto flex min-w-0 items-center gap-2 sm:order-none">
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
      <main className="safe-area-main mx-auto w-full min-w-0 max-w-6xl flex-1 py-4 sm:py-6">
        {children}
      </main>
    </div>
  );
}

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
            setError(requestError instanceof Error ? requestError.message : 'Sign out failed.');
            setBusy(false);
          }
        }}
      >
        {busy ? 'Signing out…' : 'Sign out'}
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
