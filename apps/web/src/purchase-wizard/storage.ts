import { useCallback, useEffect, useRef, useState } from 'react';
import { CLIENT_DRAFT_ID_PATTERN, isAllocationMethod, isWeightUnit } from '@bullion-ledger/shared';

import { isWizardStep, wizardStepIndex } from './model.js';
import {
  MAX_WIZARD_MEDIA_PER_KIND,
  PURCHASE_WIZARD_VERSION,
  type DocumentCorners,
  type NormalizedCropRect,
  type NormalizedPoint,
  type PurchaseWizardDraft,
  type WizardCosts,
  type WizardItem,
  type WizardLocalSaveState,
  type WizardMedia,
  type WizardOrganizationAssignment,
  type WizardSystemSaveState,
  type WizardTransaction,
} from './types.js';

export const PURCHASE_WIZARD_STORAGE_KEY = `bullion-ledger:purchase-wizard:v${PURCHASE_WIZARD_VERSION}`;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type DraftRestoreStatus = 'restored' | 'missing' | 'corrupt' | 'unsupported-version';

export interface DraftRestoreResult {
  draft: PurchaseWizardDraft | null;
  status: DraftRestoreStatus;
}

type PersistedMedia = Omit<WizardMedia, 'originalFile' | 'previewUrl'>;

function mediaForStorage(media: WizardMedia): PersistedMedia {
  const { originalFile: _originalFile, previewUrl: _previewUrl, ...metadata } = media;
  return {
    ...metadata,
    // A local File cannot safely be reconstructed from localStorage.
    needsReselection: metadata.needsReselection || Boolean(_originalFile || _previewUrl),
  };
}

export function serializePurchaseWizardDraft(draft: PurchaseWizardDraft): string {
  return JSON.stringify({
    ...draft,
    version: PURCHASE_WIZARD_VERSION,
    photos: draft.photos.map(mediaForStorage),
    documents: draft.documents.map(mediaForStorage),
  });
}

export function parsePurchaseWizardDraft(raw: string): DraftRestoreResult {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { draft: null, status: 'corrupt' };
  }
  if (!isRecord(value)) return { draft: null, status: 'corrupt' };
  if (value.version !== PURCHASE_WIZARD_VERSION) {
    return { draft: null, status: 'unsupported-version' };
  }

  if (
    typeof value.draftId !== 'string' ||
    !CLIENT_DRAFT_ID_PATTERN.test(value.draftId) ||
    !isWizardStep(value.currentStep) ||
    !isWizardStep(value.furthestStep) ||
    wizardStepIndex(value.currentStep) > wizardStepIndex(value.furthestStep) ||
    !isRecord(value.transaction) ||
    !isRecord(value.costs) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 100 ||
    !Array.isArray(value.photos) ||
    value.photos.length > MAX_WIZARD_MEDIA_PER_KIND ||
    !Array.isArray(value.documents) ||
    value.documents.length > MAX_WIZARD_MEDIA_PER_KIND ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    return { draft: null, status: 'corrupt' };
  }

  try {
    const items = value.items.map((item, index) => parseItem(item, index));
    const itemIds = new Set(items.map(({ id }) => id));
    if (itemIds.size !== items.length) throw new Error('duplicate item id');
    const photos = value.photos.map((media) => parseMedia(media, 'ASSET_PHOTO'));
    const documents = value.documents.map((media) => parseMedia(media, 'DOCUMENT'));
    const mediaIds = new Set<string>();
    for (const media of [...photos, ...documents]) {
      if (mediaIds.has(media.id)) throw new Error('duplicate media id');
      mediaIds.add(media.id);
      if (media.targetItemId && !itemIds.has(media.targetItemId)) {
        throw new Error('media references an unknown item');
      }
    }
    const draft: PurchaseWizardDraft = {
      version: PURCHASE_WIZARD_VERSION,
      draftId: value.draftId,
      currentStep: value.currentStep,
      furthestStep: value.furthestStep,
      transaction: parseTransaction(value.transaction),
      costs: parseCosts(value.costs),
      items,
      photos,
      documents,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
    return { draft, status: 'restored' };
  } catch {
    return { draft: null, status: 'corrupt' };
  }
}

