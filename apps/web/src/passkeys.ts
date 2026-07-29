import { api, type Passkey } from './api.js';
import {
  createPasskeyCredential,
  getPasskeyAssertion,
  type AuthenticationOptionsJSON,
  type CeremonyOptions,
  type RegistrationOptionsJSON,
} from './webauthn.js';

/**
 * The three passkey ceremonies as single calls (PRD §5.2, §4.3).
 *
 * Each is strictly options → prompt → verify. The `challengeId` returned by the
 * server is echoed back untouched; the browser never chooses its own challenge.
 */

export async function registerPasskey(name?: string): Promise<Passkey> {
  const { challengeId, options } = await api.post<CeremonyOptions<RegistrationOptionsJSON>>(
    '/auth/passkey/register/options',
  );
  const response = await createPasskeyCredential(options);
  return api.post<Passkey>('/auth/passkey/register/verify', {
    challengeId,
    response,
    ...(name?.trim() ? { name: name.trim() } : {}),
  });
}

export async function loginWithPasskey(): Promise<{ username: string }> {
  const { challengeId, options } = await api.post<CeremonyOptions<AuthenticationOptionsJSON>>(
    '/auth/passkey/login/options',
  );
  const response = await getPasskeyAssertion(options);
  return api.post<{ username: string }>('/auth/passkey/login/verify', { challengeId, response });
}

/**
 * Elevates the current session so one sensitive change can proceed without the
 * account password. The elevation is single-use and short-lived server-side.
 */
export async function reauthenticateWithPasskey(): Promise<void> {
  const { challengeId, options } = await api.post<CeremonyOptions<AuthenticationOptionsJSON>>(
    '/auth/passkey/reauth/options',
  );
  const response = await getPasskeyAssertion(options);
  await api.post<{ ok: true }>('/auth/passkey/reauth/verify', { challengeId, response });
}
