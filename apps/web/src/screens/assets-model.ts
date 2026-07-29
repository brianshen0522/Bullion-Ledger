import Decimal from 'decimal.js';

import {
  formatWeightInput,
  PURITY_INPUT_RE,
  MONEY_INPUT_RE,
  WEIGHT_INPUT_RE,
} from '@bullion-ledger/shared';
import type { HeldAssetListItem } from '../api.js';

export interface AssetFilters {
  query: string;
  metalCode: string;
}

export function filterHeldAssets(
  assets: readonly HeldAssetListItem[],
  filters: AssetFilters,
): HeldAssetListItem[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return assets.filter((asset) => {
    if (filters.metalCode && asset.metal.code !== filters.metalCode) return false;
    if (!query) return true;
    return [
      asset.name,
      asset.brand,
      asset.serial,
      asset.storageLocation,
      asset.purchase?.dealerName,
      asset.metal.code,
      asset.metal.name,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

export function heldUnitCount(assets: readonly HeldAssetListItem[]): number {
  return assets.reduce((sum, asset) => sum + asset.quantity, 0);
}

export function assetPhotoReadPath(photo: NonNullable<HeldAssetListItem['coverPhoto']>): string {
  const parameters = new URLSearchParams({
    variant: photo.variant,
    revision: String(photo.revision),
  });
  return `/attachments/${encodeURIComponent(photo.attachmentId)}/url?${parameters.toString()}`;
}

export interface AssetEditForm {
  quantity: string;
  unitWeight: string;
  weightUnitDirty: boolean;
  purity: string;
  allocatedCost: string;
  serial: string;
  storageLocation: string;
}

export function emptyAssetEditForm(asset: HeldAssetListItem): AssetEditForm {
  return {
    quantity: asset.quantity.toString(),
    unitWeight: formatWeightInput(asset.unitWeightGrams),
    weightUnitDirty: false,
    purity: asset.purity,
    allocatedCost: asset.allocatedCost,
    serial: asset.serial ?? '',
    storageLocation: asset.storageLocation ?? '',
  };
}

export function validateAssetEditForm(form: AssetEditForm): string | null {
  const qty = Number(form.quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1_000_000)
    return '數量必須為 1–1,000,000 之間的整數';
  if (!WEIGHT_INPUT_RE.test(form.unitWeight)) return '重量格式無效（最多9位小數，不允許科學記號）';
  try {
    const w = new Decimal(form.unitWeight);
    if (!w.isFinite() || w.lte(0)) return '重量必須大於 0';
  } catch {
    return '重量格式無效';
  }
  if (!PURITY_INPUT_RE.test(form.purity)) return '純度格式無效（最多7位小數，不允許科學記號）';
  try {
    const p = new Decimal(form.purity);
    if (!p.isFinite() || p.lte(0) || p.gt(1)) return '純度必須在 0 到 1 之間';
  } catch {
    return '純度格式無效';
  }
  const cost = form.allocatedCost.trim();
  if (!cost) return '成本不得為空';
  if (!MONEY_INPUT_RE.test(cost)) return '成本格式無效（最多2位小數，不允許科學記號）';
  try {
    const c = new Decimal(cost);
    if (!c.isFinite() || c.isNegative()) return '成本必須 >= 0';
  } catch {
    return '成本格式無效';
  }
  if (form.serial.trim().length > 128) return '序號不得超過 128 個字元';
  if (form.storageLocation.trim().length > 128) return '存放位置不得超過 128 個字元';
  return null;
}

export function buildAssetPatch(
  asset: HeldAssetListItem,
  form: AssetEditForm,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { version: asset.version };
  const qty = parseInt(form.quantity, 10);
  if (qty !== asset.quantity) patch.quantity = qty;
  const normalizedWeight = formatWeightInput(form.unitWeight);
  if (form.weightUnitDirty && normalizedWeight !== formatWeightInput(asset.unitWeightGrams)) {
    patch.unitWeight = normalizedWeight;
    patch.weightUnit = 'g';
  }
  const cleanPurity = new Decimal(form.purity).toFixed();
  if (cleanPurity !== asset.purity) patch.purity = cleanPurity;
  if (form.serial.trim() !== (asset.serial ?? '')) patch.serial = form.serial.trim() || null;
  if (form.storageLocation.trim() !== (asset.storageLocation ?? ''))
    patch.storageLocation = form.storageLocation.trim() || null;
  const normalizedCost = new Decimal(form.allocatedCost.trim()).toFixed();
  if (normalizedCost !== asset.allocatedCost) patch.allocatedCost = normalizedCost;
  return patch;
}
