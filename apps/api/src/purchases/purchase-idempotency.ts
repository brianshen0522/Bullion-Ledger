import { createHash } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';

import type { PurchaseDto } from './dto/purchase.dto.js';

export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/**
 * Require an opaque, log-safe ASCII key. The raw value is used only long
 * enough to derive its digest and is never persisted.
 */
export function requireIdempotencyKey(value: string | undefined): string {
  if (
    typeof value !== 'string' ||
    value.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    value.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_RE.test(value)
  ) {
    throw new BadRequestException(
      `Idempotency-Key must be ${IDEMPOTENCY_KEY_MIN_LENGTH}-${IDEMPOTENCY_KEY_MAX_LENGTH} ASCII letters, digits, '.', '_', ':' or '-'`,
    );
  }

  return value;
}

/** A domain-separated digest prevents the caller-supplied key reaching storage. */
export function hashIdempotencyKey(value: string): string {
  return sha256(`bullion-ledger:purchase-idempotency-key:v1:${value}`);
}

/**
 * Produce a stable hash of the request's persisted meaning. Property order,
 * omitted optional fields, and equivalent decimal spellings do not change
 * this digest; a meaningful payload change does.
 */
export function hashPurchaseRequest(dto: PurchaseDto): string {
  const canonical = {
    version: 1,
    purchasedAt: new Date(dto.purchasedAt).toISOString(),
    dealerName: nullable(dto.dealerName),
    branch: nullable(dto.branch),
    orderNumber: nullable(dto.orderNumber),
    invoiceNumber: nullable(dto.invoiceNumber),
    currency: dto.currency,
    paymentMethod: nullable(dto.paymentMethod),
    subtotal: decimal(dto.subtotal),
    premium: decimal(dto.premium ?? '0'),
    labor: decimal(dto.labor ?? '0'),
    tax: decimal(dto.tax ?? '0'),
    shipping: decimal(dto.shipping ?? '0'),
    otherFees: decimal(dto.otherFees ?? '0'),
    discount: decimal(dto.discount ?? '0'),
    allocationMethod: dto.allocationMethod,
    // priceEntryMode is deliberately excluded: it records how the buyer knew
    // the price, not what was bought, and every derived amount is already
    // hashed above. Including it would change the digest of every previously
    // stored request, turning legitimate retries into 409 conflicts.
    notes: nullable(dto.notes),
    items: dto.items.map((item) => ({
      draftItemId: nullable(item.draftItemId),
      productDefinitionId: nullable(item.productDefinitionId),
      ...(item.productDefinitionVersion !== undefined && item.productDefinitionVersion > 1
        ? { productDefinitionVersion: item.productDefinitionVersion }
        : {}),
      metalCode: item.metalCode,
      // When a catalog product is selected these descriptive fields are
      // resolved authoritatively by the server and therefore are not part of
      // the caller-controlled persisted meaning.
      form: item.productDefinitionId ? null : item.form.trim(),
      brand: item.productDefinitionId ? null : nullable(item.brand),
      name: item.productDefinitionId ? null : item.name.trim(),
      country: item.productDefinitionId ? null : nullable(item.country),
      yearOrVersion: item.productDefinitionId ? null : nullable(item.yearOrVersion),
      serial: nullable(item.serial),
      quantity: item.quantity,
      unitWeight: decimal(item.unitWeight),
      weightUnit: item.weightUnit,
      purity: decimal(item.purity),
      lineSubtotal: decimal(item.lineSubtotal),
      manualAmount:
        dto.allocationMethod !== 'MANUAL' ||
        item.manualAmount === undefined ||
        item.manualAmount === null
          ? null
          : decimal(item.manualAmount),
      packagingState: nullable(item.packagingState),
      hasCertificate: item.hasCertificate ?? false,
      initialStorageLocation: nullable(item.initialStorageLocation),
      parties: item.productDefinitionId
        ? []
        : (item.parties ?? [])
            .map((party) => ({
              organizationId: nullable(party.organizationId),
              role: party.role,
              // A linked organization's current canonical name wins.
              displayName: party.organizationId ? null : nullable(party.displayName?.trim()),
              isPrimary: party.isPrimary ?? false,
              attributionStatus: party.attributionStatus ?? 'USER_REPORTED',
            }))
            .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    })),
  };

  return sha256(JSON.stringify(canonical));
}

/** Restrict race recovery to the Purchase idempotency unique constraint. */
export function isIdempotencyKeyUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') {
    return false;
  }

  const meta = 'meta' in error && error.meta && typeof error.meta === 'object' ? error.meta : null;
  const target = meta && 'target' in meta ? meta.target : null;
  if (Array.isArray(target)) {
    return target.some((field) => field === 'idempotencyKeyHash');
  }
  return typeof target === 'string' && target.includes('idempotencyKeyHash');
}

function decimal(value: string): string {
  return new Decimal(value).toString();
}

function nullable(value: string | null | undefined): string | null {
  return value ?? null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
