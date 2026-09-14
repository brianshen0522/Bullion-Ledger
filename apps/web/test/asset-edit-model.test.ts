import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { AssetAttachment, HeldAssetListItem } from '../src/api.js';
import {
  COST_CURRENCIES,
  attachmentReadPath,
  attachmentReviewPatches,
  assetPatchHasChanges,
  buildAssetPatch,
  buildPurchasePatch,
  currencyChangeScope,
  documentPreview,
  initialAssetForm,
  initialPurchaseForm,
  isPurchaseScoped,
  previewVariant,
  unitWeightGrams,
  unitWeightInUnit,
} from '../src/screens/asset-edit-model.js';

function asset(overrides: Partial<HeldAssetListItem> = {}): HeldAssetListItem {
  return {
    id: 'asset-1',
    productDefinitionId: 'product-1',
    status: 'HELD',
    name: '楓葉金幣',
    metal: { code: 'XAU', name: '黃金' },
    form: 'coin',
    brand: 'RCM',
    country: 'CA',
    yearOrVersion: '2019',
    quantity: 2,
    unitWeightGrams: '31.1034768',
    grossWeightGrams: '62.2069536',
    purity: '0.9999',
    fineWeightGrams: '62.2007329',
    allocatedCost: '120000',
    currency: 'TWD',
    serial: null,
    storageLocation: '家中保險箱',
    acquiredAt: '2026-07-01T00:00:00.000Z',
    packagingState: null,
    hasCertificate: false,
    version: 3,
    updatedAt: '2026-07-01T00:00:00.000Z',
    inherited: {
      name: '楓葉金幣',
      form: 'coin',
      brand: 'RCM',
      country: 'CA',
      yearOrVersion: '2019',
    },
    overriddenFields: [],
    purchase: {
      id: 'purchase-1',
      purchasedAt: '2026-07-01T00:00:00.000Z',
      dealerName: '台銀',
      branch: null,
      orderNumber: null,
      invoiceNumber: null,
      paymentMethod: null,
      notes: null,
    },
    coverPhoto: null,
    photos: [],
    ...overrides,
  } as HeldAssetListItem;
}

describe('buildAssetPatch', () => {
  it('sends nothing but the version when the form is untouched', () => {
    const result = buildAssetPatch(asset(), initialAssetForm(asset()));
    expect('patch' in result && result.patch).toEqual({ version: 3 });
    expect('patch' in result && assetPatchHasChanges(result.patch)).toBe(false);
  });

  it('sends only the fields that changed', () => {
    const held = asset();
    const form = { ...initialAssetForm(held), storageLocation: '銀行保管箱' };
    const result = buildAssetPatch(held, form);
    expect(result).toEqual({ patch: { version: 3, storageLocation: '銀行保管箱' } });
  });

  it('sends a descriptive field so the server can store a per-lot override', () => {
    const held = asset();
    const form = { ...initialAssetForm(held), name: '我的楓葉金幣' };
    const result = buildAssetPatch(held, form);
    expect('patch' in result && result.patch.name).toBe('我的楓葉金幣');
  });

  it('sends null for a cleared descriptive field, which restores inheritance', () => {
    const held = asset({ name: '我的楓葉金幣', overriddenFields: ['name'] });
    const form = { ...initialAssetForm(held), name: '  ' };
    const result = buildAssetPatch(held, form);
    expect('patch' in result && result.patch.name).toBeNull();
  });

  it('converts the unit weight back to grams before comparing and sending', () => {
    const held = asset();
    // 1 troy ounce is exactly the stored gram weight, so choosing that unit
    // must not register as an edit.
    const unchanged = buildAssetPatch(held, {
      ...initialAssetForm(held),
      weightUnit: 'troy_oz',
      unitWeight: '1',
    });
    expect('patch' in unchanged && assetPatchHasChanges(unchanged.patch)).toBe(false);

    const changed = buildAssetPatch(held, {
      ...initialAssetForm(held),
      weightUnit: 'qian',
      unitWeight: '10',
    });
    expect('patch' in changed && changed.patch).toMatchObject({
      unitWeight: '37.5',
      weightUnit: 'g',
    });
  });

  it('reports bad numbers instead of sending a malformed patch', () => {
    const held = asset();
    expect(buildAssetPatch(held, { ...initialAssetForm(held), quantity: '0' })).toEqual({
      error: expect.stringContaining('數量'),
    });
    expect(buildAssetPatch(held, { ...initialAssetForm(held), purity: '1.5' })).toEqual({
      error: expect.stringContaining('純度'),
    });
    expect(buildAssetPatch(held, { ...initialAssetForm(held), allocatedCost: '-1' })).toEqual({
      error: expect.stringContaining('成本'),
    });
    expect(buildAssetPatch(held, { ...initialAssetForm(held), unitWeight: 'abc' })).toEqual({
      error: expect.stringContaining('單件重量'),
    });
  });
});

