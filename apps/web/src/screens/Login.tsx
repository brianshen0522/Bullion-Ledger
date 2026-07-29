import { useEffect, useState } from 'react';
import { AppIcon } from '../AppIcon.js';
import { api, type PasskeyStatus } from '../api.js';
import { loginWithPasskey } from '../passkeys.js';
import { ThemeSwitcher } from '../ThemeSwitcher.js';
import { PasskeyError, isPasskeySupported } from '../webauthn.js';
import { Field } from './Init.js';

export function LoginScreen({ onDone }: { onDone: () => void | Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyOffered, setPasskeyOffered] = useState(false);

  // The sign-in screen is public, so this is the one place that has to ask the
  // server whether passkeys are configured before advertising them.
  useEffect(() => {
    if (!isPasskeySupported()) return;
    let active = true;
    void api
      .get<PasskeyStatus>('/auth/passkey/status')
      .then((status) => {
        if (active) setPasskeyOffered(status.available);
      })
      .catch(() => {
        if (active) setPasskeyOffered(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/login', { username, password });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
      setSubmitting(false);
    }
  }

  async function submitPasskey() {
    setPasskeyBusy(true);
    setError(null);
    try {
      await loginWithPasskey();
      await onDone();
    } catch (e) {
      // A cancelled prompt is a normal user action, not an error worth shouting.
      if (e instanceof PasskeyError && e.reason === 'cancelled') setError(null);
      else setError(e instanceof Error ? e.message : 'Passkey sign in failed.');
      setPasskeyBusy(false);
    }
  }

  return (
    <div className="safe-area-screen flex min-h-screen min-h-dvh flex-col">
      <div className="self-end">
        <ThemeSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center py-6">
        <form
          onSubmit={submit}
          className="surface w-full max-w-sm space-y-5 rounded-2xl p-5 sm:p-7"
        >
          <div className="flex items-center gap-3">
            <AppIcon className="h-12 w-12 shadow-sm" />
            <div>
              <p className="text-sm font-medium text-teal-700 dark:text-teal-400">Bullion Ledger</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sign in</h1>
            </div>
          </div>
          <Field
            label="Username"
            name="username"
            value={username}
            onChange={setUsername}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            required
          />
          <Field
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            required
          />
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || passkeyBusy}
            className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 dark:hover:bg-teal-600"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          {passkeyOffered && (
            <>
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                <span>或</span>
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              </div>
              <button
                type="button"
                onClick={() => void submitPasskey()}
                disabled={submitting || passkeyBusy}
                className="interactive-muted w-full rounded-lg border border-slate-300 px-4 py-2 font-medium disabled:opacity-50 dark:border-slate-600"
              >
                {passkeyBusy ? '驗證中…' : '使用密碼金鑰登入（Touch ID／Face ID）'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
