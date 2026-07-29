import type { Passkey } from '../api.js';

export const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;
/** Non-empty only; no length policy is imposed on the owner's own password. */
export const MIN_PASSWORD_LENGTH = 1;

/** How the user proves who they are before a sensitive change (PRD §4.3). */
export type ReauthMethod = 'password' | 'passkey';

export interface PasswordFormState {
  newPassword: string;
  confirmPassword: string;
  currentPassword: string;
  method: ReauthMethod;
}

export interface UsernameFormState {
  username: string;
  currentPassword: string;
  method: ReauthMethod;
}

/**
 * Returns the reason the password form cannot be submitted, or null when it is
 * valid. Confirmation is checked here rather than server-side because the
 * server has no extra information to check it against — the second entry exists
 * to catch the user's own typo before it becomes an unknown password.
 */
export function validatePasswordForm(state: PasswordFormState): string | null {
  if (state.newPassword.length < MIN_PASSWORD_LENGTH) {
    return '請輸入新密碼。';
  }
  if (state.confirmPassword.length === 0) {
    return '請再次輸入新密碼以確認。';
  }
  if (state.newPassword !== state.confirmPassword) {
    return '兩次輸入的新密碼不一致。';
  }
  if (state.method === 'password' && state.currentPassword.length === 0) {
    return '請輸入目前的密碼。';
  }
  if (state.method === 'password' && state.currentPassword === state.newPassword) {
    return '新密碼不可與目前密碼相同。';
  }
  return null;
}

/** Same contract as validatePasswordForm, for the username form. */
export function validateUsernameForm(
  state: UsernameFormState,
  currentUsername: string,
): string | null {
  if (!USERNAME_RE.test(state.username)) {
    return '使用者名稱需為 3-64 個字元，僅能使用 A-Z a-z 0-9 . _ -。';
  }
  if (state.username === currentUsername) {
    return '新的使用者名稱與目前相同。';
  }
  if (state.method === 'password' && state.currentPassword.length === 0) {
    return '請輸入目前的密碼。';
  }
  return null;
}

/**
 * Builds the change-password request body. `currentPassword` is omitted for the
 * passkey path so the server falls through to the session step-up it recorded.
 */
export function passwordChangePayload(state: PasswordFormState): Record<string, string> {
  return state.method === 'password'
    ? { newPassword: state.newPassword, currentPassword: state.currentPassword }
    : { newPassword: state.newPassword };
}

export function usernameChangePayload(state: UsernameFormState): Record<string, string> {
  return state.method === 'password'
    ? { username: state.username, currentPassword: state.currentPassword }
    : { username: state.username };
}

/** Display label for a passkey that the user never bothered to name. */
export function passkeyLabel(passkey: Passkey): string {
  if (passkey.name) return passkey.name;
  if (passkey.transports.includes('internal')) return '此裝置的密碼金鑰';
  return '未命名的密碼金鑰';
}

export function formatTimestamp(value: string | null): string {
  if (!value) return '尚未使用';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}
