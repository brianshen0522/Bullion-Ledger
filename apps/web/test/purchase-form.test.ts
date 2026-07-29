import { describe, expect, it } from 'vitest';
import { WEIGHT_INPUT_RE } from '@bullion-ledger/shared';

import {
  convertUnitWeightInput,
  localDateTimeToIso,
  toLocalDateTimeInput,
  validatePurchase,
  type PurchaseValidationInput,
} from '../src/screens/purchase-form.js';

function validPurchase(): PurchaseValidationInput {
  return {
    purchasedAt: '2026-07-28T09:30',
    currency: 'USD',
    subtotal: '100',
    premium: '0',
    labor: '0',
    tax: '0',
    shipping: '0',
    otherFees: '0',
    discount: '0',
    method: 'SUBTOTAL_PROPORTIONAL',
    items: [
      {
        name: 'Gold bar',
        metalCode: 'XAU',
        form: 'bar',
        quantity: '1',
        unitWeight: '1',
        purity: '0.9999',
        lineSubtotal: '100',
        manualAmount: '',
      },
    ],
  };
}

describe('purchase date conversion', () => {
  it('formats the local wall clock rather than UTC fields', () => {
    const localDate = new Date(2026, 6, 28, 9, 7);
    expect(toLocalDateTimeInput(localDate)).toBe('2026-07-28T09:07');
  });

  it('turns the local control value into the matching instant', () => {
    const expected = new Date(2026, 6, 28, 9, 7);
    expect(new Date(localDateTimeToIso('2026-07-28T09:07')).getTime()).toBe(expected.getTime());
  });
});

describe('purchase validation', () => {
  it('accepts a complete positive purchase', () => {
    expect(validatePurchase(validPurchase())).toBeNull();
  });

  it('rejects whitespace-only names', () => {
    const purchase = validPurchase();
    purchase.items[0]!.name = '   ';
    expect(validatePurchase(purchase)).toContain('product name is required');
  });

  it('requires the header subtotal to equal the two-decimal line subtotal sum', () => {
    const purchase = validPurchase();
    purchase.items[0]!.lineSubtotal = '99.99';
    expect(validatePurchase(purchase)).toBe('Subtotal must equal the line subtotal total (99.99).');
  });

  it('rejects negative and mismatched manual allocations', () => {
    const negative = validPurchase();
    negative.method = 'MANUAL';
    negative.items[0]!.manualAmount = '-100';
    expect(validatePurchase(negative)).toContain('zero or greater');

    const mismatched = validPurchase();
    mismatched.method = 'MANUAL';
    mismatched.items[0]!.manualAmount = '99';
    expect(validatePurchase(mismatched)).toContain('must add up');
  });
});

describe('weight-unit input conversion', () => {
  it('preserves the physical weight when the display unit changes', () => {
    expect(convertUnitWeightInput('1000', 'g', 'kg')).toBe('1');
    expect(convertUnitWeightInput('1', 'troy_oz', 'g')).toBe('31.1034768');
    expect(convertUnitWeightInput('3.75', 'g', 'qian')).toBe('1');
  });

  it('keeps repeating conversions inside the API fixed-point scale', () => {
    const converted = convertUnitWeightInput('1', 'kg', 'troy_oz');
    expect(converted).toBe('32.150746569');
    expect(converted).toMatch(WEIGHT_INPUT_RE);
  });
});
