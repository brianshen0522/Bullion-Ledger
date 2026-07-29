import {
  MAX_ALLOCATION_ITEMS,
  MONEY_INPUT_RE,
  PURITY_INPUT_RE,
  WEIGHT_INPUT_RE,
  isCurrencyCode,
  isWeightUnit,
  quantizeMoney,
  quantizeWeightGrams,
  toGrams,
  validatePurity,
} from '@bullion-ledger/shared';

import { localDateTimeToIso, validatePurchase } from '../screens/purchase-form.js';
import { resolveCosts } from './model.js';
import { PURCHASE_WIZARD_STEPS, type PurchaseWizardDraft } from './types.js';
import type { PurchaseWizardStep, WizardValidationIssue } from './types.js';

const MAX_QUANTITY = 1_000_000;

function issue(path: string, message: string): WizardValidationIssue {
  return { path, message };
}

export function validateTransactionStep(draft: PurchaseWizardDraft): WizardValidationIssue[] {
  const issues: WizardValidationIssue[] = [];
  try {
    localDateTimeToIso(draft.transaction.purchasedAt);
  } catch {
    issues.push(issue('transaction.purchasedAt', '請輸入有效的購買日期與時間。'));
  }
  if (!isCurrencyCode(draft.transaction.currency)) {
    issues.push(issue('transaction.currency', '幣別必須是三個大寫英文字母。'));
  }
  if (draft.transaction.paymentMethod.length > 64) {
    issues.push(issue('transaction.paymentMethod', '付款方式不可超過 64 個字元。'));
  }
  return issues;
}

export function validateItemsStep(draft: PurchaseWizardDraft): WizardValidationIssue[] {
  if (draft.items.length === 0) return [issue('items', '請至少新增一項商品。')];
  if (draft.items.length > MAX_ALLOCATION_ITEMS) {
    return [issue('items', `單筆交易最多 ${MAX_ALLOCATION_ITEMS} 項商品。`)];
  }

  const issues: WizardValidationIssue[] = [];
  for (const [index, item] of draft.items.entries()) {
    const base = `items.${item.id}`;
    const label = `商品 ${index + 1}`;
    if (!item.name.trim()) issues.push(issue(`${base}.name`, `${label}需要商品名稱。`));
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(item.metalCode)) {
      issues.push(issue(`${base}.metalCode`, `${label}需要有效的金屬種類。`));
    }
    if (!item.form.trim()) issues.push(issue(`${base}.form`, `${label}需要商品形式。`));

    if (!/^\d+$/.test(item.quantity)) {
      issues.push(issue(`${base}.quantity`, `${label}數量必須是整數。`));
    } else {
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        issues.push(issue(`${base}.quantity`, `${label}數量必須介於 1 到 ${MAX_QUANTITY}。`));
      }
    }

    if (!isWeightUnit(item.weightUnit)) {
      issues.push(issue(`${base}.weightUnit`, `${label}的重量單位無效。`));
    } else {
      try {
        if (!WEIGHT_INPUT_RE.test(item.unitWeight)) throw new Error('invalid weight syntax');
        const grams = quantizeWeightGrams(toGrams(item.unitWeight, item.weightUnit));
        if (grams.lte(0)) throw new Error('non-positive');
      } catch {
        issues.push(issue(`${base}.unitWeight`, `${label}的單件重量必須大於零。`));
      }
    }

    try {
      if (!PURITY_INPUT_RE.test(item.purity)) throw new Error('invalid purity syntax');
      validatePurity(item.purity);
    } catch {
      issues.push(issue(`${base}.purity`, `${label}的純度必須大於 0 且不超過 1。`));
    }
  }
  return issues;
}

function validateMoney(path: string, label: string, value: string): WizardValidationIssue | null {
  try {
    if (!MONEY_INPUT_RE.test(value)) throw new Error('invalid money syntax');
    quantizeMoney(value);
    return null;
  } catch {
    return issue(path, `${label}必須是有效的非負金額，最多兩位小數。`);
  }
}

