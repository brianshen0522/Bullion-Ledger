import Decimal from 'decimal.js';
import { intrinsicValue } from '@bullion-ledger/shared';

/**
 * Portfolio valuation arithmetic (PRD §10.2, §10.4, §10.7), kept pure so the
 * money rules can be tested without a database or a price feed.
 */

export interface MetalHolding {
  code: string;
  fineWeightGrams: string;
  costByCurrency: { currency: string; totalCost: string }[];
}

export interface MetalPrice {
  metalCode: string;
  /** Price per gram already expressed in the display currency. */
  pricePerGramDisplay: string | null;
  timestamp: string;
}

export interface MetalValuation {
  code: string;
  fineWeightGrams: string;
  intrinsicValue: string | null;
  pricePerGram: string | null;
  priceAsOf: string | null;
}

/**
 * Why a figure is absent, as data rather than prose.
 *
 * The API must not emit user-facing sentences: the interface is Chinese, and a
 * message assembled on the server cannot be translated at the point of display.
 * The client owns all wording.
 */
export type ValuationNotice =
  | { code: 'NO_PRICES' }
  | { code: 'UNPRICED_METALS'; metals: string[] }
  | { code: 'MIXED_COST_CURRENCIES'; currencies: string[] };

export interface PortfolioValuation {
  currency: string;
  /** Null when no metal could be priced at all. */
  intrinsicValue: string | null;
  /** Null when cost and value are not comparable — see `notice`. */
  unrealizedPnl: string | null;
  returnRate: string | null;
  byMetal: MetalValuation[];
  /** Metals held but not priced; their value is excluded from the total. */
  unpricedMetals: string[];
  /** Why P&L is absent, when it is. */
  notice: ValuationNotice | null;
  /** Oldest price used, so the UI can show how stale the figure is. */
  priceAsOf: string | null;
}

/**
 * Values holdings against the latest prices.
 *
 * Two refusals are deliberate. A metal with no price is excluded and named
 * rather than treated as worthless, and profit is not reported at all unless
 * every cost sits in the same currency as the valuation — a number mixing TWD
 * cost with USD value would look authoritative and be meaningless.
 */
export function valuePortfolio(
  holdings: readonly MetalHolding[],
  prices: readonly MetalPrice[],
  displayCurrency: string,
): PortfolioValuation {
  const priceByMetal = new Map(prices.map((price) => [price.metalCode, price]));

  const byMetal: MetalValuation[] = [];
  const unpricedMetals: string[] = [];
  let total = new Decimal(0);
  let priced = 0;
  let oldestPrice: string | null = null;

  for (const holding of holdings) {
    const price = priceByMetal.get(holding.code);
    const perGram = price?.pricePerGramDisplay ?? null;

    if (perGram === null) {
      unpricedMetals.push(holding.code);
      byMetal.push({
        code: holding.code,
        fineWeightGrams: holding.fineWeightGrams,
        intrinsicValue: null,
        pricePerGram: null,
        priceAsOf: null,
      });
      continue;
    }

    const value = intrinsicValue(holding.fineWeightGrams, perGram).toDecimalPlaces(
      2,
      Decimal.ROUND_HALF_EVEN,
    );
    total = total.plus(value);
    priced += 1;
    if (price && (oldestPrice === null || price.timestamp < oldestPrice)) {
      oldestPrice = price.timestamp;
    }

    byMetal.push({
      code: holding.code,
      fineWeightGrams: holding.fineWeightGrams,
      intrinsicValue: value.toFixed(2),
      pricePerGram: perGram,
      priceAsOf: price?.timestamp ?? null,
    });
  }

  const anyPriced = priced > 0;
  const costs = aggregateCosts(holdings);
  const comparable = costComparableTo(costs, displayCurrency);

  let unrealizedPnl: string | null = null;
  let returnRate: string | null = null;
  let notice: ValuationNotice | null = null;

  if (!anyPriced) {
    notice = holdings.length === 0 ? null : { code: 'NO_PRICES' };
  } else if (unpricedMetals.length > 0) {
    notice = { code: 'UNPRICED_METALS', metals: unpricedMetals };
  } else if (comparable === null) {
    notice =
      costs.size === 0
        ? null
        : { code: 'MIXED_COST_CURRENCIES', currencies: [...costs.keys()].sort() };
  } else {
    const pnl = total.minus(comparable);
    unrealizedPnl = pnl.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
    // PRD §10.7. Undefined against zero cost rather than infinite.
    returnRate = comparable.isZero()
      ? null
      : pnl.div(comparable).times(100).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(4);
  }

  return {
    currency: displayCurrency,
    intrinsicValue: anyPriced ? total.toFixed(2) : null,
    unrealizedPnl,
    returnRate,
    byMetal,
    unpricedMetals,
    notice,
    priceAsOf: oldestPrice,
  };
}

/** Total cost per currency across every holding. */
export function aggregateCosts(holdings: readonly MetalHolding[]): Map<string, Decimal> {
  const totals = new Map<string, Decimal>();
  for (const holding of holdings) {
    for (const cost of holding.costByCurrency) {
      totals.set(
        cost.currency,
        (totals.get(cost.currency) ?? new Decimal(0)).plus(new Decimal(cost.totalCost)),
      );
    }
  }
  return totals;
}

/**
 * The cost figure that may legitimately be compared with a valuation in
 * `displayCurrency`: only when that is the sole currency present.
 */
export function costComparableTo(
  costs: ReadonlyMap<string, Decimal>,
  displayCurrency: string,
): Decimal | null {
  if (costs.size !== 1) return null;
  const only = [...costs.entries()][0];
  if (!only) return null;
  const [currency, total] = only;
  return currency === displayCurrency ? total : null;
}
