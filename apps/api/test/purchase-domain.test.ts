import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@bullion-ledger/shared';

import { computePurchase, MAX_PURCHASE_ITEMS } from '../src/purchases/purchase-domain';

function item(overrides: Partial<Parameters<typeof computePurchase>[0]['items'][number]> = {}) {
  return {
    metalId: 'gold-1',
    form: 'bar',
    name: 'Test bar',
    quantity: 1,
    unitWeight: '1',
    weightUnit: 'g',
    purity: '0.9999',
    lineSubtotal: '100',
    ...overrides,
  };
}

function sumAllocated(items: { allocatedCost: Decimal }[]): Decimal {
  return items.reduce((acc, i) => acc.plus(i.allocatedCost), new Decimal(0));
}

describe('computePurchase reconciliation', () => {
  it('rejects empty item list', () => {
    expect(() =>
      computePurchase({
        currency: 'USD',
        subtotal: '0',
        allocationMethod: 'EQUAL',
        items: [],
      }),
    ).toThrow(ArgumentError);
  });

  it('rejects currency code that is not 3-letter uppercase', () => {
    expect(() =>
      computePurchase({
        currency: 'usd',
        subtotal: '100',
        allocationMethod: 'EQUAL',
        items: [item()],
      }),
    ).toThrow(ArgumentError);
  });

  it('rejects when subtotal does not equal sum of line subtotals', () => {
    expect(() =>
      computePurchase({
        currency: 'USD',
        subtotal: '999',
        allocationMethod: 'EQUAL',
        items: [item({ lineSubtotal: '100' }), item({ lineSubtotal: '100' })],
      }),
    ).toThrow(ArgumentError);
  });

  it('rejects purity > 1', () => {
    expect(() =>
      computePurchase({
        currency: 'USD',
        subtotal: '100',
        allocationMethod: 'EQUAL',
        items: [item({ purity: '1.5' })],
      }),
    ).toThrow(ArgumentError);
  });

  it('rejects fractional quantity', () => {
    expect(() =>
      computePurchase({
        currency: 'USD',
        subtotal: '100',
        allocationMethod: 'EQUAL',
        items: [item({ quantity: 1.5 as unknown as number })],
      }),
    ).toThrow(ArgumentError);
  });

  it('rejects blank identifying fields', () => {
    for (const invalid of [item({ metalId: '   ' }), item({ form: '\t' }), item({ name: '' })]) {
      expect(() =>
        computePurchase({
          currency: 'USD',
          subtotal: '100',
          allocationMethod: 'EQUAL',
          items: [invalid],
        }),
      ).toThrow(ArgumentError);
    }
  });

  it('rejects purchases above the bounded item count', () => {
    expect(() =>
      computePurchase({
        currency: 'USD',
        subtotal: '0',
        allocationMethod: 'EQUAL',
        items: Array.from({ length: MAX_PURCHASE_ITEMS + 1 }, () => item({ lineSubtotal: '0' })),
      }),
    ).toThrow(ArgumentError);
  });

  it('rejects precision and range that cannot fit database columns', () => {
    expect(() =>
      computePurchase({
        currency: 'USD',
        subtotal: '100',
        allocationMethod: 'EQUAL',
        items: [item({ purity: '0.12345678' })],
      }),
    ).toThrow(ArgumentError);

    expect(() =>
      computePurchase({
        currency: 'USD',
        subtotal: '100',
        allocationMethod: 'EQUAL',
        items: [item({ unitWeight: '1000000000', weightUnit: 'g' })],
      }),
    ).toThrow(ArgumentError);

    expect(() =>
      computePurchase({
        currency: 'USD',
        subtotal: '99999999999999.99',
        premium: '0.01',
        allocationMethod: 'EQUAL',
        items: [item({ lineSubtotal: '99999999999999.99' })],
      }),
    ).toThrow(ArgumentError);
  });

  it('computes fine weight = gross × purity across quantity', () => {
    const r = computePurchase({
      currency: 'USD',
      subtotal: '100',
      allocationMethod: 'EQUAL',
      items: [
        item({
          quantity: 10,
          unitWeight: '1',
          weightUnit: 'troy_oz',
          purity: '0.9999',
        }),
      ],
    });
    const fine = r.items[0]!.fineWeightGrams;
    // 1 troy oz = 31.1034768 g; × 10 coins; × 0.9999
    expect(fine.toDecimalPlaces(8).toString()).toBe('311.00366452');
  });
});

