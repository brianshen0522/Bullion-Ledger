import Decimal from 'decimal.js';
import {
  formatWeightInput,
  fromGrams,
  isWeightUnit,
  toDecimal,
  type WeightUnit,
} from '@bullion-ledger/shared';

import { toLocalDateTimeInput } from '../screens/purchase-form.js';
import {
  PURCHASE_WIZARD_STEPS,
  PURCHASE_WIZARD_VERSION,
  type PurchaseWizardDraft,
  type PurchaseWizardStep,
  type WizardCosts,
  type WizardItem,
  type WizardMedia,
  type WizardProduct,
  type WizardPurchasePayload,
} from './types.js';

export function createStableId(prefix = 'draft'): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) return `${prefix}-${webCrypto.randomUUID()}`;
  if (webCrypto?.getRandomValues) {
    const bytes = webCrypto.getRandomValues(new Uint8Array(12));
    return `${prefix}-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createEmptyWizardItem(metalCode = '', id = createStableId('item')): WizardItem {
  return {
    id,
    productDefinitionId: '',
    metalCode,
    form: 'bar',
    name: '',
    country: '',
    yearOrVersion: '',
    serial: '',
    quantity: '1',
    unitWeight: '1',
    weightUnit: 'g',
    purity: '0.9999',
    lineSubtotal: '0',
    manualAmount: '',
    packagingState: '',
    hasCertificate: false,
    initialStorageLocation: '',
    organizations: [],
  };
}

export function createPurchaseWizardDraft(
  options: {
    now?: Date;
    draftId?: string;
    metalCode?: string;
    itemId?: string;
  } = {},
): PurchaseWizardDraft {
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  return {
    version: PURCHASE_WIZARD_VERSION,
    draftId: options.draftId ?? createStableId('purchase-draft'),
    currentStep: 'transaction',
    furthestStep: 'transaction',
    transaction: {
      purchasedAt: toLocalDateTimeInput(now),
      dealerName: '',
      branch: '',
      orderNumber: '',
      invoiceNumber: '',
      currency: 'USD',
      paymentMethod: '',
      notes: '',
    },
    items: [createEmptyWizardItem(options.metalCode, options.itemId)],
    costs: {
      // Most purchases are a single price plus shipping; the itemized breakdown
      // is opt-in for when a receipt actually provides it.
      mode: 'SIMPLE',
      subtotal: '0',
      premium: '0',
      labor: '0',
      tax: '0',
      shipping: '0',
      otherFees: '0',
      discount: '0',
      allocationMethod: 'SUBTOTAL_PROPORTIONAL',
    },
    photos: [],
    documents: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function wizardStepIndex(step: PurchaseWizardStep): number {
  return PURCHASE_WIZARD_STEPS.findIndex(({ id }) => id === step);
}

export function isWizardStep(value: unknown): value is PurchaseWizardStep {
  return PURCHASE_WIZARD_STEPS.some(({ id }) => id === value);
}

export function touchWizardDraft(
  draft: PurchaseWizardDraft,
  now = new Date(),
): PurchaseWizardDraft {
  return { ...draft, updatedAt: now.toISOString() };
}

export function setWizardStep(
  draft: PurchaseWizardDraft,
  step: PurchaseWizardStep,
  now = new Date(),
): PurchaseWizardDraft {
  const furthestStep =
    wizardStepIndex(step) > wizardStepIndex(draft.furthestStep) ? step : draft.furthestStep;
  return touchWizardDraft({ ...draft, currentStep: step, furthestStep }, now);
}

export function addWizardItem(
  draft: PurchaseWizardDraft,
  item = createEmptyWizardItem(draft.items[0]?.metalCode ?? ''),
  now = new Date(),
): PurchaseWizardDraft {
  return touchWizardDraft({ ...draft, items: [...draft.items, item] }, now);
}

export function duplicateWizardItem(
  draft: PurchaseWizardDraft,
  itemId: string,
  nextId = createStableId('item'),
  now = new Date(),
): PurchaseWizardDraft {
  const index = draft.items.findIndex(({ id }) => id === itemId);
  if (index < 0) return draft;
  const original = draft.items[index]!;
  const copy: WizardItem = {
    ...original,
    id: nextId,
    serial: '',
    organizations: original.organizations.map((assignment) => ({
      ...assignment,
      id: createStableId('party'),
    })),
  };
  const items = [...draft.items];
  items.splice(index + 1, 0, copy);
  return touchWizardDraft({ ...draft, items }, now);
}

export function removeWizardItem(
  draft: PurchaseWizardDraft,
  itemId: string,
  now = new Date(),
): PurchaseWizardDraft {
  if (draft.items.length <= 1) return draft;
  return touchWizardDraft(
    {
      ...draft,
      items: draft.items.filter(({ id }) => id !== itemId),
      photos: normalizePrimaryWizardPhotos(
        draft.photos.map((photo) =>
          photo.targetItemId === itemId ? { ...photo, targetItemId: undefined } : photo,
        ),
      ),
    },
    now,
  );
}

function photoTargetKey(photo: WizardMedia): string {
  return photo.targetItemId ? `item:${photo.targetItemId}` : 'purchase';
}

/** Ensures every asset-photo target has exactly one stable primary photo. */
export function normalizePrimaryWizardPhotos(photos: readonly WizardMedia[]): WizardMedia[] {
  const primaryByTarget = new Map<string, string>();
  for (const photo of photos) {
    if (photo.kind !== 'ASSET_PHOTO' || photo.isPrimary !== true) continue;
    const target = photoTargetKey(photo);
    if (!primaryByTarget.has(target)) primaryByTarget.set(target, photo.id);
  }
  for (const photo of photos) {
    if (photo.kind !== 'ASSET_PHOTO') continue;
    const target = photoTargetKey(photo);
    if (!primaryByTarget.has(target)) primaryByTarget.set(target, photo.id);
  }
  return photos.map((photo) => {
    if (photo.kind !== 'ASSET_PHOTO') return photo;
    const isPrimary = primaryByTarget.get(photoTargetKey(photo)) === photo.id;
    return photo.isPrimary === isPrimary ? photo : { ...photo, isPrimary };
  });
}

export function setPrimaryWizardPhoto(
  photos: readonly WizardMedia[],
  photoId: string,
): WizardMedia[] {
  const selected = photos.find(({ id, kind }) => id === photoId && kind === 'ASSET_PHOTO');
  if (!selected) return normalizePrimaryWizardPhotos(photos);
  const target = photoTargetKey(selected);
  return normalizePrimaryWizardPhotos(
    photos.map((photo) =>
      photo.kind === 'ASSET_PHOTO' && photoTargetKey(photo) === target
        ? { ...photo, isPrimary: photo.id === photoId }
        : photo,
    ),
  );
}

export function retargetWizardPhoto(
  photos: readonly WizardMedia[],
  photoId: string,
  targetItemId: string | undefined,
): WizardMedia[] {
  const selected = photos.find(({ id, kind }) => id === photoId && kind === 'ASSET_PHOTO');
  if (!selected) return normalizePrimaryWizardPhotos(photos);
  const updated = photos.map((photo) =>
    photo.id === photoId ? { ...photo, targetItemId } : photo,
  );
  return selected.isPrimary
    ? setPrimaryWizardPhoto(updated, photoId)
    : normalizePrimaryWizardPhotos(updated);
}

export function moveWizardItem(
  draft: PurchaseWizardDraft,
  itemId: string,
  direction: -1 | 1,
  now = new Date(),
): PurchaseWizardDraft {
  const from = draft.items.findIndex(({ id }) => id === itemId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= draft.items.length) return draft;
  const items = [...draft.items];
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item!);
  return touchWizardDraft({ ...draft, items }, now);
}

export function applyProductToItem(item: WizardItem, product: WizardProduct): WizardItem {
  const unit: WeightUnit = isWeightUnit(product.defaultWeightUnit)
    ? product.defaultWeightUnit
    : 'g';
  const catalogOrganizations =
    product.organizations?.map((assignment) => ({
      ...assignment,
      id: createStableId('party'),
    })) ?? [];
  const organizations =
    catalogOrganizations.length > 0
      ? catalogOrganizations
      : product.brand
        ? [
            {
              id: createStableId('party'),
              displayName: product.brand,
              role: 'BRAND' as const,
              isPrimary: true,
              // Legacy catalog rows can expose only a free-text brand. Treat
              // it as unlinked if the user later converts the item to custom.
              custom: true,
            },
          ]
        : [];

  return {
    ...item,
    productDefinitionId: product.id,
    productDefinitionVersion: product.version,
    name: product.name,
    metalCode: product.metalCode,
    form: product.form,
    country: product.country ?? '',
    yearOrVersion: product.yearOrVersion ?? '',
    purity: toDecimal(product.defaultPurity).toFixed(),
    weightUnit: unit,
    unitWeight: formatWeightInput(fromGrams(product.defaultUnitWeightGrams, unit)),
    organizations,
  };
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Sum of the line subtotals — the single source of truth for the transaction
 * subtotal. Returns null when any line is not yet a usable number, so the UI
 * can show a dash instead of a misleading partial total.
 */
export function deriveSubtotal(items: readonly WizardItem[]): Decimal | null {
  try {
    return items.reduce(
      (sum, item) => sum.plus(new Decimal(item.lineSubtotal || '0')),
      new Decimal(0),
    );
  } catch {
    return null;
  }
}

/**
 * Costs as they should be submitted: the subtotal is recomputed from the lines,
 * and in SIMPLE mode the fields the buyer was never asked about are pinned to
 * zero rather than carrying a stale value from a previous switch to ITEMIZED.
 */
export function resolveCosts(draft: PurchaseWizardDraft): WizardCosts {
  const derived = deriveSubtotal(draft.items);
  const subtotal = derived === null ? draft.costs.subtotal : derived.toFixed(2);
  if (draft.costs.mode !== 'SIMPLE') return { ...draft.costs, subtotal };

  return {
    ...draft.costs,
    subtotal,
    premium: '0',
    labor: '0',
    tax: '0',
    otherFees: '0',
  };
}

export function buildWizardPurchasePayload(draft: PurchaseWizardDraft): WizardPurchasePayload {
  const costs = resolveCosts(draft);
  return {
    purchasedAt: new Date(draft.transaction.purchasedAt).toISOString(),
    dealerName: optional(draft.transaction.dealerName),
    branch: optional(draft.transaction.branch),
    orderNumber: optional(draft.transaction.orderNumber),
    invoiceNumber: optional(draft.transaction.invoiceNumber),
    currency: draft.transaction.currency,
    paymentMethod: optional(draft.transaction.paymentMethod),
    subtotal: costs.subtotal,
    premium: costs.premium,
    labor: costs.labor,
    tax: costs.tax,
    shipping: costs.shipping,
    otherFees: costs.otherFees,
    discount: costs.discount,
    allocationMethod: costs.allocationMethod,
    priceEntryMode: costs.mode,
    notes: optional(draft.transaction.notes),
    items: draft.items.map((item) => ({
      productDefinitionId: optional(item.productDefinitionId),
      productDefinitionVersion: item.productDefinitionId
        ? item.productDefinitionVersion
        : undefined,
      metalCode: item.metalCode,
      form: item.form.trim(),
      brand: optional(
        item.organizations.find(({ role, isPrimary }) => role === 'BRAND' && isPrimary)
          ?.displayName ??
          item.organizations.find(({ role }) => role === 'BRAND')?.displayName ??
          '',
      ),
      name: item.name.trim(),
      country: optional(item.country),
      yearOrVersion: optional(item.yearOrVersion),
      serial: optional(item.serial),
      quantity: Number(item.quantity),
      unitWeight: item.unitWeight,
      weightUnit: item.weightUnit,
      purity: item.purity,
      lineSubtotal: item.lineSubtotal,
      manualAmount: draft.costs.allocationMethod === 'MANUAL' ? item.manualAmount : undefined,
      packagingState: optional(item.packagingState),
      hasCertificate: item.hasCertificate,
      initialStorageLocation: optional(item.initialStorageLocation),
      parties: item.productDefinitionId
        ? undefined
        : item.organizations.map((assignment) => ({
            organizationId: assignment.custom ? undefined : assignment.organizationId,
            role: assignment.role,
            isPrimary: assignment.isPrimary,
            displayName:
              assignment.custom || !assignment.organizationId
                ? optional(assignment.displayName)
                : undefined,
            attributionStatus: 'USER_REPORTED' as const,
          })),
    })),
  };
}
