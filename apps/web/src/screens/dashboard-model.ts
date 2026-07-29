import { pricePerUnitFromGram } from '@bullion-ledger/shared';

import type { DashboardSummary, ValuationNotice } from '../api.js';
import { WEIGHT_UNIT_LABELS, type WeightUnit } from '../units.js';

/** Colours a signed figure; an absent or zero value stays neutral. */
export function signTone(value: string | null): 'gain' | 'loss' | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return undefined;
  return parsed > 0 ? 'gain' : 'loss';
}

/** Renders a structured valuation notice as Chinese UI copy. */
export function describeNotice(
  notice: ValuationNotice | null,
  displayCurrency: string,
): string | null {
  if (!notice) return null;
  switch (notice.code) {
    case 'NO_PRICES':
      return '尚未取得任何行情，無法估值。';
    case 'UNPRICED_METALS':
      return `${notice.metals.join('、')} 尚無行情，已排除在總價值之外，因此暫不計算損益。`;
    case 'MIXED_COST_CURRENCIES':
      return `持倉分別以 ${notice.currencies.join('、')} 買入，無法與 ${displayCurrency} 估值直接相比，因此不計算損益。`;
  }
}

/** Explains why the cumulative premium cannot be shown as a single figure. */
export function describePremium(
  data: Pick<DashboardSummary, 'premiumPaid' | 'premiumCurrency' | 'premiumCurrencies'>,
  formatAmount: (amount: string, currency: string) => string,
): string {
  if (data.premiumPaid !== null) {
    return formatAmount(data.premiumPaid, data.premiumCurrency ?? '');
  }
  // Data exists but spans currencies — saying "no data" would be untrue.
  if (data.premiumCurrencies.length > 1) {
    return `${data.premiumCurrencies.join('、')} 各自計價，無法合計`;
  }
  return '尚無資料';
}

/**
 * Builds the explanations shown under the summary cards.
 *
 * A blank figure invites the reader to assume zero, so every absent number is
 * accompanied by the reason it is absent, plus how old the prices behind the
 * present ones are.
 */
export function valuationNotes(
  data: Pick<
    DashboardSummary,
    'notice' | 'purchasesAwaitingPrices' | 'priceAsOf' | 'valuationCurrency'
  >,
  formatTimestamp: (iso: string) => string = (iso) => new Date(iso).toLocaleString(),
): string[] {
  const notes: string[] = [];
  const notice = describeNotice(data.notice, data.valuationCurrency);
  if (notice) notes.push(notice);
  if (data.purchasesAwaitingPrices > 0) {
    notes.push(`${data.purchasesAwaitingPrices} 筆交易的購入行情尚未補齊。`);
  }
  if (data.priceAsOf) {
    const parsed = new Date(data.priceAsOf);
    if (!Number.isNaN(parsed.getTime())) {
      notes.push(`行情時間：${formatTimestamp(data.priceAsOf)}`);
    }
  }
  return notes;
}

/**
 * Converts a per-gram price into the unit the user has selected, so the price
 * and the weight beside it are always quoted in the same unit (PRD §11.6).
 */
export function formatPricePerUnit(
  pricePerGram: string,
  unit: WeightUnit,
  currency: string,
  decimals = 2,
): string {
  const converted = pricePerUnitFromGram(pricePerGram, unit).toDecimalPlaces(decimals);
  return `${currency} ${converted.toString()} / ${WEIGHT_UNIT_LABELS[unit]}`;
}
