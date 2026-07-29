import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { fineWeightGrams, fineWeightGramsForLine, validatePurity } from '../src/index.js';
import { ArgumentError } from '../src/index.js';

describe('validatePurity', () => {
  it('accepts ratios in (0, 1]', () => {
    expect(validatePurity(0.9999).toString()).toBe('0.9999');
    expect(validatePurity(1).toString()).toBe('1');
    expect(validatePurity('0.925').toString()).toBe('0.925');
  });

  it('rejects zero and negative', () => {
    expect(() => validatePurity(0)).toThrow(ArgumentError);
    expect(() => validatePurity(-0.1)).toThrow(ArgumentError);
  });

  it('rejects > 1', () => {
    expect(() => validatePurity(1.0001)).toThrow(ArgumentError);
  });
});

describe('fineWeightGrams', () => {
  it('computes gross × purity', () => {
    // 31.1034768 g of 0.9999 gold
    const fine = fineWeightGrams('31.1034768', '0.9999');
    expect(round(fine, 8)).toBe('31.10036645');
  });

  it('uses full Decimal precision (not JS float)', () => {
    const fineFloat = 0.1 * 0.2; // JS float drift
    const fineDecimal = fineWeightGrams(0.1, 0.2);
    expect(fineDecimal.toString()).toBe('0.02');
    expect(fineDecimal.toString()).not.toBe(fineFloat.toFixed(17));
  });

  it('matches line helper for quantity > 1', () => {
    const line = fineWeightGramsForLine(10, 5, '0.999');
    expect(round(line, 6)).toBe('49.95');
  });

  it('rejects non-finite gross weight and purity', () => {
    expect(() => fineWeightGrams('Infinity', '0.9999')).toThrow(ArgumentError);
    expect(() => fineWeightGrams('1', 'Infinity')).toThrow(ArgumentError);
  });
});

function round(d: Decimal, decimals: number): string {
  return d.toDecimalPlaces(decimals).toString();
}
