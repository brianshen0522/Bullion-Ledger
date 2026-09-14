import Decimal from 'decimal.js';
import { formatWeightInput, fromGrams, toGrams, type WeightUnit } from '@bullion-ledger/shared';

import type { AssetAttachment, HeldAssetListItem } from '../api.js';

/** Descriptive fields a single holding can override (mirrors the API list). */
export const OVERRIDABLE_FIELDS = ['name', 'form', 'brand', 'country', 'yearOrVersion'] as const;

export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

export interface AssetEditForm {
  name: string;
  form: string;
  brand: string;
  country: string;
  yearOrVersion: string;
  serial: string;
  storageLocation: string;
  packagingState: string;
  hasCertificate: boolean;
  quantity: string;
  unitWeight: string;
  weightUnit: WeightUnit;
  purity: string;
  allocatedCost: string;
}

export interface PurchaseEditForm {
  dealerName: string;
  branch: string;
  orderNumber: string;
  invoiceNumber: string;
  paymentMethod: string;
  notes: string;
}

export function initialAssetForm(asset: HeldAssetListItem): AssetEditForm {
  return {
    name: asset.name ?? '',
    form: asset.form ?? '',
    brand: asset.brand ?? '',
    country: asset.country ?? '',
    yearOrVersion: asset.yearOrVersion ?? '',
    serial: asset.serial ?? '',
    storageLocation: asset.storageLocation ?? '',
    packagingState: asset.packagingState ?? '',
    hasCertificate: asset.hasCertificate,
    quantity: String(asset.quantity),
    unitWeight: formatWeightInput(asset.unitWeightGrams),
    weightUnit: 'g',
    purity: asset.purity,
    allocatedCost: asset.allocatedCost,
  };
}

export function initialPurchaseForm(asset: HeldAssetListItem): PurchaseEditForm {
  return {
    dealerName: asset.purchase?.dealerName ?? '',
    branch: asset.purchase?.branch ?? '',
    orderNumber: asset.purchase?.orderNumber ?? '',
    invoiceNumber: asset.purchase?.invoiceNumber ?? '',
    paymentMethod: asset.purchase?.paymentMethod ?? '',
    notes: asset.purchase?.notes ?? '',
  };
}

/**
 * The unit weight the form shows, converted back to grams for comparison and
 * submission. Returns null when the entry is not a usable number, so the caller
 * reports a validation error instead of sending a malformed patch.
 */
export function unitWeightGrams(
  form: Pick<AssetEditForm, 'unitWeight' | 'weightUnit'>,
): string | null {
  const raw = form.unitWeight.trim();
  if (!raw) return null;
  try {
    return formatWeightInput(toGrams(raw, form.weightUnit).toFixed());
  } catch {
    return null;
  }
}

/** Displays a stored gram value in the unit the user picked. */
export function unitWeightInUnit(grams: string, unit: WeightUnit): string {
  try {
    return formatWeightInput(fromGrams(grams, unit).toFixed());
  } catch {
    return grams;
  }
}

export type AssetPatch = Record<string, unknown> & { version: number };

/**
 * Diffs the form against the holding. Only changed fields are sent, so a save
 * that touches one field cannot silently rewrite another, and an unchanged form
 * produces a patch with nothing but `version` (the caller then skips the call).
 *
 * Descriptive fields go out even when they equal the inherited value: the API
 * reads that as "clear the override", which is how a lot returns to following
 * its product definition.
 */
export type AssetPatchResult = { patch: AssetPatch } | { error: string };

export function buildAssetPatch(asset: HeldAssetListItem, form: AssetEditForm): AssetPatchResult {
  const patch: AssetPatch = { version: asset.version };

  const quantity = Number.parseInt(form.quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 1) return { error: '數量必須是 1 以上的整數。' };
  if (quantity !== asset.quantity) patch.quantity = quantity;

  const grams = unitWeightGrams(form);
  if (grams === null) return { error: '單件重量必須是有效的數字。' };
  if (new Decimal(grams).lte(0)) return { error: '單件重量必須大於 0。' };
  if (grams !== formatWeightInput(asset.unitWeightGrams)) {
    patch.unitWeight = grams;
    patch.weightUnit = 'g';
  }

  let purity: Decimal;
  try {
    purity = new Decimal(form.purity.trim());
  } catch {
    return { error: '純度必須是有效的數字。' };
  }
  if (purity.lte(0) || purity.gt(1)) return { error: '純度必須介於 0 與 1 之間。' };
  if (purity.toFixed() !== asset.purity) patch.purity = purity.toFixed();

  let cost: Decimal;
  try {
    cost = new Decimal(form.allocatedCost.trim());
  } catch {
    return { error: '分攤成本必須是有效的數字。' };
  }
  if (cost.isNegative()) return { error: '分攤成本不能是負數。' };
  if (cost.toFixed() !== asset.allocatedCost) patch.allocatedCost = cost.toFixed();

  if (form.serial.trim() !== (asset.serial ?? '')) patch.serial = form.serial.trim() || null;
  if (form.storageLocation.trim() !== (asset.storageLocation ?? '')) {
    patch.storageLocation = form.storageLocation.trim() || null;
  }
  if (form.packagingState.trim() !== (asset.packagingState ?? '')) {
    patch.packagingState = form.packagingState.trim() || null;
  }
  if (form.hasCertificate !== asset.hasCertificate) patch.hasCertificate = form.hasCertificate;

  for (const field of OVERRIDABLE_FIELDS) {
    const next = form[field].trim();
    if (next !== (asset[field] ?? '')) patch[field] = next || null;
  }

  return { patch };
}

