import { describe, expect, it } from 'vitest';

import {
  describeNotice,
  describePremium,
  formatPricePerUnit,
  signTone,
  valuationNotes,
} from '../src/screens/dashboard-model.js';

describe('signed figure colouring', () => {
  it('marks a gain and a loss differently', () => {
    expect(signTone('1234.56')).toBe('gain');
    expect(signTone('-8784.48')).toBe('loss');
  });

  it('stays neutral for zero, absent, and unparseable values', () => {
    // Zero is neither good nor bad, and must not be coloured as either.
    expect(signTone('0')).toBeUndefined();
    expect(signTone('0.00')).toBeUndefined();
    expect(signTone(null)).toBeUndefined();
    expect(signTone('not-a-number')).toBeUndefined();
  });
});

describe('valuation notices', () => {
  it('renders every notice code in the interface language', () => {
    expect(describeNotice({ code: 'NO_PRICES' }, 'TWD')).toContain('尚未取得任何行情');

    const unpriced = describeNotice({ code: 'UNPRICED_METALS', metals: ['XAG'] }, 'TWD');
    expect(unpriced).toContain('XAG');
    expect(unpriced).toContain('排除');

    const mixed = describeNotice(
      { code: 'MIXED_COST_CURRENCIES', currencies: ['TWD', 'USD'] },
      'TWD',
    );
    expect(mixed).toContain('TWD、USD');
    expect(mixed).toContain('無法');
  });

  it('contains no English prose, since the API no longer supplies any', () => {
    const rendered = [
      describeNotice({ code: 'NO_PRICES' }, 'TWD'),
      describeNotice({ code: 'UNPRICED_METALS', metals: ['XAG'] }, 'TWD'),
      describeNotice({ code: 'MIXED_COST_CURRENCIES', currencies: ['TWD', 'USD'] }, 'TWD'),
    ].join(' ');
    // Currency codes are legitimate; sentences are not.
    expect(rendered).not.toMatch(/\b(cannot|purchased|available|price for)\b/);
  });

  it('says nothing when there is nothing to explain', () => {
    expect(describeNotice(null, 'TWD')).toBeNull();
  });
});

describe('cumulative premium', () => {
  const format = (amount: string, currency: string) => `${currency} ${amount}`;

  it('shows the total when one currency is involved', () => {
    expect(
      describePremium(
        { premiumPaid: '8784.48', premiumCurrency: 'TWD', premiumCurrencies: ['TWD'] },
        format,
      ),
    ).toBe('TWD 8784.48');
  });

  it('explains a mixed-currency premium instead of claiming there is no data', () => {
    const rendered = describePremium(
      { premiumPaid: null, premiumCurrency: null, premiumCurrencies: ['TWD', 'USD'] },
      format,
    );
    expect(rendered).toContain('TWD、USD');
    expect(rendered).not.toBe('尚無資料');
  });

  it('reports genuinely absent data as absent', () => {
    expect(
      describePremium({ premiumPaid: null, premiumCurrency: null, premiumCurrencies: [] }, format),
    ).toBe('尚無資料');
  });
});

describe('price quoted in the selected weight unit (PRD §11.6)', () => {
  it('leaves a per-gram price alone', () => {
    expect(formatPricePerUnit('4204.17', 'g', 'TWD')).toBe('TWD 4204.17 / g');
  });

  it('converts to troy ounce so price and weight share a unit', () => {
    // 4204.17 × 31.1034768 = 130764.304…, trailing zeros not padded.
    expect(formatPricePerUnit('4204.17', 'troy_oz', 'TWD')).toBe('TWD 130764.3 / oz');
  });

  it('converts to 台錢, the unit Taiwanese dealers quote', () => {
    expect(formatPricePerUnit('4204.17', 'qian', 'TWD')).toBe('TWD 15765.64 / 台錢');
  });

  it('converts to kilogram', () => {
    expect(formatPricePerUnit('4204.17', 'kg', 'TWD')).toBe('TWD 4204170 / kg');
  });
});

describe('summary notes', () => {
  const stamp = () => '2026/7/28 23:49:41';
  const base = { purchasesAwaitingPrices: 0, priceAsOf: null, valuationCurrency: 'TWD' };

  it('says nothing when every figure is present and current', () => {
    expect(valuationNotes({ ...base, notice: null }, stamp)).toEqual([]);
  });

  it('surfaces the reason a figure is missing', () => {
    const notes = valuationNotes(
      { ...base, notice: { code: 'UNPRICED_METALS', metals: ['XAG'] } },
      stamp,
    );
    expect(notes[0]).toContain('XAG');
  });

  it('reports transactions still awaiting their purchase-time price', () => {
    const notes = valuationNotes({ ...base, notice: null, purchasesAwaitingPrices: 2 }, stamp);
    expect(notes[0]).toContain('2 筆交易');
  });

  it('shows how old the prices are', () => {
    const notes = valuationNotes(
      { ...base, notice: null, priceAsOf: '2026-07-28T15:49:41.000Z' },
      stamp,
    );
    expect(notes).toEqual(['行情時間：2026/7/28 23:49:41']);
  });

  it('ignores an unparseable timestamp rather than printing "Invalid Date"', () => {
    expect(valuationNotes({ ...base, notice: null, priceAsOf: 'nonsense' }, stamp)).toEqual([]);
  });

  it('combines every applicable note', () => {
    const notes = valuationNotes(
      {
        ...base,
        notice: { code: 'MIXED_COST_CURRENCIES', currencies: ['TWD', 'USD'] },
        purchasesAwaitingPrices: 1,
        priceAsOf: '2026-07-28T15:49:41.000Z',
      },
      stamp,
    );
    expect(notes).toHaveLength(3);
  });
});
