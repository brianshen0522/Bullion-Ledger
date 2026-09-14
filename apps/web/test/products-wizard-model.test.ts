import { describe, expect, it } from 'vitest';

import {
  buildProductCreateBody,
  newProductWizardForm,
  productWizardFormFrom,
  validateProductStep,
} from '../src/screens/products-model.js';
import type { ProductDefinition } from '../src/api.js';

const product = {
  id: 'p1',
  name: 'PAMP 10g 金條',
  metal: { code: 'XAU', name: 'Gold' },
  form: 'bar',
  brand: 'PAMP',
  country: 'CH',
  yearOrVersion: '2026',
  defaultPurity: '0.9999',
  defaultUnitWeightGrams: '10',
  defaultWeightUnit: 'g',
  active: true,
  source: 'USER',
  version: 3,
} as ProductDefinition;

describe('product wizard form', () => {
  it('seeds a new specification with a usable default', () => {
    const form = newProductWizardForm('XAU');
    expect(form.metalCode).toBe('XAU');
    expect(validateProductStep(form, 'spec')).toBeNull();
    // The name is the one thing that cannot be defaulted.
    expect(validateProductStep(form, 'basics')).toContain('名稱');
  });

  it('seeds an edit from the stored specification, in its own weight unit', () => {
    const form = productWizardFormFrom(product);
    expect(form).toMatchObject({
      metalCode: 'XAU',
      name: 'PAMP 10g 金條',
      brand: 'PAMP',
      unitWeight: '10',
      weightUnit: 'g',
    });
  });
});

describe('per-step validation', () => {
  /**
   * A wizard that validates everything on step one stops the user with a
   * complaint about a field they have not reached. Each step answers only for
   * its own fields; the review step answers for all of them.
   */
  it('does not fault a later step from an earlier one', () => {
    const form = { ...newProductWizardForm('XAU'), name: '金條', purity: 'nonsense' };
    expect(validateProductStep(form, 'basics')).toBeNull();
    expect(validateProductStep(form, 'origin')).toBeNull();
    expect(validateProductStep(form, 'spec')).not.toBeNull();
    expect(validateProductStep(form, 'review')).not.toBeNull();
  });

  it('treats brand, country and year as optional', () => {
    const form = { ...newProductWizardForm('XAU'), name: '金條' };
    expect(form.brand).toBe('');
    expect(validateProductStep(form, 'origin')).toBeNull();
    expect(validateProductStep(form, 'review')).toBeNull();
  });

  it('rejects a purity or weight outside the stored range', () => {
    const base = { ...newProductWizardForm('XAU'), name: '金條' };
    expect(validateProductStep({ ...base, purity: '1.5' }, 'spec')).not.toBeNull();
    expect(validateProductStep({ ...base, purity: '0' }, 'spec')).not.toBeNull();
    expect(validateProductStep({ ...base, unitWeight: '0' }, 'spec')).not.toBeNull();
  });
});

describe('buildProductCreateBody', () => {
  it('omits the optional attributions it has no value for', () => {
    const form = { ...newProductWizardForm('XAU'), name: '金條' };
    expect(buildProductCreateBody(form, null)).toEqual({
      name: '金條',
      metalCode: 'XAU',
      form: 'bar',
      parties: undefined,
      country: undefined,
      yearOrVersion: undefined,
      purity: '0.9999',
      unitWeight: '1',
      weightUnit: 'g',
    });
  });

  it('attaches a chosen brand as the primary BRAND attribution', () => {
    const form = { ...newProductWizardForm('XAU'), name: '金條', country: 'CH' };
    expect(buildProductCreateBody(form, 'org-1')).toMatchObject({
      country: 'CH',
      parties: [
        {
          organizationId: 'org-1',
          role: 'BRAND',
          isPrimary: true,
          attributionStatus: 'DECLARED',
        },
      ],
    });
  });
});
