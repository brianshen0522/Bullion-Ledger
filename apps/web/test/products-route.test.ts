import { describe, expect, it } from 'vitest';

import {
  FIRST_PRODUCT_STEP,
  NEW_PRODUCT,
  PRODUCT_WIZARD_STEPS,
  isProductWizardStep,
  nextProductStep,
  previousProductStep,
  productStepIndex,
  productStepLabel,
  readProductsView,
  urlForProductsView,
} from '../src/screens/products-route.js';
import { urlForScreen } from '../src/screen-navigation.js';

describe('product wizard URL state', () => {
  it('reads the list, a new specification, and one being edited', () => {
    expect(readProductsView('')).toEqual({ kind: 'list' });
    expect(readProductsView(`?product=${NEW_PRODUCT}&productStep=spec`)).toEqual({
      kind: 'create',
      step: 'spec',
    });
    expect(readProductsView('?product=p1&productStep=origin')).toEqual({
      kind: 'edit',
      productId: 'p1',
      step: 'origin',
    });
  });

  it('opens an unrecognised or missing step at the beginning', () => {
    expect(readProductsView('?product=p1')).toEqual({
      kind: 'edit',
      productId: 'p1',
      step: FIRST_PRODUCT_STEP,
    });
    expect(readProductsView('?product=p1&productStep=nonsense')).toEqual({
      kind: 'edit',
      productId: 'p1',
      step: FIRST_PRODUCT_STEP,
    });
  });

  it('round-trips a view and preserves unrelated state', () => {
    const base = '/app?screen=products&q=gold#top';
    const create = urlForProductsView(base, { kind: 'create', step: 'basics' });
    expect(create).toBe('/app?screen=products&q=gold&product=new&productStep=basics#top');
    expect(urlForProductsView(create, { kind: 'list' })).toBe(base);
  });

  it('leaves no wizard state behind when the user changes screen', () => {
    expect(urlForScreen('/app?screen=products&product=new&productStep=spec', 'dashboard')).toBe(
      '/app',
    );
  });

  it('walks the whole step sequence in both directions', () => {
    expect(productStepIndex(FIRST_PRODUCT_STEP)).toBe(0);
    expect(previousProductStep(FIRST_PRODUCT_STEP)).toBeNull();
    const last = PRODUCT_WIZARD_STEPS[PRODUCT_WIZARD_STEPS.length - 1]!.id;
    expect(nextProductStep(last)).toBeNull();
    expect(nextProductStep('basics')).toBe('origin');
    expect(previousProductStep('review')).toBe('spec');
  });

  it('labels a step and rejects anything that is not one', () => {
    expect(productStepLabel('spec')).toBe('純度與重量');
    expect(isProductWizardStep('spec')).toBe(true);
    expect(isProductWizardStep('specs')).toBe(false);
  });
});
