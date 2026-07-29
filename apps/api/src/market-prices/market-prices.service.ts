import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import {
  assertPriceSourceType,
  normalizePricePerGram,
  pricePerUnitFromGram,
  quantizeFxRate,
  quantizePrice,
  type PriceSourceType,
  type WeightUnit,
} from '@bullion-ledger/shared';

import { PrismaService } from '../prisma/prisma.module.js';
import { PriceProviderRegistry } from '../price-providers/price-provider.registry.js';
import type { MetalQuote } from '../price-providers/price-provider.interface.js';

export interface StoredPrice {
  metalCode: string;
  timestamp: string;
  price: string;
  quoteCurrency: string;
  quoteUnit: string;
  pricePerGram: string;
  provider: string | null;
  sourceType: string;
}

export interface LatestPrice extends StoredPrice {
  /** Converted into the display currency, when an FX rate was available. */
  displayCurrency: string;
  pricePerGramDisplay: string | null;
  pricePerQianDisplay: string | null;
  pricePerTroyOzDisplay: string | null;
  fxRate: string | null;
  fxQuotedAt: string | null;
}

/**
 * Persistence and normalization for market data (PRD §12.2, §12.4).
 *
 * Two invariants live here. Every stored row carries a normalized
 * price-per-gram alongside its original quote, so downstream valuation never
 * re-derives a conversion; and the PRD §12.2 source types are kept in separate
 * rows, never merged, so a dealer's buyback quote can never be mistaken for
 * international spot.
 */
