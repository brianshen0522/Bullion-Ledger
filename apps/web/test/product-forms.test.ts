import { describe, expect, it } from 'vitest';

import { productFormLabel, productFormOptions } from '../src/product-forms';

describe('metal-aware product form labels', () => {
  it.each([
    ['bar', 'XAU', '金條／金塊'],
    ['bar', 'XAG', '銀條／銀塊'],
    ['coin', 'XAU', '金幣'],
    ['coin', 'XAG', '銀幣'],
  ])('labels %s for %s as %s', (form, metalCode, expected) => {
    expect(productFormLabel(form, metalCode)).toBe(expected);
  });

  it('uses neutral labels when the metal is not known', () => {
    expect(productFormLabel('bar')).toBe('條／塊');
    expect(productFormLabel('coin', 'XPT')).toBe('幣');
  });

  it('builds independent gold and silver options', () => {
    expect(productFormOptions('XAU')).toContainEqual(['coin', '金幣']);
    expect(productFormOptions('XAG')).toContainEqual(['bar', '銀條／銀塊']);
    expect(productFormOptions('XAG')).toContainEqual(['coin', '銀幣']);
  });
});
