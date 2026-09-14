import Decimal from 'decimal.js';
import {
  convertWeight,
  formatWeightInput,
  fromGrams,
  WEIGHT_INPUT_RE,
  PURITY_INPUT_RE,
} from '@bullion-ledger/shared';

import type { ProductDefinition } from '../api.js';
import { productFormLabel } from '../product-forms.js';

export interface ProductDraftInput {
  name: string;
  metalCode: string;
  form: string;
  purity: string;
  unitWeight: string;
}

export function validateProductDraft(input: ProductDraftInput): string | null {
  if (!input.name.trim()) return '請輸入商品規格名稱。';
  if (!input.metalCode) return '請選擇金屬。';
  if (!input.form) return '請選擇商品形式。';
  if (!PURITY_INPUT_RE.test(input.purity)) return '純度格式無效（最多7位小數，不允許科學記號）。';
  try {
    const purity = new Decimal(input.purity);
    if (!purity.isFinite() || purity.lte(0) || purity.gt(1)) {
      return '純度必須大於 0 且不超過 1。';
    }
  } catch {
    return '請輸入有效的純度。';
  }
  if (!WEIGHT_INPUT_RE.test(input.unitWeight))
    return '重量格式無效（最多9位小數，不允許科學記號）。';
  try {
    const weight = new Decimal(input.unitWeight);
    if (!weight.isFinite() || weight.lte(0)) return '單件重量必須大於 0。';
  } catch {
    return '請輸入有效的單件重量。';
  }

  return null;
}

export function filterProductDefinitions(
  products: readonly ProductDefinition[],
  query: string,
): ProductDefinition[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...products];
  return products.filter((product) =>
    [
      product.name,
      product.brand,
      product.country,
      product.yearOrVersion,
      product.metal.code,
      product.metal.name,
      product.form,
      productFormLabel(product.form, product.metal.code),
    ].some((value) => value?.toLocaleLowerCase().includes(normalized)),
  );
}

export interface ProductDefinitionGroup {
  metalCode: string;
  metalName: string;
  products: ProductDefinition[];
}

export function groupProductDefinitionsByMetal(
  products: readonly ProductDefinition[],
): ProductDefinitionGroup[] {
  const groups = new Map<string, ProductDefinitionGroup>();
  for (const product of products) {
    const existing = groups.get(product.metal.code);
    if (existing) {
      existing.products.push(product);
    } else {
      groups.set(product.metal.code, {
        metalCode: product.metal.code,
        metalName: product.metal.name,
        products: [product],
      });
    }
  }

  const preferredOrder = new Map([
    ['XAU', 0],
    ['XAG', 1],
  ]);
  return [...groups.values()].sort((left, right) => {
    const leftRank = preferredOrder.get(left.metalCode) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = preferredOrder.get(right.metalCode) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.metalCode.localeCompare(right.metalCode);
  });
}

export function formatProductPurity(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '—';
  try {
    return `${new Decimal(value).mul(100).toDecimalPlaces(5).toString()}%`;
  } catch {
    return '—';
  }
}

export function safeDecimalString(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    return new Decimal(value).toString();
  } catch {
    return null;
  }
}

export interface ProductEditForm {
  name: string;
  form: string;
  brand: string;
  country: string;
  yearOrVersion: string;
  purity: string;
  unitWeight: string;
  weightUnit: string;
  weightUnitDirty: boolean;
  active: boolean;
}

export function emptyProductEditForm(product: ProductDefinition): ProductEditForm {
  const weightUnit = product.defaultWeightUnit;
  return {
    name: product.name,
    form: product.form,
    brand: product.brand ?? '',
    country: product.country ?? '',
    yearOrVersion: product.yearOrVersion ?? '',
    purity: product.defaultPurity,
    unitWeight: formatWeightInput(
      convertWeight(product.defaultUnitWeightGrams, 'g', weightUnit as never),
    ),
    weightUnit,
    weightUnitDirty: false,
    active: product.active,
  };
}

export function validateProductEditForm(form: ProductEditForm): string | null {
  if (!form.name.trim()) return '名稱不得為空';
  if (!PURITY_INPUT_RE.test(form.purity)) return '純度格式無效（最多7位小數，不允許科學記號）';
  try {
    const p = new Decimal(form.purity);
    if (!p.isFinite() || p.lte(0) || p.gt(1)) return '純度必須在 0 到 1 之間';
  } catch {
    return '純度格式無效';
  }
  if (!WEIGHT_INPUT_RE.test(form.unitWeight)) return '重量格式無效（最多9位小數，不允許科學記號）';
  try {
    const w = new Decimal(form.unitWeight);
    if (!w.isFinite() || w.lte(0)) return '單件重量必須大於 0';
  } catch {
    return '重量格式無效';
  }
  return null;
}

export function convertWeightDisplay(magnitude: string, fromUnit: string, toUnit: string): string {
  return formatWeightInput(convertWeight(magnitude, fromUnit as never, toUnit as never));
}

