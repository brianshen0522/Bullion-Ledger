import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { api, isApiError, type Passkey, type PasskeyStatus } from '../api.js';
import { loginWithPasskeyUnavailable } from './settings-copy.js';
import { registerPasskey, reauthenticateWithPasskey } from '../passkeys.js';
import { PasskeyError, isPlatformAuthenticatorAvailable, isPasskeySupported } from '../webauthn.js';
import { BackupSection } from './BackupSection.js';
import { Field } from './Init.js';
import {
  formatTimestamp,
  passkeyLabel,
  passwordChangePayload,
  usernameChangePayload,
  validatePasswordForm,
  validateUsernameForm,
  type ReauthMethod,
} from './settings-model.js';

export function SettingsScreen({
  username,
  onUsernameChanged,
}: {
  username: string;
  onUsernameChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const passkeys = useQuery<Passkey[]>({
    queryKey: ['passkeys'],
    queryFn: () => api.get<Passkey[]>('/auth/passkeys'),
  });
  const passkeyStatus = useQuery<PasskeyStatus>({
    queryKey: ['passkey-status'],
    queryFn: () => api.get<PasskeyStatus>('/auth/passkey/status'),
  });

  const serverSupportsPasskeys = passkeyStatus.data?.available === true;
  const hasPasskey = (passkeys.data?.length ?? 0) > 0;
  // Only offer the passkey re-auth path when it can actually succeed.
  const canReauthWithPasskey = serverSupportsPasskeys && hasPasskey && isPasskeySupported();

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">帳號與安全性</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          管理登入名稱、密碼與密碼金鑰（Passkey）。此系統只有一個帳號，密碼永遠是最後的復原方式。
        </p>
      </div>

      <UsernameCard
        username={username}
        canReauthWithPasskey={canReauthWithPasskey}
        onChanged={onUsernameChanged}
      />

      <PasswordCard canReauthWithPasskey={canReauthWithPasskey} />

      <PasskeyCard
        passkeys={passkeys.data ?? []}
        loading={passkeys.isLoading}
        loadError={passkeys.isError ? (passkeys.error as Error).message : null}
        serverSupportsPasskeys={serverSupportsPasskeys}
        statusResolved={passkeyStatus.isSuccess}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ['passkeys'] })}
      />

      <BackupSection canReauthWithPasskey={canReauthWithPasskey} />

      <SessionsCard />
    </div>
  );
}

// --- Username --------------------------------------------------------------

function UsernameCard({
  username,
  canReauthWithPasskey,
  onChanged,
}: {
  username: string;
  canReauthWithPasskey: boolean;
  onChanged: () => void;
}) {
  const [nextUsername, setNextUsername] = useState(username);
  const [currentPassword, setCurrentPassword] = useState('');
  const [method, setMethod] = useState<ReauthMethod>('password');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setNextUsername(username), [username]);
  useEffect(() => {
    if (!canReauthWithPasskey) setMethod('password');
  }, [canReauthWithPasskey]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const state = { username: nextUsername.trim(), currentPassword, method };
    const invalid = validateUsernameForm(state, username);
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    try {
      if (method === 'passkey') await reauthenticateWithPasskey();
      await api.post('/auth/change-username', usernameChangePayload(state));
      setSuccess(`使用者名稱已更新為「${state.username}」。`);
      setCurrentPassword('');
      onChanged();
    } catch (requestError) {
      setError(describeError(requestError, '無法更新使用者名稱。'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="使用者名稱" description="變更登入時使用的名稱。變更前需要重新驗證身分。">
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="新的使用者名稱（3-64 字元：A-Z a-z 0-9 . _ -）"
          name="username"
          value={nextUsername}
          onChange={setNextUsername}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <ReauthChoice
          method={method}
          onMethodChange={setMethod}
          canReauthWithPasskey={canReauthWithPasskey}
          currentPassword={currentPassword}
          onCurrentPasswordChange={setCurrentPassword}
          idPrefix="username"
        />
        <Feedback error={error} success={success} />
        <SubmitButton busy={busy} idle="更新使用者名稱" working="更新中…" />
      </form>
    </Card>
  );
}

// --- Password --------------------------------------------------------------

function PasswordCard({ canReauthWithPasskey }: { canReauthWithPasskey: boolean }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [method, setMethod] = useState<ReauthMethod>('password');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canReauthWithPasskey) setMethod('password');
  }, [canReauthWithPasskey]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const state = { newPassword, confirmPassword, currentPassword, method };
    const invalid = validatePasswordForm(state);
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    try {
      if (method === 'passkey') await reauthenticateWithPasskey();
      await api.post('/auth/change-password', passwordChangePayload(state));
      setSuccess('密碼已更新，其他裝置上的登入工作階段已全部登出。');
      setNewPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
    } catch (requestError) {
      setError(describeError(requestError, '無法更新密碼。'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="密碼"
      description="新密碼需輸入兩次以避免打錯。變更成功後，其他裝置上的工作階段會自動登出。"
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="新密碼"
          name="new-password"
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <Field
          label="再次輸入新密碼"
          name="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        {confirmPassword.length > 0 && newPassword !== confirmPassword && (
          <p role="status" className="text-danger text-xs">
            兩次輸入的新密碼不一致。
          </p>
        )}
        <ReauthChoice
          method={method}
          onMethodChange={setMethod}
          canReauthWithPasskey={canReauthWithPasskey}
          currentPassword={currentPassword}
          onCurrentPasswordChange={setCurrentPassword}
          idPrefix="password"
        />
        <Feedback error={error} success={success} />
        <SubmitButton busy={busy} idle="更新密碼" working="更新中…" />
      </form>
    </Card>
  );
}

