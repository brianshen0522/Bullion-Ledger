import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { AssetEditWizard } from '../src/screens/AssetEditWizard.js';
import type { HeldAssetListItem } from '../src/api.js';
import { ASSET_EDIT_STEPS, type AssetEditStep } from '../src/screens/inventory-route.js';

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

function renderWith(
  overrides: Partial<HeldAssetListItem> = {},
  step: AssetEditStep = 'description',
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AssetEditWizard, {
        asset: { ...asset, ...overrides },
        step,
        onStep: () => {},
        onDone: () => {},
        onCancel: () => {},
      }),
    ),
  );
}

function render(step: AssetEditStep = 'description') {
  return renderWith({}, step);
}

/**
 * A full-screen editor: one small panel at a time, with the page itself fixed
 * so the only thing that can move is a panel that genuinely overflows.
 */
describe('holding editor', () => {
  it('renders one panel at a time under a pinned header and footer', () => {
    const markup = render();
    expect(markup).toContain('楓葉金幣');
    expect(markup).toContain('商品描述');
    expect(markup).toContain('第 2／8 步');
    // The spec and cost panels belong to other steps and must not be rendered.
    expect(markup).not.toContain('分攤成本');
    expect(markup).not.toContain('存放位置');
  });

  it('names and measures every step it can open', () => {
    for (const [index, step] of ASSET_EDIT_STEPS.entries()) {
      const markup = render(step.id);
      expect(markup).toContain(step.label);
      expect(markup).toContain(`第 ${index + 1}／${ASSET_EDIT_STEPS.length} 步`);
    }
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
    const markup = render('spec');
    expect(markup).toContain('單件重量');
    expect(markup).toContain('重量單位');
    expect(markup).toContain('gram (g)');
  });

  it('offers to restore inheritance once a field diverges from the catalog', () => {
    const markup = renderWith({ name: '我的楓葉金幣', overriddenFields: ['name'] });
    expect(markup).toContain('>恢復沿用</button>');
    expect(markup).toContain('商品規格：楓葉金幣');
  });

  it('never tells the user the currency is fixed', () => {
    // The transaction step used to list 幣別 under 不可修改, so anyone reading
    // step one concluded the currency could not be corrected at all.
    const markup = render('transaction');
    expect(markup).not.toContain('不可修改');
    expect(markup).toContain('成本與幣別');
  });

  it('offers the currency on the cost step and says how far a change reaches', () => {
    const purchased = render('cost');
    expect(purchased).toContain('幣別');
    expect(purchased).toContain('TWD');
    expect(purchased).toContain('屬於整筆買入');

    // A received gift has no purchase behind it, so only that lot is affected.
    const gift = renderWith({ purchase: null }, 'cost');
    expect(gift).toContain('只影響這一批');
  });
});
