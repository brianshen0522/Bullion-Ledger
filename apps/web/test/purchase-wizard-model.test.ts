import { describe, expect, it } from 'vitest';

import {
  addWizardItem,
  applyProductToItem,
  buildWizardPurchasePayload,
  createEmptyWizardItem,
  createPurchaseWizardDraft,
  deriveSubtotal,
  moveWizardItem,
  normalizePrimaryWizardPhotos,
  removeWizardItem,
  resolveCosts,
  retargetWizardPhoto,
  setPrimaryWizardPhoto,
} from '../src/purchase-wizard/model.js';
import {
  validateCostsStep,
  validateEntireWizard,
  validateItemsStep,
  validateTransactionStep,
  validateWizardStep,
} from '../src/purchase-wizard/validation.js';
import type { PurchaseWizardDraft, WizardMedia } from '../src/purchase-wizard/types.js';

function validDraft(): PurchaseWizardDraft {
  const draft = createPurchaseWizardDraft({
    now: new Date(2026, 6, 28, 9, 30),
    draftId: 'draft-1',
    itemId: 'item-1',
    metalCode: 'XAU',
  });
  draft.items[0] = {
    ...draft.items[0]!,
    name: 'PAMP Gold Bar',
    form: 'bar',
    quantity: '1',
    unitWeight: '1',
    weightUnit: 'troy_oz',
    purity: '0.9999',
    lineSubtotal: '100.00',
    organizations: [
      {
        id: 'party-pamp',
        organizationId: 'org-pamp',
        displayName: 'MKS PAMP SA',
        role: 'BRAND',
        isPrimary: true,
        custom: false,
      },
    ],
  };
  draft.costs.subtotal = '100.00';
  return draft;
}

