import Decimal from 'decimal.js';

export interface HeldAssetSummaryInput {
  metalCode: string;
  currency: string;
  quantity: number;
  fineWeightGrams: string | Decimal;
  allocatedCost: string | Decimal;
}

export interface CurrencyCostSummary {
  currency: string;
  totalCost: string;
}

export interface MetalHoldingSummary {
  code: string;
  fineWeightGrams: string;
  heldAssetLots: number;
  /** Integer string so an inventory count never loses precision in JSON. */
  heldAssetUnits: string;
  costByCurrency: CurrencyCostSummary[];
}

export interface HeldAssetsSummary {
  heldAssetLots: number;
  /** Sum of Asset.quantity, not the number of lot rows. */
  heldAssetUnits: string;
  purchaseCount: number;
  costByCurrency: CurrencyCostSummary[];
  byMetal: MetalHoldingSummary[];
}

/**
 * Summarize held lots without ever combining costs from different currencies.
 * This function is pure so the financial grouping contract can be tested
 * independently of Prisma.
 */
export function summarizeHeldAssets(
  assets: HeldAssetSummaryInput[],
  purchaseCount: number,
): HeldAssetsSummary {
  const costByCurrency = new Map<string, Decimal>();
  const byMetal = new Map<
    string,
    {
      fineWeightGrams: Decimal;
      heldAssetLots: number;
      heldAssetUnits: bigint;
      costByCurrency: Map<string, Decimal>;
    }
  >();
  let heldAssetUnits = 0n;

  for (const asset of assets) {
    if (!Number.isInteger(asset.quantity) || asset.quantity < 0) {
      throw new RangeError(`held asset quantity must be a non-negative integer: ${asset.quantity}`);
    }

    const quantity = BigInt(asset.quantity);
    const cost = new Decimal(asset.allocatedCost);
    const fineWeight = new Decimal(asset.fineWeightGrams);
    heldAssetUnits += quantity;
    costByCurrency.set(
      asset.currency,
      (costByCurrency.get(asset.currency) ?? new Decimal(0)).plus(cost),
    );

    const metal = byMetal.get(asset.metalCode) ?? {
      fineWeightGrams: new Decimal(0),
      heldAssetLots: 0,
      heldAssetUnits: 0n,
      costByCurrency: new Map<string, Decimal>(),
    };
    metal.fineWeightGrams = metal.fineWeightGrams.plus(fineWeight);
    metal.heldAssetLots += 1;
    metal.heldAssetUnits += quantity;
    metal.costByCurrency.set(
      asset.currency,
      (metal.costByCurrency.get(asset.currency) ?? new Decimal(0)).plus(cost),
    );
    byMetal.set(asset.metalCode, metal);
  }

  return {
    heldAssetLots: assets.length,
    heldAssetUnits: heldAssetUnits.toString(),
    purchaseCount,
    costByCurrency: serializeCurrencyCosts(costByCurrency),
    byMetal: Array.from(byMetal.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, metal]) => ({
        code,
        fineWeightGrams: metal.fineWeightGrams.toString(),
        heldAssetLots: metal.heldAssetLots,
        heldAssetUnits: metal.heldAssetUnits.toString(),
        costByCurrency: serializeCurrencyCosts(metal.costByCurrency),
      })),
  };
}

function serializeCurrencyCosts(costs: Map<string, Decimal>): CurrencyCostSummary[] {
  return Array.from(costs.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, totalCost]) => ({ currency, totalCost: totalCost.toString() }));
}
