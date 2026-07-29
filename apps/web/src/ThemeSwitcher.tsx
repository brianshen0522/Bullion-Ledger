import { getThemeToggleTarget, type ResolvedTheme } from './theme.js';
import { useTheme } from './ThemeProvider.js';

const ICON_CLASSES: Record<ResolvedTheme, string> = {
  light: 'theme-icon theme-icon--sun',
  dark: 'theme-icon theme-icon--moon',
};

export function ThemeSwitcher() {
  const { resolvedTheme, setPreference } = useTheme();
  const targetTheme = getThemeToggleTarget(resolvedTheme);
  const targetLabel = targetTheme === 'dark' ? '深色' : '淺色';

  return (
    <button
      type="button"
      aria-label={`切換至${targetLabel}主題`}
      title={`切換至${targetLabel}主題`}
      onClick={() => setPreference(targetTheme)}
      className="group relative inline-flex h-9 min-h-9 w-9 min-w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-0 text-slate-600 shadow-sm transition-all duration-200 after:absolute after:-inset-1 after:content-[''] hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 active:scale-95 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
    >
      <ThemeIcon theme={targetTheme} />
    </button>
  );
}

function ThemeIcon({ theme }: { theme: ResolvedTheme }) {
  return (
    <span
      aria-hidden="true"
      className={`${ICON_CLASSES[theme]} transition-transform duration-200 ${
        theme === 'dark' ? '-rotate-12' : 'rotate-0'
      } group-hover:rotate-12`}
    />
  );
}
