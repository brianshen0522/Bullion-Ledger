import { describe, expect, it } from 'vitest';

import { computeLinePreview } from '../src/screens/purchase-preview.js';

describe('computeLinePreview', () => {
  it('renders gross and fine grams for troy oz input', () => {
    const out = computeLinePreview(
      {
        name: 'Bar',
        metalCode: 'XAU',
        form: 'bar',
        quantity: '2',
        unitWeight: '1',
        weightUnit: 'troy_oz',
        purity: '0.9999',
        lineSubtotal: '0',
        manualAmount: '',
      },
      [],
    );
    expect(out).toContain('62.207 g gross');
    expect(out).toContain('62.2007 g fine');
  });

  it('reports an error message for invalid input', () => {
    const out = computeLinePreview(
      {
        name: 'X',
        metalCode: 'XAU',
        form: 'bar',
        quantity: '1.5',
        unitWeight: '1',
        weightUnit: 'g',
        purity: '0.9999',
        lineSubtotal: '0',
        manualAmount: '',
      },
      [],
    );
    expect(out).toBe('Invalid quantity');
  });
});
