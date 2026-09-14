import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { AssetEditWizard } from '../src/screens/AssetEditWizard.js';
import type { HeldAssetListItem } from '../src/api.js';

const asset = {
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
  inherited: { name: '楓葉金幣', form: 'coin', brand: 'RCM', country: 'CA', yearOrVersion: '2019' },
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
} as unknown as HeldAssetListItem;

function renderWith(overrides: Partial<HeldAssetListItem> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AssetEditWizard, {
        asset: { ...asset, ...overrides },
        onDone: () => {},
        onCancel: () => {},
      }),
    ),
  );
}

function render() {
  return renderWith();
}

/**
 * Editing an existing holding is not a linear wizard — every section already
 * holds data — so none of the section buttons may be gated behind the one
 * before it, the way the purchase wizard gates its steps.
 */
describe('holding editor', () => {
  it('opens on the product section with every section reachable', () => {
    const markup = render();
    expect(markup).toContain('楓葉金幣');
    expect(markup).toContain('商品資訊');
    for (const label of ['交易', '商品', '成本', '照片', '文件', '確認']) {
      expect(markup).toContain(`>${label}</button>`);
    }
    expect(markup).not.toContain('disabled=""');
  });

  it('shows what a catalog-linked field inherits, without offering an undo it does not need', () => {
    const markup = render();
    expect(markup).toContain('商品規格：楓葉金幣');
    expect(markup).toContain('商品規格：金幣');
    // Nothing has diverged yet, so no restore button — only the explanatory
    // paragraph mentions restoring.
    expect(markup).not.toContain('>恢復沿用</button>');
  });

  it('lets the weight be entered in a unit other than grams', () => {
    const markup = render();
    expect(markup).toContain('單件重量');
    expect(markup).toContain('重量單位');
    expect(markup).toContain('gram (g)');
  });

  it('offers to restore inheritance once a field diverges from the catalog', () => {
    const markup = renderWith({ name: '我的楓葉金幣', overriddenFields: ['name'] });
    expect(markup).toContain('>恢復沿用</button>');
    expect(markup).toContain('商品規格：楓葉金幣');
  });
});
