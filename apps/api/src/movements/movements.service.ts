import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { AssetAcquisitionType, AssetMovementType } from '@prisma/client';
import {
  intrinsicValue,
  quantizeWeightGrams,
  toGrams,
  type WeightUnit,
} from '@bullion-ledger/shared';

import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { MarketPricesService } from '../market-prices/market-prices.service.js';
import { MetalsService } from '../metals/metals.service.js';
import {
  MovementError,
  booksRealizedPnl,
  computeSale,
  splitForDisposal,
  statusAfterDisposal,
} from './movement-domain.js';

export interface DisposalInput {
  assetId: string;
  occurredAt: Date;
  quantity: number;
  counterparty?: string;
  notes?: string;
  /** Optimistic concurrency guard from the holding the user was looking at. */
  version?: number;
}

export interface SaleInput extends DisposalInput {
  proceedsAmount: string;
  fees?: string;
  currency?: string;
}

export interface GiftInInput {
  occurredAt: Date;
  metalCode: string;
  name: string;
  quantity: number;
  unitWeight: string;
  weightUnit: WeightUnit;
  purity: string;
  counterparty?: string;
  storageLocation?: string;
  serial?: string;
  notes?: string;
}

/**
 * Asset lifecycle movements (PRD §6.4, §15.3).
 *
 * Every mutation writes the movement and the resulting balance inside one
 * transaction, guarded by the holding's optimistic `version`. A disposal can
 * therefore never be double-applied by two tabs, and the ledger can never
 * disagree with the balance it produced.
 */
