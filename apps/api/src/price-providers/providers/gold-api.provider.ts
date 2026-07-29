import { Injectable } from '@nestjs/common';

import { PriceHttpClient } from '../http-client.js';
import {
  PriceProviderError,
  type MetalQuote,
  type PriceProvider,
  type ProviderDescriptor,
} from '../price-provider.interface.js';

const BASE_URL = 'https://api.gold-api.com/price';

/** gold-api.com quotes precious metals in USD per troy ounce. */
const SUPPORTED = ['XAU', 'XAG'] as const;

interface GoldApiResponse {
  name?: unknown;
  price?: unknown;
  symbol?: unknown;
  currency?: unknown;
  updatedAt?: unknown;
}

/**
 * Live spot prices from gold-api.com (PRD §12.1 adapter).
 *
 * Chosen as the default because it needs no API key or signup and updates
 * continuously, so the PRD §12.3 five-minute schedule is actually usable. It
 * publishes only the current price — historical series come from
 * {@link CurrencyApiProvider} instead.
 */
@Injectable()
export class GoldApiProvider implements PriceProvider {
  readonly descriptor: ProviderDescriptor = {
    id: 'gold-api',
    capabilities: ['spot'],
    attribution: 'gold-api.com',
  };

  constructor(private readonly http: PriceHttpClient) {}

  supportedMetals(): readonly string[] {
    return SUPPORTED;
  }

  async fetchLatest(metalCodes: readonly string[]): Promise<MetalQuote[]> {
    const wanted = metalCodes.filter((code) =>
      (SUPPORTED as readonly string[]).includes(code.toUpperCase()),
    );

    // Sequential rather than parallel: this is a free, unauthenticated service
    // and two requests every five minutes is not worth bursting.
    const quotes: MetalQuote[] = [];
    for (const code of wanted) {
      quotes.push(await this.fetchOne(code.toUpperCase()));
    }
    return quotes;
  }

  private async fetchOne(metalCode: string): Promise<MetalQuote> {
    const payload = await this.http
      .getJson<GoldApiResponse>(`${BASE_URL}/${metalCode}`)
      .catch((error: unknown) => {
        throw new PriceProviderError(
          this.descriptor.id,
          `failed to fetch ${metalCode}: ${(error as Error).message}`,
          error,
        );
      });

    const price = toPositiveNumberString(payload.price);
    if (price === null) {
      throw new PriceProviderError(this.descriptor.id, `${metalCode} response had no usable price`);
    }

    const currency = typeof payload.currency === 'string' ? payload.currency : 'USD';
    return {
      metalCode,
      price,
      quoteCurrency: currency.toUpperCase(),
      // gold-api publishes per troy ounce; it does not label the unit.
      quoteUnit: 'troy_oz',
      quotedAt: parseTimestamp(payload.updatedAt),
      sourceType: 'SPOT',
      raw: payload,
    };
  }
}

/**
 * Accepts only finite, positive numbers and returns them as strings so the
 * value reaches Decimal without a float round-trip.
 */
export function toPositiveNumberString(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? String(value) : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? value.trim() : null;
  }
  return null;
}

/** Falls back to fetch time when the upstream omits or mangles its timestamp. */
export function parseTimestamp(value: unknown): Date {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}
