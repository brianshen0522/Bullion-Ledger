import Decimal from 'decimal.js';

import {
  ArgumentError,
  assertAllocationMethod,
  assertCurrencyCode,
  allocate,
  fineWeightGrams,
  MAX_ALLOCATION_ITEMS,
  quantizeWeightGrams,
  quantizeMoney,
  toGrams,
  validatePurity,
  type AllocationMethod,
  type AllocationResult,
} from '@bullion-ledger/shared';

export const MAX_PURCHASE_ITEMS = MAX_ALLOCATION_ITEMS;

/**
 * Pure purchase-computation domain. Lives outside the ORM so the math is
 * unit-testable without a database, and so the same logic could be reused by
 * an import/sync path later.
 *
 * All monetary values are Decimal. Inputs are validated here even if the DTO
 * layer already validated them — defense in depth at the trust boundary.
 */

export interface PurchaseItemInput {
  productDefinitionId?: string | null;
  productDefinitionVersion?: number | null;
  metalId: string;
  form: string;
  brand?: string | null;
  name: string;
  country?: string | null;
  yearOrVersion?: string | null;
  serial?: string | null;
  quantity: number;
  unitWeight: number | string | Decimal;
  weightUnit: string;
  purity: number | string | Decimal;
  lineSubtotal: number | string | Decimal;
  manualAmount?: number | string | Decimal | null;
  packagingState?: string | null;
  hasCertificate?: boolean;
  initialStorageLocation?: string | null;
}

export interface PurchaseInput {
  currency: string;
  subtotal: number | string | Decimal;
  premium?: number | string | Decimal;
  labor?: number | string | Decimal;
  tax?: number | string | Decimal;
  shipping?: number | string | Decimal;
  otherFees?: number | string | Decimal;
  discount?: number | string | Decimal;
  allocationMethod: AllocationMethod;
  items: PurchaseItemInput[];
}

export interface ComputedItem {
  input: PurchaseItemInput;
  unitWeightGrams: Decimal;
  grossWeightGrams: Decimal;
  fineWeightGrams: Decimal;
  purity: Decimal;
  lineSubtotal: Decimal;
  allocatedCost: Decimal;
}

export interface ComputedPurchase {
  currency: string;
  subtotal: Decimal;
  premium: Decimal;
  labor: Decimal;
  tax: Decimal;
  shipping: Decimal;
  otherFees: Decimal;
  discount: Decimal;
  totalAmount: Decimal;
  allocationMethod: AllocationMethod;
  items: ComputedItem[];
  allocation: AllocationResult;
}

