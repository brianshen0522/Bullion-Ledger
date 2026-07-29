import Decimal from 'decimal.js';
import { pricePerUnitFromGram } from '@bullion-ledger/shared';

import type { WeightUnit } from '../units.js';

/** Time windows offered above the chart (PRD §11.3, §11.4.2). */
export const MARKET_RANGES = [
  { id: '7d', label: '7 天', days: 7 },
  { id: '1m', label: '1 個月', days: 30 },
  { id: '3m', label: '3 個月', days: 90 },
  { id: '6m', label: '6 個月', days: 180 },
  { id: '1y', label: '1 年', days: 365 },
  { id: 'ytd', label: '今年至今', days: null },
  { id: 'all', label: '全部', days: null },
] as const;

export type MarketRangeId = (typeof MARKET_RANGES)[number]['id'];

export interface PricePoint {
  timestamp: string;
  pricePerGram: string;
  quoteCurrency: string;
  provider: string | null;
}

export interface PurchaseMarker {
  purchaseId: string;
  purchasedAt: string;
  metalCode: string;
  names: string[];
  quantity: number;
  fineWeightGrams: string;
  totalCost: string;
  currency: string;
  spotPricePerGram: string | null;
  costPerGram: string;
  premiumRate: string | null;
  awaitingPrice: boolean;
}

export interface CostLines {
  currency: string | null;
  averageCostPerGram: string | null;
  averageSpotAtPurchase: string | null;
  breakEvenPerGram: string | null;
  unavailableReason: 'NO_HOLDINGS' | 'MIXED_CURRENCIES' | null;
}

/** Resolves a range id into an inclusive [from, to] window. */
export function rangeWindow(range: MarketRangeId, now = new Date()): { from: Date; to: Date } {
  const to = now;
  if (range === 'ytd') {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to };
  }
  if (range === 'all') {
    // The provider caps a backfill at 400 days, so "all" is that same ceiling.
    return { from: new Date(to.getTime() - 400 * 86_400_000), to };
  }
  const days = MARKET_RANGES.find((entry) => entry.id === range)?.days ?? 90;
  return { from: new Date(to.getTime() - days * 86_400_000), to };
}

/**
 * Converts a per-gram series into the chosen display unit and currency.
 *
 * `fxRate` is applied only when the stored quote currency differs from the one
 * being displayed; a null rate yields an empty series rather than numbers
 * produced by the wrong conversion.
 */
export function toChartSeries(
  points: readonly PricePoint[],
  unit: WeightUnit,
  displayCurrency: string,
  fxRate: string | null,
): [number, number][] {
  const series: [number, number][] = [];
  for (const point of points) {
    const converted = convertPrice(
      point.pricePerGram,
      point.quoteCurrency,
      displayCurrency,
      fxRate,
    );
    if (converted === null) continue;
    const at = new Date(point.timestamp).getTime();
    if (Number.isNaN(at)) continue;
    series.push([at, pricePerUnitFromGram(converted, unit).toNumber()]);
  }
  return series.sort((a, b) => a[0] - b[0]);
}

/**
 * Buy points plotted on the same axes as the series.
 *
 * A marker sits at the price *actually paid per gram*, not at the spot price of
 * the day: the question the chart answers is "where did I buy relative to the
 * market", and putting it on the spot line would hide the premium entirely.
 */
export function toMarkerSeries(
  markers: readonly PurchaseMarker[],
  unit: WeightUnit,
  displayCurrency: string,
  fxRate: string | null,
): { value: [number, number]; marker: PurchaseMarker }[] {
  const plotted: { value: [number, number]; marker: PurchaseMarker }[] = [];
  for (const marker of markers) {
    const converted = convertPrice(marker.costPerGram, marker.currency, displayCurrency, fxRate);
    if (converted === null) continue;
    const at = new Date(marker.purchasedAt).getTime();
    if (Number.isNaN(at)) continue;
    plotted.push({
      value: [at, pricePerUnitFromGram(converted, unit).toNumber()],
      marker,
    });
  }
  return plotted.sort((a, b) => a.value[0] - b.value[0]);
}

/** A horizontal reference line, already in display unit and currency. */
export function toLineValue(
  perGram: string | null,
  sourceCurrency: string | null,
  unit: WeightUnit,
  displayCurrency: string,
  fxRate: string | null,
): number | null {
  if (perGram === null || sourceCurrency === null) return null;
  const converted = convertPrice(perGram, sourceCurrency, displayCurrency, fxRate);
  if (converted === null) return null;
  return pricePerUnitFromGram(converted, unit).toNumber();
}

/**
 * Applies FX only for the exact pair the rate describes. Any other combination
 * returns null — a wrong conversion on a price chart is worse than a gap.
 */
export function convertPrice(
  amount: string,
  fromCurrency: string,
  toCurrency: string,
  fxRate: string | null,
): Decimal | null {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return new Decimal(amount);
  if (fxRate === null) return null;
  const rate = new Decimal(fxRate);
  if (!rate.isFinite() || rate.lte(0)) return null;
  // The stored rate is USD→display; the inverse covers display→USD.
  if (from === 'USD') return new Decimal(amount).times(rate);
  if (to === 'USD') return new Decimal(amount).div(rate);
  return null;
}

/** Groups markers that land within a day of each other (PRD §11.4.3). */
export function groupNearbyMarkers(
  markers: readonly { value: [number, number]; marker: PurchaseMarker }[],
  windowMs = 86_400_000,
): { value: [number, number]; markers: PurchaseMarker[] }[] {
  const groups: { value: [number, number]; markers: PurchaseMarker[] }[] = [];
  for (const entry of markers) {
    const last = groups[groups.length - 1];
    if (last && entry.value[0] - last.value[0] <= windowMs) {
      last.markers.push(entry.marker);
      continue;
    }
    groups.push({ value: entry.value, markers: [entry.marker] });
  }
  return groups;
}

export function formatPremiumRate(rate: string | null): string {
  if (rate === null) return '—';
  const percent = new Decimal(rate).times(100).toDecimalPlaces(2);
  return `${percent.isPositive() ? '+' : ''}${percent.toString()}%`;
}
