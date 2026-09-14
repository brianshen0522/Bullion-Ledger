import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { AssetDetailScreen } from '../src/screens/AssetDetail.js';
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
  serial: 'SN-1',
  storageLocation: '家中保險箱',
  acquiredAt: '2026-07-01T00:00:00.000Z',
  packagingState: '原封',
  hasCertificate: true,
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
    branch: '總行',
    orderNumber: 'ORD-9',
    invoiceNumber: 'INV-9',
    paymentMethod: '匯款',
    notes: '現場取貨',
  },
  coverPhoto: null,
  photos: [],
} as unknown as HeldAssetListItem;

function render(overrides: Partial<HeldAssetListItem> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AssetDetailScreen, {
        asset: { ...asset, ...overrides },
        onBack: () => {},
        onEdit: () => {},
        actions: [{ id: 'edit', label: '編輯', onSelect: () => {} }],
      }),
    ),
  );
}

/**
 * The list row can only carry a summary. Everything a user checks before acting
 * on a holding has to be on this page rather than hidden inside the editor.
 */
describe('holding detail page', () => {
  it('shows every stored figure for the holding', () => {
    const markup = render();
    for (const label of [
      '數量',
      '單件重量',
      '總毛重',
      '純度',
      '細重量',
      '分攤成本',
      '幣別',
      '序號',
      '存放位置',
      '包裝狀態',
      '附有證書',
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('SN-1');
    expect(markup).toContain('家中保險箱');
    expect(markup).toContain('TWD');
  });

  it('shows the transaction the holding came from', () => {
    const markup = render();
    expect(markup).toContain('交易資訊');
    expect(markup).toContain('台銀');
    expect(markup).toContain('ORD-9');
    expect(markup).toContain('INV-9');
    expect(markup).toContain('現場取貨');
  });

  it('explains a holding that came from no purchase rather than showing blanks', () => {
    const markup = render({ purchase: null });
    expect(markup).toContain('沒有交易資訊');
    expect(markup).not.toContain('ORD-9');
  });

  it('has sections for photos and documents, and a way back and into the editor', () => {
    const markup = render();
    expect(markup).toContain('照片');
    expect(markup).toContain('文件');
    expect(markup).toContain('← 持有庫存');
    expect(markup).toContain('編輯');
  });
});
