import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { intrinsicValue, pricePerUnitFromGram, quantizePrice } from '@bullion-ledger/shared';

import { PrismaService } from '../prisma/prisma.module.js';
import { MarketPricesService } from './market-prices.service.js';

export interface PurchaseSnapshotResult {
  purchaseId: string;
  metals: number;
  skipped: string[];
}

/**
 * Captures market conditions at the moment of a purchase (PRD §9) and derives
 * the premium actually paid (PRD §10.3).
 *
 * The result is stored as a flat copy rather than a join to live price rows.
 * What the user paid over melt value on a given day is a historical fact; it
 * must survive price pruning, a provider swap, or a later correction to the
 * price series, and must never silently change because today's spot moved.
 */
@Injectable()
export class PurchaseSnapshotService {
  private readonly logger = new Logger('PurchaseSnapshot');

  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketPricesService,
  ) {}

  /**
   * Builds one snapshot per metal in the purchase. Metals with no usable price
   * are reported as skipped rather than guessed at, so the Dashboard can show
   * an honest "行情尚未補齊" count (PRD §9, §11.1).
   */
  async capture(purchaseId: string): Promise<PurchaseSnapshotResult> {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      select: {
        id: true,
        currency: true,
        purchasedAt: true,
        items: {
          select: {
            allocatedCost: true,
            fineWeightGrams: true,
            metal: { select: { id: true, code: true } },
          },
        },
      },
    });
    if (!purchase) throw new NotFoundException(`Unknown purchase ${purchaseId}`);

    const byMetal = groupByMetal(purchase.items);
    const fx = await this.market.latestFxRate();
    const skipped: string[] = [];
    let captured = 0;

    for (const [metalCode, group] of byMetal) {
      const quote = await this.market.priceAt(metalCode, purchase.purchasedAt);
      if (!quote) {
        skipped.push(metalCode);
        continue;
      }

      const converted = this.toPurchaseCurrency(
        quote.pricePerGram,
        quote.row.quoteCurrency,
        purchase.currency,
        fx?.rate ?? null,
      );
      if (!converted) {
        skipped.push(metalCode);
        continue;
      }

      const melt = intrinsicValue(group.fineWeightGrams, converted.pricePerGram);
      const premiumAmount = group.allocatedCost.minus(melt);
      // Guard against a zero-weight line: a rate over zero melt is undefined,
      // not infinite, and must not be persisted as a bogus number.
      const premiumRate = melt.isZero()
        ? new Decimal(0)
        : premiumAmount.div(melt).toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN);

      await this.prisma.purchasePriceSnapshot.upsert({
        where: { purchaseId_metalId: { purchaseId: purchase.id, metalId: group.metalId } },
        create: {
          purchaseId: purchase.id,
          metalId: group.metalId,
          quotePrice: quantizePrice(quote.pricePerGram).toFixed(),
          quoteCurrency: quote.row.quoteCurrency,
          quoteUnit: 'g',
          quotedAt: quote.row.timestamp,
          provider: quote.row.provider ?? 'unknown',
          sourceType: 'SPOT',
          fxRate: converted.fxRate?.toFixed() ?? null,
          fxBaseCurrency: converted.fxRate ? quote.row.quoteCurrency : null,
          fxQuoteCurrency: converted.fxRate ? purchase.currency : null,
          pricePerGram: quantizePrice(converted.pricePerGram).toFixed(),
          pricePerQian: quantizePrice(
            pricePerUnitFromGram(converted.pricePerGram, 'qian'),
          ).toFixed(),
          intrinsicValue: melt.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(),
          premiumAmount: premiumAmount.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(),
          premiumRate: premiumRate.toFixed(),
          raw: { fineWeightGrams: group.fineWeightGrams.toFixed(), source: 'auto' },
        },
        // A re-run refreshes a snapshot captured before prices were backfilled.
        update: {
          quotePrice: quantizePrice(quote.pricePerGram).toFixed(),
          quotedAt: quote.row.timestamp,
          provider: quote.row.provider ?? 'unknown',
          fxRate: converted.fxRate?.toFixed() ?? null,
          pricePerGram: quantizePrice(converted.pricePerGram).toFixed(),
          pricePerQian: quantizePrice(
            pricePerUnitFromGram(converted.pricePerGram, 'qian'),
          ).toFixed(),
          intrinsicValue: melt.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(),
          premiumAmount: premiumAmount.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(),
          premiumRate: premiumRate.toFixed(),
        },
      });
      captured += 1;
    }

    if (skipped.length > 0) {
      this.logger.warn(
        `Purchase ${purchaseId}: no usable price for ${skipped.join(', ')}; will retry`,
      );
    }
    return { purchaseId, metals: captured, skipped };
  }

  /** Purchases still missing a snapshot for at least one of their metals. */
  async pendingPurchaseIds(limit = 50): Promise<string[]> {
    const purchases = await this.prisma.purchase.findMany({
      select: {
        id: true,
        items: { select: { metalId: true } },
        priceSnapshots: { select: { metalId: true } },
      },
      orderBy: { purchasedAt: 'desc' },
      take: 500,
    });

    return purchases
      .filter((purchase) => {
        const needed = new Set(purchase.items.map((item) => item.metalId));
        const have = new Set(purchase.priceSnapshots.map((snapshot) => snapshot.metalId));
        return [...needed].some((metalId) => !have.has(metalId));
      })
      .slice(0, limit)
      .map((purchase) => purchase.id);
  }

  /**
   * Converts a per-gram quote into the purchase's own currency. Returns null
   * when no defensible conversion exists, so the caller records nothing rather
   * than a number nobody can reproduce.
   */
  private toPurchaseCurrency(
    pricePerGram: Decimal,
    quoteCurrency: string,
    purchaseCurrency: string,
    fxRate: Decimal | null,
  ): { pricePerGram: Decimal; fxRate: Decimal | null } | null {
    if (quoteCurrency.toUpperCase() === purchaseCurrency.toUpperCase()) {
      return { pricePerGram, fxRate: null };
    }
    if (!fxRate) return null;
    // The stored FX rate is base→display; it only applies when the purchase is
    // in that display currency.
    if (purchaseCurrency.toUpperCase() !== this.market.displayCurrency) return null;
    return { pricePerGram: pricePerGram.times(fxRate), fxRate };
  }
}

interface MetalGroup {
  metalId: string;
  allocatedCost: Decimal;
  fineWeightGrams: Decimal;
}

export function groupByMetal(
  items: readonly {
    allocatedCost: Decimal | { toString(): string };
    fineWeightGrams: Decimal | { toString(): string };
    metal: { id: string; code: string };
  }[],
): Map<string, MetalGroup> {
  const groups = new Map<string, MetalGroup>();
  for (const item of items) {
    const existing = groups.get(item.metal.code) ?? {
      metalId: item.metal.id,
      allocatedCost: new Decimal(0),
      fineWeightGrams: new Decimal(0),
    };
    existing.allocatedCost = existing.allocatedCost.plus(
      new Decimal(item.allocatedCost.toString()),
    );
    existing.fineWeightGrams = existing.fineWeightGrams.plus(
      new Decimal(item.fineWeightGrams.toString()),
    );
    groups.set(item.metal.code, existing);
  }
  return groups;
}
