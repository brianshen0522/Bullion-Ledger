import Decimal from 'decimal.js';

import { ArgumentError, toDecimal } from './units.js';

/**
 * Purity is stored as a decimal ratio per PRD §7.4:
 *   999.9‰ -> 0.9999
 *   925‰   -> 0.925
 *
 * Karat labels may be preserved separately; this module never converts karat
 * strings on its own to avoid lossy ambiguity.
 */
export const MAX_PURITY = new Decimal(1);
export const MIN_PURITY = new Decimal(0);
export const PURITY_STORAGE_SCALE = 7;
export const PURITY_INPUT_RE = /^(?:0\.\d{1,7}|1(?:\.0{1,7})?)$/;

/**
 * Validate a purity ratio. Must satisfy 0 < purity <= 1.
 * Zero purity is rejected because it would make fine weight meaningless.
 */
export function validatePurity(value: number | string | Decimal): Decimal {
  const p = toDecimal(value);
  if (!p.isFinite()) {
    throw new ArgumentError(`purity must be finite, received ${p.toString()}`);
  }
  if (p.lte(MIN_PURITY)) {
    throw new ArgumentError(`purity must be > 0, received ${p.toString()}`);
  }
  if (p.gt(MAX_PURITY)) {
    throw new ArgumentError(`purity must be <= 1, received ${p.toString()}`);
  }
  if (p.decimalPlaces() > PURITY_STORAGE_SCALE) {
    throw new ArgumentError(
      `purity must have at most ${PURITY_STORAGE_SCALE} decimal places, received ${p.toString()}`,
    );
  }
  return p;
}

/**
 * Fine-metal weight = gross weight × purity. PRD §7.4.
 * Returns Decimal grams when gross is given in grams.
 */
export function fineWeightGrams(
  grossGrams: number | string | Decimal,
  purity: number | string | Decimal,
): Decimal {
  const g = toDecimal(grossGrams);
  if (!g.isFinite() || g.lt(0)) {
    throw new ArgumentError(`grossGrams must be finite and >= 0, received ${g.toString()}`);
  }
  return g.times(validatePurity(purity));
}

/** Convenience: fine weight for a line of `quantity` identical items. */
export function fineWeightGramsForLine(
  unitWeightGrams: number | string | Decimal,
  quantity: number | string | Decimal,
  purity: number | string | Decimal,
): Decimal {
  const totalGross = toDecimal(unitWeightGrams).times(toDecimal(quantity));
  return fineWeightGrams(totalGross, purity);
}
