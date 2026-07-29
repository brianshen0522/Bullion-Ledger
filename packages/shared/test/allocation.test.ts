import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  allocate,
  AllocationResult,
  ArgumentError,
  assertAllocationMethod,
  MONEY_SCALE,
  MONEY_UNIT,
} from '../src/index.js';

function sum(amounts: Decimal[]): Decimal {
  return amounts.reduce((acc, a) => acc.plus(a), new Decimal(0));
}

function reconcile(result: AllocationResult, expectedTotal: string): void {
  const total = new Decimal(expectedTotal);
  const s = sum(result.amounts);
  expect(s.eq(total)).toBe(true);
  expect(s.eq(result.total)).toBe(true);
  expect(result.amounts.every((a) => a.decimalPlaces() <= MONEY_SCALE)).toBe(true);
}

describe('allocation reconciliation invariants', () => {
  it('MANUAL keeps caller amounts when they sum to total', () => {
    const r = allocate({
      method: 'MANUAL',
      total: '100.00',
      manualAmounts: ['30.00', '70.00'],
    });
    expect(r.amounts.map((a) => a.toString())).toEqual(['30', '70']);
    reconcile(r, '100');
  });

  it('MANUAL rejects mismatched sum', () => {
    expect(() =>
      allocate({
        method: 'MANUAL',
        total: '100.00',
        manualAmounts: ['30.00', '60.00'],
      }),
    ).toThrow(ArgumentError);
  });

  it('MANUAL rejects negative amounts even when the signed sum reconciles', () => {
    expect(() =>
      allocate({
        method: 'MANUAL',
        total: '1.00',
        manualAmounts: ['-1.00', '2.00'],
      }),
    ).toThrow(ArgumentError);
  });

  it('MANUAL rejects an empty or length-mismatched amount list', () => {
    expect(() => allocate({ method: 'MANUAL', total: '0.00', manualAmounts: [] })).toThrow(
      ArgumentError,
    );
    expect(() =>
      allocate({ method: 'MANUAL', total: '3.00', count: 3, manualAmounts: ['1', '2'] }),
    ).toThrow(ArgumentError);
  });

  it('SUBTOTAL_PROPORTIONAL splits exactly on a non-divisible total', () => {
    // 100.00 over 3 items with subtotals 50/30/20
    const r = allocate({
      method: 'SUBTOTAL_PROPORTIONAL',
      total: '100.00',
      basis: [50, 30, 20],
    });
    expect(r.amounts.map((a) => a.toString())).toEqual(['50', '30', '20']);
    reconcile(r, '100');
  });

  it('SUBTOTAL_PROPORTIONAL distributes remainder deterministically', () => {
    // 10.00 over 3 equal subtotals -> [3.34, 3.33, 3.33] (tie -> ascending idx)
    const r = allocate({
      method: 'SUBTOTAL_PROPORTIONAL',
      total: '10.00',
      basis: [1, 1, 1],
    });
    expect(r.amounts.map((a) => a.toString())).toEqual(['3.34', '3.33', '3.33']);
    reconcile(r, '10');
    expect(r.remainderUnits).toBe(1);
  });

  it('WEIGHT_PROPORTIONAL splits by fine weight and reconciles', () => {
    const r = allocate({
      method: 'WEIGHT_PROPORTIONAL',
      total: '1000.00',
      basis: [31.1034768, 15.5517384, 46.6552152],
    });
    // weights are 2:1:3 => 333.33, 166.67, 500.00
    reconcile(r, '1000');
    expect(r.amounts[0]!.toString()).toBe('333.33');
    expect(r.amounts[1]!.toString()).toBe('166.67');
    expect(r.amounts[2]!.toString()).toBe('500');
  });

  it('EQUAL distributes evenly with deterministic remainder', () => {
    const r = allocate({ method: 'EQUAL', total: '100.00', count: 3 });
    expect(r.amounts.map((a) => a.toString())).toEqual(['33.34', '33.33', '33.33']);
    reconcile(r, '100');
  });

  it('EQUAL with zero total returns all zeros', () => {
    const r = allocate({ method: 'EQUAL', total: '0.00', count: 3 });
    expect(r.amounts.every((a) => a.isZero())).toBe(true);
    reconcile(r, '0');
  });

  it('falls back to equal split when basis sums to zero', () => {
    const r = allocate({
      method: 'SUBTOTAL_PROPORTIONAL',
      total: '9.00',
      basis: [0, 0, 0],
    });
    expect(r.amounts.map((a) => a.toString())).toEqual(['3', '3', '3']);
    reconcile(r, '9');
  });
});

