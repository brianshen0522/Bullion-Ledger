import { fineWeightGrams, toGrams } from '@bullion-ledger/shared';
import Decimal from 'decimal.js';

import type { ProductDefinition } from '../api.js';

interface ItemForm {
  name: string;
  metalCode: string;
  form: string;
  quantity: string;
  unitWeight: string;
  weightUnit: string;
  purity: string;
  lineSubtotal: string;
  manualAmount: string;
}

/** Pure preview string used by the purchase form; never reaches the API. */
export function computeLinePreview(it: ItemForm, _products: ProductDefinition[]): string {
  try {
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1) return 'Invalid quantity';
    const grams = toGrams(it.unitWeight, it.weightUnit as never);
    const fine = fineWeightGrams(grams.times(qty), it.purity);
    return `≈ ${new Decimal(grams).times(qty).toDecimalPlaces(4).toString()} g gross · ${fine
      .toDecimalPlaces(4)
      .toString()} g fine`;
  } catch (e) {
    return (e as Error).message;
  }
}
