import { describe, expect, it } from 'vitest';

import type { ProductDefinition } from '../src/api';
import {
  buildProductPatch,
  convertWeightDisplay,
  emptyProductEditForm,
  filterProductDefinitions,
  formatProductPurity,
  groupProductDefinitionsByMetal,
  productPartiesWithBrand,
  safeDecimalString,
  validateProductDraft,
} from '../src/screens/products-model';

function product(overrides: Partial<ProductDefinition> = {}): ProductDefinition {
  return {
    id: 'product-1',
    name: 'PAMP Lady Fortuna 10g',
    metal: { code: 'XAU', name: 'Gold' },
    form: 'bar',
    brand: 'PAMP',
    country: 'CH',
    yearOrVersion: null,
    defaultPurity: '0.9999',
    defaultUnitWeightGrams: '10',
    defaultWeightUnit: 'g',
    active: true,
    source: 'USER',
    version: 1,
    ...overrides,
  };
}

describe('product definition model', () => {
  it('validates required fields and decimal ranges', () => {
    const valid = {
      name: 'PAMP 10g',
      metalCode: 'XAU',
      form: 'bar',
      purity: '0.9999',
      unitWeight: '10',
    };
    expect(validateProductDraft(valid)).toBeNull();
    expect(validateProductDraft({ ...valid, purity: '0' })).toContain('純度');
    expect(validateProductDraft({ ...valid, unitWeight: '-1' })).toContain('重量');
    expect(validateProductDraft({ ...valid, name: ' ' })).toContain('名稱');
  });

  it('searches by metal-specific form, brand and metal without mixing coin labels', () => {
    const gold = product();
    const goldCoin = product({ id: 'product-gold-coin', name: 'Gold Maple Leaf', form: 'coin' });
    const silverCoin = product({
      id: 'product-2',
      name: 'Silver Maple Leaf',
      metal: { code: 'XAG', name: 'Silver' },
      form: 'coin',
      brand: 'Royal Canadian Mint',
    });
    const silverBar = product({
      id: 'product-silver-bar',
      name: 'Silver kilo bar',
      metal: { code: 'XAG', name: 'Silver' },
      form: 'bar',
      brand: 'Metalor',
    });
    const products = [gold, goldCoin, silverCoin, silverBar];

    expect(filterProductDefinitions(products, '金幣')).toEqual([goldCoin]);
    expect(filterProductDefinitions(products, '銀幣')).toEqual([silverCoin]);
    expect(filterProductDefinitions(products, '銀條')).toEqual([silverBar]);
    expect(filterProductDefinitions(products, 'pamp')).toEqual([gold, goldCoin]);
    expect(filterProductDefinitions(products, 'xag')).toEqual([silverCoin, silverBar]);
  });

  it('groups gold and silver definitions separately in a stable order', () => {
    const silver = product({
      id: 'product-silver',
      metal: { code: 'XAG', name: 'Silver' },
    });
    const gold = product();

    expect(groupProductDefinitionsByMetal([silver, gold])).toEqual([
      expect.objectContaining({ metalCode: 'XAU', products: [gold] }),
      expect.objectContaining({ metalCode: 'XAG', products: [silver] }),
    ]);
  });

  it('formats valid decimal strings and refuses object-shaped API data without crashing', () => {
    expect(formatProductPurity('0.9999')).toBe('99.99%');
    expect(formatProductPurity({ s: 1, e: -1, d: [9999000] })).toBe('—');
    expect(safeDecimalString('1000.000000000')).toBe('1000');
    expect(safeDecimalString({ s: 1, e: 3, d: [1000] })).toBeNull();
  });
});

