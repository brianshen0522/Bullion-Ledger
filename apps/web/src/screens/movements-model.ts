import Decimal from 'decimal.js';

export type MovementType =
  | 'PURCHASE_IN'
  | 'GIFT_IN'
  | 'SALE'
  | 'GIFT_OUT'
  | 'LOST'
  | 'DAMAGED'
  | 'INVENTORY_ADJUSTMENT'
  | 'STORAGE_TRANSFER'
  | 'SENT_FOR_APPRAISAL'
  | 'RETURNED_FROM_APPRAISAL';

export interface Movement {
  id: string;
  assetId: string;
  type: MovementType;
  occurredAt: string;
  metalCode: string;
  name: string;
  quantity: number;
  fineWeightGrams: string;
  counterparty: string | null;
  proceedsAmount: string | null;
  fees: string | null;
  netProceeds: string | null;
  costBasis: string | null;
  realizedPnl: string | null;
  marketValue: string | null;
  currency: string | null;
  fromStorageLocation: string | null;
  toStorageLocation: string | null;
  notes: string | null;
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  PURCHASE_IN: '購入',
  GIFT_IN: '收到贈與',
  SALE: '售出',
  GIFT_OUT: '贈與他人',
  LOST: '遺失',
  DAMAGED: '損壞',
  INVENTORY_ADJUSTMENT: '盤點調整',
  STORAGE_TRANSFER: '位置移轉',
  SENT_FOR_APPRAISAL: '送鑑定',
  RETURNED_FROM_APPRAISAL: '鑑定取回',
};

/** Movements that take metal out of the holding. */
export const OUTBOUND_TYPES: readonly MovementType[] = ['SALE', 'GIFT_OUT', 'LOST', 'DAMAGED'];

export function movementLabel(type: MovementType): string {
  return MOVEMENT_LABELS[type] ?? type;
}

/**
 * Explains a movement's money column.
 *
 * A gift deliberately has no realized figure: handing metal to someone is not
 * an economic loss, so the column says what it was worth instead of booking a
 * number against profit.
 */
export function movementAmount(movement: Movement): { label: string; value: string | null } {
  switch (movement.type) {
    case 'SALE':
      return { label: '淨收入', value: movement.netProceeds };
    case 'GIFT_OUT':
      return { label: '贈與時市值', value: movement.marketValue };
    case 'GIFT_IN':
      return { label: '收到時市值', value: movement.marketValue };
    case 'LOST':
    case 'DAMAGED':
      return { label: '損失成本', value: movement.costBasis };
    default:
      return { label: '', value: null };
  }
}

/** Realized P&L, or null when this movement type does not book one. */
export function realizedOf(movement: Movement): Decimal | null {
  if (movement.realizedPnl === null) return null;
  const parsed = new Decimal(movement.realizedPnl);
  return parsed.isFinite() ? parsed : null;
}

export interface SellPreviewInput {
  quantity: number;
  totalQuantity: number;
  allocatedCost: string;
  proceedsAmount: string;
  fees: string;
}

export interface SellPreview {
  costBasis: string;
  netProceeds: string;
  realizedPnl: string;
  remainingQuantity: number;
}

/**
 * Mirrors the server's cost-basis split so the form can show the outcome before
 * the user commits. The server remains authoritative; this is a preview only.
 */
export function previewSale(input: SellPreviewInput): SellPreview | null {
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > input.totalQuantity
  ) {
    return null;
  }
  try {
    const total = new Decimal(input.allocatedCost);
    // A full disposal takes the whole recorded cost, matching the server's
    // exact-zero rule rather than a re-derived proportion.
    const costBasis =
      input.quantity === input.totalQuantity
        ? total
        : total.times(input.quantity).div(input.totalQuantity).toDecimalPlaces(4);
    const netProceeds = new Decimal(input.proceedsAmount || '0')
      .minus(input.fees || '0')
      .toDecimalPlaces(4);

    return {
      costBasis: costBasis.toFixed(2),
      netProceeds: netProceeds.toFixed(2),
      realizedPnl: netProceeds.minus(costBasis).toFixed(2),
      remainingQuantity: input.totalQuantity - input.quantity,
    };
  } catch {
    return null;
  }
}
