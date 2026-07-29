import Decimal from 'decimal.js';

/**
 * Internal standard unit for all stored weights is the gram, per PRD §7.2.
 * Display/input units are converted at trust boundaries.
 */
export const WEIGHT_UNITS = ['g', 'kg', 'troy_oz', 'qian'] as const;

export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const WEIGHT_UNIT_LABELS: Record<WeightUnit, string> = {
  g: 'g',
  kg: 'kg',
  troy_oz: 'oz',
  qian: '台錢',
};

export const WEIGHT_UNIT_LONG_LABELS: Record<WeightUnit, string> = {
  g: 'gram (g)',
  kg: 'kilogram (kg)',
  troy_oz: 'troy ounce (oz t)',
  qian: 'Taiwan qian (台錢)',
};

/**
 * Exact conversion factors to grams. PRD §7.2:
 *   1 kg        = 1000 g
 *   1 troy oz   = 31.1034768 g
 *   1 台錢       = 3.75 g
 */
export const GRAMS_PER_UNIT: Readonly<Record<WeightUnit, Decimal>> = Object.freeze({
  g: new Decimal(1),
  kg: new Decimal(1000),
  troy_oz: new Decimal('31.1034768'),
  qian: new Decimal('3.75'),
});

/** Canonical weight columns are NUMERIC(18,9). */
export const WEIGHT_STORAGE_SCALE = 9;
export const MAX_WEIGHT_GRAMS = new Decimal('999999999.999999999');
export const WEIGHT_INPUT_RE = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,9})?$/;

export function isWeightUnit(value: unknown): value is WeightUnit {
  return typeof value === 'string' && (WEIGHT_UNITS as readonly string[]).includes(value);
}

export function assertWeightUnit(value: unknown, field = 'unit'): WeightUnit {
  if (!isWeightUnit(value)) {
    throw new ArgumentError(
      `${field} must be one of ${WEIGHT_UNITS.join(', ')}, received ${stringifySafe(value)}`,
    );
  }
  return value;
}

/**
 * Convert a numeric weight expressed in `from` unit into grams.
 * Accepts number, string, or Decimal to preserve precision from the wire.
 */
export function toGrams(value: number | string | Decimal, from: WeightUnit): Decimal {
  const v = toDecimal(value);
  if (v.isNaN() || !v.isFinite()) {
    throw new ArgumentError(`weight must be a finite number, received ${stringifySafe(value)}`);
  }
  if (v.lt(0)) {
    throw new ArgumentError(`weight must be >= 0, received ${v.toString()}`);
  }
  return v.times(GRAMS_PER_UNIT[from]);
}

/**
 * Quantize a derived gram value exactly as it will be persisted, then verify
 * the rounded value fits NUMERIC(18,9). This keeps subsequent calculations
 * based on the same value that is actually stored.
 */
export function quantizeWeightGrams(
  value: number | string | Decimal,
  field = 'weightGrams',
): Decimal {
  const grams = toDecimal(value);
  if (!grams.isFinite()) {
    throw new ArgumentError(`${field} must be finite, received ${stringifySafe(value)}`);
  }
  if (grams.isNegative()) {
    throw new ArgumentError(`${field} must be >= 0, received ${grams.toString()}`);
  }
  const quantized = grams.toDecimalPlaces(WEIGHT_STORAGE_SCALE, Decimal.ROUND_HALF_EVEN);
  if (quantized.gt(MAX_WEIGHT_GRAMS)) {
    throw new ArgumentError(
      `${field} must be <= ${MAX_WEIGHT_GRAMS.toString()}, received ${quantized.toString()}`,
    );
  }
  return quantized;
}

/** Convert grams into the target display unit. */
export function fromGrams(grams: number | string | Decimal, to: WeightUnit): Decimal {
  const g = toDecimal(grams);
  if (g.isNaN() || !g.isFinite()) {
    throw new ArgumentError(`grams must be a finite number, received ${stringifySafe(grams)}`);
  }
  return g.div(GRAMS_PER_UNIT[to]);
}

/** Convert directly between two units via the gram canonical form. */
export function convertWeight(
  value: number | string | Decimal,
  from: WeightUnit,
  to: WeightUnit,
): Decimal {
  return fromGrams(toGrams(value, from), to);
}

/** Round a Decimal to a fixed number of decimal places using banker's rounding. */
export function roundTo(value: number | string | Decimal, decimals: number): Decimal {
  return toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN);
}

/** Formats a weight for DTO/form input without exponent notation or excess scale. */
export function formatWeightInput(value: number | string | Decimal): string {
  return roundTo(value, WEIGHT_STORAGE_SCALE).toFixed();
}

/** Total gross weight in grams for a line of identical items. */
export function totalGrossGrams(
  unitWeightGrams: number | string | Decimal,
  quantity: number | string | Decimal,
): Decimal {
  const w = toDecimal(unitWeightGrams);
  const q = toDecimal(quantity);
  if (!q.isInteger() || q.lt(0)) {
    throw new ArgumentError(`quantity must be a non-negative integer, received ${q.toString()}`);
  }
  if (!w.isFinite() || w.lt(0)) {
    throw new ArgumentError(`unitWeightGrams must be finite and >= 0, received ${w.toString()}`);
  }
  return w.times(q);
}

// --- internal helpers ---

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentError';
  }
}

export function toDecimal(value: number | string | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ArgumentError(`number must be finite, received ${value}`);
    }
    return new Decimal(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new ArgumentError('numeric string must not be empty');
    }
    try {
      return new Decimal(trimmed);
    } catch {
      throw new ArgumentError(
        `numeric string must be a valid number, received ${stringifySafe(value)}`,
      );
    }
  }
  throw new ArgumentError(`expected number|string|Decimal, received ${typeof value}`);
}

function stringifySafe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return String(value);
}
