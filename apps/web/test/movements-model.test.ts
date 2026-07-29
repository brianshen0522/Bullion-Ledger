import { describe, expect, it } from 'vitest';

import {
  movementAmount,
  movementLabel,
  previewSale,
  realizedOf,
  type Movement,
} from '../src/screens/movements-model.js';

function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 'm1',
    assetId: 'a1',
    type: 'SALE',
    occurredAt: '2026-07-29T00:00:00.000Z',
    metalCode: 'XAU',
    name: 'PAMP 10g',
    quantity: 1,
    fineWeightGrams: '9.999',
    counterparty: '銀樓',
    proceedsAmount: '30000',
    fees: '500',
    netProceeds: '29500',
    costBasis: '25750',
    realizedPnl: '3750',
    marketValue: '31000',
    currency: 'TWD',
    fromStorageLocation: null,
    toStorageLocation: null,
    notes: null,
    ...overrides,
  };
}

describe('movement labels', () => {
  it('names every lifecycle event in the interface language', () => {
    expect(movementLabel('SALE')).toBe('售出');
    expect(movementLabel('GIFT_OUT')).toBe('贈與他人');
    expect(movementLabel('GIFT_IN')).toBe('收到贈與');
    expect(movementLabel('STORAGE_TRANSFER')).toBe('位置移轉');
  });
});

describe('which figure a movement reports', () => {
  it('shows net proceeds for a sale', () => {
    expect(movementAmount(movement())).toEqual({ label: '淨收入', value: '29500' });
  });

  it('shows market value for a gift, not a proceeds figure', () => {
    const out = movementAmount(movement({ type: 'GIFT_OUT', netProceeds: null }));
    expect(out).toEqual({ label: '贈與時市值', value: '31000' });

    const received = movementAmount(movement({ type: 'GIFT_IN', netProceeds: null }));
    expect(received.label).toBe('收到時市值');
  });

  it('shows the destroyed cost for a loss', () => {
    expect(movementAmount(movement({ type: 'LOST' })).label).toBe('損失成本');
  });

  it('reports nothing for a pure relocation', () => {
    expect(movementAmount(movement({ type: 'STORAGE_TRANSFER' })).value).toBeNull();
  });
});

describe('realized P&L presence', () => {
  it('reads a booked figure', () => {
    expect(realizedOf(movement())?.toFixed()).toBe('3750');
  });

  it('stays absent for a gift, which books nothing', () => {
    expect(realizedOf(movement({ type: 'GIFT_OUT', realizedPnl: null }))).toBeNull();
  });
});

describe('sale preview', () => {
  it('takes a proportional cost basis for a partial sale', () => {
    const preview = previewSale({
      quantity: 2,
      totalQuantity: 5,
      allocatedCost: '100000',
      proceedsAmount: '45000',
      fees: '500',
    });

    expect(preview?.costBasis).toBe('40000.00');
    expect(preview?.netProceeds).toBe('44500.00');
    expect(preview?.realizedPnl).toBe('4500.00');
    expect(preview?.remainingQuantity).toBe(3);
  });

  it('takes the entire recorded cost when the whole lot goes', () => {
    // Matches the server's exact-zero rule rather than re-deriving a share.
    const preview = previewSale({
      quantity: 3,
      totalQuantity: 3,
      allocatedCost: '99999.9999',
      proceedsAmount: '100000',
      fees: '0',
    });

    expect(preview?.costBasis).toBe('100000.00');
    expect(preview?.remainingQuantity).toBe(0);
  });

  it('shows a loss when the sale does not cover its basis', () => {
    const preview = previewSale({
      quantity: 1,
      totalQuantity: 1,
      allocatedCost: '50000',
      proceedsAmount: '40000',
      fees: '0',
    });
    expect(preview?.realizedPnl).toBe('-10000.00');
  });

  it('refuses a quantity beyond what is held', () => {
    expect(
      previewSale({
        quantity: 6,
        totalQuantity: 5,
        allocatedCost: '100',
        proceedsAmount: '1',
        fees: '0',
      }),
    ).toBeNull();
  });

  it('refuses a non-positive or fractional quantity', () => {
    const base = { totalQuantity: 5, allocatedCost: '100', proceedsAmount: '1', fees: '0' };
    expect(previewSale({ ...base, quantity: 0 })).toBeNull();
    expect(previewSale({ ...base, quantity: 1.5 })).toBeNull();
  });
});
