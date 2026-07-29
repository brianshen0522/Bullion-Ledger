import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { HELD_ASSET_INCLUDE, presentHeldAsset } from './asset-presenter.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';
import {
  assertMoney,
  fineWeightGrams,
  isWeightUnit,
  quantizeWeightGrams,
  quantizeMoney,
  toGrams,
  validatePurity,
} from '@bullion-ledger/shared';

type HeldAssetRecord = Prisma.AssetGetPayload<{ include: typeof HELD_ASSET_INCLUDE }>;

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const assets = await this.prisma.asset.findMany({
      where: { status: 'HELD' },
      orderBy: [{ acquiredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: HELD_ASSET_INCLUDE,
    });
    return assets.map(presentHeldAsset);
  }

  async update(id: string, dto: UpdateAssetDto, auditContext: AuditContext = {}) {
    if (dto.weightUnit !== undefined && dto.unitWeight === undefined) {
      throw new BadRequestException('weightUnit requires unitWeight');
    }
    if (
      dto.quantity === undefined &&
      dto.unitWeight === undefined &&
      dto.weightUnit === undefined &&
      dto.purity === undefined &&
      dto.allocatedCost === undefined &&
      dto.serial === undefined &&
      dto.storageLocation === undefined &&
      dto.name === undefined &&
      dto.brand === undefined &&
      dto.country === undefined &&
      dto.yearOrVersion === undefined &&
      dto.packagingState === undefined &&
      dto.hasCertificate === undefined
    ) {
      throw new BadRequestException('No changes provided');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.asset.findUnique({
        where: { id },
        include: HELD_ASSET_INCLUDE,
      });
      if (!before) throw new NotFoundException('Asset not found');
      if (before.version !== dto.version) {
        throw new ConflictException(
          `Asset version conflict: expected ${dto.version}, current ${before.version}`,
        );
      }
      if (before.status !== 'HELD') {
        throw new BadRequestException('Only HELD assets can be edited');
      }

      const oldQty = before.quantity;
      const oldGross = before.grossWeightGrams;
      const oldPurity = before.purity;

      const data: Record<string, unknown> = {};
      let recomputeGross = false;
      let recomputeFine = false;

      // Quantity.
      if (dto.quantity !== undefined) {
        if (!Number.isInteger(dto.quantity) || dto.quantity < 1) {
          throw new BadRequestException('quantity must be a positive integer');
        }
        data.quantity = dto.quantity;
        recomputeGross = true;
      }

      // Weight: only recompute gross when unitWeight supplied.
      if (dto.unitWeight !== undefined) {
        const unit = (dto.weightUnit ?? 'g') as never;
        if (!isWeightUnit(unit)) {
          throw new BadRequestException('Invalid weight unit');
        }
        const uwg = quantizeWeightGrams(toGrams(dto.unitWeight, unit), 'unitWeightGrams');
        if (uwg.lte(0)) {
          throw new BadRequestException('unitWeight must be > 0');
        }
        // Derive unit weight grams from input, then apply current or new quantity.
        const qty = (dto.quantity ?? oldQty) as number;
        data.grossWeightGrams = quantizeWeightGrams(uwg.times(qty), 'grossWeightGrams').toString();
        recomputeGross = false; // already set
        recomputeFine = true;
      } else if (recomputeGross) {
        // Quantity-only: derive unit weight from old gross/old quantity without
        // quantizing the unit weight, so repeated metadata-only edits do not drift.
        const derivedUnit = oldQty > 0 ? oldGross.dividedBy(oldQty) : new Decimal(0);
        const newQty = dto.quantity!;
        data.grossWeightGrams = quantizeWeightGrams(
          derivedUnit.times(newQty),
          'grossWeightGrams',
        ).toString();
        recomputeFine = true;
      }

      // Purity.
      if (dto.purity !== undefined) {
        data.purity = validatePurity(dto.purity).toString();
        recomputeFine = true;
      }

      // Fine weight.
      if (recomputeFine) {
        const gross = new Decimal((data.grossWeightGrams as string) ?? oldGross.toFixed());
        const purity = new Decimal((data.purity as string) ?? oldPurity.toFixed());
        data.fineWeightGrams = quantizeWeightGrams(
          fineWeightGrams(gross, purity),
          'fineWeightGrams',
        ).toString();
      }

      // Allocated cost. Null is rejected — unsetting cost requires a separate
      // transfer/disposal flow, not a metadata edit.
      if (dto.allocatedCost !== undefined) {
        if (dto.allocatedCost === null) {
          throw new BadRequestException(
            'allocatedCost cannot be null; use a transfer or disposal to zero cost',
          );
        }
        let cost: Decimal;
        try {
          cost = assertMoney(dto.allocatedCost);
        } catch {
          throw new BadRequestException('allocatedCost must be >= 0');
        }
        data.allocatedCost = quantizeMoney(cost).toString();
      }

      // Serial / storage location.
      if (dto.serial !== undefined) data.serial = nullableString(dto.serial);
      if (dto.storageLocation !== undefined)
        data.storageLocation = nullableString(dto.storageLocation);

      // Descriptive fields on the PurchaseItem snapshot (for non-catalog assets).
      const itemData: Record<string, unknown> = {};
      if (dto.name !== undefined) itemData.name = nullableString(dto.name) ?? '未命名資產';
      if (dto.brand !== undefined) itemData.brand = nullableString(dto.brand);
      if (dto.country !== undefined) itemData.country = nullableString(dto.country);
      if (dto.yearOrVersion !== undefined) itemData.yearOrVersion = nullableString(dto.yearOrVersion);
      if (dto.packagingState !== undefined) itemData.packagingState = nullableString(dto.packagingState);
      if (dto.hasCertificate !== undefined) itemData.hasCertificate = dto.hasCertificate;

      // Reject semantic no-op — every computed data value must differ from the
      // current persisted state (after canonicalization), or item fields changed.
      const assetChanged = Object.keys(data).some((key) => fieldDiffers(key, data[key], before));
      const itemChanged =
        before.purchaseItemId !== null &&
        Object.keys(itemData).length > 0 &&
        Object.keys(itemData).some((key) => itemFieldDiffers(key, itemData[key], before.purchaseItem));
      if (!assetChanged && !itemChanged) {
        throw new BadRequestException('No changes provided');
      }

      if (assetChanged) {
        const { count } = await tx.asset.updateMany({
          where: { id, version: before.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (count === 0) {
          throw new ConflictException(
            `Asset ${id} was updated by another request; refresh and retry`,
          );
        }
      }

      if (itemChanged && before.purchaseItemId) {
        await tx.purchaseItem.update({
          where: { id: before.purchaseItemId },
          data: itemData,
        });
      }

      const updated = await tx.asset.findUnique({
        where: { id },
        include: HELD_ASSET_INCLUDE,
      });

      await this.audit.recordInTransaction(tx, {
        ...auditContext,
        action: 'asset.update',
        resourceType: 'Asset',
        resourceId: id,
        beforeSummary: summarizeAsset(before),
        afterSummary: summarizeAsset(updated),
      });

      return updated!;
    });

    return presentHeldAsset(result);
  }
}

function summarizeAsset(asset: HeldAssetRecord | null) {
  if (!asset) return null;
  return {
    quantity: asset.quantity,
    grossWeightGrams: asset.grossWeightGrams.toFixed(),
    purity: asset.purity.toFixed(),
    fineWeightGrams: asset.fineWeightGrams.toFixed(),
    allocatedCost: asset.allocatedCost.toFixed(),
    serial: asset.serial,
    storageLocation: asset.storageLocation,
    status: asset.status,
    version: asset.version,
  };
}

function fieldDiffers(key: string, newValue: unknown, record: HeldAssetRecord): boolean {
  const oldValue = (record as Record<string, unknown>)[key];
  if (oldValue instanceof Decimal) {
    try {
      return !new Decimal(String(newValue)).eq(oldValue);
    } catch {
      return true;
    }
  }
  return String(newValue) !== String(oldValue);
}

function itemFieldDiffers(
  key: string,
  newValue: unknown,
  item: HeldAssetRecord['purchaseItem'],
): boolean {
  if (!item) return true;
  const oldValue = (item as Record<string, unknown>)[key];
  if (oldValue instanceof Decimal) {
    try {
      return !new Decimal(String(newValue)).eq(oldValue);
    } catch {
      return true;
    }
  }
  return String(newValue) !== String(oldValue ?? '');
}

function nullableString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed || null;
}