describe('unit weight conversion', () => {
  it('round-trips a gram value through a display unit', () => {
    expect(unitWeightInUnit('37.5', 'qian')).toBe('10');
    expect(unitWeightGrams({ unitWeight: '10', weightUnit: 'qian' })).toBe('37.5');
  });

  it('reports an unusable entry rather than guessing', () => {
    expect(unitWeightGrams({ unitWeight: '', weightUnit: 'g' })).toBeNull();
    expect(unitWeightGrams({ unitWeight: 'x', weightUnit: 'g' })).toBeNull();
  });
});

describe('currency correction', () => {
  it('routes a purchased lot through the purchase, not the holding', () => {
    const held = asset();
    expect(currencyChangeScope(held)).toBe('purchase');

    const form = { ...initialAssetForm(held), currency: 'USD' };
    const assetPatch = buildAssetPatch(held, form);
    // Relabelling one lot of a transaction would split it across two
    // currencies, which is what makes the dashboard withhold P&L.
    expect('patch' in assetPatch && 'currency' in assetPatch.patch).toBe(false);
    expect(buildPurchasePatch(held, initialPurchaseForm(held), form)).toEqual({
      currency: 'USD',
    });
  });

  it('routes a gift-received lot through the holding, since it has no purchase', () => {
    const gift = asset({ purchase: null });
    expect(currencyChangeScope(gift)).toBe('asset');

    const form = { ...initialAssetForm(gift), currency: 'usd' };
    expect(buildAssetPatch(gift, form)).toEqual({ patch: { version: 3, currency: 'USD' } });
    expect(buildPurchasePatch(gift, initialPurchaseForm(gift), form)).toEqual({});
  });

  it('sends nothing when the currency is unchanged', () => {
    const held = asset();
    const form = initialAssetForm(held);
    expect(buildPurchasePatch(held, initialPurchaseForm(held), form)).toEqual({});
    expect(
      'patch' in buildAssetPatch(held, form) &&
        assetPatchHasChanges(
          (buildAssetPatch(held, form) as { patch: Record<string, unknown> & { version: number } })
            .patch,
        ),
    ).toBe(false);
  });

  it('offers the currencies a cost can plausibly be recorded in', () => {
    expect(COST_CURRENCIES).toContain('TWD');
    expect(COST_CURRENCIES).toContain('USD');
    // XAU/XAG are metals-as-currency for market quotes, never a cost currency.
    expect(COST_CURRENCIES).not.toContain('XAU');
  });
});

describe('buildPurchasePatch', () => {
  it('diffs only the transaction metadata the API accepts', () => {
    const held = asset();
    const form = { ...initialPurchaseForm(held), dealerName: '中央造幣', notes: '現場取貨' };
    expect(buildPurchasePatch(held, form)).toEqual({
      dealerName: '中央造幣',
      notes: '現場取貨',
    });
  });

  it('clears a field emptied by the user and stays empty when nothing changed', () => {
    const held = asset();
    expect(buildPurchasePatch(held, { ...initialPurchaseForm(held), dealerName: '' })).toEqual({
      dealerName: null,
    });
    expect(buildPurchasePatch(held, initialPurchaseForm(held))).toEqual({});
  });
});

