import { describe, expect, it } from 'vitest';

import {
  ORGANIZATION_ALIASES_V1,
  ORGANIZATION_CATALOG_VERSION,
  ORGANIZATIONS_V1,
} from '../prisma/catalog/organizations.v1';
import { normalizeOrganizationName } from '../src/organizations/organization-normalization';

describe('organization catalog fixtures', () => {
  it('is versioned, broad, and has stable unique keys', () => {
    expect(ORGANIZATION_CATALOG_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/);
    expect(ORGANIZATIONS_V1.length).toBeGreaterThanOrEqual(80);
    expect(ORGANIZATION_ALIASES_V1.length).toBeGreaterThanOrEqual(120);
    expect(new Set(ORGANIZATIONS_V1.map(({ seedKey }) => seedKey))).toHaveLength(
      ORGANIZATIONS_V1.length,
    );
    expect(new Set(ORGANIZATION_ALIASES_V1.map(({ seedKey }) => seedKey))).toHaveLength(
      ORGANIZATION_ALIASES_V1.length,
    );
  });

  it('contains the required Taiwan, global, and historical search names', () => {
    const names = new Set(ORGANIZATION_ALIASES_V1.map(({ name }) => name));
    for (const expected of [
      'PAMP',
      'UBS',
      'Argor Heraeus',
      'Credit Suisse',
      'Royal Mint',
      'Perth Mint',
      '中央造幣廠',
      '臺灣銀行',
      '第一銀行',
      '兆豐銀行',
      '合作金庫',
      'Johnson Matthey plc',
    ]) {
      expect(names.has(expected), expected).toBe(true);
    }
  });
});

describe('organization name normalization', () => {
  it('normalizes width, case, punctuation, whitespace, and keeps CJK text', () => {
    expect(normalizeOrganizationName('  ＭＫＳ—PAMP  SA ')).toBe('mks pamp sa');
    expect(normalizeOrganizationName('臺灣銀行（黃金）')).toBe('臺灣銀行 黃金');
  });
});