function parseTransaction(value: Record<string, unknown>): WizardTransaction {
  return {
    purchasedAt: requiredString(value, 'purchasedAt', 64),
    dealerName: requiredString(value, 'dealerName', 200),
    branch: requiredString(value, 'branch', 200),
    orderNumber: requiredString(value, 'orderNumber', 200),
    invoiceNumber: requiredString(value, 'invoiceNumber', 200),
    currency: requiredString(value, 'currency', 12),
    paymentMethod: requiredString(value, 'paymentMethod', 100),
    notes: requiredString(value, 'notes', 5_000),
  };
}

function parseCosts(value: Record<string, unknown>): WizardCosts {
  if (!isAllocationMethod(value.allocationMethod)) throw new Error('invalid allocation method');
  return {
    // Drafts saved before the simple/itemized split carry no mode. They were
    // authored against the full breakdown, so ITEMIZED preserves their meaning;
    // defaulting to SIMPLE would silently zero fields the user had filled in.
    mode: value.mode === 'SIMPLE' || value.mode === 'ITEMIZED' ? value.mode : 'ITEMIZED',
    subtotal: requiredString(value, 'subtotal', 100),
    premium: requiredString(value, 'premium', 100),
    labor: requiredString(value, 'labor', 100),
    tax: requiredString(value, 'tax', 100),
    shipping: requiredString(value, 'shipping', 100),
    otherFees: requiredString(value, 'otherFees', 100),
    discount: requiredString(value, 'discount', 100),
    allocationMethod: value.allocationMethod,
  };
}

function parseItem(value: unknown, index: number): WizardItem {
  if (!isRecord(value)) throw new Error(`invalid item ${index}`);
  if (!isWeightUnit(value.weightUnit)) throw new Error(`invalid item weight unit ${index}`);
  if (typeof value.hasCertificate !== 'boolean') {
    throw new Error(`invalid item certificate flag ${index}`);
  }
  if (!Array.isArray(value.organizations) || value.organizations.length > 50) {
    throw new Error(`invalid item organizations ${index}`);
  }
  const organizations = value.organizations.map(parseOrganizationAssignment);
  if (new Set(organizations.map(({ id }) => id)).size !== organizations.length) {
    throw new Error(`duplicate organization assignment ${index}`);
  }
  return {
    id: requiredString(value, 'id', 128, 1),
    productDefinitionId: requiredString(value, 'productDefinitionId', 128),
    productDefinitionVersion:
      value.productDefinitionId &&
      typeof value.productDefinitionVersion === 'number' &&
      Number.isFinite(value.productDefinitionVersion) &&
      value.productDefinitionVersion >= 1
        ? value.productDefinitionVersion
        : value.productDefinitionId
          ? 1
          : undefined,
    metalCode: requiredString(value, 'metalCode', 32),
    form: requiredString(value, 'form', 100),
    name: requiredString(value, 'name', 300),
    country: requiredString(value, 'country', 100),
    yearOrVersion: requiredString(value, 'yearOrVersion', 100),
    serial: requiredString(value, 'serial', 200),
    quantity: requiredString(value, 'quantity', 100),
    unitWeight: requiredString(value, 'unitWeight', 100),
    weightUnit: value.weightUnit,
    purity: requiredString(value, 'purity', 100),
    lineSubtotal: requiredString(value, 'lineSubtotal', 100),
    manualAmount: requiredString(value, 'manualAmount', 100),
    packagingState: requiredString(value, 'packagingState', 200),
    hasCertificate: value.hasCertificate,
    initialStorageLocation: requiredString(value, 'initialStorageLocation', 300),
    organizations,
  };
}

