import { describe, expect, it } from 'vitest';

import type { HeldAssetListItem } from '../src/api';
import {
  assetPhotoReadPath,
  buildAssetPatch,
  emptyAssetEditForm,
  filterHeldAssets,
  heldUnitCount,
  validateAssetEditForm,
} from '../src/screens/assets-model';

function asset(overrides: Partial<HeldAssetListItem> = {}): HeldAssetListItem {
  return {
    id: 'asset-1',
    productDefinitionId: null,
    status: 'HELD',
    name: 'PAMP Lady Fortuna 10g',
    metal: { code: 'XAU', name: 'Gold' },
    form: 'bar',
    brand: 'PAMP',
    country: null,
    yearOrVersion: null,
    quantity: 2,
    unitWeightGrams: '10',
    grossWeightGrams: '20',
    purity: '0.9999',
    fineWeightGrams: '19.998',
    allocatedCost: '51500',
    currency: 'TWD',
    serial: 'AU-123',
    storageLocation: '保險箱 A',
    acquiredAt: '2026-07-27T08:00:00.000Z',
    packagingState: 'assay card',
    hasCertificate: true,
    coverPhoto: null,
    version: 27,
    updatedAt: '2026-07-27T08:00:00.000Z',
    purchase: { purchasedAt: '2026-07-27T08:00:00.000Z', dealerName: 'Taipei Bullion' },
    ...overrides,
  };
}

describe('inventory filters', () => {
  const gold = asset();
  const silver = asset({
    id: 'asset-2',
    name: 'Silver coin',
    metal: { code: 'XAG', name: 'Silver' },
    brand: null,
    serial: null,
    storageLocation: '抽屜 B',
    quantity: 1,
    purchase: { purchasedAt: '2026-07-27T08:00:00.000Z', dealerName: 'Silver Dealer' },
  });

  it.each(['pamp', 'AU-123', '保險箱', 'taipei bullion'])(
    'searches all useful inventory fields with %s',
    (query) => {
      expect(filterHeldAssets([gold, silver], { query, metalCode: '' })).toEqual([gold]);
    },
  );

  it('combines metal and text filters', () => {
    expect(filterHeldAssets([gold, silver], { query: 'coin', metalCode: 'XAG' })).toEqual([silver]);
    expect(filterHeldAssets([gold, silver], { query: 'pamp', metalCode: 'XAG' })).toEqual([]);
  });

  it('counts physical units separately from lots', () => {
    expect(heldUnitCount([gold, silver])).toBe(3);
  });
});

describe('asset photo URLs', () => {
  it('builds an encoded authenticated read path for the selected revision', () => {
    expect(
      assetPhotoReadPath({
        attachmentId: 'photo/id with spaces',
        variant: 'CROPPED',
        revision: 7,
        mime: 'image/jpeg',
        width: 1200,
        height: 800,
      }),
    ).toBe('/attachments/photo%2Fid%20with%20spaces/url?variant=CROPPED&revision=7');
  });
});

describe('buildAssetPatch', () => {
  const ASSET = asset();

  it('returns only changed fields plus version', () => {
    const form = emptyAssetEditForm(ASSET);
    form.serial = 'NEW-SERIAL';

    const patch = buildAssetPatch(ASSET, form);

    expect(patch).toEqual({ version: 27, serial: 'NEW-SERIAL' });
  });

  it('sends unitWeight and weightUnit=g when weight changes', () => {
    const form = emptyAssetEditForm(ASSET);
    form.unitWeight = '15';
    form.weightUnitDirty = true;

    const patch = buildAssetPatch(ASSET, form);

    expect(patch).toHaveProperty('unitWeight', '15');
    expect(patch).toHaveProperty('weightUnit', 'g');
  });

  it('validates quantity must be positive integer', () => {
    expect(
      validateAssetEditForm({
        quantity: '0',
        unitWeight: '10',
        weightUnitDirty: false,
        purity: '0.999',
        allocatedCost: '100',
        serial: '',
        storageLocation: '',
      }),
    ).toContain('1,000,000');
    expect(
      validateAssetEditForm({
        quantity: '-1',
        unitWeight: '10',
        weightUnitDirty: false,
        purity: '0.999',
        allocatedCost: '100',
        serial: '',
        storageLocation: '',
      }),
    ).toContain('1,000,000');
    expect(
      validateAssetEditForm({
        quantity: '1.5',
        unitWeight: '10',
        weightUnitDirty: false,
        purity: '0.999',
        allocatedCost: '100',
        serial: '',
        storageLocation: '',
      }),
    ).toContain('1,000,000');
  });

  it('validates unitWeight > 0', () => {
    expect(
      validateAssetEditForm({
        quantity: '1',
        unitWeight: '0',
        weightUnitDirty: false,
        purity: '0.999',
        allocatedCost: '100',
        serial: '',
        storageLocation: '',
      }),
    ).toContain('重量');
    expect(
      validateAssetEditForm({
        quantity: '1',
        unitWeight: '-1',
        weightUnitDirty: false,
        purity: '0.999',
        allocatedCost: '100',
        serial: '',
        storageLocation: '',
      }),
    ).toContain('重量');
  });

  it('validates purity in (0,1]', () => {
    expect(
      validateAssetEditForm({
        quantity: '1',
        unitWeight: '10',
        weightUnitDirty: false,
        purity: '0',
        allocatedCost: '100',
        serial: '',
        storageLocation: '',
      }),
    ).toContain('純度');
    expect(
      validateAssetEditForm({
        quantity: '1',
        unitWeight: '10',
        weightUnitDirty: false,
        purity: '1.1',
        allocatedCost: '100',
        serial: '',
        storageLocation: '',
      }),
    ).toContain('純度');
  });

  it('validates cost >= 0', () => {
    expect(
      validateAssetEditForm({
        quantity: '1',
        unitWeight: '10',
        weightUnitDirty: false,
        purity: '0.999',
        allocatedCost: '-1',
        serial: '',
        storageLocation: '',
      }),
    ).toContain('成本');
  });

  it('rejects blank allocatedCost', () => {
    expect(
      validateAssetEditForm({
        quantity: '1',
        unitWeight: '10',
        weightUnitDirty: false,
        purity: '0.999',
        allocatedCost: '',
        serial: '',
        storageLocation: '',
      }),
    ).toContain('成本');
  });

  it('passes a valid form', () => {
    expect(
      validateAssetEditForm({
        quantity: '1',
        unitWeight: '10',
        weightUnitDirty: false,
        purity: '0.999',
        allocatedCost: '100',
        serial: '',
        storageLocation: '',
      }),
    ).toBeNull();
  });

  it('enforces the API length limits for serial and storage location', () => {
    const form = emptyAssetEditForm(ASSET);
    form.serial = 'S'.repeat(129);
    expect(validateAssetEditForm(form)).toContain('序號');

    form.serial = '';
    form.storageLocation = 'L'.repeat(129);
    expect(validateAssetEditForm(form)).toContain('存放位置');
  });
});
