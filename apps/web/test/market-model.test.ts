import { describe, expect, it } from 'vitest';

import {
  convertPrice,
  formatPremiumRate,
  groupNearbyMarkers,
  rangeWindow,
  toChartSeries,
  toLineValue,
  toMarkerSeries,
  type PricePoint,
  type PurchaseMarker,
} from '../src/screens/market-model.js';

const NOW = new Date('2026-07-29T12:00:00.000Z');

function point(timestamp: string, pricePerGram: string, quoteCurrency = 'USD'): PricePoint {
  return { timestamp, pricePerGram, quoteCurrency, provider: 'gold-api' };
}

function marker(overrides: Partial<PurchaseMarker> = {}): PurchaseMarker {
  return {
    purchaseId: 'p1',
    purchasedAt: '2026-07-28T02:38:00.000Z',
    metalCode: 'XAU',
    names: ['PAMP 10g'],
    quantity: 2,
    fineWeightGrams: '19.998',
    totalCost: '51500',
    currency: 'TWD',
    spotPricePerGram: '4249.666903',
    costPerGram: '2575.257526',
    premiumRate: '-0.394',
    awaitingPrice: false,
    ...overrides,
  };
}

describe('time ranges', () => {
  it('resolves a fixed-length window', () => {
    const { from, to } = rangeWindow('7d', NOW);
    expect(to).toBe(NOW);
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(7);
  });

  it('starts year-to-date at 1 January', () => {
    const { from } = rangeWindow('ytd', NOW);
    expect(from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('caps "all" at the provider backfill limit rather than unbounded', () => {
    const { from, to } = rangeWindow('all', NOW);
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(400);
  });
});

describe('currency conversion on the chart', () => {
  it('returns the amount unchanged for a matching currency', () => {
    expect(convertPrice('100', 'USD', 'USD', null)?.toString()).toBe('100');
  });

  it('applies the rate for USD to the display currency', () => {
    expect(convertPrice('100', 'USD', 'TWD', '32.327371')?.toFixed(4)).toBe('3232.7371');
  });

  it('inverts the rate for the display currency back to USD', () => {
    expect(convertPrice('3232.7371', 'TWD', 'USD', '32.327371')?.toFixed(2)).toBe('100.00');
  });

  it('refuses a pair the stored rate does not describe', () => {
    expect(convertPrice('100', 'EUR', 'TWD', '32.327371')).toBeNull();
  });

  it('refuses to convert with a missing or nonsensical rate', () => {
    expect(convertPrice('100', 'USD', 'TWD', null)).toBeNull();
    expect(convertPrice('100', 'USD', 'TWD', '0')).toBeNull();
  });
});

describe('price series', () => {
  it('converts to the display unit and sorts chronologically', () => {
    const series = toChartSeries(
      [point('2026-07-28T00:00:00.000Z', '100'), point('2026-07-27T00:00:00.000Z', '99')],
      'g',
      'USD',
      null,
    );
    expect(series.map(([, value]) => value)).toEqual([99, 100]);
    expect(series[0]?.[0]).toBeLessThan(series[1]![0]);
  });

  it('scales a per-gram price into troy ounces', () => {
    const [entry] = toChartSeries(
      [point('2026-07-28T00:00:00.000Z', '100')],
      'troy_oz',
      'USD',
      null,
    );
    expect(entry?.[1]).toBeCloseTo(3110.34768, 4);
  });

  it('drops points it cannot convert rather than plotting a wrong value', () => {
    const series = toChartSeries(
      [point('2026-07-28T00:00:00.000Z', '100', 'EUR')],
      'g',
      'TWD',
      '32.327371',
    );
    expect(series).toEqual([]);
  });

  it('ignores an unparseable timestamp', () => {
    expect(toChartSeries([point('not-a-date', '100')], 'g', 'USD', null)).toEqual([]);
  });
});

describe('buy-point markers', () => {
  it('plots a marker at the price actually paid, not at spot', () => {
    const [plotted] = toMarkerSeries([marker()], 'g', 'TWD', null);
    // Cost per gram, so the gap to the spot line is the premium.
    expect(plotted?.value[1]).toBeCloseTo(2575.257526, 6);
  });

  it('converts a marker into the display currency', () => {
    const [plotted] = toMarkerSeries(
      [marker({ currency: 'USD', costPerGram: '100' })],
      'g',
      'TWD',
      '32.327371',
    );
    expect(plotted?.value[1]).toBeCloseTo(3232.7371, 4);
  });

  it('omits a marker whose currency cannot be reconciled', () => {
    expect(toMarkerSeries([marker({ currency: 'EUR' })], 'g', 'TWD', '32.327371')).toEqual([]);
  });
});

describe('grouping overlapping buy points (PRD §11.4.3)', () => {
  it('merges purchases within a day into one plotted group', () => {
    const grouped = groupNearbyMarkers([
      { value: [1, 10], marker: marker({ purchaseId: 'a' }) },
      { value: [2, 11], marker: marker({ purchaseId: 'b' }) },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.markers.map((m) => m.purchaseId)).toEqual(['a', 'b']);
  });

  it('keeps purchases further apart separate', () => {
    const twoDays = 2 * 86_400_000;
    const grouped = groupNearbyMarkers([
      { value: [0, 10], marker: marker({ purchaseId: 'a' }) },
      { value: [twoDays, 11], marker: marker({ purchaseId: 'b' }) },
    ]);
    expect(grouped).toHaveLength(2);
  });

  it('handles an empty set', () => {
    expect(groupNearbyMarkers([])).toEqual([]);
  });
});

describe('reference lines', () => {
  it('converts a per-gram cost line into the display unit', () => {
    expect(toLineValue('100', 'USD', 'troy_oz', 'USD', null)).toBeCloseTo(3110.34768, 4);
  });

  it('returns nothing when the line has no currency to convert from', () => {
    expect(toLineValue('100', null, 'g', 'TWD', '32.327371')).toBeNull();
    expect(toLineValue(null, 'USD', 'g', 'USD', null)).toBeNull();
  });
});

describe('premium formatting', () => {
  it('signs a positive rate explicitly', () => {
    expect(formatPremiumRate('0.0724')).toBe('+7.24%');
  });

  it('shows a discount as negative', () => {
    expect(formatPremiumRate('-0.394')).toBe('-39.4%');
  });

  it('shows a dash when no premium could be computed', () => {
    expect(formatPremiumRate(null)).toBe('—');
  });
});