describe('buildProductPatch', () => {
  const PRODUCT = product();

  it('returns only changed fields plus version', () => {
    const form = emptyProductEditForm(PRODUCT);
    form.name = 'Renamed bar';

    const patch = buildProductPatch(PRODUCT, form);

    expect(patch).toEqual({ version: 1, name: 'Renamed bar' });
  });

  it('includes active change', () => {
    const form = emptyProductEditForm(PRODUCT);
    form.active = false;

    const patch = buildProductPatch(PRODUCT, form);

    expect(patch).toEqual({ version: 1, active: false });
  });

  it('treats equivalent purity formatting as a semantic no-op', () => {
    const equivalent = product({ defaultPurity: '0.9999' });
    const form = emptyProductEditForm(equivalent);
    form.purity = '0.99990';

    expect(buildProductPatch(equivalent, form)).toEqual({ version: 1 });
  });

  it('clears brand with empty string or null', () => {
    const withBrand = product({ brand: 'PAMP' });
    const form = emptyProductEditForm(withBrand);
    form.brand = '';

    const patch = buildProductPatch(withBrand, form);

    expect(patch).toHaveProperty('brand', null);
  });

  it('does not send unitWeight when weightUnitDirty is false', () => {
    const form = emptyProductEditForm(PRODUCT);
    form.unitWeight = '20';

    const patch = buildProductPatch(PRODUCT, form);

    expect(patch).not.toHaveProperty('unitWeight');
  });

  it('sends unitWeight when weightUnitDirty is true', () => {
    const form = emptyProductEditForm(PRODUCT);
    form.unitWeight = '20';
    form.weightUnitDirty = true;

    const patch = buildProductPatch(PRODUCT, form);

    expect(patch).toHaveProperty('unitWeight', '20');
  });

  it('converts troy oz grams back to oz for display', () => {
    const troyProduct = product({
      defaultUnitWeightGrams: '31.1034768',
      defaultWeightUnit: 'troy_oz',
    });
    const form = emptyProductEditForm(troyProduct);

    expect(form.unitWeight).toBe('1');
    expect(form.weightUnit).toBe('troy_oz');
  });

  it('converts g display to kg without changing canonical weight', () => {
    const kgProduct = product({ defaultUnitWeightGrams: '1000', defaultWeightUnit: 'g' });
    const form = emptyProductEditForm(kgProduct);

    expect(form.unitWeight).toBe('1000');
    expect(form.weightUnit).toBe('g');

    form.weightUnit = 'kg';

    const patch = buildProductPatch(kgProduct, form);

    expect(patch).toEqual({ version: 1, weightUnit: 'kg' });
  });

  it('sends unitWeight when magnitude edited in kg', () => {
    const kgProduct = product({ defaultUnitWeightGrams: '1000', defaultWeightUnit: 'g' });
    const form = emptyProductEditForm(kgProduct);
    form.weightUnit = 'kg';
    form.unitWeight = '2';
    form.weightUnitDirty = true;

    const patch = buildProductPatch(kgProduct, form);

    expect(patch).toHaveProperty('unitWeight', '2');
    expect(patch).toHaveProperty('weightUnit', 'kg');
  });

  it('converts 1000g display to troy oz', () => {
    const troyProduct = product({ defaultUnitWeightGrams: '1000', defaultWeightUnit: 'g' });
    const form = emptyProductEditForm(troyProduct);

    form.weightUnit = 'troy_oz';
    const patch = buildProductPatch(troyProduct, form);

    expect(patch).toEqual({ version: 1, weightUnit: 'troy_oz' });
  });

  it('sends raw magnitude when edited magnitude in troy_oz', () => {
    const troyProduct = product({ defaultUnitWeightGrams: '31.1034768', defaultWeightUnit: 'g' });
    const form = emptyProductEditForm(troyProduct);
    form.weightUnit = 'troy_oz';
    form.unitWeight = '2';
    form.weightUnitDirty = true;

    const patch = buildProductPatch(troyProduct, form);

    expect(patch).toHaveProperty('unitWeight', '2');
    expect(patch).toHaveProperty('weightUnit', 'troy_oz');
  });

  it('sends raw magnitude when edited magnitude in g (default unit)', () => {
    const form = emptyProductEditForm(PRODUCT);
    form.unitWeight = '20';
    form.weightUnitDirty = true;

    const patch = buildProductPatch(PRODUCT, form);

    expect(patch).toHaveProperty('unitWeight', '20');
    expect(patch).not.toHaveProperty('weightUnit');
  });

  it('no drift when retyping same displayed value in original unit', () => {
    const form = emptyProductEditForm(PRODUCT);
    form.unitWeight = '10';
    form.weightUnitDirty = true;

    const patch = buildProductPatch(PRODUCT, form);

    expect(patch).toEqual({ version: 1 });
  });

  it('no drift when retyping same displayed value after unit switch', () => {
    const kgProduct = product({ defaultUnitWeightGrams: '1000', defaultWeightUnit: 'g' });
    const form = emptyProductEditForm(kgProduct);
    form.weightUnit = 'kg';
    form.unitWeight = '1';
    form.weightUnitDirty = true;

    const patch = buildProductPatch(kgProduct, form);

    expect(patch).toEqual({ version: 1, weightUnit: 'kg' });
  });
});

