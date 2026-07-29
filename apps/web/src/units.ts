import Decimal from 'decimal.js';
import {
  WEIGHT_UNITS,
  WEIGHT_UNIT_LABELS,
  type WeightUnit,
  fromGrams,
} from '@bullion-ledger/shared';

export { WEIGHT_UNITS, WEIGHT_UNIT_LABELS };
export type { WeightUnit };

export function formatGrams(grams: string | number, unit: WeightUnit, decimals = 4): string {
  const value = fromGrams(grams, unit);
  return `${value.toDecimalPlaces(decimals).toString()} ${WEIGHT_UNIT_LABELS[unit]}`;
}

export function formatMoney(value: string | number, currency: string, decimals = 2): string {
  const d = new Decimal(value).toDecimalPlaces(decimals);
  return `${currency} ${d.toString()}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