@Injectable()
export class MovementsService {
  private readonly logger = new Logger('Movements');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly market: MarketPricesService,
    private readonly metals: MetalsService,
  ) {}

  async sell(input: SaleInput, context: AuditContext = {}) {
    const proceeds = parseMoney(input.proceedsAmount, 'proceedsAmount');
    const fees = parseMoney(input.fees ?? '0', 'fees');
    return this.dispose(AssetMovementType.SALE, input, context, { proceeds, fees });
  }

  async giftOut(input: DisposalInput, context: AuditContext = {}) {
    return this.dispose(AssetMovementType.GIFT_OUT, input, context);
  }

  async markLost(input: DisposalInput, context: AuditContext = {}) {
    return this.dispose(AssetMovementType.LOST, input, context);
  }

  async markDamaged(input: DisposalInput, context: AuditContext = {}) {
    return this.dispose(AssetMovementType.DAMAGED, input, context);
  }

  /** Relocates a holding without changing what is held (PRD §6.4). */
  async transferStorage(
    input: { assetId: string; occurredAt: Date; toStorageLocation: string; notes?: string },
    context: AuditContext = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({
        where: { id: input.assetId },
        select: { id: true, storageLocation: true, version: true, status: true },
      });
      if (!asset) throw new NotFoundException('Asset not found');

      const updated = await tx.asset.updateMany({
        where: { id: asset.id, version: asset.version },
        data: { storageLocation: input.toStorageLocation, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Asset changed; reload and retry');

      const movement = await tx.assetMovement.create({
        data: {
          assetId: asset.id,
          type: AssetMovementType.STORAGE_TRANSFER,
          occurredAt: input.occurredAt,
          fromStorageLocation: asset.storageLocation,
          toStorageLocation: input.toStorageLocation,
          notes: input.notes ?? null,
        },
      });

      await this.audit.recordInTransaction(tx, {
        ...context,
        action: 'asset.movement.storageTransfer',
        resourceType: 'AssetMovement',
        resourceId: movement.id,
        beforeSummary: { storageLocation: asset.storageLocation },
        afterSummary: { storageLocation: input.toStorageLocation },
      });
      return { movementId: movement.id };
    });
  }

  /**
   * Records metal received as a gift (PRD §6.4 收到贈與).
   *
   * The cost basis is the market value at receipt rather than zero. A zero
   * basis would report the entire holding as profit and make every return
   * percentage meaningless; valuing it at receipt means the reported gain is
   * only what happened after it arrived. The holding is tagged
   * `GIFT_RECEIVED` so purchased-only returns remain separable.
   */
  async giftIn(input: GiftInInput, context: AuditContext = {}) {
    const metal = await this.metals.requireByCode(input.metalCode);
    if (!metal.active) throw new BadRequestException(`Metal ${input.metalCode} is inactive`);

    const unitGrams = quantizeWeightGrams(toGrams(input.unitWeight, input.weightUnit));
    const purity = new Decimal(input.purity);
    if (!purity.gt(0) || purity.gt(1)) {
      throw new BadRequestException('purity must be greater than 0 and at most 1');
    }
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
      throw new BadRequestException('quantity must be a positive integer');
    }

    const grossWeightGrams = quantizeWeightGrams(unitGrams.times(input.quantity));
    const fineWeightGrams = quantizeWeightGrams(grossWeightGrams.times(purity));

    const valuation = await this.valueAt(input.metalCode, input.occurredAt, fineWeightGrams);

    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          metalId: metal.id,
          quantity: input.quantity,
          grossWeightGrams: grossWeightGrams.toFixed(),
          purity: purity.toFixed(),
          fineWeightGrams: fineWeightGrams.toFixed(),
          // Market value at receipt; zero when no price is known yet, which the
          // reconciliation pass can correct later.
          allocatedCost: (valuation?.marketValue ?? new Decimal(0)).toFixed(4),
          currency: valuation?.currency ?? this.market.displayCurrency,
          status: 'HELD',
          acquisitionType: AssetAcquisitionType.GIFT_RECEIVED,
          serial: input.serial ?? null,
          storageLocation: input.storageLocation ?? null,
          acquiredAt: input.occurredAt,
        },
      });

      const movement = await tx.assetMovement.create({
        data: {
          assetId: asset.id,
          type: AssetMovementType.GIFT_IN,
          occurredAt: input.occurredAt,
          quantity: input.quantity,
          fineWeightGrams: fineWeightGrams.toFixed(),
          grossWeightGrams: grossWeightGrams.toFixed(),
          counterparty: input.counterparty ?? null,
          costBasis: (valuation?.marketValue ?? new Decimal(0)).toFixed(4),
          // Receiving a gift books no gain; the value simply enters at cost.
          realizedPnl: null,
          spotPricePerGram: valuation?.pricePerGram.toFixed(6) ?? null,
          marketValue: valuation?.marketValue.toFixed(4) ?? null,
          marketCurrency: valuation?.currency ?? null,
          notes: input.notes ?? null,
        },
      });

      await this.audit.recordInTransaction(tx, {
        ...context,
        action: 'asset.movement.giftIn',
        resourceType: 'Asset',
        resourceId: asset.id,
        afterSummary: {
          metalCode: input.metalCode.toUpperCase(),
          name: input.name,
          quantity: input.quantity,
          fineWeightGrams: fineWeightGrams.toFixed(),
          valuedAt: valuation?.marketValue.toFixed(4) ?? null,
          counterparty: input.counterparty,
        },
      });

      return { assetId: asset.id, movementId: movement.id };
    });
  }

  /** Movement history, newest first. */
  async list(limit = 200) {
    const rows = await this.prisma.assetMovement.findMany({
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
      include: {
        asset: {
          select: {
            id: true,
            serial: true,
            metal: { select: { code: true, name: true } },
            product: { select: { name: true } },
            purchaseItem: { select: { name: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      assetId: row.assetId,
      type: row.type,
      occurredAt: row.occurredAt.toISOString(),
      metalCode: row.asset.metal.code,
      name: row.asset.purchaseItem?.name ?? row.asset.product?.name ?? row.asset.metal.name,
      quantity: row.quantity,
      fineWeightGrams: row.fineWeightGrams.toString(),
      counterparty: row.counterparty,
      proceedsAmount: row.proceedsAmount?.toString() ?? null,
      fees: row.fees?.toString() ?? null,
      netProceeds: row.netProceeds?.toString() ?? null,
      costBasis: row.costBasis?.toString() ?? null,
      realizedPnl: row.realizedPnl?.toString() ?? null,
      marketValue: row.marketValue?.toString() ?? null,
      currency: row.currency ?? row.marketCurrency,
      fromStorageLocation: row.fromStorageLocation,
      toStorageLocation: row.toStorageLocation,
      notes: row.notes,
    }));
  }

  /** Realized P&L per currency (PRD §11.1). Never sums across currencies. */
  async realizedTotals(): Promise<{
    amount: string | null;
    currency: string | null;
    currencies: string[];
  }> {
    const rows = await this.prisma.assetMovement.findMany({
      where: { realizedPnl: { not: null } },
      select: { realizedPnl: true, currency: true, marketCurrency: true },
    });
    if (rows.length === 0) return { amount: null, currency: null, currencies: [] };

    const currencies = [
      ...new Set(rows.map((row) => row.currency ?? row.marketCurrency ?? 'UNKNOWN')),
    ].sort();
    if (currencies.length !== 1) return { amount: null, currency: null, currencies };

    const total = rows.reduce(
      (sum, row) => sum.plus(new Decimal(row.realizedPnl?.toString() ?? '0')),
      new Decimal(0),
    );
    return {
      amount: total.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2),
      currency: currencies[0] ?? null,
      currencies,
    };
  }

  // --- internals ------------------------------------------------------------

  private async dispose(
    type: AssetMovementType,
    input: DisposalInput,
    context: AuditContext,
    sale?: { proceeds: Decimal; fees: Decimal },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({
        where: { id: input.assetId },
        select: {
          id: true,
          status: true,
          version: true,
          quantity: true,
          fineWeightGrams: true,
          grossWeightGrams: true,
          allocatedCost: true,
          currency: true,
          storageLocation: true,
          metal: { select: { code: true } },
        },
      });
      if (!asset) throw new NotFoundException('Asset not found');
      if (asset.status !== 'HELD') {
        throw new ConflictException(`Asset is already ${asset.status.toLowerCase()}`);
      }
      if (input.version !== undefined && input.version !== asset.version) {
        throw new ConflictException('Asset changed; reload and retry');
      }

      let split;
      try {
        split = splitForDisposal(
          {
            quantity: asset.quantity,
            fineWeightGrams: new Decimal(asset.fineWeightGrams.toString()),
            grossWeightGrams: new Decimal(asset.grossWeightGrams.toString()),
            allocatedCost: new Decimal(asset.allocatedCost.toString()),
          },
          input.quantity,
        );
      } catch (error) {
        if (error instanceof MovementError) throw new BadRequestException(error.message);
        throw error;
      }

      const currency = sale ? (asset.currency ?? this.market.displayCurrency) : asset.currency;
      const saleResult = sale ? computeSale(sale.proceeds, sale.fees, split.costBasis) : null;
      // Losing metal destroys its cost; a gift does not (see booksRealizedPnl).
      const realizedPnl = saleResult
        ? saleResult.realizedPnl
        : booksRealizedPnl(type)
          ? split.costBasis.negated()
          : null;

      const valuation = await this.valueAt(
        asset.metal.code,
        input.occurredAt,
        split.fineWeightGrams,
      );

      const updated = await tx.asset.updateMany({
        where: { id: asset.id, version: asset.version },
        data: {
          quantity: split.remaining.quantity,
          fineWeightGrams: split.remaining.fineWeightGrams.toFixed(),
          grossWeightGrams: split.remaining.grossWeightGrams.toFixed(),
          allocatedCost: split.remaining.allocatedCost.toFixed(4),
          status: statusAfterDisposal(type, split.remaining.quantity),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ConflictException('Asset changed; reload and retry');

      const movement = await tx.assetMovement.create({
        data: {
          assetId: asset.id,
          type,
          occurredAt: input.occurredAt,
          quantity: split.quantity,
          fineWeightGrams: split.fineWeightGrams.toFixed(),
          grossWeightGrams: split.grossWeightGrams.toFixed(),
          counterparty: input.counterparty ?? null,
          proceedsAmount: sale?.proceeds.toFixed(4) ?? null,
          fees: sale?.fees.toFixed(4) ?? null,
          netProceeds: saleResult?.netProceeds.toFixed(4) ?? null,
          currency: sale ? currency : null,
          costBasis: split.costBasis.toFixed(4),
          realizedPnl: realizedPnl?.toFixed(4) ?? null,
          spotPricePerGram: valuation?.pricePerGram.toFixed(6) ?? null,
          marketValue: valuation?.marketValue.toFixed(4) ?? null,
          marketCurrency: valuation?.currency ?? null,
          fromStorageLocation: asset.storageLocation,
          notes: input.notes ?? null,
        },
      });

      await this.audit.recordInTransaction(tx, {
        ...context,
        action: `asset.movement.${type.toLowerCase()}`,
        resourceType: 'AssetMovement',
        resourceId: movement.id,
        beforeSummary: { quantity: asset.quantity, allocatedCost: asset.allocatedCost.toString() },
        afterSummary: {
          quantity: split.quantity,
          remainingQuantity: split.remaining.quantity,
          costBasis: split.costBasis.toFixed(4),
          realizedPnl: realizedPnl?.toFixed(4) ?? null,
          counterparty: input.counterparty,
        },
      });

      return {
        movementId: movement.id,
        remainingQuantity: split.remaining.quantity,
        costBasis: split.costBasis.toFixed(4),
        netProceeds: saleResult?.netProceeds.toFixed(4) ?? null,
        realizedPnl: realizedPnl?.toFixed(4) ?? null,
      };
    });
  }

  /** Market value of a quantity of fine metal at an instant, if a price exists. */
  private async valueAt(
    metalCode: string,
    at: Date,
    fineWeightGrams: Decimal,
  ): Promise<{ pricePerGram: Decimal; marketValue: Decimal; currency: string } | null> {
    const quote = await this.market.priceAt(metalCode, at).catch(() => null);
    if (!quote) return null;

    const fx = await this.market.latestFxRate().catch(() => null);
    const quoteCurrency = quote.row.quoteCurrency.toUpperCase();
    const display = this.market.displayCurrency;

    let perGram = quote.pricePerGram;
    let currency = quoteCurrency;
    if (quoteCurrency !== display) {
      if (!fx) return null;
      perGram = perGram.times(fx.rate);
      currency = display;
    }

    return {
      pricePerGram: perGram,
      marketValue: intrinsicValue(fineWeightGrams, perGram).toDecimalPlaces(
        4,
        Decimal.ROUND_HALF_EVEN,
      ),
      currency,
    };
  }
}

function parseMoney(value: string, field: string): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new BadRequestException(`${field} must be a non-negative number`);
  }
  return parsed;
}