export function assetPatchHasChanges(patch: AssetPatch): boolean {
  return Object.keys(patch).length > 1;
}

const PURCHASE_FIELDS = [
  'dealerName',
  'branch',
  'orderNumber',
  'invoiceNumber',
  'paymentMethod',
  'notes',
] as const;

/** Transaction metadata diff. Empty object means nothing to send. */
export function buildPurchasePatch(
  asset: HeldAssetListItem,
  form: PurchaseEditForm,
): Record<string, string | null> {
  const current = initialPurchaseForm(asset);
  const patch: Record<string, string | null> = {};
  for (const field of PURCHASE_FIELDS) {
    const next = form[field].trim();
    if (next !== current[field].trim()) patch[field] = next || null;
  }
  return patch;
}

export interface AttachmentEdit {
  id: string;
  version: number;
  kind: string;
  description: string;
  isCover: boolean;
}

export interface AttachmentReviewPatch {
  id: string;
  body: { version: number; kind?: string; description?: string | null; isCover?: boolean };
}

/**
 * Metadata changes to replay onto attachments that already exist on the server.
 *
 * Previously only the cover flag was persisted — a renamed photo caption or a
 * re-typed document kind was dropped on save. Versions come from the listing
 * that populated the form, because there is no endpoint that reads one
 * attachment on its own.
 */
export function attachmentReviewPatches(
  original: readonly AttachmentEdit[],
  edited: readonly AttachmentEdit[],
): AttachmentReviewPatch[] {
  const before = new Map(original.map((item) => [item.id, item]));
  const patches: AttachmentReviewPatch[] = [];
  for (const item of edited) {
    const prior = before.get(item.id);
    if (!prior) continue;
    const body: AttachmentReviewPatch['body'] = { version: item.version };
    if (item.kind !== prior.kind) body.kind = item.kind;
    if (item.description !== prior.description) body.description = item.description || null;
    if (item.isCover !== prior.isCover) body.isCover = item.isCover;
    if (Object.keys(body).length > 1) patches.push({ id: item.id, body });
  }
  return patches;
}

export type DocumentPreview = 'image' | 'pdf' | 'none';

/** How a document can be shown in place: inline image, embedded PDF, or not. */
export function documentPreview(mime: string): DocumentPreview {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'none';
}

/** The best variant to display for an attachment, newest derivative first. */
export function previewVariant(
  attachment: Pick<AssetAttachment, 'variants'>,
  priority: readonly string[] = ['SCAN_COLOR', 'CROPPED', 'THUMBNAIL', 'ORIGINAL'],
): { kind: string; revision: number } | null {
  for (const kind of priority) {
    const matches = attachment.variants.filter((variant) => variant.kind === kind);
    if (matches.length === 0) continue;
    const newest = matches.reduce((best, variant) =>
      variant.revision > best.revision ? variant : best,
    );
    return { kind: newest.kind, revision: newest.revision };
  }
  return null;
}

export function attachmentReadPath(
  attachmentId: string,
  variant: { kind: string; revision: number } | null,
  disposition?: 'inline' | 'attachment',
): string {
  const params = new URLSearchParams();
  if (variant) {
    params.set('variant', variant.kind);
    params.set('revision', String(variant.revision));
  }
  if (disposition) params.set('disposition', disposition);
  const query = params.toString();
  return `/attachments/${encodeURIComponent(attachmentId)}/url${query ? `?${query}` : ''}`;
}

/**
 * Whether a document is shared by the whole purchase. Those files are listed
 * alongside the holding's own photos but deleting one removes it from every lot
 * of that purchase, so the UI has to say which it is.
 */
export function isPurchaseScoped(attachment: Pick<AssetAttachment, 'purchaseId'>): boolean {
  return attachment.purchaseId !== null;
}
