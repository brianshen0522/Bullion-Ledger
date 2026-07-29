import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

import { PrismaService } from '../prisma/prisma.module.js';

/** One purchase plotted against the price series (PRD §11.4.3). */
export interface PurchaseMarker {
  purchaseId: string;
  purchasedAt: string;
  metalCode: string;
  /** Item names in this purchase for this metal. */
  names: string[];
  quantity: number;
  fineWeightGrams: string;
  totalCost: string;
  currency: string;
  /** Spot price per gram at purchase, in the purchase currency (PRD §9). */
  spotPricePerGram: string | null;
  /** What was actually paid per gram of fine metal. */
  costPerGram: string;
  premiumRate: string | null;
  /** True when no price snapshot exists yet, so the marker has no spot to sit on. */
  awaitingPrice: boolean;
}

/** Reference lines drawn across the chart (PRD §11.4.4). */
export interface CostLines {
  currency: string | null;
  /** Σ cost ÷ Σ fine weight — the weighted average actually paid. */
  averageCostPerGram: string | null;
  /** Σ (fine weight × spot at purchase) ÷ Σ fine weight. */
  averageSpotAtPurchase: string | null;
  /**
   * Spot price at which holdings are worth what they cost. Equal to the average
   * cost per gram while no dealer buyback spread is modelled; it will diverge
   * once PRD §13.3 buyback rules exist.
   */
  breakEvenPerGram: string | null;
  /** Why the lines are absent, when they are. */
  unavailableReason: 'NO_HOLDINGS' | 'MIXED_CURRENCIES' | null;
}

export interface MarkerResponse {
  metalCode: string;
  markers: PurchaseMarker[];
  costLines: CostLines;
}

/**
 * Turns purchase history into chart overlays (PRD §11.4).
 *
 * Everything here is expressed in the *purchase* currency rather than the
 * display currency: a buy point is a historical fact about what was paid, and
 * re-converting it through today's FX would move a marker that never moved.
 * Cost lines are therefore withheld entirely when a metal was bought in more
 * than one currency, for the same reason the Dashboard withholds P&L.
 */
@Injectable()
export class MarketMarkersService {
  constructor(private readonly prisma: PrismaService) {}

  async forMetal(metalCode: string): Promise<MarkerResponse> {
    const code = metalCode.toUpperCase();
    const items = await this.prisma.purchaseItem.findMany({
      where: { metal: { code } },
      select: {
        quantity: true,
        fineWeightGrams: true,
        allocatedCost: true,
        name: true,
        purchaseId: true,
        purchase: {
          select: {
            id: true,
            purchasedAt: true,
            currency: true,
            priceSnapshots: {
              where: { metal: { code } },
              select: { pricePerGram: true, premiumRate: true },
            },
          },
        },
      },
      orderBy: { purchase: { purchasedAt: 'asc' } },
    });

    const byPurchase = new Map<string, PurchaseMarker>();
    for (const item of items) {
      const existing = byPurchase.get(item.purchaseId);
      const snapshot = item.purchase.priceSnapshots[0];

      if (!existing) {
        byPurchase.set(item.purchaseId, {
          purchaseId: item.purchase.id,
          purchasedAt: item.purchase.purchasedAt.toISOString(),
          metalCode: code,
          names: [item.name],
          quantity: item.quantity,
          fineWeightGrams: item.fineWeightGrams.toString(),
          totalCost: item.allocatedCost.toString(),
          currency: item.purchase.currency,
          spotPricePerGram: snapshot?.pricePerGram.toString() ?? null,
          costPerGram: '0',
          premiumRate: snapshot?.premiumRate.toString() ?? null,
          awaitingPrice: snapshot === undefined,
        });
        continue;
      }

      // Several lines of the same metal in one purchase collapse to one marker.
      existing.names.push(item.name);
      existing.quantity += item.quantity;
      existing.fineWeightGrams = new Decimal(existing.fineWeightGrams)
        .plus(item.fineWeightGrams.toString())
        .toString();
      existing.totalCost = new Decimal(existing.totalCost)
        .plus(item.allocatedCost.toString())
        .toString();
    }

    const markers = [...byPurchase.values()].map((marker) => ({
      ...marker,
      costPerGram: perGram(marker.totalCost, marker.fineWeightGrams),
    }));

    return { metalCode: code, markers, costLines: computeCostLines(markers) };
  }
}

/** Cost per gram, or '0' for a weightless line rather than a division by zero. */
export function perGram(total: string, fineWeightGrams: string): string {
  const weight = new Decimal(fineWeightGrams);
  if (weight.isZero()) return '0';
  return new Decimal(total).div(weight).toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toFixed();
}

export function computeCostLines(markers: readonly PurchaseMarker[]): CostLines {
  if (markers.length === 0) {
    return {
      currency: null,
      averageCostPerGram: null,
      averageSpotAtPurchase: null,
      breakEvenPerGram: null,
      unavailableReason: 'NO_HOLDINGS',
    };
  }

  const currencies = new Set(markers.map((marker) => marker.currency));
  if (currencies.size !== 1) {
    return {
      currency: null,
      averageCostPerGram: null,
      averageSpotAtPurchase: null,
      breakEvenPerGram: null,
      unavailableReason: 'MIXED_CURRENCIES',
    };
  }

  let totalCost = new Decimal(0);
  let totalWeight = new Decimal(0);
  let spotWeighted = new Decimal(0);
  let spotWeight = new Decimal(0);

  for (const marker of markers) {
    const weight = new Decimal(marker.fineWeightGrams);
    totalCost = totalCost.plus(marker.totalCost);
    totalWeight = totalWeight.plus(weight);
    if (marker.spotPricePerGram !== null) {
      spotWeighted = spotWeighted.plus(weight.times(marker.spotPricePerGram));
      spotWeight = spotWeight.plus(weight);
    }
  }

  const averageCost = totalWeight.isZero()
    ? null
    : totalCost.div(totalWeight).toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toFixed();

  return {
    currency: [...currencies][0] ?? null,
    averageCostPerGram: averageCost,
    averageSpotAtPurchase: spotWeight.isZero()
      ? null
      : spotWeighted.div(spotWeight).toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toFixed(),
    // Identical to average cost until a buyback spread is modelled (PRD §13.3).
    breakEvenPerGram: averageCost,
    unavailableReason: null,
  };
}
