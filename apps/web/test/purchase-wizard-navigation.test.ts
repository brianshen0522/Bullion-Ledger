import { describe, expect, it } from 'vitest';

import { readWizardStepFromSearch, urlForWizardStep } from '../src/purchase-wizard/history.js';
import {
  filterOrganizations,
  normalizeOrganizationSearch,
  replacePrimaryBrandAssignment,
} from '../src/purchase-wizard/organization-search.js';
import type { WizardOrganizationAssignment } from '../src/purchase-wizard/types.js';

describe('purchase wizard URL state', () => {
  it('reads only known steps and preserves unrelated query/hash state', () => {
    expect(readWizardStepFromSearch('?purchaseStep=documents')).toBe('documents');
    expect(readWizardStepFromSearch('?purchaseStep=admin')).toBeNull();
    expect(urlForWizardStep('/app?tab=purchases#top', 'items')).toBe(
      '/app?tab=purchases&purchaseStep=items#top',
    );
  });
});

describe('organization search', () => {
  const organizations = [
    {
      id: 'pamp',
      canonicalName: 'MKS PAMP SA',
      aliases: ['PAMP Suisse', 'PAMP'],
      capabilities: ['REFINER' as const],
    },
    {
      id: 'ubs',
      canonicalName: 'UBS AG',
      aliases: ['Union Bank of Switzerland'],
      capabilities: ['ISSUER' as const],
    },
  ];

  it('normalizes full-width characters, punctuation, case, and whitespace', () => {
    expect(normalizeOrganizationSearch('  ＭＫＳ–PAMP,  S.A. ')).toBe('mks pamp s a');
  });

  it('matches aliases without treating UBS as a refiner', () => {
    expect(filterOrganizations(organizations, 'pamp', 'BRAND').map(({ id }) => id)).toEqual([
      'pamp',
    ]);
    expect(filterOrganizations(organizations, 'union bank', 'ISSUER').map(({ id }) => id)).toEqual([
      'ubs',
    ]);
    expect(filterOrganizations(organizations, 'ubs', 'REFINER')).toEqual([]);
  });

  it('replaces every old brand while preserving non-brand sources', () => {
    const assignments: WizardOrganizationAssignment[] = [
      {
        id: 'old-brand',
        displayName: 'Legacy brand',
        role: 'BRAND',
        isPrimary: true,
        custom: true,
      },
      {
        id: 'mint',
        organizationId: 'org-mint',
        displayName: 'Royal Mint',
        role: 'MINT',
        isPrimary: true,
        custom: false,
      },
    ];

    const replaced = replacePrimaryBrandAssignment(assignments, {
      organizationId: 'org-pamp',
      displayName: 'MKS PAMP SA',
      custom: false,
    });

    expect(replaced).toEqual([
      expect.objectContaining({
        organizationId: 'org-pamp',
        displayName: 'MKS PAMP SA',
        role: 'BRAND',
        isPrimary: true,
      }),
      assignments[1],
    ]);
    expect(replacePrimaryBrandAssignment(replaced, null)).toEqual([assignments[1]]);
  });
});
