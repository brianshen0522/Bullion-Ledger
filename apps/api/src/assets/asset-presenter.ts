import { formatWeightInput } from '@bullion-ledger/shared';
import Decimal from 'decimal.js';
import type { Prisma } from '@prisma/client';

export const HELD_ASSET_INCLUDE = {
  metal: { select: { code: true, name: true } },
  product: {
    select: {
      name: true,
      form: true,
      brand: true,
      country: true,
      yearOrVersion: true,
    },
  },
  purchaseItem: {
    select: {
      name: true,
      form: true,
      brand: true,
      country: true,
      yearOrVersion: true,
      unitWeightGrams: true,
      packagingState: true,
      hasCertificate: true,
    },
  },
  purchase: { select: { purchasedAt: true, dealerName: true } },
  attachments: {
    where: {
      deletedAt: null,
      mediaClass: 'ASSET_PHOTO',
      status: 'READY',
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      kind: true,
      isCover: true,
      status: true,
      mediaClass: true,
      description: true,
      filename: true,
      mime: true,
      variants: {
        where: { kind: { in: ['THUMBNAIL', 'CROPPED', 'ORIGINAL'] } },
        orderBy: [{ revision: 'desc' }],
        select: {
          kind: true,
          revision: true,
          mime: true,
          width: true,
          height: true,
        },
      },
    },
  },
} satisfies Prisma.AssetInclude;

type HeldAssetRecord = Prisma.AssetGetPayload<{ include: typeof HELD_ASSET_INCLUDE }>;

/**
 * Held-inventory contract. For assets that reference a ProductDefinition, the
 * descriptive fields (name, form, brand, country, yearOrVersion) read from the
 * current definition so edits to the catalog are reflected in inventory.
 * Assets without a product fall back to their PurchaseItem snapshot.
 * Physical and financial fields always come from the Asset row.
 */
export function presentHeldAsset(asset: HeldAssetRecord) {
  const hasProduct = Boolean(asset.productDefinitionId && asset.product);
  const description = hasProduct ? asset.product : asset.purchaseItem;
  const unitWeightFromAsset =
    asset.quantity > 0 ? asset.grossWeightGrams.dividedBy(asset.quantity) : new Decimal(0);
  const coverPhoto = presentCoverPhoto(asset.attachments);

  return {
    id: asset.id,
    productDefinitionId: asset.productDefinitionId,
    name: description?.name ?? '未命名資產',
    form: description?.form ?? 'other',
    brand: description?.brand ?? null,
    country: description?.country ?? null,
    yearOrVersion: description?.yearOrVersion ?? null,
    metal: asset.metal,
    quantity: asset.quantity,
    // Prisma's Decimal runtime is not guaranteed to share object identity
    // with the shared package's decimal.js constructor. Cross the module
    // boundary as a fixed-point string instead of passing the Decimal object.
    unitWeightGrams: formatWeightInput(unitWeightFromAsset.toFixed()),
    grossWeightGrams: formatWeightInput(asset.grossWeightGrams.toFixed()),
    purity: asset.purity.toFixed(),
    fineWeightGrams: formatWeightInput(asset.fineWeightGrams.toFixed()),
    allocatedCost: asset.allocatedCost.toFixed(),
    currency: asset.currency,
    status: asset.status,
    serial: asset.serial,
    storageLocation: asset.storageLocation,
    packagingState: asset.purchaseItem?.packagingState ?? null,
    hasCertificate: asset.purchaseItem?.hasCertificate ?? false,
    acquiredAt: asset.acquiredAt.toISOString(),
    purchase: asset.purchase
      ? {
          purchasedAt: asset.purchase.purchasedAt.toISOString(),
          dealerName: asset.purchase.dealerName,
        }
      : null,
    coverPhoto,
    photos: asset.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      isCover: a.isCover,
      description: a.description,
      filename: a.filename,
      mime: a.mime,
      variant: bestVariant(a.variants),
    })),
    version: asset.version,
    updatedAt: asset.updatedAt.toISOString(),
  };
}

const PHOTO_VARIANT_PRIORITY = ['THUMBNAIL', 'CROPPED', 'ORIGINAL'] as const;

function bestVariant(
  variants: { kind: string; revision: number; mime: string; width: number | null; height: number | null }[],
) {
  for (const kind of PHOTO_VARIANT_PRIORITY) {
    const variant = variants.find((v) => v.kind === kind);
    if (!variant) continue;
    return {
      variant: kind,
      revision: variant.revision,
      mime: variant.mime,
      width: variant.width,
      height: variant.height,
    };
  }
  return null;
}

function presentCoverPhoto(attachments: HeldAssetRecord['attachments']) {
  // New uploads have one explicit cover per asset. The front/oldest fallbacks
  // keep photos visible for legacy purchases recorded before cover selection
  // was available in the wizard.
  const attachment =
    attachments.find(({ isCover }) => isCover) ??
    attachments.find(({ kind }) => kind === 'front') ??
    attachments[0];
  if (!attachment) return null;

  for (const kind of PHOTO_VARIANT_PRIORITY) {
    const variant = attachment.variants.find((candidate) => candidate.kind === kind);
    if (!variant) continue;
    return {
      attachmentId: attachment.id,
      variant: kind,
      revision: variant.revision,
      mime: variant.mime,
      width: variant.width,
      height: variant.height,
    };
  }
  return null;
}
