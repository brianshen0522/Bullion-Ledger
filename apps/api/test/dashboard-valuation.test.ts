import { describe, expect, it } from 'vitest';

import { valuePortfolio, type MetalHolding, type MetalPrice } from '../src/dashboard/valuation';

const AS_OF = '2026-07-28T14:45:11.000Z';

function holding(
  code: string,
  fineWeightGrams: string,
  cost: { currency: string; totalCost: string }[] = [{ currency: 'TWD', totalCost: '130000' }],
): MetalHolding {
  return { code, fineWeightGrams, costByCurrency: cost };
}

function price(metalCode: string, pricePerGramDisplay: string | null, at = AS_OF): MetalPrice {
  return { metalCode, pricePerGramDisplay, timestamp: at };
}

describe('portfolio valuation (PRD §10.2, §10.4, §10.7)', () => {
  it('values a holding at fine weight × price per gram', () => {
    const result = valuePortfolio([holding('XAU', '37.49625')], [price('XAU', '3232.7371')], 'TWD');

    expect(result.intrinsicValue).toBe('121215.52');
    // Melt value minus cost. Negative here because 8,784.48 of premium was
    // paid over melt — the mirror image of the premium recorded at purchase.
    expect(result.unrealizedPnl).toBe('-8784.48');
    // (value − cost) / cost × 100.
    expect(result.returnRate).toBe('-6.7573');
    expect(result.priceAsOf).toBe(AS_OF);
  });

  it('reports a gain when the holding is worth more than it cost', () => {
    const result = valuePortfolio(
      [holding('XAU', '37.49625', [{ currency: 'TWD', totalCost: '100000' }])],
      [price('XAU', '3232.7371')],
      'TWD',
    );

    expect(result.unrealizedPnl).toBe('21215.52');
    expect(Number(result.returnRate)).toBeGreaterThan(0);
  });

  it('sums across metals', () => {
    const result = valuePortfolio(
      [
        holding('XAU', '37.49625', [{ currency: 'TWD', totalCost: '130000' }]),
        holding('XAG', '311.035', [{ currency: 'TWD', totalCost: '20000' }]),
      ],
      [price('XAU', '3232.7371'), price('XAG', '59.3')],
      'TWD',
    );

    // 121215.52 + 18444.38.
    expect(result.intrinsicValue).toBe('139659.90');
    expect(result.byMetal).toHaveLength(2);
  });

  it('excludes an unpriced metal from the total and names it', () => {
    const result = valuePortfolio(
      [holding('XAU', '37.49625'), holding('XAG', '311.035')],
      [price('XAU', '3232.7371'), price('XAG', null)],
      'TWD',
    );

    expect(result.intrinsicValue).toBe('121215.52');
    expect(result.unpricedMetals).toEqual(['XAG']);
    // Profit is withheld because the total is knowingly incomplete.
    expect(result.unrealizedPnl).toBeNull();
    expect(result.notice).toEqual({ code: 'UNPRICED_METALS', metals: ['XAG'] });
  });

  it('reports nothing at all when no metal can be priced', () => {
    const result = valuePortfolio([holding('XAU', '37.49625')], [], 'TWD');

    expect(result.intrinsicValue).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
    expect(result.returnRate).toBeNull();
    expect(result.notice).toEqual({ code: 'NO_PRICES' });
  });

  it('refuses to compute profit across mixed cost currencies', () => {
    const result = valuePortfolio(
      [
        holding('XAU', '37.49625', [{ currency: 'TWD', totalCost: '130000' }]),
        holding('XAG', '311.035', [{ currency: 'USD', totalCost: '600' }]),
      ],
      [price('XAU', '3232.7371'), price('XAG', '59.3')],
      'TWD',
    );

    // The value is still knowable; the profit is not.
    expect(result.intrinsicValue).toBe('139659.90');
    expect(result.unrealizedPnl).toBeNull();
    expect(result.notice).toEqual({
      code: 'MIXED_COST_CURRENCIES',
      currencies: ['TWD', 'USD'],
    });
  });

  it('refuses to compare a valuation against cost in a different currency', () => {
    const result = valuePortfolio(
      [holding('XAU', '37.49625', [{ currency: 'USD', totalCost: '4000' }])],
      [price('XAU', '3232.7371')],
      'TWD',
    );

    expect(result.intrinsicValue).toBe('121215.52');
    expect(result.unrealizedPnl).toBeNull();
  });

  it('leaves the return rate undefined against zero cost rather than infinite', () => {
    const result = valuePortfolio(
      [holding('XAU', '37.49625', [{ currency: 'TWD', totalCost: '0' }])],
      [price('XAU', '3232.7371')],
      'TWD',
    );

    expect(result.unrealizedPnl).toBe('121215.52');
    expect(result.returnRate).toBeNull();
  });

  it('reports the oldest price used, so staleness is visible', () => {
    const older = '2026-07-27T00:00:00.000Z';
    const result = valuePortfolio(
      [holding('XAU', '10'), holding('XAG', '10')],
      [price('XAU', '3232.7371', AS_OF), price('XAG', '59.3', older)],
      'TWD',
    );

    expect(result.priceAsOf).toBe(older);
  });

  it('stays quiet for an empty portfolio', () => {
    const result = valuePortfolio([], [], 'TWD');

    expect(result.intrinsicValue).toBeNull();
    expect(result.notice).toBeNull();
    expect(result.byMetal).toEqual([]);
  });
});