export function validateCostsStep(draft: PurchaseWizardDraft): WizardValidationIssue[] {
  const issues: WizardValidationIssue[] = [];
  // The transaction subtotal is derived from the lines, so it is not validated
  // as an input — and the itemized-only charges are not asked for in SIMPLE
  // mode, so complaining about them there would be reporting a field the user
  // was never shown.
  const itemizedCharges: [keyof PurchaseWizardDraft['costs'], string][] = [
    ['premium', '商家標示溢價'],
    ['labor', '工錢'],
    ['tax', '稅費'],
    ['otherFees', '其他費用'],
  ];
  const alwaysCharges: [keyof PurchaseWizardDraft['costs'], string][] = [
    ['shipping', '運費'],
    ['discount', '折扣'],
  ];
  const charges =
    draft.costs.mode === 'ITEMIZED' ? [...itemizedCharges, ...alwaysCharges] : alwaysCharges;

  for (const [field, label] of charges) {
    const value = draft.costs[field];
    if (typeof value !== 'string') continue;
    const error = validateMoney(`costs.${field}`, label, value);
    if (error) issues.push(error);
  }

  const priceLabel = draft.costs.mode === 'SIMPLE' ? '商品價格' : '商品小計';
  for (const [index, item] of draft.items.entries()) {
    const lineError = validateMoney(
      `items.${item.id}.lineSubtotal`,
      `商品 ${index + 1}${priceLabel}`,
      item.lineSubtotal,
    );
    if (lineError) issues.push(lineError);

    if (draft.costs.allocationMethod === 'MANUAL') {
      const manualError = validateMoney(
        `items.${item.id}.manualAmount`,
        `商品 ${index + 1}分攤金額`,
        item.manualAmount,
      );
      if (manualError) issues.push(manualError);
    }
  }

  // Validate exactly what will be submitted: the derived subtotal, and the
  // itemized charges pinned to zero when the buyer never saw them.
  const costs = resolveCosts(draft);
  const fullValidation = validatePurchase({
    purchasedAt: draft.transaction.purchasedAt,
    currency: draft.transaction.currency,
    subtotal: costs.subtotal,
    premium: costs.premium,
    labor: costs.labor,
    tax: costs.tax,
    shipping: costs.shipping,
    otherFees: costs.otherFees,
    discount: costs.discount,
    method: costs.allocationMethod,
    items: draft.items.map((item) => ({
      name: item.name,
      metalCode: item.metalCode,
      form: item.form,
      quantity: item.quantity,
      unitWeight: item.unitWeight,
      purity: item.purity,
      lineSubtotal: item.lineSubtotal,
      manualAmount: item.manualAmount,
    })),
  });
  if (fullValidation && issues.length === 0) issues.push(issue('costs', fullValidation));
  return deduplicateIssues(issues);
}

export function validateWizardStep(
  draft: PurchaseWizardDraft,
  step: PurchaseWizardStep,
): WizardValidationIssue[] {
  switch (step) {
    case 'transaction':
      return validateTransactionStep(draft);
    case 'items':
      return validateItemsStep(draft);
    case 'costs':
      return validateCostsStep(draft);
    case 'photos':
    case 'documents':
      return [];
    case 'review':
      return validateEntireWizard(draft);
  }
}

export function validateEntireWizard(draft: PurchaseWizardDraft): WizardValidationIssue[] {
  return deduplicateIssues([
    ...validateTransactionStep(draft),
    ...validateItemsStep(draft),
    ...validateCostsStep(draft),
  ]);
}

export function firstInvalidStep(draft: PurchaseWizardDraft): PurchaseWizardStep | null {
  for (const { id } of PURCHASE_WIZARD_STEPS) {
    if (validateWizardStep(draft, id).length > 0) return id;
  }
  return null;
}

function deduplicateIssues(issues: WizardValidationIssue[]): WizardValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter(({ path, message }) => {
    const key = `${path}\u0000${message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
