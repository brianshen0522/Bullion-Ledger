import { describe, expect, it } from 'vitest';

import {
  validateAssetDisposal,
  type AssetDisposalFormValues,
} from '../src/screens/asset-disposal-model.js';

function validForm(overrides: Partial<AssetDisposalFormValues> = {}): AssetDisposalFormValues {
  return {
    occurredAt: '2026-07-29T09:07',
    quantity: '2',
    proceedsAmount: '100.5',
    fees: '0.2500',
    ...overrides,
  };
}

describe('asset disposal validation', () => {
  it('accepts fractional currency amounts and converts local time to an instant', () => {
    const result = validateAssetDisposal('SALE', 3, validForm());
    expect(result).toEqual({
      ok: true,
      value: {
        occurredAt: new Date('2026-07-29T09:07').toISOString(),
        quantity: 2,
        proceedsAmount: '100.5',
        fees: '0.2500',
      },
    });
  });

  it('requires a whole quantity within the currently held balance', () => {
    for (const quantity of ['', '0', '-1', '1.5', '1e2', '4']) {
      const result = validateAssetDisposal('LOST', 3, validForm({ quantity }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.field).toBe('quantity');
    }
  });

  it('rejects negative, exponential, over-precision, and over-limit proceeds', () => {
    for (const proceedsAmount of ['-1', '1e2', '1.00001', '100000000000000', '01']) {
      const result = validateAssetDisposal('SALE', 3, validForm({ proceedsAmount }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.field).toBe('proceedsAmount');
    }
  });

  it('applies the same fixed-point validation to fees', () => {
    const result = validateAssetDisposal('SALE', 3, validForm({ fees: '-0.01' }));
    expect(result).toMatchObject({ ok: false, field: 'fees' });
  });

  it('normalizes an optional blank fee to zero', () => {
    const result = validateAssetDisposal('SALE', 3, validForm({ fees: '   ' }));
    expect(result).toMatchObject({ ok: true, value: { fees: '0' } });
  });

  it('does not require sale-only amounts for gifts or losses', () => {
    for (const action of ['GIFT_OUT', 'LOST'] as const) {
      expect(
        validateAssetDisposal(action, 3, validForm({ proceedsAmount: '', fees: '-1' })),
      ).toMatchObject({ ok: true, value: { quantity: 2 } });
    }
  });

  it('rejects an invalid date before building a request payload', () => {
    expect(validateAssetDisposal('SALE', 3, validForm({ occurredAt: '' }))).toMatchObject({
      ok: false,
      field: 'occurredAt',
    });
  });
});