/**
 * Chooses how to prove identity before a sensitive change. The passkey option
 * only appears when the deployment, the account, and the browser all support
 * it, so it never renders as a button that cannot work.
 */
function ReauthChoice({
  method,
  onMethodChange,
  canReauthWithPasskey,
  currentPassword,
  onCurrentPasswordChange,
  idPrefix,
}: {
  method: ReauthMethod;
  onMethodChange: (method: ReauthMethod) => void;
  canReauthWithPasskey: boolean;
  currentPassword: string;
  onCurrentPasswordChange: (value: string) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <legend className="px-1 text-sm font-medium">驗證身分</legend>
      {canReauthWithPasskey && (
        <div className="flex flex-wrap gap-3">
          {(['password', 'passkey'] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${idPrefix}-reauth`}
                value={option}
                checked={method === option}
                onChange={() => onMethodChange(option)}
              />
              <span>{option === 'password' ? '使用目前密碼' : '使用密碼金鑰（Touch ID）'}</span>
            </label>
          ))}
        </div>
      )}
      {method === 'password' ? (
        <Field
          label="目前的密碼"
          name={`${idPrefix}-current-password`}
          type="password"
          value={currentPassword}
          onChange={onCurrentPasswordChange}
          autoComplete="current-password"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          送出時會跳出 Touch ID／Face ID 驗證。一次驗證只能完成一項變更。
        </p>
      )}
    </fieldset>
  );
}

// --- Passkeys --------------------------------------------------------------

function PasskeyCard({
  passkeys,
  loading,
  loadError,
  serverSupportsPasskeys,
  statusResolved,
  onChanged,
}: {
  passkeys: Passkey[];
  loading: boolean;
  loadError: string | null;
  serverSupportsPasskeys: boolean;
  statusResolved: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [platformAvailable, setPlatformAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void isPlatformAuthenticatorAvailable().then((available) => {
      if (active) setPlatformAvailable(available);
    });
    return () => {
      active = false;
    };
  }, []);

  const browserSupported = isPasskeySupported();
  const unavailableReason = loginWithPasskeyUnavailable({
    statusResolved,
    serverSupportsPasskeys,
    browserSupported,
  });

  async function add() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const created = await registerPasskey(name);
      setSuccess(`已新增密碼金鑰「${passkeyLabel(created)}」，下次登入即可使用。`);
      setName('');
      onChanged();
    } catch (requestError) {
      setError(describeError(requestError, '無法新增密碼金鑰。'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="密碼金鑰（Passkey）"
      description="在 Mac 或 iPhone 上註冊後，即可用 Touch ID／Face ID 登入，並用來驗證密碼變更。系統只會收到驗證結果，不會取得指紋或臉部資料。"
    >
      {unavailableReason ? (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
          {unavailableReason}
        </p>
      ) : (
        <div className="space-y-4">
          {platformAvailable === false && (
            <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
              這台裝置沒有內建的驗證器，仍可使用實體安全金鑰或手機掃碼註冊。
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Field
                label="名稱（選填，例如「MacBook Touch ID」）"
                name="passkey-name"
                value={name}
                onChange={setName}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 dark:hover:bg-teal-600"
            >
              {busy ? '註冊中…' : '新增密碼金鑰'}
            </button>
          </div>
          <Feedback error={error} success={success} />
        </div>
      )}

      <div className="mt-5">
        {loading && <p className="text-sm text-slate-500 dark:text-slate-400">載入中…</p>}
        {loadError && (
          <p role="alert" className="text-danger text-sm">
            無法載入密碼金鑰：{loadError}
          </p>
        )}
        {!loading && !loadError && passkeys.length === 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            尚未註冊任何密碼金鑰。目前只能使用使用者名稱與密碼登入。
          </p>
        )}
        <ul className="space-y-3">
          {passkeys.map((passkey) => (
            <PasskeyRow key={passkey.id} passkey={passkey} onChanged={onChanged} />
          ))}
        </ul>
      </div>
    </Card>
  );
}

function PasskeyRow({ passkey, onChanged }: { passkey: Passkey; onChanged: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(passkey.name ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
      onChanged();
      setRenaming(false);
      setConfirmingDelete(false);
    } catch (requestError) {
      setError(describeError(requestError, fallback));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{passkeyLabel(passkey)}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            建立於 {formatTimestamp(passkey.createdAt)} · 最後使用{' '}
            {formatTimestamp(passkey.lastUsedAt)}
            {passkey.backedUp && ' · 已同步備份'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 text-sm">
          <button
            type="button"
            className="interactive-muted rounded-lg px-2 py-1"
            onClick={() => {
              setName(passkey.name ?? '');
              setRenaming((open) => !open);
            }}
            disabled={busy}
          >
            重新命名
          </button>
          <button
            type="button"
            className="text-danger rounded-lg px-2 py-1 underline-offset-4 hover:underline"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
          >
            刪除
          </button>
        </div>
      </div>

      {renaming && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label="新名稱" value={name} onChange={setName} spellCheck={false} />
          </div>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy || name.trim().length === 0}
            onClick={() =>
              void run(
                () => api.patch(`/auth/passkeys/${passkey.id}`, { name: name.trim() }),
                '無法重新命名。',
              )
            }
          >
            儲存
          </button>
        </div>
      )}

      {confirmingDelete && (
        <div className="mt-3 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">
          <p>刪除後這個裝置就無法再用來登入。使用者名稱與密碼仍可正常登入。確定要刪除嗎？</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-red-700 px-3 py-1.5 font-medium text-white disabled:opacity-50"
              disabled={busy}
              onClick={() =>
                void run(() => api.delete(`/auth/passkeys/${passkey.id}`), '無法刪除密碼金鑰。')
              }
            >
              {busy ? '刪除中…' : '確定刪除'}
            </button>
            <button
              type="button"
              className="interactive-muted rounded-lg px-3 py-1.5"
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-danger mt-2 text-sm">
          {error}
        </p>
      )}
    </li>
  );
}

// --- Sessions --------------------------------------------------------------

function SessionsCard() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revoke = useMutation({
    mutationFn: () => api.post<{ revoked: number }>('/auth/logout-all-others'),
    onSuccess: ({ revoked }) => {
      setError(null);
      setMessage(
        revoked === 0 ? '目前沒有其他登入中的工作階段。' : `已登出 ${revoked} 個其他工作階段。`,
      );
    },
    onError: (requestError) => {
      setMessage(null);
      setError(describeError(requestError, '無法登出其他工作階段。'));
    },
  });

  return (
    <Card title="工作階段" description="如果懷疑其他裝置仍在登入中，可以一次全部登出。">
      <button
        type="button"
        onClick={() => revoke.mutate()}
        disabled={revoke.isPending}
        className="interactive-muted rounded-lg border border-slate-300 px-4 py-2 font-medium disabled:opacity-50 dark:border-slate-600"
      >
        {revoke.isPending ? '登出中…' : '登出所有其他工作階段'}
      </button>
      <Feedback error={error} success={message} />
    </Card>
  );
}

// --- Shared pieces ---------------------------------------------------------

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="surface rounded-xl p-4 sm:p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
      {children}
    </section>
  );
}

function Feedback({ error, success }: { error: string | null; success: string | null }) {
  if (!error && !success) return null;
  return error ? (
    <p role="alert" className="text-danger text-sm">
      {error}
    </p>
  ) : (
    <p role="status" className="text-sm text-teal-700 dark:text-teal-400">
      {success}
    </p>
  );
}

function SubmitButton({ busy, idle, working }: { busy: boolean; idle: string; working: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50 dark:hover:bg-teal-600"
    >
      {busy ? working : idle}
    </button>
  );
}

/** Keeps cancelled prompts from reading like server failures. */
function describeError(error: unknown, fallback: string): string {
  if (error instanceof PasskeyError) return error.message;
  if (isApiError(error)) return error.message;
  return error instanceof Error ? error.message : fallback;
}
