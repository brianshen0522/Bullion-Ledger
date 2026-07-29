import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  ArgumentError,
  assertPriceSourceType,
  convertCurrency,
  intrinsicValue,
  isPriceSourceType,
  normalizePricePerGram,
  pricePerUnitFromGram,
  quantizeFxRate,
  quantizePrice,
} from '../src/index.js';

describe('price normalization', () => {
  it('converts a troy-ounce quote to price per gram exactly', () => {
    // 1 troy oz = 31.1034768 g (PRD §7.2).
    const perGram = normalizePricePerGram('3110.34768', 'troy_oz');
    expect(perGram.toFixed(2)).toBe('100.00');
  });

  it('leaves a per-gram quote untouched', () => {
    expect(normalizePricePerGram('42.5', 'g').toString()).toBe('42.5');
  });

  it('handles kilogram and qian quotes', () => {
    expect(normalizePricePerGram('1000', 'kg').toString()).toBe('1');
    // 1 台錢 = 3.75 g.
    expect(normalizePricePerGram('37.5', 'qian').toString()).toBe('10');
  });

  it('round-trips through the inverse conversion', () => {
    const original = new Decimal('4030.899902');
    const perGram = normalizePricePerGram(original, 'troy_oz');
    expect(pricePerUnitFromGram(perGram, 'troy_oz').toFixed(6)).toBe(original.toFixed(6));
  });

  it('rejects a negative or non-finite price', () => {
    expect(() => normalizePricePerGram('-1', 'g')).toThrow(ArgumentError);
    expect(() => normalizePricePerGram(Number.NaN, 'g')).toThrow(ArgumentError);
  });
});

describe('storage quantization', () => {
  it('quantizes to the NUMERIC(18,6) price scale with banker’s rounding', () => {
    // Half-to-even: .0000005 rounds down to an even last digit, .0000015 up.
    expect(quantizePrice('1.0000005').toFixed(6)).toBe('1.000000');
    expect(quantizePrice('1.0000015').toFixed(6)).toBe('1.000002');
  });

  it('quantizes FX to the NUMERIC(18,8) rate scale', () => {
    expect(quantizeFxRate('32.327371').toFixed()).toBe('32.327371');
    expect(quantizeFxRate('32.3273712345').toFixed()).toBe('32.32737123');
  });

  it('rejects a zero or negative FX rate, which would erase value', () => {
    expect(() => quantizeFxRate('0')).toThrow(ArgumentError);
    expect(() => quantizeFxRate('-1')).toThrow(ArgumentError);
  });
});

describe('source types (PRD §12.2)', () => {
  it('recognizes every defined kind', () => {
    for (const kind of ['SPOT', 'BENCHMARK', 'DEALER_SELL', 'DEALER_BUYBACK', 'MANUAL']) {
      expect(isPriceSourceType(kind)).toBe(true);
    }
  });

  it('refuses an unknown kind rather than defaulting to spot', () => {
    expect(isPriceSourceType('GUESS')).toBe(false);
    expect(() => assertPriceSourceType('GUESS')).toThrow(ArgumentError);
  });
});

describe('valuation primitives', () => {
  it('computes intrinsic value as fine weight times price per gram (PRD §10.2)', () => {
    // One Taiwanese tael bar: 37.5 g of 999.9 gold = 37.49625 g fine.
    const fineWeight = new Decimal('37.5').times('0.9999');
    expect(fineWeight.toString()).toBe('37.49625');
    const value = intrinsicValue(fineWeight, '3300');
    expect(value.toString()).toBe('123737.625');
    expect(value.toFixed(2)).toBe('123737.63');
  });

  it('returns zero for a zero holding rather than throwing', () => {
    expect(intrinsicValue('0', '3300').toString()).toBe('0');
  });

  it('converts across currencies without float drift', () => {
    const twd = convertCurrency('129.6', '32.327371');
    expect(twd.toFixed(4)).toBe('4189.6273');
  });

  it('refuses a non-positive conversion rate', () => {
    expect(() => convertCurrency('100', '0')).toThrow(ArgumentError);
  });
});
