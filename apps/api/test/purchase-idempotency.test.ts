import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  hashIdempotencyKey,
  hashPurchaseRequest,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  isIdempotencyKeyUniqueConflict,
  requireIdempotencyKey,
} from '../src/purchases/purchase-idempotency';
import type { PurchaseDto } from '../src/purchases/dto/purchase.dto';

function request(overrides: Partial<PurchaseDto> = {}): PurchaseDto {
  return {
    purchasedAt: '2026-07-28T00:00:00.000Z',
    currency: 'USD',
    subtotal: '100',
    allocationMethod: 'EQUAL',
    items: [
      {
        metalCode: 'XAU',
        form: 'bar',
        name: 'Gold bar',
        quantity: 1,
        unitWeight: '1',
        weightUnit: 'g',
        purity: '0.9999',
        lineSubtotal: '100',
      },
    ],
    ...overrides,
  };
}

describe('purchase idempotency helpers', () => {
  it.each([
    undefined,
    '',
    'short',
    'contains space',
    '-cannot-start-with-symbol',
    '含有非ASCII',
    'a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1),
  ])('rejects a missing or malformed key: %s', (value) => {
    expect(() => requireIdempotencyKey(value)).toThrow(BadRequestException);
  });

  it('accepts a bounded opaque ASCII key and stores only its digest', () => {
    const key = 'purchase:01J3QZNE6JRC3KAM10AY5Z9Q7M';
    expect(requireIdempotencyKey(key)).toBe(key);
    expect(hashIdempotencyKey(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashIdempotencyKey(key)).not.toContain(key);
  });

  it('canonicalizes optional zeroes, decimal spellings, and persisted whitespace', () => {
    const first = request({ premium: undefined, subtotal: '100.00' });
    const second = request({ premium: '0.0000', subtotal: '100' });
    first.items[0]!.unitWeight = '1.000000000';
    first.items[0]!.form = ' bar ';

    expect(hashPurchaseRequest(first)).toBe(hashPurchaseRequest(second));
  });

  it('ignores a manual allocation hint when the selected method does not persist it', () => {
    const withUnusedHint = request();
    withUnusedHint.items[0]!.manualAmount = '99.99';
    expect(hashPurchaseRequest(withUnusedHint)).toBe(hashPurchaseRequest(request()));
  });

  it('changes the request hash when persisted content changes', () => {
    expect(hashPurchaseRequest(request())).not.toBe(
      hashPurchaseRequest(request({ notes: 'different' })),
    );
  });

  it('includes the wizard item id because it controls attachment-to-asset reassignment', () => {
    const first = request();
    first.items[0]!.draftItemId = 'draft-item-1';
    const second = request();
    second.items[0]!.draftItemId = 'draft-item-2';
    expect(hashPurchaseRequest(first)).not.toBe(hashPurchaseRequest(second));
  });

  it('canonicalizes custom party ordering but detects a changed party', () => {
    const first = request();
    first.items[0]!.parties = [
      { organizationId: 'org-pamp', role: 'BRAND', attributionStatus: 'VERIFIED' },
      { displayName: 'Independent Assayer', role: 'ASSAYER' },
    ];
    const reordered = request();
    reordered.items[0]!.parties = [...first.items[0]!.parties].reverse();
    const changed = request();
    changed.items[0]!.parties = [{ organizationId: 'org-other', role: 'BRAND' }];

    expect(hashPurchaseRequest(first)).toBe(hashPurchaseRequest(reordered));
    expect(hashPurchaseRequest(first)).not.toBe(hashPurchaseRequest(changed));
  });

  it('absent and explicit version 1 produce the same legacy hash', () => {
    const absent = request();
    absent.items[0]!.productDefinitionId = 'product-1';
    const explicit1 = request();
    explicit1.items[0]!.productDefinitionId = 'product-1';
    explicit1.items[0]!.productDefinitionVersion = 1;

    expect(hashPurchaseRequest(absent)).toBe(hashPurchaseRequest(explicit1));
    expect(hashPurchaseRequest(explicit1)).toBe(
      '3dfd2072e83b6943d35582944dc9225908c73473226f3d66843b4f3fb78283df',
    );
  });

  it('version > 1 produces a different hash from absent/1', () => {
    const absent = request();
    absent.items[0]!.productDefinitionId = 'product-1';
    const version2 = request();
    version2.items[0]!.productDefinitionId = 'product-1';
    version2.items[0]!.productDefinitionVersion = 2;

    expect(hashPurchaseRequest(version2)).not.toBe(hashPurchaseRequest(absent));
  });

  it('recognizes only the intended Prisma unique constraint', () => {
    expect(
      isIdempotencyKeyUniqueConflict({
        code: 'P2002',
        meta: { target: ['idempotencyKeyHash'] },
      }),
    ).toBe(true);
    expect(
      isIdempotencyKeyUniqueConflict({ code: 'P2002', meta: { target: ['storageKey'] } }),
    ).toBe(false);
    expect(isIdempotencyKeyUniqueConflict(new Error('no'))).toBe(false);
  });
});