describe('purchase wizard model', () => {
  it('keeps exactly one primary photo for every target item', () => {
    const photo = (id: string, targetItemId: string, isPrimary?: boolean): WizardMedia => ({
      id,
      kind: 'ASSET_PHOTO',
      source: 'CAMERA',
      targetItemId,
      isPrimary,
      attachmentType: 'front',
      filename: `${id}.jpg`,
      mime: 'image/jpeg',
      sizeBytes: 10,
      needsReselection: false,
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    const normalized = normalizePrimaryWizardPhotos([
      photo('a', 'item-1'),
      photo('b', 'item-1'),
      photo('c', 'item-2', true),
      photo('d', 'item-2', true),
    ]);

    expect(normalized.filter(({ isPrimary }) => isPrimary).map(({ id }) => id)).toEqual(['a', 'c']);

    const selected = setPrimaryWizardPhoto(normalized, 'b');
    expect(selected.filter(({ isPrimary }) => isPrimary).map(({ id }) => id)).toEqual(['b', 'c']);

    const retargeted = retargetWizardPhoto(selected, 'b', 'item-2');
    expect(retargeted.filter(({ isPrimary }) => isPrimary).map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('keeps stable item identities while adding, moving, and removing items', () => {
    let draft = validDraft();
    draft = addWizardItem(draft, createEmptyWizardItem('XAG', 'item-2'));
    draft.photos = [
      {
        id: 'photo-1',
        kind: 'ASSET_PHOTO',
        source: 'CAMERA',
        targetItemId: 'item-1',
        filename: 'front.jpg',
        mime: 'image/jpeg',
        sizeBytes: 10,
        needsReselection: false,
        createdAt: '2026-07-28T00:00:00.000Z',
      },
    ];

    draft = moveWizardItem(draft, 'item-2', -1);
    expect(draft.items.map(({ id }) => id)).toEqual(['item-2', 'item-1']);

    draft = removeWizardItem(draft, 'item-1');
    expect(draft.items.map(({ id }) => id)).toEqual(['item-2']);
    expect(draft.photos[0]?.targetItemId).toBeUndefined();
  });

  it('applies catalog defaults and preserves the catalog brand as a role', () => {
    const item = createEmptyWizardItem('XAU', 'item-1');
    const next = applyProductToItem(item, {
      id: 'product-pamp-1oz',
      name: 'PAMP Gold Bar 1 oz',
      metalCode: 'XAU',
      form: 'bar',
      brand: 'PAMP',
      country: 'CH',
      yearOrVersion: 'Lady Fortuna',
      defaultPurity: '0.9999',
      defaultUnitWeightGrams: '31.1034768',
      defaultWeightUnit: 'troy_oz',
      organizations: [],
    });

    expect(next.productDefinitionId).toBe('product-pamp-1oz');
    expect(next.unitWeight).toBe('1');
    expect(next.country).toBe('CH');
    expect(next.yearOrVersion).toBe('Lady Fortuna');
    expect(next.organizations).toEqual([
      expect.objectContaining({ displayName: 'PAMP', role: 'BRAND', isPrimary: true }),
    ]);

    const draft = validDraft();
    draft.items[0] = {
      ...next,
      productDefinitionId: '',
      name: 'Customized PAMP Gold Bar',
      lineSubtotal: '100.00',
    };
    expect(buildWizardPurchasePayload(draft).items[0]).toMatchObject({
      brand: 'PAMP',
      parties: [
        expect.objectContaining({
          displayName: 'PAMP',
          role: 'BRAND',
          isPrimary: true,
        }),
      ],
    });
  });

  it('normalizes tiny catalog decimals into purchase DTO-compatible fixed notation', () => {
    const next = applyProductToItem(createEmptyWizardItem('XAU', 'item-1'), {
      id: 'product-minimum-values',
      name: 'Tiny assay sample',
      metalCode: 'XAU',
      form: 'other',
      defaultPurity: '1e-7',
      defaultUnitWeightGrams: '1e-9',
      defaultWeightUnit: 'g',
      organizations: [],
    });
    const draft = validDraft();
    draft.items[0] = { ...next, lineSubtotal: '100.00' };

    expect(next.purity).toBe('0.0000001');
    expect(next.unitWeight).toBe('0.000000001');
    expect(validateItemsStep(draft)).toEqual([]);
    expect(buildWizardPurchasePayload(draft).items[0]).toMatchObject({
      purity: '0.0000001',
      unitWeight: '0.000000001',
    });
  });

  it('rounds repeating catalog unit conversions to the accepted weight scale', () => {
    const next = applyProductToItem(createEmptyWizardItem('XAU', 'item-1'), {
      id: 'product-kilo-in-ounces',
      name: 'Imported kilo template',
      metalCode: 'XAU',
      form: 'bar',
      defaultPurity: '0.9999',
      defaultUnitWeightGrams: '1000',
      defaultWeightUnit: 'troy_oz',
      organizations: [],
    });
    const draft = validDraft();
    draft.items[0] = { ...next, lineSubtotal: '100.00' };

    expect(next.unitWeight).toBe('32.150746569');
    expect(validateItemsStep(draft)).toEqual([]);
  });

  it('builds the purchase DTO with linked and custom organization snapshots', () => {
    const draft = validDraft();
    draft.transaction.paymentMethod = '信用卡';
    draft.items[0]!.organizations.push({
      id: 'party-ubs',
      organizationId: 'org-ubs',
      displayName: 'UBS',
      role: 'ISSUER',
      isPrimary: false,
      custom: false,
    });
    draft.items[0]!.organizations.push({
      id: 'party-custom',
      displayName: '地方小型鑄造廠',
      role: 'MANUFACTURER',
      isPrimary: false,
      custom: true,
    });
    const payload = buildWizardPurchasePayload(draft);

    expect(new Date(payload.purchasedAt).getTime()).toBe(
      new Date(draft.transaction.purchasedAt).getTime(),
    );
    expect(payload.paymentMethod).toBe('信用卡');
    expect(payload.items[0]).toMatchObject({
      brand: 'MKS PAMP SA',
      metalCode: 'XAU',
      quantity: 1,
      lineSubtotal: '100.00',
      parties: [
        {
          organizationId: 'org-pamp',
          role: 'BRAND',
          isPrimary: true,
          attributionStatus: 'USER_REPORTED',
        },
        {
          organizationId: 'org-ubs',
          role: 'ISSUER',
          isPrimary: false,
          attributionStatus: 'USER_REPORTED',
        },
        {
          role: 'MANUFACTURER',
          displayName: '地方小型鑄造廠',
          isPrimary: false,
          attributionStatus: 'USER_REPORTED',
        },
      ],
    });
    expect(payload.items[0]?.manualAmount).toBeUndefined();
    expect(JSON.stringify(payload.items[0])).not.toContain('manualAmount');
  });

  it('does not send editable parties for an authoritative catalog product', () => {
    const draft = validDraft();
    draft.items[0]!.productDefinitionId = 'product-pamp-1oz';

    expect(buildWizardPurchasePayload(draft).items[0]?.parties).toBeUndefined();
  });

  it('tracks productDefinitionVersion from applied product', () => {
    const result = applyProductToItem(createEmptyWizardItem('XAU', 'item-1'), {
      id: 'product-v1',
      version: 3,
      name: 'Versioned product',
      metalCode: 'XAU',
      form: 'bar',
      defaultPurity: '0.9999',
      defaultUnitWeightGrams: '31.1035',
      defaultWeightUnit: 'g',
      organizations: [],
    });

    expect(result.productDefinitionId).toBe('product-v1');
    expect(result.productDefinitionVersion).toBe(3);
  });

  it('clears productDefinitionVersion when productDefinitionId is empty (custom)', () => {
    const payload = buildWizardPurchasePayload({
      ...validDraft(),
      items: validDraft().items.map((item) => ({
        ...item,
        productDefinitionId: '',
        productDefinitionVersion: undefined,
      })),
    });

    expect(payload.items[0]!.productDefinitionVersion).toBeUndefined();
    expect(payload.items[0]!.productDefinitionId).toBeUndefined();
  });
});

describe('purchase wizard step validation', () => {
  it('validates only the active step until review', () => {
    const draft = createPurchaseWizardDraft({ metalCode: 'XAU', itemId: 'item-1' });
    expect(validateTransactionStep(draft)).toEqual([]);
    expect(validateWizardStep(draft, 'photos')).toEqual([]);
    expect(validateItemsStep(draft)).toEqual([
      expect.objectContaining({ path: 'items.item-1.name' }),
    ]);
    expect(validateEntireWizard(draft).length).toBeGreaterThan(0);
  });

  it('rejects an overlong legacy payment method before the API request', () => {
    const draft = validDraft();
    draft.transaction.paymentMethod = 'x'.repeat(65);

    expect(validateTransactionStep(draft)).toContainEqual(
      expect.objectContaining({ path: 'transaction.paymentMethod' }),
    );
  });

  it('accepts a complete draft and derives the subtotal from the lines', () => {
    const draft = validDraft();
    expect(validateEntireWizard(draft)).toEqual([]);

    // The transaction subtotal is no longer typed, so changing a line can never
    // put the form out of balance — it simply changes the derived total.
    draft.items[0]!.lineSubtotal = '99.99';
    expect(validateCostsStep(draft)).toEqual([]);
    expect(deriveSubtotal(draft.items)?.toFixed(2)).toBe('99.99');
    expect(resolveCosts(draft).subtotal).toBe('99.99');
  });

  it('sums every line into the derived subtotal', () => {
    const draft = validDraft();
    draft.items = [
      { ...draft.items[0]!, id: 'item-1', lineSubtotal: '100.00' },
      { ...draft.items[0]!, id: 'item-2', lineSubtotal: '250.50' },
    ];
    expect(deriveSubtotal(draft.items)?.toFixed(2)).toBe('350.50');
  });

  it('zeroes itemized-only charges in simple mode so stale values cannot leak', () => {
    const draft = validDraft();
    draft.costs.mode = 'ITEMIZED';
    draft.costs.premium = '25.00';
    draft.costs.tax = '5.00';
    expect(resolveCosts(draft).premium).toBe('25.00');

    // Switching back must not submit a premium the user can no longer see.
    draft.costs.mode = 'SIMPLE';
    const resolved = resolveCosts(draft);
    expect(resolved.premium).toBe('0');
    expect(resolved.tax).toBe('0');
    expect(resolved.shipping).toBe(draft.costs.shipping);
  });

  it('rejects wire formats the API DTO cannot accept', () => {
    const draft = validDraft();
    draft.items[0]!.unitWeight = '1e2';
    draft.items[0]!.purity = '9.999e-1';
    // Premium is only asked for — and therefore only validated — when itemized.
    draft.costs.mode = 'ITEMIZED';
    draft.costs.premium = '0.001';

    expect(validateItemsStep(draft).map(({ path }) => path)).toEqual(
      expect.arrayContaining(['items.item-1.unitWeight', 'items.item-1.purity']),
    );
    expect(validateCostsStep(draft)).toContainEqual(
      expect.objectContaining({ path: 'costs.premium' }),
    );
  });

  it('does not complain about itemized charges the simple form never showed', () => {
    const draft = validDraft();
    draft.costs.mode = 'SIMPLE';
    // A stale value from an earlier itemized visit must not block submission.
    draft.costs.premium = '0.001';

    expect(validateCostsStep(draft)).toEqual([]);
  });

  it('requires manual allocations to reconcile with the final total', () => {
    const draft = validDraft();
    draft.costs.allocationMethod = 'MANUAL';
    draft.items[0]!.manualAmount = '99.00';
    expect(validateCostsStep(draft)).toContainEqual(expect.objectContaining({ path: 'costs' }));

    draft.items[0]!.manualAmount = '100.00';
    expect(validateCostsStep(draft)).toEqual([]);
  });
});