function parseMedia(value: unknown, kind: WizardMedia['kind']): WizardMedia {
  if (
    !isRecord(value) ||
    value.kind !== kind ||
    (value.source !== 'CAMERA' && value.source !== 'LIBRARY')
  ) {
    throw new Error('invalid media');
  }
  const filename = requiredString(value, 'filename', 255, 1);
  const mime = requiredString(value, 'mime', 100, 1);
  const allowedMime =
    mime === 'image/jpeg' ||
    mime === 'image/png' ||
    mime === 'image/webp' ||
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    (kind === 'DOCUMENT' && mime === 'application/pdf');
  if (!allowedMime) throw new Error('invalid media mime');
  const sizeBytes = requiredFiniteNumber(
    value,
    'sizeBytes',
    0,
    mime === 'application/pdf' ? 50 * 1024 * 1024 : 25 * 1024 * 1024,
  );
  const lastModified = optionalFiniteNumber(value.lastModified, 0, Number.MAX_SAFE_INTEGER);
  const width = optionalInteger(value.width, 1, 100_000);
  const height = optionalInteger(value.height, 1, 100_000);
  const serverAttachmentStatus = parseOptionalEnum(value.serverAttachmentStatus, [
    'READY',
    'NEEDS_REVIEW',
    'PROCESSING',
    'FAILED',
  ] as const);
  return {
    id: requiredString(value, 'id', 128, 1),
    kind,
    source: value.source,
    targetItemId: optionalString(value.targetItemId, 128),
    isPrimary:
      kind === 'ASSET_PHOTO' && typeof value.isPrimary === 'boolean' ? value.isPrimary : undefined,
    attachmentType: optionalString(value.attachmentType, 100),
    documentType: optionalString(value.documentType, 100),
    description: optionalString(value.description, 200),
    filename,
    mime,
    sizeBytes,
    lastModified,
    width,
    height,
    originalFile: undefined,
    previewUrl: undefined,
    needsReselection: true,
    serverAttachmentStatus,
    crop: value.crop === undefined ? undefined : parseCrop(value.crop),
    documentCorners:
      value.documentCorners === undefined ? undefined : parseDocumentCorners(value.documentCorners),
    createdAt: requiredTimestamp(value, 'createdAt'),
  };
}

function parseOrganizationAssignment(value: unknown): WizardOrganizationAssignment {
  if (!isRecord(value)) throw new Error('invalid organization assignment');
  const role = parseOptionalEnum(value.role, [
    'BRAND',
    'ISSUER',
    'REFINER',
    'MINT',
    'MANUFACTURER',
    'ASSAYER',
  ] as const);
  if (!role || typeof value.isPrimary !== 'boolean' || typeof value.custom !== 'boolean') {
    throw new Error('invalid organization assignment');
  }
  return {
    id: requiredString(value, 'id', 128, 1),
    organizationId: optionalString(value.organizationId, 128),
    displayName: requiredString(value, 'displayName', 200),
    role,
    isPrimary: value.isPrimary,
    custom: value.custom,
  };
}

function parseCrop(value: unknown): NormalizedCropRect {
  if (!isRecord(value)) throw new Error('invalid crop');
  const crop = {
    x: requiredFiniteNumber(value, 'x', 0, 1),
    y: requiredFiniteNumber(value, 'y', 0, 1),
    width: requiredFiniteNumber(value, 'width', 0.001, 1),
    height: requiredFiniteNumber(value, 'height', 0.001, 1),
  };
  if (crop.x + crop.width > 1.000_001 || crop.y + crop.height > 1.000_001) {
    throw new Error('crop exceeds image bounds');
  }
  return crop;
}

function parseDocumentCorners(value: unknown): DocumentCorners {
  if (!isRecord(value)) throw new Error('invalid document corners');
  return {
    topLeft: parsePoint(value.topLeft),
    topRight: parsePoint(value.topRight),
    bottomRight: parsePoint(value.bottomRight),
    bottomLeft: parsePoint(value.bottomLeft),
  };
}

function parsePoint(value: unknown): NormalizedPoint {
  if (!isRecord(value)) throw new Error('invalid point');
  return {
    x: requiredFiniteNumber(value, 'x', 0, 1),
    y: requiredFiniteNumber(value, 'y', 0, 1),
  };
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  maximumLength: number,
  minimumLength = 0,
): string {
  const value = record[key];
  if (!isBoundedString(value, maximumLength, minimumLength)) {
    throw new Error(`invalid ${key}`);
  }
  return value;
}

function optionalString(value: unknown, maximumLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (!isBoundedString(value, maximumLength)) throw new Error('invalid optional string');
  return value;
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
  minimumLength = 0,
): value is string {
  return (
    typeof value === 'string' && value.length >= minimumLength && value.length <= maximumLength
  );
}

function requiredTimestamp(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (!isTimestamp(value)) throw new Error(`invalid ${key}`);
  return value;
}

function isTimestamp(value: unknown): value is string {
  return (
    isBoundedString(value, 64, 1) &&
    Number.isFinite(Date.parse(value)) &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  );
}

function requiredFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`invalid ${key}`);
  }
  return value;
}

function optionalFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error('invalid optional number');
  }
  return value;
}

function optionalInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  const number = optionalFiniteNumber(value, minimum, maximum);
  if (number !== undefined && !Number.isInteger(number)) throw new Error('invalid integer');
  return number;
}

function parseOptionalEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error('invalid enum value');
  }
  return value as T[number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadPurchaseWizardDraft(
  storage: KeyValueStorage,
  key = PURCHASE_WIZARD_STORAGE_KEY,
): DraftRestoreResult {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { draft: null, status: 'corrupt' };
  }
  if (raw === null) return { draft: null, status: 'missing' };
  const result = parsePurchaseWizardDraft(raw);
  if (result.status === 'corrupt') {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in private mode; the in-memory draft remains usable.
    }
  }
  return result;
}

export function savePurchaseWizardDraft(
  storage: KeyValueStorage,
  draft: PurchaseWizardDraft,
  key = PURCHASE_WIZARD_STORAGE_KEY,
): void {
  storage.setItem(key, serializePurchaseWizardDraft(draft));
}

export interface WizardAutosaveOptions {
  storage?: KeyValueStorage | null;
  storageKey?: string;
  delayMs?: number;
  onSystemSave?: (draft: PurchaseWizardDraft) => Promise<void>;
}

export interface WizardAutosaveResult {
  localState: WizardLocalSaveState;
  systemState: WizardSystemSaveState;
  lastLocalSaveAt: string | null;
  lastSystemSaveAt: string | null;
  error: string | null;
  flush: () => Promise<void>;
  clear: () => void;
}

export function useWizardAutosave(
  draft: PurchaseWizardDraft,
  options: WizardAutosaveOptions = {},
): WizardAutosaveResult {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const storageKey = options.storageKey ?? PURCHASE_WIZARD_STORAGE_KEY;
  const delayMs = options.delayMs ?? 550;
  const draftRef = useRef(draft);
  const saveSequence = useRef(0);
  const cleared = useRef(false);
  const [localState, setLocalState] = useState<WizardLocalSaveState>('dirty');
  const [systemState, setSystemState] = useState<WizardSystemSaveState>(
    options.onSystemSave ? 'saving' : 'unavailable',
  );
  const [lastLocalSaveAt, setLastLocalSaveAt] = useState<string | null>(null);
  const [lastSystemSaveAt, setLastSystemSaveAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    draftRef.current = draft;
    setLocalState('dirty');
    if (options.onSystemSave) setSystemState('saving');
  }, [draft, options.onSystemSave]);

  const persist = useCallback(async () => {
    if (cleared.current) return;
    const sequence = ++saveSequence.current;
    const snapshot = draftRef.current;
    const savedAt = new Date().toISOString();
    setError(null);

    if (storage) {
      setLocalState('saving');
      try {
        savePurchaseWizardDraft(storage, snapshot, storageKey);
        if (sequence === saveSequence.current) {
          setLocalState('saved');
          setLastLocalSaveAt(savedAt);
        }
      } catch (storageError) {
        if (sequence === saveSequence.current) {
          setLocalState('error');
          setError(storageError instanceof Error ? storageError.message : '無法儲存到此裝置。');
        }
      }
    } else {
      setLocalState('error');
      setError('此瀏覽器無法使用本機儲存空間。');
    }

    if (options.onSystemSave) {
      setSystemState('saving');
      try {
        await options.onSystemSave(snapshot);
        if (sequence === saveSequence.current) {
          setSystemState('saved');
          setLastSystemSaveAt(savedAt);
        }
      } catch (systemError) {
        if (sequence === saveSequence.current) {
          setSystemState('error');
          setError(systemError instanceof Error ? systemError.message : '無法同步到系統。');
        }
      }
    }
  }, [options.onSystemSave, storage, storageKey]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => void persist(), delayMs);
    return () => globalThis.clearTimeout(timer);
  }, [delayMs, draft, persist]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flushOnPageHide = () => {
      if (!storage) return;
      try {
        savePurchaseWizardDraft(storage, draftRef.current, storageKey);
      } catch {
        // Best-effort lifecycle flush; the visible status already reports storage failures.
      }
    };
    window.addEventListener('pagehide', flushOnPageHide);
    return () => window.removeEventListener('pagehide', flushOnPageHide);
  }, [storage, storageKey]);

  const clear = useCallback(() => {
    cleared.current = true;
    saveSequence.current += 1;
    if (!storage) return;
    try {
      storage.removeItem(storageKey);
    } catch {
      // Completion is authoritative even if browser storage cleanup is unavailable.
    }
  }, [storage, storageKey]);

  return {
    localState,
    systemState,
    lastLocalSaveAt,
    lastSystemSaveAt,
    error,
    flush: persist,
    clear,
  };
}

function browserStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
