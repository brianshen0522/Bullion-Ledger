import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  ArgumentError,
  GRAMS_PER_UNIT,
  convertWeight,
  formatWeightInput,
  fromGrams,
  isWeightUnit,
  roundTo,
  toGrams,
  totalGrossGrams,
} from '../src/index.js';

describe('weight units', () => {
  it('exposes exact gram factors from PRD §7.2', () => {
    expect(GRAMS_PER_UNIT.g.toString()).toBe('1');
    expect(GRAMS_PER_UNIT.kg.toString()).toBe('1000');
    expect(GRAMS_PER_UNIT.troy_oz.toString()).toBe('31.1034768');
    expect(GRAMS_PER_UNIT.qian.toString()).toBe('3.75');
  });

  it('recognizes the four supported units', () => {
    expect(isWeightUnit('g')).toBe(true);
    expect(isWeightUnit('kg')).toBe(true);
    expect(isWeightUnit('troy_oz')).toBe(true);
    expect(isWeightUnit('qian')).toBe(true);
    expect(isWeightUnit('pound')).toBe(false);
    expect(isWeightUnit(null)).toBe(false);
  });
});

describe('toGrams', () => {
  it('converts kg to grams exactly', () => {
    expect(toGrams(2, 'kg').toString()).toBe('2000');
  });

  it('converts troy oz to grams at full precision', () => {
    expect(toGrams(1, 'troy_oz').toString()).toBe('31.1034768');
    expect(toGrams(10, 'troy_oz').toString()).toBe('311.034768');
  });

  it('converts Taiwan qian to grams exactly', () => {
    expect(toGrams(1, 'qian').toString()).toBe('3.75');
    expect(toGrams(5, 'qian').toString()).toBe('18.75');
  });

  it('accepts string input to preserve precision', () => {
    expect(toGrams('0.0001', 'troy_oz').toString()).toBe('0.00311034768');
  });

  it('rejects negative weight', () => {
    expect(() => toGrams(-1, 'g')).toThrow(ArgumentError);
  });

  it('rejects NaN / non-numeric strings', () => {
    expect(() => toGrams('abc', 'g')).toThrow(ArgumentError);
    expect(() => toGrams(NaN, 'g')).toThrow(ArgumentError);
  });
});

describe('convertWeight round-trip', () => {
  it('preserves identity across unit conversions within precision', () => {
    const original = new Decimal('100');
    const grams = toGrams(original, 'troy_oz');
    const back = fromGrams(grams, 'troy_oz');
    expect(back.toString()).toBe('100');
  });

  it('converts between arbitrary units via gram canonical form', () => {
    // 1 kg = 1000 g = 32.1507465686... troy oz
    const inOz = convertWeight(1, 'kg', 'troy_oz');
    expect(roundTo(inOz, 6).toString()).toBe('32.150747');
  });

  it('formats converted weights as fixed-point input with at most nine decimals', () => {
    expect(formatWeightInput(convertWeight(1, 'kg', 'troy_oz'))).toBe('32.150746569');
  });
});

describe('totalGrossGrams', () => {
  it('multiplies unit weight by integer quantity', () => {
    expect(totalGrossGrams(31.1034768, 10).toString()).toBe('311.034768');
  });

  it('rejects fractional quantity', () => {
    expect(() => totalGrossGrams(1, 0.5)).toThrow(ArgumentError);
  });

  it('rejects non-finite unit weight and quantity', () => {
    expect(() => totalGrossGrams('Infinity', 1)).toThrow(ArgumentError);
    expect(() => totalGrossGrams(1, 'Infinity')).toThrow(ArgumentError);
  });
});