export function computePurchase(input: PurchaseInput): ComputedPurchase {
  assertCurrencyCode(input.currency);
  const method = assertAllocationMethod(input.allocationMethod);
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ArgumentError('purchase must contain at least one item');
  }
  if (input.items.length > MAX_PURCHASE_ITEMS) {
    throw new ArgumentError(`purchase item count exceeds ${MAX_PURCHASE_ITEMS}`);
  }

  const currency = input.currency;
  const subtotal = quantizeMoney(input.subtotal);
  const premium = quantizeMoney(input.premium ?? 0);
  const labor = quantizeMoney(input.labor ?? 0);
  const tax = quantizeMoney(input.tax ?? 0);
  const shipping = quantizeMoney(input.shipping ?? 0);
  const otherFees = quantizeMoney(input.otherFees ?? 0);
  const discount = quantizeMoney(input.discount ?? 0);

  // Compute per-item canonical weights + fine weight.
  const computedItems: ComputedItem[] = input.items.map((raw, i) => {
    requireNonBlank(raw.metalId, `item[${i}].metalId`);
    requireNonBlank(raw.form, `item[${i}].form`);
    requireNonBlank(raw.name, `item[${i}].name`);
    if (raw.productDefinitionId !== undefined && raw.productDefinitionId !== null) {
      requireNonBlank(raw.productDefinitionId, `item[${i}].productDefinitionId`);
    }
    if (!Number.isInteger(raw.quantity) || raw.quantity < 1) {
      throw new ArgumentError(`item[${i}].quantity must be a positive integer`);
    }
    if (typeof raw.weightUnit !== 'string' || !isWeightUnitRaw(raw.weightUnit)) {
      throw new ArgumentError(`item[${i}].weightUnit must be g | kg | troy_oz | qian`);
    }
    const unitWeightGrams = quantizeWeightGrams(
      toGrams(raw.unitWeight, raw.weightUnit),
      `item[${i}].unitWeightGrams`,
    );
    if (unitWeightGrams.lte(0)) {
      throw new ArgumentError(`item[${i}].unitWeight must be > 0`);
    }
    const purity = validatePurity(raw.purity);
    const grossWeightGrams = quantizeWeightGrams(
      unitWeightGrams.times(raw.quantity),
      `item[${i}].grossWeightGrams`,
    );
    const fineWeightGramsValue = quantizeWeightGrams(
      fineWeightGrams(grossWeightGrams, purity),
      `item[${i}].fineWeightGrams`,
    );
    const lineSubtotal = quantizeMoney(raw.lineSubtotal);
    if (lineSubtotal.lt(0)) {
      throw new ArgumentError(`item[${i}].lineSubtotal must be >= 0`);
    }
    return {
      input: raw,
      unitWeightGrams,
      grossWeightGrams,
      fineWeightGrams: fineWeightGramsValue,
      purity,
      lineSubtotal,
      allocatedCost: new Decimal(0),
    };
  });

  // Header subtotal must equal sum of line subtotals (PRD §8.1 金屬商品小計).
  const lineSum = computedItems.reduce((acc, it) => acc.plus(it.lineSubtotal), new Decimal(0));
  if (!lineSum.eq(subtotal)) {
    throw new ArgumentError(
      `subtotal ${subtotal.toString()} does not match sum of line subtotals ${lineSum.toString()}`,
    );
  }

  const totalAmount = quantizeMoney(
    subtotal.plus(premium).plus(labor).plus(tax).plus(shipping).plus(otherFees).minus(discount),
  );

  // Allocation basis selection.
  let allocation: AllocationResult;
  if (method === 'MANUAL') {
    allocation = allocate({
      method: 'MANUAL',
      total: totalAmount,
      count: computedItems.length,
      manualAmounts: computedItems.map((it, i) => {
        if (it.input.manualAmount === undefined || it.input.manualAmount === null) {
          throw new ArgumentError(`item[${i}].manualAmount required for MANUAL allocation`);
        }
        return it.input.manualAmount;
      }),
    });
  } else if (method === 'SUBTOTAL_PROPORTIONAL') {
    allocation = allocate({
      method: 'SUBTOTAL_PROPORTIONAL',
      total: totalAmount,
      basis: computedItems.map((it) => it.lineSubtotal),
    });
  } else if (method === 'WEIGHT_PROPORTIONAL') {
    allocation = allocate({
      method: 'WEIGHT_PROPORTIONAL',
      total: totalAmount,
      basis: computedItems.map((it) => it.fineWeightGrams),
    });
  } else {
    allocation = allocate({ method: 'EQUAL', total: totalAmount, count: computedItems.length });
  }

  computedItems.forEach((it, i) => {
    it.allocatedCost = allocation.amounts[i]!;
  });

  return {
    currency,
    subtotal,
    premium,
    labor,
    tax,
    shipping,
    otherFees,
    discount,
    totalAmount,
    allocationMethod: method,
    items: computedItems,
    allocation,
  };
}

function isWeightUnitRaw(v: string): v is 'g' | 'kg' | 'troy_oz' | 'qian' {
  return v === 'g' || v === 'kg' || v === 'troy_oz' || v === 'qian';
}

function requireNonBlank(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ArgumentError(`${field} must not be blank`);
  }
}
