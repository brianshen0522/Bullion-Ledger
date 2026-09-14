import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

export interface WizardShellProps {
  /** Small line above the title: which flow this is. */
  eyebrow: string;
  /** What is being worked on — a holding's name, a draft's subject. Truncated. */
  subject?: ReactNode;
  /** Name of the current step; the page's heading. */
  stepLabel: string;
  /** 0-based. */
  stepIndex: number;
  stepCount: number;
  onCancel: () => void;
  cancelLabel?: string;
  /** Status shown beside the subject, e.g. an autosave pill. */
  headerAside?: ReactNode;
  /** Notices that belong above the panel rather than inside it. */
  banner?: ReactNode;
  /** Shown under the panel, above the action bar. */
  error?: ReactNode;
  /** The action bar's contents — back / next / submit. */
  footer: ReactNode;
  /** Disables every control while a submission is in flight. */
  busy?: boolean;
  onSubmit?: (event: FormEvent) => void;
  /** The body scrolls back to its top whenever this changes. */
  scrollKey?: string;
  children: ReactNode;
}

/**
 * Chrome shared by every multi-step flow in the app.
 *
 * A wizard covers the page instead of sitting inside it: the document itself
 * never scrolls, the step name and the action bar stay put, and only the
 * current panel's body can move — and only when a panel genuinely overflows a
 * short screen. Keeping panels small enough that it rarely does is the caller's
 * job; this component's job is that the primary action is always reachable
 * without hunting for it, and that nothing behind the wizard scrolls out from
 * under the user.
 */
export function WizardShell({
  eyebrow,
  subject,
  stepLabel,
  stepIndex,
  stepCount,
  onCancel,
  cancelLabel = '取消',
  headerAside,
  banner,
  error,
  footer,
  busy = false,
  onSubmit,
  scrollKey,
  children,
}: WizardShellProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Work starts at the first field of the panel the wizard opened on.
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
  }, []);

  // Each panel starts at its own top. Without this, stepping out of a panel
  // that did overflow leaves the next one scrolled part-way down.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [scrollKey]);

  // The page behind must not scroll while the wizard is over it, or a flick
  // past the panel's edge moves the document instead.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-paper dark:bg-slate-950">
      <form
        ref={formRef}
        className="flex min-h-0 w-full flex-1 flex-col"
        noValidate
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(event);
        }}
      >
        <fieldset disabled={busy} className="m-0 flex min-h-0 flex-1 flex-col border-0 p-0">
          <header
            data-wizard-top
            className="safe-area-header shrink-0 border-b border-slate-200 bg-white pb-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="interactive-muted -ml-2 shrink-0 rounded-lg px-2 text-sm font-medium disabled:opacity-30"
              >
                ← {cancelLabel}
              </button>
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-600 dark:text-slate-300">
                {subject ?? eyebrow}
              </p>
              {headerAside}
            </div>

            <div className="mx-auto mt-2 w-full max-w-4xl">
              <div className="flex items-baseline justify-between gap-3">
                <h1 className="text-lg font-semibold tracking-tight">{stepLabel}</h1>
                <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  第 {stepIndex + 1}／{stepCount} 步
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={stepCount}
                aria-valuenow={stepIndex + 1}
                aria-label={`第 ${stepIndex + 1} 步，共 ${stepCount} 步：${stepLabel}`}
                className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
              >
                <div
                  className="h-full rounded-full bg-accent motion-safe:transition-all"
                  style={{ width: `${((stepIndex + 1) / stepCount) * 100}%` }}
                />
              </div>
            </div>
          </header>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="safe-area-inline mx-auto w-full max-w-4xl py-4">
              {banner}
              {children}
              {error}
            </div>
          </div>

          <footer className="shrink-0 border-t border-slate-200 bg-white pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="safe-area-inline mx-auto flex w-full max-w-4xl items-center gap-2">
              {footer}
            </div>
          </footer>
        </fieldset>
      </form>
    </div>
  );
}

/** The action bar's Back button, so every wizard's looks and behaves the same. */
export function WizardBack({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="interactive-muted rounded-lg px-4 font-medium disabled:opacity-30"
      onClick={onClick}
    >
      上一步
    </button>
  );
}

export function WizardNext({ onClick, label = '下一步' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="ml-auto rounded-lg bg-accent px-5 font-medium text-white shadow-sm hover:bg-teal-800 dark:hover:bg-teal-600"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function WizardSubmit({
  busy,
  idle,
  working,
}: {
  busy: boolean;
  idle: string;
  working: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="ml-auto rounded-lg bg-accent px-5 font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 dark:hover:bg-teal-600"
    >
      {busy ? working : idle}
    </button>
  );
}
