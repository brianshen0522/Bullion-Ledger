import Decimal from 'decimal.js';

/**
 * Cost-basis arithmetic for partial disposals (PRD §15.3), kept pure so the
 * money rules are testable without a database.
 */

export const MONEY_SCALE = 4;
export const WEIGHT_SCALE = 9;

export interface HoldingBalance {
  quantity: number;
  fineWeightGrams: Decimal;
  grossWeightGrams: Decimal;
  allocatedCost: Decimal;
}

export interface DisposalSplit {
  /** What leaves the holding. */
  quantity: number;
  fineWeightGrams: Decimal;
  grossWeightGrams: Decimal;
  costBasis: Decimal;
  /** What stays behind. */
  remaining: HoldingBalance;
}

export class MovementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MovementError';
  }
}

/**
 * Splits a lot by quantity.
 *
 * A holding is a lot of interchangeable items, so selling 2 of 5 carries away
 * two fifths of the cost. Weight-proportional would give the same answer for a
 * uniform lot and is only meaningfully different for granules or scrap.
 *
 * Disposing of the whole remainder assigns the *entire* stored balance rather
 * than a recomputed proportion. Without that, rounding at each partial step
 * leaves a few cents of cost and a few micrograms stranded on a lot that is
 * physically empty.
 */
export function splitForDisposal(balance: HoldingBalance, quantity: number): DisposalSplit {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new MovementError('quantity must be a positive integer');
  }
  if (!Number.isSafeInteger(balance.quantity) || balance.quantity <= 0) {
    throw new MovementError('holding has nothing left to dispose of');
  }
  if (quantity > balance.quantity) {
    throw new MovementError(`cannot dispose of ${quantity} when only ${balance.quantity} remain`);
  }

  if (quantity === balance.quantity) {
    return {
      quantity,
      fineWeightGrams: balance.fineWeightGrams,
      grossWeightGrams: balance.grossWeightGrams,
      costBasis: balance.allocatedCost,
      remaining: {
        quantity: 0,
        fineWeightGrams: new Decimal(0),
        grossWeightGrams: new Decimal(0),
        allocatedCost: new Decimal(0),
      },
    };
  }

  const share = new Decimal(quantity).div(balance.quantity);
  const fineWeightGrams = balance.fineWeightGrams
    .times(share)
    .toDecimalPlaces(WEIGHT_SCALE, Decimal.ROUND_HALF_EVEN);
  const grossWeightGrams = balance.grossWeightGrams
    .times(share)
    .toDecimalPlaces(WEIGHT_SCALE, Decimal.ROUND_HALF_EVEN);
  const costBasis = balance.allocatedCost
    .times(share)
    .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_EVEN);

  // The remainder is the subtraction, never a second rounded multiplication,
  // so the parts always add back up to the original.
  return {
    quantity,
    fineWeightGrams,
    grossWeightGrams,
    costBasis,
    remaining: {
      quantity: balance.quantity - quantity,
      fineWeightGrams: balance.fineWeightGrams.minus(fineWeightGrams),
      grossWeightGrams: balance.grossWeightGrams.minus(grossWeightGrams),
      allocatedCost: balance.allocatedCost.minus(costBasis),
    },
  };
}

export interface SaleResult {
  netProceeds: Decimal;
  realizedPnl: Decimal;
}

/** Net proceeds and realized P&L for a sale (PRD §10, §15.3). */
export function computeSale(
  proceedsAmount: Decimal,
  fees: Decimal,
  costBasis: Decimal,
): SaleResult {
  if (proceedsAmount.isNegative()) throw new MovementError('proceeds must be >= 0');
  if (fees.isNegative()) throw new MovementError('fees must be >= 0');

  const netProceeds = proceedsAmount
    .minus(fees)
    .toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_EVEN);
  return {
    netProceeds,
    realizedPnl: netProceeds.minus(costBasis).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_EVEN),
  };
}

/**
 * Whether a movement books a realized gain or loss.
 *
 * A gift is deliberately excluded. Handing metal to someone is not an economic
 * loss, and recording one would put a large negative number on the P&L card for
 * an act of generosity. Losing or destroying metal genuinely does destroy the
 * cost, so those do book a loss.
 */
export function booksRealizedPnl(type: string): boolean {
  return type === 'SALE' || type === 'LOST' || type === 'DAMAGED';
}

/** Status a holding lands in once a movement empties it. */
export function statusAfterDisposal(type: string, remainingQuantity: number): string {
  if (remainingQuantity > 0) return 'HELD';
  switch (type) {
    case 'SALE':
      return 'SOLD';
    case 'GIFT_OUT':
      return 'GIFTED';
    case 'LOST':
      return 'LOST';
    case 'DAMAGED':
      return 'DAMAGED';
    default:
      return 'HELD';
  }
}
