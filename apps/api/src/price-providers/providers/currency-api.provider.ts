import { Injectable } from '@nestjs/common';

import { PriceHttpClient } from '../http-client.js';
import {
  PriceProviderError,
  type FxQuote,
  type HistoryQuery,
  type MetalQuote,
  type PriceProvider,
  type ProviderDescriptor,
} from '../price-provider.interface.js';
import { toPositiveNumberString } from './gold-api.provider.js';

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';

/** The dataset treats metals as currencies, keyed by lowercase code. */
const SUPPORTED = ['XAU', 'XAG'] as const;

/** One day of backfill is one request, so a range is capped to stay polite. */
const MAX_HISTORY_DAYS = 400;

type CurrencyApiResponse = Record<string, unknown> & { date?: unknown };

/**
 * fawazahmed0/currency-api, served from the jsDelivr CDN (PRD §12.1 adapter).
 *
 * Fills the two gaps gold-api.com leaves: it publishes **dated** endpoints, so
 * the historical price chart (PRD §11.4) can be backfilled, and it quotes both
 * metals and fiat, so it doubles as a fallback when the primary spot or FX
 * source is down.
 *
 * A quote here reads "1 XAU = N units of X", i.e. per troy ounce, matching the
 * metal-as-currency convention used across the dataset.
 */
@Injectable()
export class CurrencyApiProvider implements PriceProvider {
  readonly descriptor: ProviderDescriptor = {
    id: 'currency-api',
    capabilities: ['spot', 'fx', 'history'],
    attribution: 'fawazahmed0/currency-api (jsDelivr)',
  };

  constructor(private readonly http: PriceHttpClient) {}

  supportedMetals(): readonly string[] {
    return SUPPORTED;
  }

  async fetchLatest(metalCodes: readonly string[]): Promise<MetalQuote[]> {
    const quotes: MetalQuote[] = [];
    for (const code of metalCodes) {
      const upper = code.toUpperCase();
      if (!(SUPPORTED as readonly string[]).includes(upper)) continue;
      const quote = await this.fetchOn(upper, 'latest');
      if (quote) quotes.push(quote);
    }
    return quotes;
  }

  async fetchAt(metalCode: string, at: Date): Promise<MetalQuote | null> {
    return this.fetchOn(metalCode.toUpperCase(), isoDate(at));
  }

  /**
   * Walks the requested range one dated endpoint at a time. Days the dataset
   * has no entry for (weekends, holidays) are skipped rather than interpolated
   * — an invented price is worse than a gap in a chart.
   */
  async fetchHistory(query: HistoryQuery): Promise<MetalQuote[]> {
    const metalCode = query.metalCode.toUpperCase();
    if (!(SUPPORTED as readonly string[]).includes(metalCode)) return [];

    const days = enumerateDays(query.from, query.to);
    if (days.length > MAX_HISTORY_DAYS) {
      throw new PriceProviderError(
        this.descriptor.id,
        `history range exceeds ${MAX_HISTORY_DAYS} days`,
      );
    }

    const quotes: MetalQuote[] = [];
    for (const day of days) {
      const quote = await this.fetchOn(metalCode, day).catch(() => null);
      if (quote) quotes.push(quote);
    }
    return quotes;
  }

  async fetchFxRate(baseCurrency: string, quoteCurrency: string): Promise<FxQuote> {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();
    const payload = await this.load(base.toLowerCase(), 'latest');

    const table = payload[base.toLowerCase()];
    const rate = isRecord(table) ? toPositiveNumberString(table[quote.toLowerCase()]) : null;
    if (rate === null) {
      throw new PriceProviderError(this.descriptor.id, `no usable ${base}/${quote} rate returned`);
    }

    return {
      baseCurrency: base,
      quoteCurrency: quote,
      rate,
      quotedAt: parseDateOnly(payload.date),
      raw: { date: payload.date, rate },
    };
  }

  /** `version` is either "latest" or a YYYY-MM-DD dataset tag. */
  private async fetchOn(metalCode: string, version: string): Promise<MetalQuote | null> {
    const key = metalCode.toLowerCase();
    const payload = await this.load(key, version);
    const table = payload[key];
    if (!isRecord(table)) return null;

    // "1 XAU = N USD" — the metal is the base, so USD is the quote currency.
    const price = toPositiveNumberString(table.usd);
    if (price === null) return null;

    return {
      metalCode,
      price,
      quoteCurrency: 'USD',
      quoteUnit: 'troy_oz',
      quotedAt: parseDateOnly(payload.date),
      sourceType: 'SPOT',
      raw: { date: payload.date, usd: table.usd },
    };
  }

  private async load(key: string, version: string): Promise<CurrencyApiResponse> {
    const url = `${CDN_BASE}@${version}/v1/currencies/${key}.json`;
    return this.http.getJson<CurrencyApiResponse>(url).catch((error: unknown) => {
      throw new PriceProviderError(
        this.descriptor.id,
        `failed to load ${key}@${version}: ${(error as Error).message}`,
        error,
      );
    });
  }
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Inclusive list of UTC calendar days between two instants. */
export function enumerateDays(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= end) {
    days.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function parseDateOnly(value: unknown): Date {
  if (typeof value === 'string') {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
