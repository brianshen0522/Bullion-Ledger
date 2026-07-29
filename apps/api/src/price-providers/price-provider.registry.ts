import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.module.js';
import { GoldApiProvider } from './providers/gold-api.provider.js';
import { ExchangeRateApiProvider } from './providers/exchangerate-api.provider.js';
import { CurrencyApiProvider } from './providers/currency-api.provider.js';
import {
  PriceProviderError,
  type FxQuote,
  type HistoryQuery,
  type MetalQuote,
  type PriceProvider,
} from './price-provider.interface.js';

export interface ProviderStatus {
  provider: string;
  kind: string;
  attribution: string;
  capabilities: readonly string[];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  consecutiveFail: number;
  healthy: boolean;
}

/**
 * Selects providers, fails over, and records health (PRD §12.1).
 *
 * Ordering is explicit rather than clever: the configured primary is tried
 * first and the remaining capable adapters act as fallbacks. Every attempt —
 * success or failure — is recorded, because "the price is stale" and "the
 * provider has been failing for six hours" must be distinguishable on the
 * status page rather than inferred from a missing row.
 */
@Injectable()
export class PriceProviderRegistry {
  private readonly logger = new Logger('PriceProviders');
  private readonly providers: PriceProvider[];
  private readonly primaryId?: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    goldApi: GoldApiProvider,
    exchangeRate: ExchangeRateApiProvider,
    currencyApi: CurrencyApiProvider,
  ) {
    this.providers = [goldApi, exchangeRate, currencyApi];
    this.primaryId = config.get<string>('PRICE_PROVIDER')?.trim() || undefined;

    if (this.primaryId && !this.providers.some((p) => p.descriptor.id === this.primaryId)) {
      this.logger.warn(
        `PRICE_PROVIDER="${this.primaryId}" is not a known provider; using default ordering`,
      );
    }
  }

  list(): PriceProvider[] {
    return [...this.providers];
  }

  /** Capable providers, configured primary first. */
  private ordered(capability: 'spot' | 'fx' | 'history'): PriceProvider[] {
    const capable = this.providers.filter((provider) =>
      provider.descriptor.capabilities.includes(capability),
    );
    if (!this.primaryId) return capable;
    return [
      ...capable.filter((provider) => provider.descriptor.id === this.primaryId),
      ...capable.filter((provider) => provider.descriptor.id !== this.primaryId),
    ];
  }

  /**
   * Latest quotes, falling through to the next capable provider on failure.
   * A provider that returns an empty result is treated as a miss, not a
   * success, so a silently-degraded upstream still triggers failover.
   */
  async fetchLatest(metalCodes: readonly string[]): Promise<{
    provider: string;
    quotes: MetalQuote[];
  }> {
    const errors: string[] = [];

    for (const provider of this.ordered('spot')) {
      const id = provider.descriptor.id;
      try {
        const quotes = await provider.fetchLatest(metalCodes);
        if (quotes.length === 0) {
          errors.push(`${id}: returned no quotes`);
          await this.recordFailure(id, 'spot', 'returned no quotes');
          continue;
        }
        await this.recordSuccess(id, 'spot');
        return { provider: id, quotes };
      } catch (error) {
        const message = describe(error);
        errors.push(`${id}: ${message}`);
        await this.recordFailure(id, 'spot', message);
      }
    }

    throw new ServiceUnavailableException(
      `No price provider could supply a quote (${errors.join('; ')})`,
    );
  }

  async fetchFxRate(baseCurrency: string, quoteCurrency: string): Promise<FxQuote> {
    const errors: string[] = [];

    for (const provider of this.ordered('fx')) {
      const id = provider.descriptor.id;
      if (!provider.fetchFxRate) continue;
      try {
        const quote = await provider.fetchFxRate(baseCurrency, quoteCurrency);
        await this.recordSuccess(id, 'fx');
        return quote;
      } catch (error) {
        const message = describe(error);
        errors.push(`${id}: ${message}`);
        await this.recordFailure(id, 'fx', message);
      }
    }

    throw new ServiceUnavailableException(
      `No provider could supply ${baseCurrency}/${quoteCurrency} (${errors.join('; ')})`,
    );
  }

  async fetchHistory(query: HistoryQuery): Promise<{ provider: string; quotes: MetalQuote[] }> {
    for (const provider of this.ordered('history')) {
      const id = provider.descriptor.id;
      if (!provider.fetchHistory) continue;
      try {
        const quotes = await provider.fetchHistory(query);
        await this.recordSuccess(id, 'history');
        return { provider: id, quotes };
      } catch (error) {
        await this.recordFailure(id, 'history', describe(error));
      }
    }
    throw new ServiceUnavailableException('No provider could supply historical prices');
  }

  /** Union of every provider's supported metals (PRD §12.1). */
  supportedMetals(): string[] {
    const codes = new Set<string>();
    for (const provider of this.providers) {
      for (const code of provider.supportedMetals()) codes.add(code);
    }
    return [...codes].sort();
  }

  /** PRD §12.1 / §22.4 provider status. */
  async status(): Promise<ProviderStatus[]> {
    const rows = await this.prisma.priceProviderStatus.findMany();
    const byProvider = new Map(rows.map((row) => [row.provider, row]));

    return this.providers.map((provider) => {
      const { id, capabilities, attribution } = provider.descriptor;
      const row = byProvider.get(id);
      return {
        provider: id,
        kind: capabilities.join(','),
        attribution,
        capabilities,
        lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: row?.lastFailureAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null,
        consecutiveFail: row?.consecutiveFail ?? 0,
        // Never-run is not reported as healthy; it has proven nothing yet.
        healthy: row !== undefined && row.consecutiveFail === 0 && row.lastSuccessAt !== null,
      };
    });
  }

  private async recordSuccess(provider: string, kind: string): Promise<void> {
    await this.prisma.priceProviderStatus
      .upsert({
        where: { provider },
        create: { provider, kind, lastSuccessAt: new Date(), consecutiveFail: 0 },
        update: { kind, lastSuccessAt: new Date(), consecutiveFail: 0, lastError: null },
      })
      .catch((error: unknown) => {
        // Health bookkeeping must never fail the price fetch it describes.
        this.logger.warn(`Could not record success for ${provider}: ${describe(error)}`);
      });
  }

  private async recordFailure(provider: string, kind: string, message: string): Promise<void> {
    const lastError = message.slice(0, 500);
    await this.prisma.priceProviderStatus
      .upsert({
        where: { provider },
        create: { provider, kind, lastFailureAt: new Date(), lastError, consecutiveFail: 1 },
        update: {
          kind,
          lastFailureAt: new Date(),
          lastError,
          consecutiveFail: { increment: 1 },
        },
      })
      .catch((error: unknown) => {
        this.logger.warn(`Could not record failure for ${provider}: ${describe(error)}`);
      });
  }
}

function describe(error: unknown): string {
  if (error instanceof PriceProviderError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
