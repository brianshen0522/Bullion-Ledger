import { describe, expect, it } from 'vitest';

import { summarizeHeldAssets } from '../src/purchases/purchase-summary';

describe('summarizeHeldAssets', () => {
  it('groups costs by currency globally and within each metal', () => {
    const summary = summarizeHeldAssets(
      [
        {
          metalCode: 'XAU',
          currency: 'USD',
          quantity: 2,
          fineWeightGrams: '20',
          allocatedCost: '100',
        },
        {
          metalCode: 'XAU',
          currency: 'TWD',
          quantity: 3,
          fineWeightGrams: '30',
          allocatedCost: '1000',
        },
        {
          metalCode: 'XAG',
          currency: 'USD',
          quantity: 10,
          fineWeightGrams: '250.5',
          allocatedCost: '25.75',
        },
      ],
      7,
    );

    expect(summary).toEqual({
      heldAssetLots: 3,
      heldAssetUnits: '15',
      purchaseCount: 7,
      costByCurrency: [
        { currency: 'TWD', totalCost: '1000' },
        { currency: 'USD', totalCost: '125.75' },
      ],
      byMetal: [
        {
          code: 'XAG',
          fineWeightGrams: '250.5',
          heldAssetLots: 1,
          heldAssetUnits: '10',
          costByCurrency: [{ currency: 'USD', totalCost: '25.75' }],
        },
        {
          code: 'XAU',
          fineWeightGrams: '50',
          heldAssetLots: 2,
          heldAssetUnits: '5',
          costByCurrency: [
            { currency: 'TWD', totalCost: '1000' },
            { currency: 'USD', totalCost: '100' },
          ],
        },
      ],
    });
  });

  it('returns an honest empty summary without inventing a base currency', () => {
    expect(summarizeHeldAssets([], 0)).toEqual({
      heldAssetLots: 0,
      heldAssetUnits: '0',
      purchaseCount: 0,
      costByCurrency: [],
      byMetal: [],
    });
  });

  it('counts quantities rather than treating each lot row as one item', () => {
    const summary = summarizeHeldAssets(
      [
        {
          metalCode: 'XAU',
          currency: 'USD',
          quantity: 1_000_000,
          fineWeightGrams: '1',
          allocatedCost: '1',
        },
        {
          metalCode: 'XAU',
          currency: 'USD',
          quantity: 1_000_000,
          fineWeightGrams: '1',
          allocatedCost: '1',
        },
      ],
      1,
    );
    expect(summary.heldAssetLots).toBe(2);
    expect(summary.heldAssetUnits).toBe('2000000');
    expect(summary.byMetal[0]?.heldAssetUnits).toBe('2000000');
  });
});
