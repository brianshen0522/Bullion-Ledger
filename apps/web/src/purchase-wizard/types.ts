import type { AllocationMethod, WeightUnit } from '@bullion-ledger/shared';

export const PURCHASE_WIZARD_VERSION = 1 as const;
export const MAX_WIZARD_MEDIA_PER_KIND = 200;

export const PURCHASE_WIZARD_STEPS = [
  { id: 'transaction', label: '交易資訊', shortLabel: '交易' },
  { id: 'items', label: '商品與重量', shortLabel: '商品' },
  { id: 'costs', label: '價格與費用', shortLabel: '價格' },
  { id: 'photos', label: '商品照片', shortLabel: '照片' },
  { id: 'documents', label: '文件', shortLabel: '文件' },
  { id: 'review', label: '確認入庫', shortLabel: '確認' },
] as const;

export type PurchaseWizardStep = (typeof PURCHASE_WIZARD_STEPS)[number]['id'];

export type OrganizationRole = 'BRAND' | 'ISSUER' | 'REFINER' | 'MINT' | 'MANUFACTURER' | 'ASSAYER';

export interface WizardOrganization {
  id: string;
  canonicalName: string;
  countryCode?: string;
  aliases?: string[];
  capabilities?: OrganizationRole[];
  matchedAlias?: string;
}

export interface WizardOrganizationAssignment {
  id: string;
  organizationId?: string;
  displayName: string;
  role: OrganizationRole;
  isPrimary: boolean;
  custom: boolean;
}

export type OrganizationSearchProvider = (
  query: string,
  options: { role?: OrganizationRole; limit: number; signal: AbortSignal },
) => Promise<WizardOrganization[]>;

export interface WizardMetal {
  id?: string;
  code: string;
  name: string;
}

export interface WizardProduct {
  id: string;
  version: number;
  name: string;
  metalCode: string;
  form: string;
  brand?: string | null;
  country?: string | null;
  yearOrVersion?: string | null;
  defaultPurity: string;
  defaultUnitWeightGrams: string;
  defaultWeightUnit: WeightUnit;
  organizations?: WizardOrganizationAssignment[];
}

export interface WizardTransaction {
  purchasedAt: string;
  dealerName: string;
  branch: string;
  orderNumber: string;
  invoiceNumber: string;
  currency: string;
  paymentMethod: string;
  notes: string;
}

export interface WizardItem {
  id: string;
  productDefinitionId: string;
  /** The ProductDefinition.version at the time the template was applied. */
  productDefinitionVersion?: number;
  metalCode: string;
  form: string;
  name: string;
  country: string;
  yearOrVersion: string;
  serial: string;
  quantity: string;
  unitWeight: string;
  weightUnit: WeightUnit;
  purity: string;
  lineSubtotal: string;
  manualAmount: string;
  packagingState: string;
  hasCertificate: boolean;
  initialStorageLocation: string;
  organizations: WizardOrganizationAssignment[];
}

/**
 * How the buyer knew the price (PRD §8.1).
 *
 * `SIMPLE` is what an online purchase actually looks like: one goods price that
 * already includes whatever premium and workmanship the dealer charged, plus
 * shipping. `ITEMIZED` is for a receipt that genuinely breaks those out.
 *
 * Recording which was used matters because it makes a stored `0` unambiguous —
 * in ITEMIZED it means "no tax was charged", in SIMPLE it means "not known
 * separately". The purchase premium the analytics use is derived from the spot
 * snapshot (PRD §10.3), never from these fields, so SIMPLE loses no analysis.
 */
export type PriceEntryMode = 'SIMPLE' | 'ITEMIZED';

export interface WizardCosts {
  mode: PriceEntryMode;
  /**
   * Always the sum of the line subtotals — derived, never typed. The API
   * re-checks the equality, so this stays an invariant rather than a chore.
   */
  subtotal: string;
  premium: string;
  labor: string;
  tax: string;
  shipping: string;
  otherFees: string;
  discount: string;
  allocationMethod: AllocationMethod;
}

/** Fields only meaningful when the buyer had an itemized receipt. */
export const ITEMIZED_ONLY_COST_FIELDS = ['premium', 'labor', 'tax', 'otherFees'] as const;

export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface DocumentCorners {
  topLeft: NormalizedPoint;
  topRight: NormalizedPoint;
  bottomRight: NormalizedPoint;
  bottomLeft: NormalizedPoint;
}

export type WizardMediaSource = 'CAMERA' | 'LIBRARY';
export type WizardMediaKind = 'ASSET_PHOTO' | 'DOCUMENT';

/**
 * File and previewUrl exist only for this browser session. LocalStorage keeps
 * metadata and non-destructive edit recipes, never a blob URL or replacement
 * for the original file.
 */
export interface WizardMedia {
  id: string;
  kind: WizardMediaKind;
  source: WizardMediaSource;
  targetItemId?: string;
  /** Exactly one asset photo per target item is normalized to primary. */
  isPrimary?: boolean;
  attachmentType?: string;
  documentType?: string;
  description?: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  lastModified?: number;
  width?: number;
  height?: number;
  originalFile?: File;
  previewUrl?: string;
  needsReselection: boolean;
  serverAttachmentStatus?: 'READY' | 'NEEDS_REVIEW' | 'PROCESSING' | 'FAILED';
  crop?: NormalizedCropRect;
  documentCorners?: DocumentCorners;
  createdAt: string;
}

export interface PurchaseWizardDraft {
  version: typeof PURCHASE_WIZARD_VERSION;
  draftId: string;
  currentStep: PurchaseWizardStep;
  furthestStep: PurchaseWizardStep;
  transaction: WizardTransaction;
  items: WizardItem[];
  costs: WizardCosts;
  photos: WizardMedia[];
  documents: WizardMedia[];
  createdAt: string;
  updatedAt: string;
}

/** Payload compatible with the existing POST /purchases DTO. */
export interface WizardPurchasePayload {
  purchasedAt: string;
  dealerName?: string;
  branch?: string;
  orderNumber?: string;
  invoiceNumber?: string;
  currency: string;
  paymentMethod?: string;
  subtotal: string;
  premium: string;
  labor: string;
  tax: string;
  shipping: string;
  otherFees: string;
  discount: string;
  allocationMethod: AllocationMethod;
  /** How the buyer knew the price; keeps a stored 0 unambiguous. */
  priceEntryMode: PriceEntryMode;
  notes?: string;
  items: {
    productDefinitionId?: string;
    /** The ProductDefinition.version observed at template selection. */
    productDefinitionVersion?: number;
    metalCode: string;
    form: string;
    brand?: string;
    name: string;
    country?: string;
    yearOrVersion?: string;
    serial?: string;
    quantity: number;
    unitWeight: string;
    weightUnit: WeightUnit;
    purity: string;
    lineSubtotal: string;
    manualAmount?: string;
    packagingState?: string;
    hasCertificate: boolean;
    initialStorageLocation?: string;
    /** Sent only for custom products; catalog products are authoritative server-side. */
    parties?: {
      organizationId?: string;
      role: OrganizationRole;
      displayName?: string;
      isPrimary: boolean;
      attributionStatus: 'USER_REPORTED';
    }[];
  }[];
}

export interface WizardValidationIssue {
  path: string;
  message: string;
}

export type WizardLocalSaveState = 'dirty' | 'saving' | 'saved' | 'error';
export type WizardSystemSaveState = 'unavailable' | 'saving' | 'saved' | 'error';
