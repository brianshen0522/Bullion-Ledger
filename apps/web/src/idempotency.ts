export interface IdempotencyAttempt {
  key: string;
  payloadFingerprint: string;
}

/** Produces a backend-compatible, collision-resistant purchase idempotency key. */
export function createPurchaseIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) return `purchase:${webCrypto.randomUUID()}`;

  if (webCrypto?.getRandomValues) {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    return `purchase:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  // Legacy/non-secure browser fallback. This identifier is not an authentication secret.
  return `purchase:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Reuses a key only while the submitted payload is byte-for-byte unchanged. */
export function resolveIdempotencyAttempt(
  previous: IdempotencyAttempt | null,
  payloadFingerprint: string,
  createKey: () => string = createPurchaseIdempotencyKey,
): IdempotencyAttempt {
  if (previous?.payloadFingerprint === payloadFingerprint) return previous;
  return { key: createKey(), payloadFingerprint };
}
