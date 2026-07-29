import { convertWeight, formatWeightInput, type WeightUnit } from '@bullion-ledger/shared';
import Decimal from 'decimal.js';

export interface PurchaseValidationItem {
  name: string;
  metalCode: string;
  form: string;
  quantity: string;
  unitWeight: string;
  purity: string;
  lineSubtotal: string;
  manualAmount: string;
}

export interface PurchaseValidationInput {
  purchasedAt: string;
  currency: string;
  subtotal: string;
  premium: string;
  labor: string;
  tax: string;
  shipping: string;
  otherFees: string;
  discount: string;
  method: 'MANUAL' | 'SUBTOTAL_PROPORTIONAL' | 'WEIGHT_PROPORTIONAL' | 'EQUAL';
  items: PurchaseValidationItem[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats a Date as local wall-clock time for an HTML datetime-local control. */
export function toLocalDateTimeInput(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Interprets a datetime-local value in the user's local zone, then sends an unambiguous instant. */
export function localDateTimeToIso(value: string): string {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime()))
    throw new Error('Enter a valid purchase date and time.');
  return parsed.toISOString();
}

/** Changes only the display unit while preserving the input's physical weight. */
export function convertUnitWeightInput(value: string, from: WeightUnit, to: WeightUnit): string {
  if (from === to || value.trim() === '') return value;
  return formatWeightInput(convertWeight(value, from, to));
}

function parseNonNegative(label: string, value: string): { value?: Decimal; error?: string } {
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.isNegative())
      return { error: `${label} must be zero or greater.` };
    return { value: parsed };
  } catch {
    return { error: `${label} must be a valid number.` };
  }
}

export function validatePurchase(input: PurchaseValidationInput): string | null {
  try {
    localDateTimeToIso(input.purchasedAt);
  } catch (error) {
    return (error as Error).message;
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) return 'Currency must be a three-letter code.';
  if (input.items.length === 0) return 'Add at least one purchase item.';

  const charges: [string, string][] = [
    ['Subtotal', input.subtotal],
    ['Premium', input.premium],
    ['Labor', input.labor],
    ['Tax', input.tax],
    ['Shipping', input.shipping],
    ['Other fees', input.otherFees],
    ['Discount', input.discount],
  ];
  const parsedCharges = charges.map(([label, value]) => parseNonNegative(label, value));
  const chargeError = parsedCharges.find(({ error }) => error)?.error;
  if (chargeError) return chargeError;

  const monetaryTotal = parsedCharges
    .slice(0, 6)
    .reduce((sum, parsed) => sum.plus(parsed.value!), new Decimal(0))
    .minus(parsedCharges[6]!.value!);
  if (monetaryTotal.lte(0)) return 'Purchase total must be greater than zero.';

  const headerSubtotal = parsedCharges[0]!.value!.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  let lineSubtotalSum = new Decimal(0);
  let manualTotal = new Decimal(0);
  for (const [index, item] of input.items.entries()) {
    const itemLabel = `Item ${index + 1}`;
    if (!item.name.trim()) return `${itemLabel}: product name is required.`;
    if (!item.metalCode.trim()) return `${itemLabel}: metal is required.`;
    if (!item.form.trim()) return `${itemLabel}: form is required.`;
    if (!/^\d+$/.test(item.quantity)) return `${itemLabel}: quantity must be a whole number.`;
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
      return `${itemLabel}: quantity must be between 1 and 1,000,000.`;
    }

    const weight = parseNonNegative(`${itemLabel}: unit weight`, item.unitWeight);
    if (weight.error) return weight.error;
    if (weight.value!.lte(0)) return `${itemLabel}: unit weight must be greater than zero.`;

    const purity = parseNonNegative(`${itemLabel}: purity`, item.purity);
    if (purity.error) return purity.error;
    if (purity.value!.lte(0) || purity.value!.gt(1)) {
      return `${itemLabel}: purity must be greater than zero and at most one.`;
    }

    const lineSubtotal = parseNonNegative(`${itemLabel}: line subtotal`, item.lineSubtotal);
    if (lineSubtotal.error) return lineSubtotal.error;
    lineSubtotalSum = lineSubtotalSum.plus(
      lineSubtotal.value!.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN),
    );

    if (input.method === 'MANUAL') {
      const manualAmount = parseNonNegative(`${itemLabel}: manual amount`, item.manualAmount);
      if (manualAmount.error) return manualAmount.error;
      manualTotal = manualTotal.plus(manualAmount.value!);
    }
  }

  if (!lineSubtotalSum.eq(headerSubtotal)) {
    return `Subtotal must equal the line subtotal total (${lineSubtotalSum.toFixed(2)}).`;
  }
  if (input.method === 'SUBTOTAL_PROPORTIONAL' && lineSubtotalSum.lte(0)) {
    return 'Line subtotals must have a positive total for subtotal-proportional allocation.';
  }
  if (
    input.method === 'MANUAL' &&
    !manualTotal.toDecimalPlaces(2).eq(monetaryTotal.toDecimalPlaces(2))
  ) {
    return 'Manual allocations must add up to the purchase total.';
  }
  return null;
}