export function buildProductPatch(
  product: ProductDefinition,
  form: ProductEditForm,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { version: product.version };
  if (form.name.trim() !== product.name) patch.name = form.name.trim();
  if (form.form !== product.form) patch.form = form.form;
  const brand = form.brand.trim() || null;
  if (brand !== product.brand) patch.brand = brand;
  const country = form.country.trim() || null;
  if (country !== product.country) patch.country = country;
  const yearOrVersion = form.yearOrVersion.trim() || null;
  if (yearOrVersion !== product.yearOrVersion) patch.yearOrVersion = yearOrVersion;
  const normalizedPurity = new Decimal(form.purity).toFixed();
  if (!new Decimal(product.defaultPurity).eq(normalizedPurity)) patch.purity = normalizedPurity;
  if (form.active !== product.active) patch.active = form.active;
  if (form.weightUnitDirty) {
    const normalizedInput = formatWeightInput(form.unitWeight);
    const canonicalInUnit = formatWeightInput(
      fromGrams(product.defaultUnitWeightGrams, form.weightUnit as never),
    );
    if (normalizedInput !== canonicalInUnit) {
      patch.unitWeight = form.unitWeight;
      if (form.weightUnit !== product.defaultWeightUnit) patch.weightUnit = form.weightUnit;
    } else if (form.weightUnit !== product.defaultWeightUnit) {
      patch.weightUnit = form.weightUnit;
    }
  } else if (form.weightUnit !== product.defaultWeightUnit) {
    patch.weightUnit = form.weightUnit;
  }
  return patch;
}

export interface ProductPartyPatch {
  organizationId: string;
  role: NonNullable<ProductDefinition['organizations']>[number]['role'];
  isPrimary: boolean;
  attributionStatus: NonNullable<ProductDefinition['organizations']>[number]['attributionStatus'];
}

/**
 * Product party updates replace the complete relation set. Keep every
 * non-brand attribution intact while replacing (or clearing) the brand.
 */
export function productPartiesWithBrand(
  product: ProductDefinition,
  organizationId: string | null,
): ProductPartyPatch[] {
  const existing = product.organizations ?? [];
  const parties: ProductPartyPatch[] = existing
    .filter(({ role }) => role !== 'BRAND')
    .map(({ organization, role, isPrimary, attributionStatus }) => ({
      organizationId: organization.id,
      role,
      isPrimary,
      attributionStatus,
    }));

  if (organizationId) {
    const previous = existing.find(
      ({ role, organization }) => role === 'BRAND' && organization.id === organizationId,
    );
    parties.push({
      organizationId,
      role: 'BRAND',
      isPrimary: true,
      attributionStatus: previous?.attributionStatus ?? 'DECLARED',
    });
  }

  return parties;
}

/**
 * One form behind both creating and editing a specification. Creating differs
 * only in that the metal is still open: an existing specification's metal is
 * what every holding built from it was priced against, so it never changes.
 */
export interface ProductWizardForm extends ProductEditForm {
  metalCode: string;
}

export function newProductWizardForm(metalCode: string): ProductWizardForm {
  return {
    metalCode,
    name: '',
    form: 'bar',
    brand: '',
    country: '',
    yearOrVersion: '',
    purity: '0.9999',
    unitWeight: '1',
    weightUnit: 'g',
    weightUnitDirty: false,
    active: true,
  };
}

export function productWizardFormFrom(product: ProductDefinition): ProductWizardForm {
  return { ...emptyProductEditForm(product), metalCode: product.metal.code };
}

/**
 * Validates only what the given step is responsible for, so a user is never
 * stopped on step one by a value they have not reached yet. Returns null when
 * the step is good.
 */
export function validateProductStep(
  form: ProductWizardForm,
  step: 'basics' | 'origin' | 'spec' | 'review',
): string | null {
  if (step === 'basics') {
    if (!form.name.trim()) return '請輸入商品規格名稱。';
    if (!form.metalCode) return '請選擇金屬。';
    if (!form.form) return '請選擇商品形式。';
    return null;
  }
  // Brand, country and year are all optional attributions (PRD §13).
  if (step === 'origin') return null;
  if (step === 'spec') {
    // Deliberately not validateProductEditForm: that also checks the name,
    // which belongs to step one. Faulting a step for a field the user has not
    // reached is how a wizard traps someone with no way forward.
    if (!PURITY_INPUT_RE.test(form.purity)) {
      return '純度格式無效（最多7位小數，不允許科學記號）。';
    }
    try {
      const purity = new Decimal(form.purity);
      if (!purity.isFinite() || purity.lte(0) || purity.gt(1)) {
        return '純度必須大於 0 且不超過 1。';
      }
    } catch {
      return '請輸入有效的純度。';
    }
    if (!WEIGHT_INPUT_RE.test(form.unitWeight)) {
      return '重量格式無效（最多9位小數，不允許科學記號）。';
    }
    try {
      const weight = new Decimal(form.unitWeight);
      if (!weight.isFinite() || weight.lte(0)) return '單件重量必須大於 0。';
    } catch {
      return '請輸入有效的單件重量。';
    }
    return null;
  }
  return (
    validateProductStep(form, 'basics') ??
    validateProductStep(form, 'origin') ??
    validateProductStep(form, 'spec')
  );
}

/** The POST body for a new specification. */
export function buildProductCreateBody(
  form: ProductWizardForm,
  brandOrganizationId: string | null,
): Record<string, unknown> {
  return {
    name: form.name.trim(),
    metalCode: form.metalCode,
    form: form.form,
    parties: brandOrganizationId
      ? [
          {
            organizationId: brandOrganizationId,
            role: 'BRAND',
            isPrimary: true,
            attributionStatus: 'DECLARED',
          },
        ]
      : undefined,
    country: form.country.trim() || undefined,
    yearOrVersion: form.yearOrVersion.trim() || undefined,
    purity: form.purity,
    unitWeight: form.unitWeight,
    weightUnit: form.weightUnit,
  };
}
