import type { PriceSourceType, WeightUnit } from '@bullion-ledger/shared';

/**
 * Price Provider contract (PRD §12.1).
 *
 * The backend must never be welded to one market API, so every upstream source
 * is reached through this interface. Adapters return raw quotes in whatever
 * unit and currency the upstream speaks; normalization to price-per-gram is the
 * persistence layer's job, so a provider is never tempted to silently reshape
 * data before it has been recorded.
 */

/** A single quote exactly as the upstream expressed it. */
export interface MetalQuote {
  /** Metal code: XAU, XAG, XPT, XPD. */
  metalCode: string;
  price: string;
  quoteCurrency: string;
  quoteUnit: WeightUnit;
  /** When the upstream says the price was observed, not when we fetched it. */
  quotedAt: Date;
  sourceType: PriceSourceType;
  /** Auditable upstream payload. Must never contain credentials. */
  raw?: unknown;
}

export interface FxQuote {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  quotedAt: Date;
  raw?: unknown;
}

export interface HistoryQuery {
  metalCode: string;
  from: Date;
  to: Date;
  /** Coarsest acceptable spacing; providers may return finer or coarser data. */
  granularity: 'day' | 'hour';
}

export interface ProviderDescriptor {
  /** Stable id used in storage, config and status reporting. */
  id: string;
  /** Whether this adapter supplies metal prices, FX rates, or both. */
  capabilities: readonly ('spot' | 'fx' | 'history')[];
  /** Human-readable attribution shown in the UI next to a price. */
  attribution: string;
}

/**
 * Implemented by every market data adapter. Methods throw on failure; the
 * registry decides whether to fail over, and records the outcome either way.
 */
export interface PriceProvider {
  readonly descriptor: ProviderDescriptor;

  /** PRD §12.1: supported metal list. */
  supportedMetals(): readonly string[];

  /** PRD §12.1: latest price for each requested metal. */
  fetchLatest(metalCodes: readonly string[]): Promise<MetalQuote[]>;

  /** PRD §12.1: price at (or nearest before) a point in time. */
  fetchAt?(metalCode: string, at: Date): Promise<MetalQuote | null>;

  /** PRD §12.1: historical series for the chart and backfill. */
  fetchHistory?(query: HistoryQuery): Promise<MetalQuote[]>;

  /** Foreign-exchange rate, for providers that offer one. */
  fetchFxRate?(baseCurrency: string, quoteCurrency: string): Promise<FxQuote>;
}

/** Raised by adapters so the registry can distinguish upstream faults. */
export class PriceProviderError extends Error {
  constructor(
    readonly providerId: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PriceProviderError';
  }
}
