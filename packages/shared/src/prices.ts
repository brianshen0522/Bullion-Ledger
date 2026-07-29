import Decimal from 'decimal.js';

import { GRAMS_PER_UNIT, toDecimal, ArgumentError, type WeightUnit } from './units.js';

/**
 * Market price kinds (PRD §12.2). These must never be collapsed into one
 * column: a dealer's buyback quote and an international spot price answer
 * different questions, and mixing them silently corrupts valuation.
 */
export const PRICE_SOURCE_TYPES = [
  'SPOT',
  'BENCHMARK',
  'DEALER_SELL',
  'DEALER_BUYBACK',
  'MANUAL',
] as const;

export type PriceSourceType = (typeof PRICE_SOURCE_TYPES)[number];

export function isPriceSourceType(value: unknown): value is PriceSourceType {
  return typeof value === 'string' && (PRICE_SOURCE_TYPES as readonly string[]).includes(value);
}

export function assertPriceSourceType(value: unknown, field = 'sourceType'): PriceSourceType {
  if (!isPriceSourceType(value)) {
    throw new ArgumentError(
      `${field} must be one of ${PRICE_SOURCE_TYPES.join(', ')}, received ${String(value)}`,
    );
  }
  return value;
}

/** Price columns are NUMERIC(18,6); FX rates are NUMERIC(18,8). */
export const PRICE_STORAGE_SCALE = 6;
export const FX_STORAGE_SCALE = 8;
export const MAX_PRICE = new Decimal('999999999999.999999');

/**
 * Converts a quote expressed per `quoteUnit` into a price per gram, the
 * canonical form every downstream calculation uses. Mirrors the gram-canonical
 * rule for weights in PRD §7.2 so a price and a weight are always expressed in
 * the same base before they are multiplied.
 */
export function normalizePricePerGram(
  price: number | string | Decimal,
  quoteUnit: WeightUnit,
): Decimal {
  const value = toDecimal(price);
  if (!value.isFinite()) {
    throw new ArgumentError(`price must be finite, received ${value.toString()}`);
  }
  if (value.isNegative()) {
    throw new ArgumentError(`price must be >= 0, received ${value.toString()}`);
  }
  return value.div(GRAMS_PER_UNIT[quoteUnit]);
}

/** Inverse of {@link normalizePricePerGram}, for display in a chosen unit. */
export function pricePerUnitFromGram(
  pricePerGram: number | string | Decimal,
  targetUnit: WeightUnit,
): Decimal {
  return toDecimal(pricePerGram).times(GRAMS_PER_UNIT[targetUnit]);
}

/**
 * Quantizes a price exactly as it will be persisted, so later arithmetic uses
 * the value that is actually stored rather than a longer in-memory one.
 */
export function quantizePrice(value: number | string | Decimal, field = 'price'): Decimal {
  const price = toDecimal(value);
  if (!price.isFinite()) {
    throw new ArgumentError(`${field} must be finite, received ${price.toString()}`);
  }
  if (price.isNegative()) {
    throw new ArgumentError(`${field} must be >= 0, received ${price.toString()}`);
  }
  const quantized = price.toDecimalPlaces(PRICE_STORAGE_SCALE, Decimal.ROUND_HALF_EVEN);
  if (quantized.gt(MAX_PRICE)) {
    throw new ArgumentError(`${field} must be <= ${MAX_PRICE.toString()}`);
  }
  return quantized;
}

export function quantizeFxRate(value: number | string | Decimal, field = 'rate'): Decimal {
  const rate = toDecimal(value);
  if (!rate.isFinite() || rate.lte(0)) {
    throw new ArgumentError(`${field} must be a positive finite number`);
  }
  return rate.toDecimalPlaces(FX_STORAGE_SCALE, Decimal.ROUND_HALF_EVEN);
}

/**
 * Converts a price into another currency. Kept explicit (rather than folded
 * into the caller) so every cross-currency step is auditable: a valuation must
 * be able to state which rate produced it.
 */
export function convertCurrency(
  amount: number | string | Decimal,
  rate: number | string | Decimal,
): Decimal {
  const fx = toDecimal(rate);
  if (!fx.isFinite() || fx.lte(0)) {
    throw new ArgumentError(`rate must be a positive finite number, received ${fx.toString()}`);
  }
  return toDecimal(amount).times(fx);
}

/**
 * Intrinsic (melt) value of a holding — PRD §10.2.
 * `fineWeightGrams × pricePerGram`, with no premium or dealer spread applied.
 */
export function intrinsicValue(
  fineWeightGrams: number | string | Decimal,
  pricePerGram: number | string | Decimal,
): Decimal {
  const weight = toDecimal(fineWeightGrams);
  const price = toDecimal(pricePerGram);
  if (weight.isNegative() || price.isNegative()) {
    throw new ArgumentError('fine weight and price per gram must both be >= 0');
  }
  return weight.times(price);
}