@Injectable()
export class MarketPricesService {
  private readonly logger = new Logger('MarketPrices');
  private readonly baseCurrency: string;
  private readonly quoteCurrency: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PriceProviderRegistry,
    config: ConfigService,
  ) {
    // Spot is quoted in USD upstream; TWD is what the ledger reports in.
    this.baseCurrency = (config.get<string>('PRICE_BASE_CURRENCY') ?? 'USD').toUpperCase();
    this.quoteCurrency = (config.get<string>('DEFAULT_CURRENCY') ?? 'TWD').toUpperCase();
  }

  get displayCurrency(): string {
    return this.quoteCurrency;
  }

  /** Fetches from the provider chain and stores whatever it returns. */
  async syncLatest(metalCodes?: readonly string[]): Promise<{ stored: number; provider: string }> {
    const codes = metalCodes?.length ? metalCodes : await this.activeMetalCodes();
    const { provider, quotes } = await this.providers.fetchLatest(codes);

    let stored = 0;
    for (const quote of quotes) {
      if (await this.storeQuote(quote, provider)) stored += 1;
    }
    return { stored, provider };
  }

  /** Refreshes the base→display FX rate used for every conversion. */
  async syncFxRate(): Promise<{ stored: boolean; rate: string }> {
    if (this.baseCurrency === this.quoteCurrency) {
      return { stored: false, rate: '1' };
    }
    const quote = await this.providers.fetchFxRate(this.baseCurrency, this.quoteCurrency);
    const rate = quantizeFxRate(quote.rate);

    const created = await this.prisma.fxRateSnapshot
      .create({
        data: {
          baseCurrency: quote.baseCurrency,
          quoteCurrency: quote.quoteCurrency,
          rate: rate.toFixed(),
          timestamp: quote.quotedAt,
          source: 'provider',
        },
      })
      .catch((error: unknown) => {
        // Same rate, same timestamp, same source — already recorded.
        if (isUniqueViolation(error)) return null;
        throw error;
      });

    return { stored: created !== null, rate: rate.toFixed() };
  }

  /**
   * Writes one quote, skipping an exact duplicate (PRD §12.4: identical
   * source + metal + granularity must not be written twice). Relies on the
   * database unique constraint rather than a read-then-write check, so
   * concurrent workers cannot both insert.
   */
  async storeQuote(quote: MetalQuote, provider: string): Promise<boolean> {
    const metal = await this.prisma.metal.findUnique({
      where: { code: quote.metalCode.toUpperCase() },
      select: { id: true },
    });
    if (!metal) {
      this.logger.warn(`Ignoring quote for unknown metal ${quote.metalCode}`);
      return false;
    }

    const price = quantizePrice(quote.price);
    const perGram = quantizePrice(normalizePricePerGram(price, quote.quoteUnit));

    const created = await this.prisma.spotPriceSnapshot
      .create({
        data: {
          metalId: metal.id,
          timestamp: quote.quotedAt,
          price: price.toFixed(),
          quoteCurrency: quote.quoteCurrency.toUpperCase(),
          quoteUnit: quote.quoteUnit,
          normalizedPricePerGram: perGram.toFixed(),
          sourceType: assertPriceSourceType(quote.sourceType),
          provider,
          raw: (quote.raw ?? null) as never,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) return null;
        throw error;
      });

    return created !== null;
  }

  /**
   * Records a hand-entered price (PRD §9 fallback, §12.2 MANUAL). Manual rows
   * are tagged `MANUAL` and attributed to `manual`, so they are never mistaken
   * for an automatic feed on the chart or in an audit.
   */
  async recordManualPrice(input: {
    metalCode: string;
    price: string;
    quoteCurrency: string;
    quoteUnit: WeightUnit;
    timestamp?: Date;
    sourceType?: PriceSourceType;
  }): Promise<StoredPrice> {
    const metal = await this.prisma.metal.findUnique({
      where: { code: input.metalCode.toUpperCase() },
      select: { id: true, code: true },
    });
    if (!metal) throw new NotFoundException(`Unknown metal ${input.metalCode}`);

    const price = quantizePrice(input.price);
    const perGram = quantizePrice(normalizePricePerGram(price, input.quoteUnit));
    const timestamp = input.timestamp ?? new Date();
    const sourceType = assertPriceSourceType(input.sourceType ?? 'MANUAL');

    const row = await this.prisma.spotPriceSnapshot.upsert({
      where: {
        metalId_timestamp_sourceType_quoteCurrency_quoteUnit: {
          metalId: metal.id,
          timestamp,
          sourceType,
          quoteCurrency: input.quoteCurrency.toUpperCase(),
          quoteUnit: input.quoteUnit,
        },
      },
      create: {
        metalId: metal.id,
        timestamp,
        price: price.toFixed(),
        quoteCurrency: input.quoteCurrency.toUpperCase(),
        quoteUnit: input.quoteUnit,
        normalizedPricePerGram: perGram.toFixed(),
        sourceType,
        provider: 'manual',
      },
      // Correcting a typo in a manual entry should update, not duplicate.
      update: {
        price: price.toFixed(),
        normalizedPricePerGram: perGram.toFixed(),
        provider: 'manual',
      },
    });

    return {
      metalCode: metal.code,
      timestamp: row.timestamp.toISOString(),
      price: row.price.toString(),
      quoteCurrency: row.quoteCurrency,
      quoteUnit: row.quoteUnit,
      pricePerGram: row.normalizedPricePerGram.toString(),
      provider: row.provider,
      sourceType: row.sourceType,
    };
  }

  /** Most recent stored price per metal, converted into the display currency. */
  async latest(sourceType: PriceSourceType = 'SPOT'): Promise<LatestPrice[]> {
    const metals = await this.prisma.metal.findMany({
      where: { active: true },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    const fx = await this.latestFxRate();

    const results: LatestPrice[] = [];
    for (const metal of metals) {
      const row = await this.prisma.spotPriceSnapshot.findFirst({
        where: { metalId: metal.id, sourceType },
        orderBy: { timestamp: 'desc' },
      });
      if (!row) continue;

      const perGram = new Decimal(row.normalizedPricePerGram.toString());
      const converted = this.convert(perGram, row.quoteCurrency, fx?.rate ?? null);

      results.push({
        metalCode: metal.code,
        timestamp: row.timestamp.toISOString(),
        price: row.price.toString(),
        quoteCurrency: row.quoteCurrency,
        quoteUnit: row.quoteUnit,
        pricePerGram: perGram.toFixed(),
        provider: row.provider,
        sourceType: row.sourceType,
        displayCurrency: this.quoteCurrency,
        pricePerGramDisplay: converted?.toFixed(6) ?? null,
        pricePerQianDisplay: converted ? pricePerUnitFromGram(converted, 'qian').toFixed(4) : null,
        pricePerTroyOzDisplay: converted
          ? pricePerUnitFromGram(converted, 'troy_oz').toFixed(4)
          : null,
        fxRate: fx?.rate.toFixed() ?? null,
        fxQuotedAt: fx?.timestamp.toISOString() ?? null,
      });
    }
    return results;
  }

  /** Time series for the market chart (PRD §11.4). */
  async history(input: {
    metalCode: string;
    from: Date;
    to: Date;
    sourceType?: PriceSourceType;
  }): Promise<StoredPrice[]> {
    const metal = await this.prisma.metal.findUnique({
      where: { code: input.metalCode.toUpperCase() },
      select: { id: true, code: true },
    });
    if (!metal) throw new NotFoundException(`Unknown metal ${input.metalCode}`);

    const rows = await this.prisma.spotPriceSnapshot.findMany({
      where: {
        metalId: metal.id,
        sourceType: input.sourceType ?? 'SPOT',
        timestamp: { gte: input.from, lte: input.to },
      },
      orderBy: { timestamp: 'asc' },
      take: 5000,
    });

    return rows.map((row) => ({
      metalCode: metal.code,
      timestamp: row.timestamp.toISOString(),
      price: row.price.toString(),
      quoteCurrency: row.quoteCurrency,
      quoteUnit: row.quoteUnit,
      pricePerGram: row.normalizedPricePerGram.toString(),
      provider: row.provider,
      sourceType: row.sourceType,
    }));
  }

  /** Backfills the chart from a provider that publishes dated series. */
  /**
   * Pulls a dated series into storage, one upstream request per missing day.
   *
   * Days already held are subtracted from the range first. Deduplication at the
   * database level would make a re-run harmless but not cheap — it would still
   * cost one HTTP request per day against a free CDN — so the skip happens
   * before any network call.
   */
  async backfillHistory(
    metalCode: string,
    from: Date,
    to: Date,
  ): Promise<{ stored: number; requestedDays: number; skippedDays: number }> {
    const missing = await this.missingHistoryDays(metalCode, from, to);
    if (missing.length === 0) {
      return { stored: 0, requestedDays: 0, skippedDays: totalDays(from, to) };
    }

    let stored = 0;
    // Fetch each contiguous run separately so an already-covered stretch in the
    // middle of the range is not re-downloaded.
    for (const [rangeStart, rangeEnd] of contiguousRanges(missing)) {
      const { provider, quotes } = await this.providers.fetchHistory({
        metalCode,
        from: rangeStart,
        to: rangeEnd,
        granularity: 'day',
      });
      for (const quote of quotes) {
        if (await this.storeQuote(quote, provider)) stored += 1;
      }
    }

    return {
      stored,
      requestedDays: missing.length,
      skippedDays: totalDays(from, to) - missing.length,
    };
  }

  /** UTC days in the range that hold no daily SPOT row yet. */
  async missingHistoryDays(metalCode: string, from: Date, to: Date): Promise<Date[]> {
    const metal = await this.prisma.metal.findUnique({
      where: { code: metalCode.toUpperCase() },
      select: { id: true },
    });
    if (!metal) throw new NotFoundException(`Unknown metal ${metalCode}`);

    const rows = await this.prisma.spotPriceSnapshot.findMany({
      where: {
        metalId: metal.id,
        sourceType: 'SPOT',
        timestamp: { gte: startOfUtcDay(from), lte: to },
      },
      select: { timestamp: true },
    });
    const covered = new Set(rows.map((row) => row.timestamp.toISOString().slice(0, 10)));

    const missing: Date[] = [];
    for (const day of eachUtcDay(from, to)) {
      if (!covered.has(day.toISOString().slice(0, 10))) missing.push(day);
    }
    return missing;
  }

  /** Nearest stored price at or before an instant — the basis for PRD §9. */
  async priceAt(
    metalCode: string,
    at: Date,
    sourceType: PriceSourceType = 'SPOT',
  ): Promise<{
    pricePerGram: Decimal;
    row: { timestamp: Date; quoteCurrency: string; provider: string | null };
  } | null> {
    const metal = await this.prisma.metal.findUnique({
      where: { code: metalCode.toUpperCase() },
      select: { id: true },
    });
    if (!metal) return null;

    const row = await this.prisma.spotPriceSnapshot.findFirst({
      where: { metalId: metal.id, sourceType, timestamp: { lte: at } },
      orderBy: { timestamp: 'desc' },
    });
    if (!row) return null;

    return {
      pricePerGram: new Decimal(row.normalizedPricePerGram.toString()),
      row: { timestamp: row.timestamp, quoteCurrency: row.quoteCurrency, provider: row.provider },
    };
  }

  async latestFxRate(): Promise<{ rate: Decimal; timestamp: Date } | null> {
    if (this.baseCurrency === this.quoteCurrency) {
      return { rate: new Decimal(1), timestamp: new Date() };
    }
    const row = await this.prisma.fxRateSnapshot.findFirst({
      where: { baseCurrency: this.baseCurrency, quoteCurrency: this.quoteCurrency },
      orderBy: { timestamp: 'desc' },
    });
    if (!row) return null;
    return { rate: new Decimal(row.rate.toString()), timestamp: row.timestamp };
  }

  /**
   * Applies FX only when the quote is in the base currency. An unexpected quote
   * currency yields null rather than a wrong number — a missing figure is
   * recoverable, a silently mis-converted one is not.
   */
  private convert(perGram: Decimal, quoteCurrency: string, fxRate: Decimal | null): Decimal | null {
    if (quoteCurrency.toUpperCase() === this.quoteCurrency) return perGram;
    if (quoteCurrency.toUpperCase() !== this.baseCurrency) return null;
    if (!fxRate) return null;
    return perGram.times(fxRate);
  }

  /** Public wrapper so the scheduler can seed history per metal. */
  async activeMetalCodesForBackfill(): Promise<string[]> {
    return this.activeMetalCodes();
  }

  private async activeMetalCodes(): Promise<string[]> {
    const metals = await this.prisma.metal.findMany({
      where: { active: true },
      select: { code: true },
    });
    return metals.map((metal) => metal.code);
  }
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Inclusive list of UTC midnights between two instants. */
export function eachUtcDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to).getTime();
  while (cursor.getTime() <= end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function totalDays(from: Date, to: Date): number {
  return eachUtcDay(from, to).length;
}

/**
 * Collapses sorted days into [start, end] runs, so a gap of consecutive
 * missing days becomes one provider call rather than one call per day.
 */
export function contiguousRanges(days: readonly Date[]): [Date, Date][] {
  const [first, ...rest] = days;
  if (!first) return [];

  const ranges: [Date, Date][] = [];
  let start = first;
  let previous = first;

  for (const day of rest) {
    const expected = new Date(previous);
    expected.setUTCDate(expected.getUTCDate() + 1);
    if (day.getTime() === expected.getTime()) {
      previous = day;
      continue;
    }
    ranges.push([start, previous]);
    start = day;
    previous = day;
  }
  ranges.push([start, previous]);
  return ranges;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
