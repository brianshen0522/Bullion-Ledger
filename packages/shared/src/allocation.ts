import Decimal from 'decimal.js';

import { ArgumentError, toDecimal } from './units.js';
import { MONEY_SCALE, MONEY_UNIT, quantizeMoney } from './money.js';

export const ALLOCATION_METHODS = [
  'MANUAL',
  'SUBTOTAL_PROPORTIONAL',
  'WEIGHT_PROPORTIONAL',
  'EQUAL',
] as const;

export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

/** Bounds request work and the largest-remainder sort at the trust boundary. */
export const MAX_ALLOCATION_ITEMS = 100;

export function isAllocationMethod(value: unknown): value is AllocationMethod {
  return typeof value === 'string' && (ALLOCATION_METHODS as readonly string[]).includes(value);
}

export function assertAllocationMethod(
  value: unknown,
  field = 'allocationMethod',
): AllocationMethod {
  if (!isAllocationMethod(value)) {
    throw new ArgumentError(
      `${field} must be one of ${ALLOCATION_METHODS.join(', ')}, received ${stringifySafe(value)}`,
    );
  }
  return value;
}

export interface AllocateInput {
  method: AllocationMethod;
  /** Decimal array of allocated amounts. Required iff method === MANUAL. */
  manualAmounts?: (number | string | Decimal)[];
  /**
   * Per-item basis used for SUBTOTAL_PROPORTIONAL and WEIGHT_PROPORTIONAL.
   * Caller is responsible for passing subtotals or fine-gram weights as
   * appropriate; this module treats them as opaque positive Decimals.
   */
  basis?: (number | string | Decimal)[];
  /** Number of items receiving allocation. Required for EQUAL. */
  count?: number;
  /** Total amount that must be reconciled exactly across items. */
  total: number | string | Decimal;
}

export interface AllocationResult {
  method: AllocationMethod;
  /** Quantized amounts aligned to the input items. */
  amounts: Decimal[];
  /** Quantized total; sum(amounts) === total exactly. */
  total: Decimal;
  scale: number;
  /** Number of smallest-unit remainders that were redistributed. */
  remainderUnits: number;
}

/**
 * Allocate `total` across items using the largest-remainder method so the
 * result reconciles exactly to the total at MONEY_SCALE.
 *
 * Determinism rules:
 *   - Items keep their input order.
 *   - Remainder units are assigned one each to items with the largest
 *     fractional quota; ties broken by ascending original index.
 *   - All intermediate math uses Decimal; only the final per-item value is
 *     quantized.
 */
export function allocate(input: AllocateInput): AllocationResult {
  const method = assertAllocationMethod(input.method);
  const total = quantizeMoney(input.total);

  if (method === 'MANUAL') {
    return allocateManual(input, total);
  }

  const count = resolveCount(input, method);
  if (count === 0) {
    if (!total.isZero()) {
      throw new ArgumentError(`${method} allocation cannot reconcile a non-zero total to no items`);
    }
    return {
      method,
      amounts: [],
      total,
      scale: MONEY_SCALE,
      remainderUnits: 0,
    };
  }

  let basis: Decimal[];
  if (method === 'EQUAL') {
    basis = Array.from({ length: count }, () => new Decimal(1));
  } else {
    if (!input.basis || input.basis.length !== count) {
      throw new ArgumentError(
        `${method} requires basis with length ${count}, received ${input.basis?.length ?? 0}`,
      );
    }
    basis = input.basis.map((b) => {
      const d = toDecimal(b);
      if (!d.isFinite()) {
        throw new ArgumentError(`basis values must be finite, received ${d.toString()}`);
      }
      if (d.isNegative()) {
        throw new ArgumentError(`basis values must be >= 0, received ${d.toString()}`);
      }
      return d;
    });
  }

  const basisSum = basis.reduce((acc, b) => acc.plus(b), new Decimal(0));
  if (basisSum.lte(0)) {
    // Fallback: equal split when the proportional basis is all-zero so we
    // still reconcile the total exactly instead of erroring mid-transaction.
    basis = Array.from({ length: count }, () => new Decimal(1));
  }

  return largestRemainderSplit(method, total, basis);
}

