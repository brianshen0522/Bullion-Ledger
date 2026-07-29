import type { WeightUnit } from '@bullion-ledger/shared';

/**
 * Thin fetch wrapper. All requests are same-origin via Vite proxy in dev and
 * via Nginx in production, so credentials: 'include' carries the session
 * cookie. Errors are normalized to a typed shape so screens can render the
 * right state without mock data.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');
const unauthorizedListeners = new Set<() => void>();

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Lets the app immediately leave protected screens when any request reports an expired session. */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function responseMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null || !('message' in body)) return fallback;
  const message = body.message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  return message === undefined || message === null ? fallback : String(message);
}

function responseCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('code' in body)) return undefined;
  return typeof body.code === 'string' ? body.code : undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = parseJson(text);

  if (!res.ok) {
    if (res.status === 401) unauthorizedListeners.forEach((listener) => listener());
    const plainText = body === null && text.trim() ? text.trim().slice(0, 300) : null;
    throw new ApiError(
      res.status,
      responseMessage(body, plainText ?? `HTTP ${res.status}`),
      responseCode(body),
    );
  }

  if (text && body === null) {
    throw new ApiError(res.status, 'The server returned an invalid JSON response.');
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, init?: Omit<RequestInit, 'body' | 'method'>) =>
    request<T>(path, {
      ...init,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown, init?: Omit<RequestInit, 'body' | 'method'>) =>
    request<T>(path, {
      ...init,
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown, init?: Omit<RequestInit, 'body' | 'method'>) =>
    request<T>(path, {
      ...init,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(path: string, init?: Omit<RequestInit, 'method'>) =>
    request<T>(path, { ...init, method: 'DELETE' }),
  upload: <T>(
    path: string,
    body: Blob,
    headers: Record<string, string>,
    init?: Omit<RequestInit, 'body' | 'headers' | 'method'>,
  ) =>
    request<T>(path, {
      ...init,
      method: 'POST',
      body,
      headers,
    }),
};

export type InitStatus = { initialized: boolean };
export type SessionInfo = { username: string | null };
export type PasskeyStatus = { available: boolean };
export type Passkey = {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  transports: string[];
  backedUp: boolean;
  deviceType: string | null;
};
export type CurrencyCost = { currency: string; totalCost: string };
export type DashboardSummary = {
  weightUnit: WeightUnit;
  heldAssetLots: number;
  heldAssetUnits: string;
  purchaseCount: number;
  costByCurrency: CurrencyCost[];
  byMetal: {
    code: string;
    fineWeightGrams: string;
    heldAssetLots: number;
    heldAssetUnits: string;
    costByCurrency: CurrencyCost[];
  }[];
  /** PRD §10.2/§10.4/§10.7. Null whenever the figure is not defensible. */
  valuationCurrency: string;
  intrinsicValue: string | null;
  unrealizedPnl: string | null;
  returnRate: string | null;
  valuationByMetal: {
    code: string;
    fineWeightGrams: string;
    intrinsicValue: string | null;
    pricePerGram: string | null;
    priceAsOf: string | null;
  }[];
  unpricedMetals: string[];
  /** Structured so the client owns the wording; the API sends no prose. */
  notice: ValuationNotice | null;
  priceAsOf: string | null;
  premiumPaid: string | null;
  premiumCurrency: string | null;
  /** Currencies premium was recorded in; >1 means it cannot be totalled. */
  premiumCurrencies: string[];
  purchasesAwaitingPrices: number;
};

export type ValuationNotice =
  | { code: 'NO_PRICES' }
  | { code: 'UNPRICED_METALS'; metals: string[] }
  | { code: 'MIXED_COST_CURRENCIES'; currencies: string[] };
export type Metal = { id: string; code: string; name: string; displayPrecision: number };
export type ProductDefinition = {
  id: string;
  name: string;
  metal: { code: string; name: string };
  form: string;
  brand: string | null;
  country: string | null;
  yearOrVersion: string | null;
  defaultPurity: string;
  defaultUnitWeightGrams: string;
  defaultWeightUnit: string;
  active: boolean;
  source: 'SYSTEM' | 'USER' | 'MIGRATED';
  version: number;
  organizations?: {
    id: string;
    role: 'BRAND' | 'ISSUER' | 'REFINER' | 'MINT' | 'MANUFACTURER' | 'ASSAYER';
    isPrimary: boolean;
    attributionStatus: 'VERIFIED' | 'DECLARED' | 'USER_REPORTED' | 'UNKNOWN';
    organization: {
      id: string;
      canonicalName: string;
      countryCode: string | null;
      verified: boolean;
    };
  }[];
};
export type HeldAssetListItem = {
  id: string;
  productDefinitionId: string | null;
  status: 'HELD';
  name: string;
  metal: { code: string; name: string };
  form: string;
  brand: string | null;
  country: string | null;
  yearOrVersion: string | null;
  quantity: number;
  unitWeightGrams: string;
  grossWeightGrams: string;
  purity: string;
  fineWeightGrams: string;
  allocatedCost: string;
  currency: string;
  serial: string | null;
  storageLocation: string | null;
  acquiredAt: string;
  packagingState: string | null;
  hasCertificate: boolean;
  version: number;
  updatedAt: string;
  purchase: {
    purchasedAt: string;
    dealerName: string | null;
  } | null;
  coverPhoto: {
    attachmentId: string;
    variant: 'THUMBNAIL' | 'CROPPED' | 'ORIGINAL';
    revision: number;
    mime: string;
    width: number | null;
    height: number | null;
  } | null;
};
export type OrganizationListItem = {
  id: string;
  canonicalName: string;
  countryCode: string | null;
  verified: boolean;
  aliases: { id: string; name: string; kind: string; locale: string | null }[];
  capabilities: ('BRAND' | 'ISSUER' | 'REFINER' | 'MINT' | 'MANUFACTURER' | 'ASSAYER')[];
  matchedAlias: string | null;
};
export type PurchaseListItem = {
  id: string;
  purchasedAt: string;
  currency: string;
  totalAmount: string;
  allocationMethod: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    fineWeightGrams: string;
    allocatedCost: string;
  }[];
};