describe('convertWeightDisplay', () => {
  it('converts 1000 g to 1 kg', () => {
    expect(convertWeightDisplay('1000', 'g', 'kg')).toBe('1');
  });

  it('converts 1000 g to 32.150746569 troy oz', () => {
    expect(convertWeightDisplay('1000', 'g', 'troy_oz')).toBe('32.150746569');
  });

  it('returns same for identical units', () => {
    expect(convertWeightDisplay('100', 'g', 'g')).toBe('100');
  });

  it('handles zero', () => {
    expect(convertWeightDisplay('0', 'g', 'kg')).toBe('0');
  });
});

describe('productPartiesWithBrand', () => {
  it('replaces the brand while preserving all other organization attributions', () => {
    const withOrganizations = product({
      organizations: [
        {
          id: 'party-brand',
          role: 'BRAND',
          isPrimary: true,
          attributionStatus: 'VERIFIED',
          organization: {
            id: 'org-old-brand',
            canonicalName: 'Old brand',
            countryCode: 'CH',
            verified: true,
          },
        },
        {
          id: 'party-mint',
          role: 'MINT',
          isPrimary: true,
          attributionStatus: 'VERIFIED',
          organization: {
            id: 'org-mint',
            canonicalName: 'Historic Mint',
            countryCode: 'GB',
            verified: true,
          },
        },
      ],
    });

    expect(productPartiesWithBrand(withOrganizations, 'org-new-brand')).toEqual([
      {
        organizationId: 'org-mint',
        role: 'MINT',
        isPrimary: true,
        attributionStatus: 'VERIFIED',
      },
      {
        organizationId: 'org-new-brand',
        role: 'BRAND',
        isPrimary: true,
        attributionStatus: 'DECLARED',
      },
    ]);
  });

  it('can clear a brand without deleting non-brand parties', () => {
    const withOrganizations = product({
      organizations: [
        {
          id: 'party-brand',
          role: 'BRAND',
          isPrimary: true,
          attributionStatus: 'USER_REPORTED',
          organization: {
            id: 'org-brand',
            canonicalName: 'Brand',
            countryCode: null,
            verified: false,
          },
        },
        {
          id: 'party-assayer',
          role: 'ASSAYER',
          isPrimary: false,
          attributionStatus: 'DECLARED',
          organization: {
            id: 'org-assayer',
            canonicalName: 'Assayer',
            countryCode: null,
            verified: false,
          },
        },
      ],
    });

    expect(productPartiesWithBrand(withOrganizations, null)).toEqual([
      {
        organizationId: 'org-assayer',
        role: 'ASSAYER',
        isPrimary: false,
        attributionStatus: 'DECLARED',
      },
    ]);
  });
});