describe('attachmentReviewPatches', () => {
  const base = { id: 'a1', version: 2, kind: 'invoice', description: '', isCover: false };

  it('replays a caption and a type change that used to be dropped on save', () => {
    expect(
      attachmentReviewPatches([base], [{ ...base, kind: 'receipt', description: '補開收據' }]),
    ).toEqual([{ id: 'a1', body: { version: 2, kind: 'receipt', description: '補開收據' } }]);
  });

  it('sends null for a cleared caption', () => {
    expect(attachmentReviewPatches([{ ...base, description: '舊說明' }], [base])).toEqual([
      { id: 'a1', body: { version: 2, description: null } },
    ]);
  });

  it('emits nothing for untouched attachments or unknown ids', () => {
    expect(attachmentReviewPatches([base], [base])).toEqual([]);
    expect(attachmentReviewPatches([base], [{ ...base, id: 'other' }])).toEqual([]);
  });

  it('carries a cover change', () => {
    expect(attachmentReviewPatches([base], [{ ...base, isCover: true }])).toEqual([
      { id: 'a1', body: { version: 2, isCover: true } },
    ]);
  });
});

describe('attachment preview helpers', () => {
  it('classifies what can be shown in place', () => {
    expect(documentPreview('image/jpeg')).toBe('image');
    expect(documentPreview('application/pdf')).toBe('pdf');
    expect(documentPreview('application/zip')).toBe('none');
  });

  it('prefers the newest derivative over the original', () => {
    const attachment = {
      variants: [
        {
          kind: 'ORIGINAL',
          revision: 1,
          mime: 'image/jpeg',
          sizeBytes: 1,
          width: null,
          height: null,
        },
        {
          kind: 'SCAN_COLOR',
          revision: 1,
          mime: 'image/jpeg',
          sizeBytes: 1,
          width: null,
          height: null,
        },
        {
          kind: 'SCAN_COLOR',
          revision: 3,
          mime: 'image/jpeg',
          sizeBytes: 1,
          width: null,
          height: null,
        },
      ],
    } as Pick<AssetAttachment, 'variants'>;
    expect(previewVariant(attachment)).toEqual({ kind: 'SCAN_COLOR', revision: 3 });
  });

  it('falls back to no variant when none is listed', () => {
    expect(previewVariant({ variants: [] } as Pick<AssetAttachment, 'variants'>)).toBeNull();
  });

  it('asks for an inline disposition so a document previews instead of downloading', () => {
    expect(attachmentReadPath('a 1', { kind: 'SCAN_COLOR', revision: 2 }, 'inline')).toBe(
      '/attachments/a%201/url?variant=SCAN_COLOR&revision=2&disposition=inline',
    );
    expect(attachmentReadPath('a1', null)).toBe('/attachments/a1/url');
  });

  it('separates purchase-wide documents from per-holding ones', () => {
    expect(isPurchaseScoped({ purchaseId: 'purchase-1' } as AssetAttachment)).toBe(true);
    expect(isPurchaseScoped({ purchaseId: null } as AssetAttachment)).toBe(false);
  });
});

describe('review diff covers the currency', () => {
  /**
   * The editor's review panel lists a change per field. A currency-only edit
   * that is missing from that list reads as "未做任何變更", which is
   * indistinguishable from the edit having been refused.
   */
  it('names 幣別 among the fields the review step compares', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/screens/AssetEditWizard.tsx', import.meta.url)),
      'utf8',
    );
    const review = source.slice(source.indexOf('function ReviewStep('));
    expect(review).toContain("push('幣別'");
    expect(review).toContain('form.currency');
  });
});
