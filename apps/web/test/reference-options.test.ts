import { describe, expect, it } from 'vitest';

import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  PACKAGING_OPTIONS,
  filterReferenceOptions,
  normalizeReferenceSearch,
  withCurrentReferenceOption,
} from '../src/reference-options.js';

function firstValue(options: typeof COUNTRY_OPTIONS, query: string): string | undefined {
  return filterReferenceOptions(options, query)[0]?.value;
}

describe('reference catalogs', () => {
  it('provides broad, unique ISO country and currency codes', () => {
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(200);
    expect(CURRENCY_OPTIONS.length).toBeGreaterThan(140);
    expect(new Set(COUNTRY_OPTIONS.map(({ value }) => value)).size).toBe(COUNTRY_OPTIONS.length);
    expect(new Set(CURRENCY_OPTIONS.map(({ value }) => value)).size).toBe(CURRENCY_OPTIONS.length);
    expect(COUNTRY_OPTIONS.every(({ value }) => /^[A-Z]{2}$/.test(value))).toBe(true);
    expect(CURRENCY_OPTIONS.every(({ value }) => /^[A-Z]{3}$/.test(value))).toBe(true);
    expect(COUNTRY_OPTIONS.slice(0, 3).map(({ value }) => value)).toEqual(['TW', 'CH', 'AU']);
    expect(CURRENCY_OPTIONS.slice(0, 3).map(({ value }) => value)).toEqual(['TWD', 'USD', 'CNY']);
  });

  it.each([
    ['台幣', 'TWD'],
    ['新臺幣', 'TWD'],
    ['NTD', 'TWD'],
    ['美金', 'USD'],
    ['美元', 'USD'],
    ['人民幣', 'CNY'],
    ['RMB', 'CNY'],
    ['港幣', 'HKD'],
    ['日圓', 'JPY'],
    ['日元', 'JPY'],
    ['Yen', 'JPY'],
    ['歐元', 'EUR'],
    ['英鎊', 'GBP'],
    ['瑞士法郎', 'CHF'],
  ])('finds currency alias %s as %s', (query, expected) => {
    expect(firstValue(CURRENCY_OPTIONS, query)).toBe(expected);
  });

  it.each([
    ['台灣', 'TW'],
    ['臺灣', 'TW'],
    ['ROC', 'TW'],
    ['瑞士', 'CH'],
    ['Swiss', 'CH'],
    ['美國', 'US'],
    ['USA', 'US'],
    ['英國', 'GB'],
    ['UK', 'GB'],
    ['中國', 'CN'],
    ['PRC', 'CN'],
    ['香港', 'HK'],
    ['加拿大', 'CA'],
    ['澳洲', 'AU'],
    ['奧地利', 'AT'],
    ['新加坡', 'SG'],
    ['日本', 'JP'],
    ['德國', 'DE'],
    ['南非', 'ZA'],
  ])('finds country alias %s as %s', (query, expected) => {
    expect(firstValue(COUNTRY_OPTIONS, query)).toBe(expected);
  });

  it('normalizes full-width input and punctuation', () => {
    expect(normalizeReferenceSearch(' Ｕ．Ｓ．Ａ ')).toBe('u s a');
    expect(firstValue(COUNTRY_OPTIONS, 'Ｕ．Ｓ．Ａ')).toBe('US');
    expect(firstValue(CURRENCY_OPTIONS, 'ＮＴ＄')).toBe('TWD');
  });

  it('preserves a current legacy value without duplicating catalog values', () => {
    const legacy = withCurrentReferenceOption(PACKAGING_OPTIONS, '收藏盒（舊格式）');
    expect(legacy[0]).toMatchObject({
      value: '收藏盒（舊格式）',
      label: '收藏盒（舊格式）',
      description: '既有資料',
    });
    expect(withCurrentReferenceOption(PACKAGING_OPTIONS, PACKAGING_OPTIONS[0]!.value)).toBe(
      PACKAGING_OPTIONS,
    );
    expect(new Set(PACKAGING_OPTIONS.map(({ value }) => value)).size).toBe(
      PACKAGING_OPTIONS.length,
    );
  });
});
