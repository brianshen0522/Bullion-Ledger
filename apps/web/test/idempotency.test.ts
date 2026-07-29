import { describe, expect, it, vi } from 'vitest';

import { createPurchaseIdempotencyKey, resolveIdempotencyAttempt } from '../src/idempotency.js';

describe('purchase idempotency attempts', () => {
  it('generates a backend-compatible key', () => {
    expect(createPurchaseIdempotencyKey()).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  });

  it('reuses a key for retries and rotates it when the payload changes', () => {
    const createKey = vi
      .fn()
      .mockReturnValueOnce('purchase:key-1')
      .mockReturnValueOnce('purchase:key-2')
      .mockReturnValueOnce('purchase:key-3');
    const first = resolveIdempotencyAttempt(null, '{"subtotal":"1"}', createKey);
    const retry = resolveIdempotencyAttempt(first, '{"subtotal":"1"}', createKey);
    const edited = resolveIdempotencyAttempt(first, '{"subtotal":"2"}', createKey);
    const afterSuccess = resolveIdempotencyAttempt(null, '{"subtotal":"1"}', createKey);

    expect(retry).toBe(first);
    expect(edited.key).toBe('purchase:key-2');
    expect(afterSuccess.key).toBe('purchase:key-3');
    expect(createKey).toHaveBeenCalledTimes(3);
  });
});
