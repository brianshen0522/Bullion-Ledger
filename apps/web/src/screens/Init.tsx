import { useState } from 'react';
import { AppIcon } from '../AppIcon.js';
import { api } from '../api.js';
import { ThemeSwitcher } from '../ThemeSwitcher.js';

export function InitScreen({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/init', { username, password });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Initialization failed.');
      setSubmitting(false);
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
          className="surface w-full max-w-md space-y-5 rounded-2xl p-5 sm:p-7"
        >
          <div className="flex items-center gap-3">
            <AppIcon className="h-12 w-12 shadow-sm" />
            <div>
              <p className="text-sm font-medium text-teal-700 dark:text-teal-400">
                First-time setup
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Initialize Bullion Ledger
              </h1>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This creates the single owner account. The initialization screen will be disabled
            afterwards.
          </p>
          <Field
            label="Username (3-64 chars: A-Z a-z 0-9 . _ -)"
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
            autoComplete="new-password"
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
            disabled={submitting || username.length < 3 || password.length === 0}
            className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 dark:hover:bg-teal-600"
          >
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  autoComplete,
  autoCapitalize,
  spellCheck,
  enterKeyHint,
  required,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  spellCheck?: boolean;
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>['enterKeyHint'];
  required?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        className="w-full rounded-lg border px-3 py-2"
        name={name}
        type={type}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        enterKeyHint={enterKeyHint}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}
