import { describe, expect, it } from 'vitest';

import { computeCostLines, perGram } from '../src/market-prices/market-markers.service';
import type { PurchaseMarker } from '../src/market-prices/market-markers.service';

function marker(overrides: Partial<PurchaseMarker> = {}): PurchaseMarker {
  return {
    purchaseId: 'p1',
    purchasedAt: '2026-07-28T02:38:00.000Z',
    metalCode: 'XAU',
    names: ['PAMP 10g'],
    quantity: 2,
    fineWeightGrams: '20',
    totalCost: '80000',
    currency: 'TWD',
    spotPricePerGram: '4000',
    costPerGram: '4000',
    premiumRate: '0',
    awaitingPrice: false,
    ...overrides,
  };
}

describe('cost per gram', () => {
  it('divides total cost by fine weight', () => {
    expect(perGram('51500', '19.998')).toBe('2575.257526');
  });

  it('returns zero for a weightless line rather than dividing by zero', () => {
    expect(perGram('100', '0')).toBe('0');
  });
});

describe('cost lines (PRD §11.4.4)', () => {
  it('weights the average by fine weight, not by purchase count', () => {
    const lines = computeCostLines([
      marker({ purchaseId: 'a', fineWeightGrams: '10', totalCost: '30000' }),
      marker({ purchaseId: 'b', fineWeightGrams: '90', totalCost: '360000' }),
    ]);
    // (30000 + 360000) / 100 = 3900 — not the 3500 a naive mean would give.
    expect(lines.averageCostPerGram).toBe('3900');
    expect(lines.currency).toBe('TWD');
  });

  it('reports break-even at the average cost while no buyback spread is modelled', () => {
    const lines = computeCostLines([marker()]);
    expect(lines.breakEvenPerGram).toBe(lines.averageCostPerGram);
  });

  it('weights the average purchase-time spot by fine weight', () => {
    const lines = computeCostLines([
      marker({ purchaseId: 'a', fineWeightGrams: '10', spotPricePerGram: '4000' }),
      marker({ purchaseId: 'b', fineWeightGrams: '30', spotPricePerGram: '5000' }),
    ]);
    // (10×4000 + 30×5000) / 40 = 4750.
    expect(lines.averageSpotAtPurchase).toBe('4750');
  });

  it('excludes unpriced purchases from the spot average but not from cost', () => {
    const lines = computeCostLines([
      marker({
        purchaseId: 'a',
        fineWeightGrams: '10',
        totalCost: '40000',
        spotPricePerGram: '4000',
      }),
      marker({
        purchaseId: 'b',
        fineWeightGrams: '10',
        totalCost: '60000',
        spotPricePerGram: null,
        awaitingPrice: true,
      }),
    ]);
    expect(lines.averageCostPerGram).toBe('5000');
    expect(lines.averageSpotAtPurchase).toBe('4000');
  });

  it('withholds every line when purchases span currencies', () => {
    const lines = computeCostLines([
      marker({ purchaseId: 'a', currency: 'TWD' }),
      marker({ purchaseId: 'b', currency: 'USD' }),
    ]);
    expect(lines.unavailableReason).toBe('MIXED_CURRENCIES');
    expect(lines.averageCostPerGram).toBeNull();
    expect(lines.breakEvenPerGram).toBeNull();
    expect(lines.currency).toBeNull();
  });

  it('reports no holdings for an empty set', () => {
    const lines = computeCostLines([]);
    expect(lines.unavailableReason).toBe('NO_HOLDINGS');
    expect(lines.averageCostPerGram).toBeNull();
  });

  it('leaves the spot average absent when nothing has a price yet', () => {
    const lines = computeCostLines([marker({ spotPricePerGram: null, awaitingPrice: true })]);
    expect(lines.averageCostPerGram).toBe('4000');
    expect(lines.averageSpotAtPurchase).toBeNull();
  });
});
