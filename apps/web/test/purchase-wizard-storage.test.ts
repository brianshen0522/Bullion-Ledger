import { describe, expect, it } from 'vitest';

import { createPurchaseWizardDraft } from '../src/purchase-wizard/model.js';
import {
  loadPurchaseWizardDraft,
  parsePurchaseWizardDraft,
  savePurchaseWizardDraft,
  serializePurchaseWizardDraft,
  type KeyValueStorage,
} from '../src/purchase-wizard/storage.js';

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('purchase wizard local draft persistence', () => {
  it('round-trips form data and stable IDs while stripping local file handles and blob URLs', () => {
    const draft = createPurchaseWizardDraft({ draftId: 'draft-stable', itemId: 'item-stable' });
    draft.transaction.paymentMethod = '銀行轉帳';
    draft.items[0]!.name = 'Gold bar';
    draft.photos = [
      {
        id: 'photo-stable',
        kind: 'ASSET_PHOTO',
        source: 'LIBRARY',
        targetItemId: 'item-stable',
        isPrimary: true,
        filename: 'gold.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1234,
        originalFile: new File(['original'], 'gold.jpg', { type: 'image/jpeg' }),
        previewUrl: 'blob:private-preview',
        needsReselection: false,
        crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
        createdAt: '2026-07-28T00:00:00.000Z',
      },
    ];

    const raw = serializePurchaseWizardDraft(draft);
    expect(raw).not.toContain('blob:private-preview');
    expect(raw).not.toContain('originalFile');
    const restored = parsePurchaseWizardDraft(raw);

    expect(restored.status).toBe('restored');
    expect(restored.draft?.draftId).toBe('draft-stable');
    expect(restored.draft?.transaction.paymentMethod).toBe('銀行轉帳');
    expect(restored.draft?.items[0]?.id).toBe('item-stable');
    expect(restored.draft?.photos[0]).toMatchObject({
      id: 'photo-stable',
      filename: 'gold.jpg',
      isPrimary: true,
      needsReselection: true,
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    });
    expect(restored.draft?.photos[0]?.originalFile).toBeUndefined();
    expect(restored.draft?.photos[0]?.previewUrl).toBeUndefined();
  });

  it('saves and resumes through an injected storage adapter', () => {
    const storage = new MemoryStorage();
    const draft = createPurchaseWizardDraft({ draftId: 'draft-01', itemId: 'item-1' });
    draft.currentStep = 'photos';
    draft.furthestStep = 'photos';
    savePurchaseWizardDraft(storage, draft, 'wizard');

    expect(loadPurchaseWizardDraft(storage, 'wizard')).toMatchObject({
      status: 'restored',
      draft: { draftId: 'draft-01', currentStep: 'photos', furthestStep: 'photos' },
    });
  });

  it('falls back safely and removes corrupt JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem('wizard', '{ definitely not json');

    expect(loadPurchaseWizardDraft(storage, 'wizard')).toEqual({
      draft: null,
      status: 'corrupt',
    });
    expect(storage.getItem('wizard')).toBeNull();
  });

  it('does not try to interpret an unsupported schema version', () => {
    expect(parsePurchaseWizardDraft(JSON.stringify({ version: 99 }))).toEqual({
      draft: null,
      status: 'unsupported-version',
    });
  });

  it('rejects a draft id that the API would refuse', () => {
    const draft = createPurchaseWizardDraft({ draftId: 'draft-valid', itemId: 'item-valid' });
    const value = JSON.parse(serializePurchaseWizardDraft(draft)) as Record<string, unknown>;
    value.draftId = 'x';

    expect(parsePurchaseWizardDraft(JSON.stringify(value))).toEqual({
      draft: null,
      status: 'corrupt',
    });
  });

  it.each([
    ['non-string item fields', (value: Record<string, any>) => (value.items[0].name = 42)],
    ['unknown weight units', (value: Record<string, any>) => (value.items[0].weightUnit = 'ounce')],
    [
      'unknown allocation methods',
      (value: Record<string, any>) => (value.costs.allocationMethod = 'RANDOM'),
    ],
    [
      'out-of-bounds crop geometry',
      (value: Record<string, any>) => {
        value.photos[0].crop = { x: 0.8, y: 0.1, width: 0.5, height: 0.5 };
      },
    ],
    [
      'invalid document corner primitives',
      (value: Record<string, any>) => {
        value.documents[0].documentCorners.topLeft.x = 'left';
      },
    ],
    [
      'media linked to a missing item',
      (value: Record<string, any>) => (value.photos[0].targetItemId = 'missing-item'),
    ],
  ])('rejects corrupt persisted drafts with %s', (_label, mutate) => {
    const draft = createPurchaseWizardDraft({ draftId: 'draft-valid', itemId: 'item-valid' });
    draft.photos = [
      {
        id: 'photo-valid',
        kind: 'ASSET_PHOTO',
        source: 'LIBRARY',
        targetItemId: 'item-valid',
        filename: 'gold.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1234,
        needsReselection: true,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        createdAt: '2026-07-28T00:00:00.000Z',
      },
    ];
    draft.documents = [
      {
        id: 'document-valid',
        kind: 'DOCUMENT',
        source: 'CAMERA',
        filename: 'receipt.jpg',
        mime: 'image/jpeg',
        sizeBytes: 2345,
        needsReselection: true,
        documentCorners: {
          topLeft: { x: 0.1, y: 0.1 },
          topRight: { x: 0.9, y: 0.1 },
          bottomRight: { x: 0.9, y: 0.9 },
          bottomLeft: { x: 0.1, y: 0.9 },
        },
        createdAt: '2026-07-28T00:00:00.000Z',
      },
    ];
    const value = JSON.parse(serializePurchaseWizardDraft(draft)) as Record<string, any>;
    mutate(value);

    expect(parsePurchaseWizardDraft(JSON.stringify(value))).toEqual({
      draft: null,
      status: 'corrupt',
    });
  });

  it('removes structurally corrupt drafts instead of repeatedly restoring them', () => {
    const storage = new MemoryStorage();
    const draft = createPurchaseWizardDraft({ draftId: 'draft-valid', itemId: 'item-valid' });
    const value = JSON.parse(serializePurchaseWizardDraft(draft)) as Record<string, any>;
    value.transaction.currency = { unexpected: true };
    storage.setItem('wizard', JSON.stringify(value));

    expect(loadPurchaseWizardDraft(storage, 'wizard').status).toBe('corrupt');
    expect(storage.getItem('wizard')).toBeNull();
  });

  it('restores productDefinitionVersion from old draft with productDefinitionId', () => {
    const draft = createPurchaseWizardDraft({ draftId: 'draft-v1', itemId: 'item-v' });
    draft.items[0]!.productDefinitionId = 'product-1';
    const raw = JSON.parse(serializePurchaseWizardDraft(draft)) as Record<string, any>;
    delete raw.items[0].productDefinitionVersion;

    const restored = parsePurchaseWizardDraft(JSON.stringify(raw));

    expect(restored.draft?.items[0]?.productDefinitionVersion).toBe(1);
  });

  it('leaves productDefinitionVersion undefined for custom items without productDefinitionId', () => {
    const draft = createPurchaseWizardDraft({ draftId: 'draft-custom', itemId: 'item-custom' });
    draft.items[0]!.productDefinitionId = '';
    const raw = JSON.parse(serializePurchaseWizardDraft(draft)) as Record<string, any>;
    delete raw.items[0].productDefinitionVersion;

    const restored = parsePurchaseWizardDraft(JSON.stringify(raw));

    expect(restored.draft?.items[0]?.productDefinitionVersion).toBeUndefined();
  });
});
