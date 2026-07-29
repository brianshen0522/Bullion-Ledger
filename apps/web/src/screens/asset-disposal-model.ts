import { localDateTimeToIso } from './purchase-form.js';

export type DisposalAction = 'SALE' | 'GIFT_OUT' | 'LOST';

export const DISPOSAL_QUANTITY_MIN = 1;
export const DISPOSAL_QUANTITY_LIMIT = 1_000_000;
export const MONEY_INPUT_MAX = '99999999999999.9999';
export const MONEY_INPUT_STEP = '0.0001';

const MONEY_RE = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

export interface AssetDisposalFormValues {
  occurredAt: string;
  quantity: string;
  proceedsAmount: string;
  fees: string;
}

export type AssetDisposalValidationField = 'occurredAt' | 'quantity' | 'proceedsAmount' | 'fees';

export interface ValidatedAssetDisposal {
  occurredAt: string;
  quantity: number;
  proceedsAmount?: string;
  fees?: string;
}

export type AssetDisposalValidationResult =
  | { ok: true; value: ValidatedAssetDisposal }
  | { ok: false; field: AssetDisposalValidationField; error: string };

/** Matches the fixed-point money contract accepted by the movements API. */
export function isValidMoneyInput(value: string): boolean {
  return MONEY_RE.test(value.trim());
}

/**
 * Validates and normalizes the values that are sent by a disposal dialog.
 * Keeping this pure makes the browser constraints and API payload testable
 * without issuing a movement against a real holding.
 */
export function validateAssetDisposal(
  action: DisposalAction,
  availableQuantity: number,
  form: AssetDisposalFormValues,
): AssetDisposalValidationResult {
  let occurredAt: string;
  try {
    occurredAt = localDateTimeToIso(form.occurredAt);
  } catch {
    return { ok: false, field: 'occurredAt', error: '請輸入有效的日期與時間。' };
  }

  const quantityText = form.quantity.trim();
  const quantity = Number(quantityText);
  const maximumQuantity = Math.min(availableQuantity, DISPOSAL_QUANTITY_LIMIT);
  if (
    !/^\d+$/.test(quantityText) ||
    !Number.isSafeInteger(quantity) ||
    quantity < DISPOSAL_QUANTITY_MIN ||
    quantity > maximumQuantity
  ) {
    return {
      ok: false,
      field: 'quantity',
      error: `數量必須是 1 到 ${maximumQuantity} 之間的整數。`,
    };
  }

  if (action !== 'SALE') return { ok: true, value: { occurredAt, quantity } };

  const proceedsAmount = form.proceedsAmount.trim();
  if (!proceedsAmount) {
    return { ok: false, field: 'proceedsAmount', error: '請輸入售出金額。' };
  }
  if (!isValidMoneyInput(proceedsAmount)) {
    return {
      ok: false,
      field: 'proceedsAmount',
      error: '售出金額必須是非負數，整數最多 14 位且小數最多 4 位。',
    };
  }

  const fees = form.fees.trim() || '0';
  if (!isValidMoneyInput(fees)) {
    return {
      ok: false,
      field: 'fees',
      error: '手續費／鑑定費必須是非負數，整數最多 14 位且小數最多 4 位。',
    };
  }

  return {
    ok: true,
    value: { occurredAt, quantity, proceedsAmount, fees },
  };
}