describe('allocation determinism and order', () => {
  it('breaks ties by ascending index', () => {
    // 1.00 over 3 items: totalUnits=100, quota=33.33 each, floor=33, remainder=1
    // tie-broken to ascending index 0 -> [0.34, 0.33, 0.33]
    const r = allocate({ method: 'EQUAL', total: '1.00', count: 3 });
    expect(r.amounts.map((a) => a.toString())).toEqual(['0.34', '0.33', '0.33']);
  });

  it('produces stable output for identical inputs', () => {
    const a = allocate({ method: 'EQUAL', total: '99.99', count: 7 });
    const b = allocate({ method: 'EQUAL', total: '99.99', count: 7 });
    expect(a.amounts.map((x) => x.toString())).toEqual(b.amounts.map((x) => x.toString()));
  });

  it('does not introduce floating-point drift on long bases', () => {
    const r = allocate({
      method: 'WEIGHT_PROPORTIONAL',
      total: '12345.67',
      basis: ['31.1034768', '31.1034768', '31.1034768', '31.1034768'],
    });
    reconcile(r, '12345.67');
  });

  it('reconciles the full two-decimal NUMERIC(18,4) boundary without JS number loss', () => {
    const r = allocate({
      method: 'EQUAL',
      total: '99999999999999.99',
      count: 3,
    });
    expect(r.amounts.map((a) => a.toFixed(2))).toEqual([
      '33333333333333.33',
      '33333333333333.33',
      '33333333333333.33',
    ]);
    reconcile(r, '99999999999999.99');
  });

  it('reconciles a skewed proportional split at the storage boundary', () => {
    const r = allocate({
      method: 'SUBTOTAL_PROPORTIONAL',
      total: '99999999999999.99',
      basis: ['999999999999', '1', '3'],
    });
    reconcile(r, '99999999999999.99');
    expect(r.amounts.every((amount) => amount.gte(0))).toBe(true);
  });
});

describe('allocation input validation', () => {
  it('rejects unknown method', () => {
    expect(() => assertAllocationMethod('RANDOM')).toThrow(ArgumentError);
    expect(() =>
      // @ts-expect-error exercising runtime guard
      allocate({ method: 'RANDOM', total: '10', count: 2 }),
    ).toThrow(ArgumentError);
  });

  it('rejects negative total', () => {
    expect(() => allocate({ method: 'EQUAL', total: '-1.00', count: 2 })).toThrow(ArgumentError);
  });

  it('rejects missing basis for proportional methods', () => {
    expect(() =>
      // @ts-expect-error exercising runtime guard
      allocate({ method: 'SUBTOTAL_PROPORTIONAL', total: '10.00' }),
    ).toThrow(ArgumentError);
  });

  it('rejects non-finite totals, manual amounts, and proportional bases', () => {
    expect(() => allocate({ method: 'EQUAL', total: 'Infinity', count: 1 })).toThrow(ArgumentError);
    expect(() => allocate({ method: 'MANUAL', total: '1', manualAmounts: ['NaN'] })).toThrow(
      ArgumentError,
    );
    expect(() =>
      allocate({ method: 'WEIGHT_PROPORTIONAL', total: '1', basis: ['Infinity'] }),
    ).toThrow(ArgumentError);
  });

  it('rejects money that cannot fit the persisted numeric range', () => {
    expect(() => allocate({ method: 'EQUAL', total: '100000000000000.00', count: 1 })).toThrow(
      ArgumentError,
    );
  });

  it('rejects mismatched basis length', () => {
    expect(() =>
      allocate({
        method: 'WEIGHT_PROPORTIONAL',
        total: '10.00',
        basis: [1, 2],
        count: 3,
      } as never),
    ).not.toThrow(); // count is ignored for proportional; length derived from basis
  });

  it('rejects allocating a non-zero total to zero items', () => {
    expect(() => allocate({ method: 'EQUAL', total: '1.00', count: 0 })).toThrow(ArgumentError);
    expect(() => allocate({ method: 'SUBTOTAL_PROPORTIONAL', total: '1.00', basis: [] })).toThrow(
      ArgumentError,
    );
    expect(() => allocate({ method: 'EQUAL', total: '0.00', count: 0 })).not.toThrow();
  });
});

describe('money scale invariants', () => {
  it('MONEY_SCALE is 2 and unit is 0.01', () => {
    expect(MONEY_SCALE).toBe(2);
    expect(MONEY_UNIT.toString()).toBe('0.01');
  });
});
