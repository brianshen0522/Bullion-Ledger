import { Injectable } from '@nestjs/common';

import { PriceHttpClient } from '../http-client.js';
import {
  PriceProviderError,
  type FxQuote,
  type MetalQuote,
  type PriceProvider,
  type ProviderDescriptor,
} from '../price-provider.interface.js';
import { toPositiveNumberString } from './gold-api.provider.js';

const BASE_URL = 'https://open.er-api.com/v6/latest';

interface ErApiResponse {
  result?: unknown;
  time_last_update_unix?: unknown;
  rates?: Record<string, unknown>;
}

/**
 * USD-based foreign exchange from open.er-api.com (the free, keyless tier of
 * exchangerate-api.com). Supplies the USD→TWD rate that turns a USD spot quote
 * into the TWD figures the ledger actually reasons about.
 *
 * Rates refresh roughly daily, which is appropriate: intraday FX noise is far
 * smaller than the bullion premium this app is built to track.
 */
@Injectable()
export class ExchangeRateApiProvider implements PriceProvider {
  readonly descriptor: ProviderDescriptor = {
    id: 'exchangerate-api',
    capabilities: ['fx'],
    attribution: 'exchangerate-api.com',
  };

  constructor(private readonly http: PriceHttpClient) {}

  supportedMetals(): readonly string[] {
    return [];
  }

  fetchLatest(): Promise<MetalQuote[]> {
    // FX-only adapter; the registry never routes metal requests here.
    return Promise.resolve([]);
  }

  async fetchFxRate(baseCurrency: string, quoteCurrency: string): Promise<FxQuote> {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();

    const payload = await this.http
      .getJson<ErApiResponse>(`${BASE_URL}/${base}`)
      .catch((error: unknown) => {
        throw new PriceProviderError(
          this.descriptor.id,
          `failed to fetch ${base} rates: ${(error as Error).message}`,
          error,
        );
      });

    if (payload.result !== 'success') {
      throw new PriceProviderError(this.descriptor.id, `${base} rates request was not successful`);
    }

    const rate = toPositiveNumberString(payload.rates?.[quote]);
    if (rate === null) {
      throw new PriceProviderError(this.descriptor.id, `no usable ${base}/${quote} rate returned`);
    }

    return {
      baseCurrency: base,
      quoteCurrency: quote,
      rate,
      quotedAt: parseUnixSeconds(payload.time_last_update_unix),
      // Only the requested pair is retained; storing every rate would bloat the
      // audit payload with data the ledger never reads.
      raw: { result: payload.result, rate, time_last_update_unix: payload.time_last_update_unix },
    };
  }
}

export function parseUnixSeconds(value: unknown): Date {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000);
  }
  return new Date();
}