function allocateManual(input: AllocateInput, total: Decimal): AllocationResult {
  if (!Array.isArray(input.manualAmounts) || input.manualAmounts.length === 0) {
    throw new ArgumentError('MANUAL allocation requires manualAmounts');
  }
  if (input.manualAmounts.length > MAX_ALLOCATION_ITEMS) {
    throw new ArgumentError(`MANUAL allocation exceeds ${MAX_ALLOCATION_ITEMS} amounts`);
  }
  if (input.count !== undefined && input.count !== input.manualAmounts.length) {
    throw new ArgumentError(
      `MANUAL allocation requires ${input.count} amounts, received ${input.manualAmounts.length}`,
    );
  }
  const amounts = input.manualAmounts.map((a) => quantizeMoney(a));
  const sum = amounts.reduce((acc, a) => acc.plus(a), new Decimal(0));
  const diff = sum.minus(total);
  // Tolerate sub-cent drift from string input; reject anything larger.
  if (!diff.abs().lt(MONEY_UNIT)) {
    throw new ArgumentError(
      `MANUAL allocation sums to ${sum.toString()} which differs from total ${total.toString()}`,
    );
  }
  // Reconcile any rounding dust onto the last non-zero item so the stored
  // sum is exactly the total. Quantization already happened, so the diff is
  // strictly zero here, but guard for clarity.
  if (!diff.isZero() && amounts.length > 0) {
    const idx = lastNonZeroIndex(amounts) ?? amounts.length - 1;
    amounts[idx] = amounts[idx]!.minus(diff);
  }
  return {
    method: 'MANUAL',
    amounts,
    total,
    scale: MONEY_SCALE,
    remainderUnits: 0,
  };
}

function resolveCount(input: AllocateInput, method: AllocationMethod): number {
  let count: number;
  if (method === 'EQUAL') {
    if (typeof input.count !== 'number' || !Number.isInteger(input.count) || input.count < 0) {
      throw new ArgumentError(
        `EQUAL allocation requires integer count >= 0, received ${stringifySafe(input.count)}`,
      );
    }
    count = input.count;
  } else {
    if (!Array.isArray(input.basis)) {
      throw new ArgumentError(`${method} requires basis array`);
    }
    count = input.basis.length;
  }
  if (count > MAX_ALLOCATION_ITEMS) {
    throw new ArgumentError(`${method} allocation exceeds ${MAX_ALLOCATION_ITEMS} items`);
  }
  return count;
}

function largestRemainderSplit(
  method: AllocationMethod,
  total: Decimal,
  basis: Decimal[],
): AllocationResult {
  const basisSum = basis.reduce((acc, b) => acc.plus(b), new Decimal(0));

  // Work in integer minor units (cents) to keep reconciliation exact.
  const totalUnits = total.div(MONEY_UNIT).toDecimalPlaces(0, Decimal.ROUND_DOWN);

  // Exact quota in minor units per item.
  const quotas = basis.map((b) => totalUnits.times(b).div(basisSum));

  // Floor each quota.
  const floors = quotas.map((q) => q.toDecimalPlaces(0, Decimal.ROUND_DOWN));
  const floorSum = floors.reduce((acc, f) => acc.plus(f), new Decimal(0));
  const remainderUnitsDecimal = totalUnits.minus(floorSum);
  // The largest-remainder theorem bounds this to [0, basis.length), so this
  // control-flow count is safe as a JS number. Monetary minor-unit values
  // themselves remain Decimal throughout.
  let unitsToDistribute = remainderUnitsDecimal.toNumber();

  // Order items by fractional remainder desc, tie-break by ascending index.
  const order = quotas
    .map((q, idx) => ({ idx, frac: q.minus(floors[idx]!), q }))
    .sort((a, b) => {
      const cmp = b.frac.comparedTo(a.frac);
      if (cmp !== 0) return cmp;
      return a.idx - b.idx;
    });

  const finalUnits = floors.map((f) => new Decimal(f));
  let i = 0;
  while (unitsToDistribute > 0 && i < order.length) {
    const target = order[i]!.idx;
    finalUnits[target] = finalUnits[target]!.plus(1);
    unitsToDistribute -= 1;
    i += 1;
  }

  const amounts = finalUnits.map((units) => units.times(MONEY_UNIT));
  return {
    method,
    amounts,
    total,
    scale: MONEY_SCALE,
    remainderUnits: remainderUnitsDecimal.toNumber(),
  };
}

function lastNonZeroIndex(amounts: Decimal[]): number | undefined {
  for (let i = amounts.length - 1; i >= 0; i--) {
    if (!amounts[i]!.isZero()) return i;
  }
  return undefined;
}

function stringifySafe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  return String(value);
}