describe('allocation integration inside computePurchase', () => {
  it('MANUAL preserves caller amounts', () => {
    const r = computePurchase({
      currency: 'TWD',
      subtotal: '3000',
      allocationMethod: 'MANUAL',
      items: [
        item({ lineSubtotal: '1500', manualAmount: '1800' }),
        item({ lineSubtotal: '1500', manualAmount: '1200' }),
      ],
    });
    expect(r.items.map((i) => i.allocatedCost.toString())).toEqual(['1800', '1200']);
    expect(sumAllocated(r.items).toString()).toBe(r.totalAmount.toString());
  });

  it('MANUAL rejects when amounts do not sum to total', () => {
    expect(() =>
      computePurchase({
        currency: 'TWD',
        subtotal: '3000',
        premium: '500',
        allocationMethod: 'MANUAL',
        items: [
          item({ lineSubtotal: '1500', manualAmount: '1800' }),
          item({ lineSubtotal: '1500', manualAmount: '1200' }),
        ],
      }),
    ).toThrow(ArgumentError);
  });

  it('SUBTOTAL_PROPORTIONAL splits total exactly including fees', () => {
    const r = computePurchase({
      currency: 'TWD',
      subtotal: '1000',
      premium: '100',
      labor: '0',
      allocationMethod: 'SUBTOTAL_PROPORTIONAL',
      items: [item({ lineSubtotal: '600' }), item({ lineSubtotal: '400' })],
    });
    // total 1100 over 6:4 => 660 / 440
    expect(r.totalAmount.toString()).toBe('1100');
    expect(r.items.map((i) => i.allocatedCost.toString())).toEqual(['660', '440']);
    expect(sumAllocated(r.items).eq(r.totalAmount)).toBe(true);
  });

  it('WEIGHT_PROPORTIONAL splits by fine weight', () => {
    const r = computePurchase({
      currency: 'USD',
      subtotal: '2000',
      allocationMethod: 'WEIGHT_PROPORTIONAL',
      items: [
        item({ lineSubtotal: '1000', unitWeight: '20', purity: '0.9999' }),
        item({ lineSubtotal: '1000', unitWeight: '10', purity: '0.9999' }),
      ],
    });
    expect(r.totalAmount.toString()).toBe('2000');
    // weights 20:10 -> 2:1 of 2000 => 1333.33 / 666.67
    expect(r.items.map((i) => i.allocatedCost.toString())).toEqual(['1333.33', '666.67']);
    expect(sumAllocated(r.items).eq(r.totalAmount)).toBe(true);
  });

  it('EQUAL distributes remainder deterministically', () => {
    const r = computePurchase({
      currency: 'USD',
      subtotal: '100',
      allocationMethod: 'EQUAL',
      items: [
        item({ lineSubtotal: '33.34' }),
        item({ lineSubtotal: '33.33' }),
        item({ lineSubtotal: '33.33' }),
      ],
    });
    expect(r.items.map((i) => i.allocatedCost.toString())).toEqual(['33.34', '33.33', '33.33']);
    expect(sumAllocated(r.items).eq(r.totalAmount)).toBe(true);
  });

  it('handles discount that reduces total to zero', () => {
    const r = computePurchase({
      currency: 'USD',
      subtotal: '100',
      discount: '100',
      allocationMethod: 'EQUAL',
      items: [item({ lineSubtotal: '50' }), item({ lineSubtotal: '50' })],
    });
    expect(r.totalAmount.toString()).toBe('0');
    expect(r.items.every((i) => i.allocatedCost.isZero())).toBe(true);
    expect(sumAllocated(r.items).eq(r.totalAmount)).toBe(true);
  });

  it('handles high-precision weights without drift', () => {
    const r = computePurchase({
      currency: 'USD',
      subtotal: '1234.56',
      premium: '765.44',
      allocationMethod: 'WEIGHT_PROPORTIONAL',
      items: [
        item({
          lineSubtotal: '617.28',
          unitWeight: '31.1034768',
          weightUnit: 'troy_oz',
          purity: '0.9999',
        }),
        item({
          lineSubtotal: '617.28',
          unitWeight: '15.5517384',
          weightUnit: 'troy_oz',
          purity: '0.9999',
        }),
        item({
          lineSubtotal: '0',
          unitWeight: '46.6552152',
          weightUnit: 'troy_oz',
          purity: '0.9999',
        }),
      ],
    });
    expect(r.totalAmount.toString()).toBe('2000');
    expect(sumAllocated(r.items).eq(r.totalAmount)).toBe(true);
  });
});
