import Decimal from 'decimal.js';

import { ArgumentError, toDecimal } from './units.js';

/**
 * Money is always handled as Decimal. Currency codes follow ISO 4371-ish
 * (3 uppercase ASCII letters) plus the metals-currency convention XAU / XAG
 * used by market data providers, which the FX layer treats as a currency.
 */
export const CURRENCY_RE = /^[A-Z]{3}$/;

export const SUPPORTED_QUOTE_CURRENCIES = ['USD', 'TWD', 'EUR', 'JPY', 'XAU', 'XAG'] as const;

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY_RE.test(value);
}

export function assertCurrencyCode(value: unknown, field = 'currency'): string {
  if (!isCurrencyCode(value)) {
    throw new ArgumentError(
      `${field} must be a 3-letter uppercase ISO code, received ${stringifySafe(value)}`,
    );
  }
  return value;
}

/** Number of decimal places used for monetary amounts in storage. */
export const MONEY_SCALE = 2;

/** Smallest representable unit at MONEY_SCALE (e.g. 0.01). */
export const MONEY_UNIT = new Decimal('0.01');

/**
 * Purchase money is persisted in NUMERIC(18,4). Phase 1 allocates at two
 * decimal places, so this is the largest two-decimal value that can be stored
 * without a carry overflowing the database's fourteen integer digits.
 */
export const MAX_MONEY = new Decimal('99999999999999.99');

/** Canonical unsigned wire format for Phase 1 money inputs. */
export const MONEY_INPUT_RE = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;

export function isMoney(value: number | string | Decimal): boolean {
  try {
    const d = toDecimal(value);
    return d.isFinite() && !d.isNegative() && d.lte(MAX_MONEY);
  } catch {
    return false;
  }
}

export function assertMoney(value: unknown, field = 'amount'): Decimal {
  if (value === null || value === undefined || value === '') {
    throw new ArgumentError(`${field} is required`);
  }
  const d = toDecimal(value as number | string | Decimal);
  if (!d.isFinite()) {
    throw new ArgumentError(`${field} must be a finite number, received ${stringifySafe(value)}`);
  }
  if (d.isNegative()) {
    throw new ArgumentError(`${field} must be >= 0, received ${d.toString()}`);
  }
  if (d.gt(MAX_MONEY)) {
    throw new ArgumentError(
      `${field} must be <= ${MAX_MONEY.toString()}, received ${d.toString()}`,
    );
  }
  return d;
}

/**
 * Quantize a Decimal monetary value to MONEY_SCALE places using banker's
 * rounding, matching the deterministic remainder logic used by allocations.
 */
export function quantizeMoney(value: number | string | Decimal): Decimal {
  const quantized = assertMoney(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_EVEN);
  if (quantized.gt(MAX_MONEY)) {
    throw new ArgumentError(
      `amount rounds beyond storage maximum ${MAX_MONEY.toString()}, received ${stringifySafe(value)}`,
    );
  }
  return quantized;
}

function stringifySafe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}
