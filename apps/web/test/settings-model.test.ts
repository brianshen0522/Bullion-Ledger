import { describe, expect, it } from 'vitest';

import {
  formatTimestamp,
  passkeyLabel,
  passwordChangePayload,
  usernameChangePayload,
  validatePasswordForm,
  validateUsernameForm,
} from '../src/screens/settings-model.js';
import { loginWithPasskeyUnavailable } from '../src/screens/settings-copy.js';

const validPassword = 'a-sufficiently-long-secret';

describe('password change form', () => {
  it('accepts a long password confirmed twice with the current password', () => {
    expect(
      validatePasswordForm({
        newPassword: validPassword,
        confirmPassword: validPassword,
        currentPassword: 'old-secret',
        method: 'password',
      }),
    ).toBeNull();
  });

  it('rejects a mismatched confirmation before anything is sent', () => {
    expect(
      validatePasswordForm({
        newPassword: validPassword,
        confirmPassword: 'a-sufficiently-long-secreT',
        currentPassword: 'old-secret',
        method: 'password',
      }),
    ).toBe('兩次輸入的新密碼不一致。');
  });

  it('requires the confirmation to actually be filled in', () => {
    expect(
      validatePasswordForm({
        newPassword: validPassword,
        confirmPassword: '',
        currentPassword: 'old-secret',
        method: 'password',
      }),
    ).toBe('請再次輸入新密碼以確認。');
  });

  it('accepts a short password — no length policy is imposed', () => {
    expect(
      validatePasswordForm({
        newPassword: 'short',
        confirmPassword: 'short',
        currentPassword: 'old-secret',
        method: 'password',
      }),
    ).toBeNull();
  });

  it('still requires the new password to be entered at all', () => {
    expect(
      validatePasswordForm({
        newPassword: '',
        confirmPassword: '',
        currentPassword: 'old-secret',
        method: 'password',
      }),
    ).toBe('請輸入新密碼。');
  });

  it('requires the current password on the password path', () => {
    expect(
      validatePasswordForm({
        newPassword: validPassword,
        confirmPassword: validPassword,
        currentPassword: '',
        method: 'password',
      }),
    ).toBe('請輸入目前的密碼。');
  });

  it('rejects reusing the current password as the new one', () => {
    expect(
      validatePasswordForm({
        newPassword: validPassword,
        confirmPassword: validPassword,
        currentPassword: validPassword,
        method: 'password',
      }),
    ).toBe('新密碼不可與目前密碼相同。');
  });

  it('does not ask for the current password on the passkey path', () => {
    expect(
      validatePasswordForm({
        newPassword: validPassword,
        confirmPassword: validPassword,
        currentPassword: '',
        method: 'passkey',
      }),
    ).toBeNull();
  });

  it('omits the password field entirely when verifying with a passkey', () => {
    expect(
      passwordChangePayload({
        newPassword: validPassword,
        confirmPassword: validPassword,
        currentPassword: 'leftover-typed-value',
        method: 'passkey',
      }),
    ).toEqual({ newPassword: validPassword });
  });

  it('sends the current password on the password path', () => {
    expect(
      passwordChangePayload({
        newPassword: validPassword,
        confirmPassword: validPassword,
        currentPassword: 'old-secret',
        method: 'password',
      }),
    ).toEqual({ newPassword: validPassword, currentPassword: 'old-secret' });
  });
});

describe('username change form', () => {
  it('accepts a valid new username', () => {
    expect(
      validateUsernameForm(
        { username: 'brian.new', currentPassword: 'old-secret', method: 'password' },
        'brian',
      ),
    ).toBeNull();
  });

  it('rejects characters the server would refuse', () => {
    for (const username of ['ab', 'has space', 'emoji🙂', 'a'.repeat(65)]) {
      expect(
        validateUsernameForm({ username, currentPassword: 'x', method: 'password' }, 'brian'),
      ).not.toBeNull();
    }
  });

  it('rejects a no-op rename', () => {
    expect(
      validateUsernameForm(
        { username: 'brian', currentPassword: 'old-secret', method: 'password' },
        'brian',
      ),
    ).toBe('新的使用者名稱與目前相同。');
  });

  it('omits the password when verifying with a passkey', () => {
    expect(
      usernameChangePayload({
        username: 'brian.new',
        currentPassword: 'leftover',
        method: 'passkey',
      }),
    ).toEqual({ username: 'brian.new' });
  });
});

describe('passkey presentation', () => {
  const base = {
    id: 'p1',
    createdAt: '2026-07-01T10:00:00.000Z',
    lastUsedAt: null,
    transports: [] as string[],
    backedUp: false,
    deviceType: null,
  };

  it('prefers the user-given name', () => {
    expect(passkeyLabel({ ...base, name: 'MacBook Touch ID' })).toBe('MacBook Touch ID');
  });

  it('falls back to a device-aware label for unnamed credentials', () => {
    expect(passkeyLabel({ ...base, name: null, transports: ['internal'] })).toBe(
      '此裝置的密碼金鑰',
    );
    expect(passkeyLabel({ ...base, name: null })).toBe('未命名的密碼金鑰');
  });

  it('says so plainly when a passkey has never been used', () => {
    expect(formatTimestamp(null)).toBe('尚未使用');
    expect(formatTimestamp('not-a-date')).toBe('—');
  });
});

describe('passkey availability messaging', () => {
  it('stays quiet once everything is available', () => {
    expect(
      loginWithPasskeyUnavailable({
        statusResolved: true,
        serverSupportsPasskeys: true,
        browserSupported: true,
      }),
    ).toBeNull();
  });

  it('distinguishes an unconfigured deployment from an unsupported browser', () => {
    const unconfigured = loginWithPasskeyUnavailable({
      statusResolved: true,
      serverSupportsPasskeys: false,
      browserSupported: true,
    });
    const unsupported = loginWithPasskeyUnavailable({
      statusResolved: true,
      serverSupportsPasskeys: true,
      browserSupported: false,
    });

    expect(unconfigured).toContain('WEBAUTHN_RP_ID');
    expect(unsupported).toContain('瀏覽器');
    expect(unconfigured).not.toBe(unsupported);
  });
});
