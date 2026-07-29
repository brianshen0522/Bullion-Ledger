/**
 * Browser half of the WebAuthn ceremonies (PRD §5.2).
 *
 * The WebAuthn DOM API speaks ArrayBuffer while the server speaks base64url
 * JSON, so this module is the single translation layer between them. It is
 * written by hand rather than pulled from `@simplewebauthn/browser` to keep the
 * web bundle's dependency set unchanged; the encoding rules are fixed by the
 * spec, so there is nothing here that drifts.
 */

/** Server-issued ceremony envelope: an options blob plus the challenge handle. */
export interface CeremonyOptions<T> {
  challengeId: string;
  options: T;
}

export interface RegistrationOptionsJSON {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { alg: number; type: 'public-key' }[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  excludeCredentials?: { id: string; type?: string; transports?: string[] }[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
}

export interface AuthenticationOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: { id: string; type?: string; transports?: string[] }[];
  userVerification?: UserVerificationRequirement;
}

/** Thrown for outcomes the UI should explain rather than treat as a crash. */
export class PasskeyError extends Error {
  constructor(
    message: string,
    readonly reason: 'cancelled' | 'unsupported' | 'duplicate' | 'failed',
  ) {
    super(message);
    this.name = 'PasskeyError';
  }
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  // Chunked to avoid blowing the argument limit on large attestation objects.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Whether this browser exposes WebAuthn at all. */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.credentials !== undefined
  );
}

/**
 * Whether a built-in authenticator (Touch ID, Face ID, Windows Hello) is
 * present. Used to phrase the button honestly instead of promising Touch ID on
 * a machine that has none.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function createPasskeyCredential(
  options: RegistrationOptionsJSON,
): Promise<Record<string, unknown>> {
  requireSupport();
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: toBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: toBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    attestation: options.attestation,
    authenticatorSelection: options.authenticatorSelection,
    excludeCredentials: options.excludeCredentials?.map((credential) => ({
      id: toBuffer(credential.id),
      type: 'public-key' as const,
      transports: credential.transports as AuthenticatorTransport[] | undefined,
    })),
  };

  const credential = await request(() => navigator.credentials.create({ publicKey }));
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      attestationObject: bytesToBase64Url(response.attestationObject),
      transports: safeTransports(response),
    },
  };
}

export async function getPasskeyAssertion(
  options: AuthenticationOptionsJSON,
): Promise<Record<string, unknown>> {
  requireSupport();
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: toBuffer(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    userVerification: options.userVerification,
    allowCredentials: options.allowCredentials?.map((credential) => ({
      id: toBuffer(credential.id),
      type: 'public-key' as const,
      transports: credential.transports as AuthenticatorTransport[] | undefined,
    })),
  };

  const credential = await request(() => navigator.credentials.get({ publicKey }));
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      userHandle: response.userHandle ? bytesToBase64Url(response.userHandle) : undefined,
    },
  };
}

// --- internals -------------------------------------------------------------

function requireSupport(): void {
  if (!isPasskeySupported()) {
    throw new PasskeyError('This browser does not support passkeys.', 'unsupported');
  }
}

function toBuffer(value: string): ArrayBuffer {
  const bytes = base64UrlToBytes(value);
  // Copy into a standalone ArrayBuffer so the view's byteOffset never matters.
  return bytes.slice().buffer;
}

/** Normalizes the DOM's error vocabulary into outcomes the UI can phrase. */
async function request(invoke: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
  let credential: Credential | null;
  try {
    credential = await invoke();
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new PasskeyError('Passkey prompt was cancelled or timed out.', 'cancelled');
    }
    if (name === 'InvalidStateError') {
      throw new PasskeyError('This device already has a passkey for this account.', 'duplicate');
    }
    if (name === 'SecurityError' || name === 'NotSupportedError') {
      throw new PasskeyError(
        'Passkeys need a secure origin (HTTPS or localhost) that matches the configured domain.',
        'unsupported',
      );
    }
    throw new PasskeyError(
      error instanceof Error ? error.message : 'The passkey prompt failed.',
      'failed',
    );
  }

  if (!credential) {
    throw new PasskeyError('No passkey was returned by the browser.', 'failed');
  }
  return credential as PublicKeyCredential;
}

/** `getTransports()` is not implemented everywhere; its absence is harmless. */
function safeTransports(response: AuthenticatorAttestationResponse): string[] | undefined {
  if (typeof response.getTransports !== 'function') return undefined;
  try {
    return response.getTransports();
  } catch {
    return undefined;
  }
}
