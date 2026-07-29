import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  MovementError,
  booksRealizedPnl,
  computeSale,
  splitForDisposal,
  statusAfterDisposal,
} from '../src/movements/movement-domain';

function balance(quantity: number, fine: string, gross: string, cost: string) {
  return {
    quantity,
    fineWeightGrams: new Decimal(fine),
    grossWeightGrams: new Decimal(gross),
    allocatedCost: new Decimal(cost),
  };
}

describe('partial disposal (PRD §15.3)', () => {
  it('carries away a proportional share of cost and weight', () => {
    const split = splitForDisposal(balance(5, '50', '50', '100000'), 2);

    expect(split.costBasis.toFixed()).toBe('40000');
    expect(split.fineWeightGrams.toFixed()).toBe('20');
    expect(split.remaining.quantity).toBe(3);
    expect(split.remaining.allocatedCost.toFixed()).toBe('60000');
    expect(split.remaining.fineWeightGrams.toFixed()).toBe('30');
  });

  it('always adds back up to the original', () => {
    const original = balance(3, '31.1034768', '31.1034768', '100000');
    const split = splitForDisposal(original, 1);

    expect(split.costBasis.plus(split.remaining.allocatedCost).toFixed()).toBe('100000');
    expect(split.fineWeightGrams.plus(split.remaining.fineWeightGrams).toFixed()).toBe(
      '31.1034768',
    );
  });

  it('leaves an emptied lot at exactly zero, with no rounding residue', () => {
    // A third of an odd amount cannot divide evenly; taking the remainder as a
    // subtraction rather than a second rounded multiplication is what makes the
    // final disposal land on zero.
    let current = balance(3, '10', '10', '100');
    const first = splitForDisposal(current, 1);
    current = first.remaining;
    const second = splitForDisposal(current, 1);
    current = second.remaining;
    const third = splitForDisposal(current, 1);

    expect(third.remaining.quantity).toBe(0);
    expect(third.remaining.allocatedCost.toFixed()).toBe('0');
    expect(third.remaining.fineWeightGrams.toFixed()).toBe('0');
    expect(first.costBasis.plus(second.costBasis).plus(third.costBasis).toFixed()).toBe('100');
  });

  it('assigns the whole balance when the entire lot goes at once', () => {
    const split = splitForDisposal(balance(4, '12.3456789', '12.5', '99999.9999'), 4);

    expect(split.costBasis.toFixed()).toBe('99999.9999');
    expect(split.fineWeightGrams.toFixed()).toBe('12.3456789');
    expect(split.remaining.quantity).toBe(0);
    expect(split.remaining.allocatedCost.isZero()).toBe(true);
  });

  it('refuses to dispose of more than is held', () => {
    expect(() => splitForDisposal(balance(2, '10', '10', '100'), 3)).toThrow(MovementError);
  });

  it('refuses a non-positive or fractional quantity', () => {
    expect(() => splitForDisposal(balance(2, '10', '10', '100'), 0)).toThrow(MovementError);
    expect(() => splitForDisposal(balance(2, '10', '10', '100'), -1)).toThrow(MovementError);
    expect(() => splitForDisposal(balance(2, '10', '10', '100'), 1.5)).toThrow(MovementError);
  });

  it('refuses to dispose from an already-empty lot', () => {
    expect(() => splitForDisposal(balance(0, '0', '0', '0'), 1)).toThrow(MovementError);
  });
});

describe('sale economics', () => {
  it('nets fees off proceeds and books the difference against cost', () => {
    const result = computeSale(new Decimal('30000'), new Decimal('500'), new Decimal('25750'));

    expect(result.netProceeds.toFixed()).toBe('29500');
    expect(result.realizedPnl.toFixed()).toBe('3750');
  });

  it('books a loss when the sale does not cover its cost basis', () => {
    const result = computeSale(new Decimal('20000'), new Decimal('0'), new Decimal('25750'));
    expect(result.realizedPnl.toFixed()).toBe('-5750');
  });

  it('rejects negative proceeds or fees', () => {
    expect(() => computeSale(new Decimal('-1'), new Decimal('0'), new Decimal('0'))).toThrow(
      MovementError,
    );
    expect(() => computeSale(new Decimal('1'), new Decimal('-1'), new Decimal('0'))).toThrow(
      MovementError,
    );
  });
});

describe('which movements book realized P&L', () => {
  it('books a sale, and a genuine loss of metal', () => {
    expect(booksRealizedPnl('SALE')).toBe(true);
    expect(booksRealizedPnl('LOST')).toBe(true);
    expect(booksRealizedPnl('DAMAGED')).toBe(true);
  });

  it('never books a gift — giving metal away is not losing money', () => {
    expect(booksRealizedPnl('GIFT_OUT')).toBe(false);
    expect(booksRealizedPnl('GIFT_IN')).toBe(false);
  });

  it('ignores movements that only relocate metal', () => {
    expect(booksRealizedPnl('STORAGE_TRANSFER')).toBe(false);
  });
});

describe('resulting holding status', () => {
  it('stays held while anything remains', () => {
    expect(statusAfterDisposal('SALE', 3)).toBe('HELD');
    expect(statusAfterDisposal('GIFT_OUT', 1)).toBe('HELD');
  });

  it('records how an emptied holding left', () => {
    expect(statusAfterDisposal('SALE', 0)).toBe('SOLD');
    expect(statusAfterDisposal('GIFT_OUT', 0)).toBe('GIFTED');
    expect(statusAfterDisposal('LOST', 0)).toBe('LOST');
    expect(statusAfterDisposal('DAMAGED', 0)).toBe('DAMAGED');
  });
});
