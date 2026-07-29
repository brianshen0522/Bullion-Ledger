import { useRef, useState, type FormEvent } from 'react';

import { isApiError } from '../api.js';
import { Field } from './Init.js';
import {
  MIN_BACKUP_PASSPHRASE,
  describeManifest,
  type BackupManifestSummary,
} from './backup-model.js';

const BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');

/**
 * Backup and restore (PRD §24).
 *
 * Restore is deliberately a three-step flow — choose file, inspect, then
 * confirm — because it replaces the account credentials with the ones inside
 * the archive. Someone who cannot sign in afterwards has lost the ledger, so
 * the consequence is stated before the button that causes it.
 */
export function BackupSection({ canReauthWithPasskey }: { canReauthWithPasskey: boolean }) {
  return (
    <section className="surface rounded-xl p-4 sm:p-5">
      <h2 className="text-lg font-semibold">備份與還原</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600 dark:text-slate-300">
        備份包含帳號、密碼雜湊、密碼金鑰、所有庫存與商品規格，以及全部照片與文件。
        檔案一律以你設定的通行碼加密。
      </p>
      <ExportPanel canReauthWithPasskey={canReauthWithPasskey} />
      <hr className="my-5 border-slate-200 dark:border-slate-700" />
      <RestorePanel />
    </section>
  );
}

function ExportPanel({ canReauthWithPasskey }: { canReauthWithPasskey: boolean }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (passphrase.length < MIN_BACKUP_PASSPHRASE) {
      setError(`通行碼至少需要 ${MIN_BACKUP_PASSPHRASE} 個字元。`);
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError('兩次輸入的通行碼不一致。');
      return;
    }

    setBusy(true);
    try {
      // Downloaded through fetch rather than a link so the passphrase and
      // re-authentication travel in a POST body, never in a URL.
      const response = await fetch(`${BASE}/backup/export`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passphrase,
          ...(currentPassword ? { currentPassword } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `匯出失敗（HTTP ${response.status}）`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bullion-ledger-${new Date().toISOString().slice(0, 10)}.blbak`;
      anchor.click();
      URL.revokeObjectURL(url);

      setDone(`已下載備份檔（${(blob.size / 1024 / 1024).toFixed(2)} MB）。`);
      setPassphrase('');
      setConfirmPassphrase('');
      setCurrentPassword('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '匯出失敗。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h3 className="font-medium">匯出備份</h3>
      <Field
        label={`備份通行碼（至少 ${MIN_BACKUP_PASSPHRASE} 個字元）`}
        type="password"
        value={passphrase}
        onChange={setPassphrase}
        autoComplete="new-password"
        required
      />
      <Field
        label="再次輸入通行碼"
        type="password"
        value={confirmPassphrase}
        onChange={setConfirmPassphrase}
        autoComplete="new-password"
        required
      />
      <Field
        label={canReauthWithPasskey ? '目前的密碼（或先用密碼金鑰驗證）' : '目前的密碼'}
        type="password"
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
      />
      <p className="text-sm text-amber-700 dark:text-amber-400">
        忘記通行碼就無法還原這個檔案 — 系統沒有保留任何副本。
      </p>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-teal-700 dark:text-teal-400">
          {done}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-sm disabled:opacity-50"
      >
        {busy ? '匯出中…' : '匯出備份'}
      </button>
    </form>
  );
}

function RestorePanel() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [manifest, setManifest] = useState<BackupManifestSummary | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function readFile(file: File) {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    setFileBase64(btoa(binary));
    setFileName(file.name);
    setManifest(null);
    setConfirmed(false);
  }

  async function call(path: string, body: unknown) {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new Error((parsed?.message as string) ?? `失敗（HTTP ${response.status}）`);
    }
    return parsed;
  }

  async function inspect() {
    setError(null);
    setBusy(true);
    try {
      const parsed = await call('/backup/inspect', { file: fileBase64, passphrase });
      setManifest(parsed as unknown as BackupManifestSummary);
    } catch (requestError) {
      setError(
        requestError instanceof Error || isApiError(requestError)
          ? (requestError as Error).message
          : '無法讀取備份檔。',
      );
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setError(null);
    setBusy(true);
    try {
      const parsed = await call('/backup/restore', {
        file: fileBase64,
        passphrase,
        ...(currentPassword ? { currentPassword } : {}),
      });
      setResult((parsed?.message as string) ?? '還原完成。');
      // The account has been replaced, so this session is already invalid.
      setTimeout(() => window.location.reload(), 4000);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '還原失敗。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="font-medium">從備份還原</h3>
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
        <p className="font-medium text-amber-900 dark:text-amber-100">還原會取代目前的所有資料</p>
        <p className="mt-1 text-amber-900 dark:text-amber-200">
          包含<strong>帳號、密碼與密碼金鑰</strong>。還原後必須用備份檔裡的帳號密碼登入，
          目前的密碼將立即失效。
        </p>
      </div>

      <div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">備份檔（.blbak）</span>
          <input
            ref={fileRef}
            type="file"
            accept=".blbak"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </label>
        {fileName && <p className="mt-1 text-xs text-slate-500">已選擇：{fileName}</p>}
      </div>

      <Field
        label="備份通行碼"
        type="password"
        value={passphrase}
        onChange={setPassphrase}
        autoComplete="off"
      />

      {manifest && (
        <div className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">
          <p className="font-medium">這個備份檔包含</p>
          <ul className="mt-2 space-y-0.5">
            {describeManifest(manifest).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {manifest && (
        <>
          <Field
            label="目前的密碼（確認是你本人）"
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-5 w-5"
            />
            <span>我了解還原會刪除目前所有資料，並改用備份檔中的帳號與密碼金鑰登入。</span>
          </label>
        </>
      )}

      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="text-sm text-teal-700 dark:text-teal-400">
          {result} 頁面即將重新載入…
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void inspect()}
          disabled={busy || !fileBase64 || passphrase.length === 0}
          className="interactive-muted rounded-lg border border-slate-300 px-4 py-2 font-medium disabled:opacity-50 dark:border-slate-600"
        >
          {busy && !manifest ? '讀取中…' : '讀取備份內容'}
        </button>
        <button
          type="button"
          onClick={() => void restore()}
          disabled={busy || !manifest || !confirmed}
          className="rounded-lg bg-red-700 px-4 py-2 font-medium text-white shadow-sm disabled:opacity-50"
        >
          {busy && manifest ? '還原中…' : '確認還原'}
        </button>
      </div>
    </div>
  );
}
