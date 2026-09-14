import { describe, expect, it } from 'vitest';

import {
  ASSET_EDIT_STEPS,
  FIRST_ASSET_EDIT_STEP,
  assetEditStepIndex,
  assetEditStepLabel,
  isAssetEditStep,
  nextAssetEditStep,
  previousAssetEditStep,
  readInventoryView,
  sameInventoryView,
  urlForInventoryView,
} from '../src/screens/inventory-route.js';
import { urlForScreen } from '../src/screen-navigation.js';

describe('inventory view URL state', () => {
  it('reads the list, a holding, and a holding being edited', () => {
    expect(readInventoryView('')).toEqual({ kind: 'list' });
    expect(readInventoryView('?asset=a1')).toEqual({ kind: 'detail', assetId: 'a1' });
    expect(readInventoryView('?asset=a1&assetStep=cost')).toEqual({
      kind: 'edit',
      assetId: 'a1',
      step: 'cost',
    });
  });

  it('treats a blank holding id as the list rather than an empty detail page', () => {
    expect(readInventoryView('?asset=')).toEqual({ kind: 'list' });
    expect(readInventoryView('?asset=%20%20')).toEqual({ kind: 'list' });
  });

  it('opens an unrecognised step at the beginning instead of trusting it', () => {
    expect(readInventoryView('?asset=a1&assetStep=nonsense')).toEqual({
      kind: 'edit',
      assetId: 'a1',
      step: FIRST_ASSET_EDIT_STEP,
    });
  });

  it('round-trips each view through a URL, preserving unrelated state', () => {
    const base = '/app?screen=inventory&tab=recent#top';
    const detail = urlForInventoryView(base, { kind: 'detail', assetId: 'a1' });
    expect(detail).toBe('/app?screen=inventory&tab=recent&asset=a1#top');
    expect(readInventoryView(new URL(detail, 'http://x').search)).toEqual({
      kind: 'detail',
      assetId: 'a1',
    });

    const edit = urlForInventoryView(detail, { kind: 'edit', assetId: 'a1', step: 'photos' });
    expect(readInventoryView(new URL(edit, 'http://x').search)).toEqual({
      kind: 'edit',
      assetId: 'a1',
      step: 'photos',
    });

    // Closing the editor drops the step but keeps the holding open.
    expect(urlForInventoryView(edit, { kind: 'detail', assetId: 'a1' })).toBe(detail);
    // Going back to the list drops both.
    expect(urlForInventoryView(edit, { kind: 'list' })).toBe(base);
  });

  it('leaves no holding state behind when the user changes screen', () => {
    // Otherwise 持有庫存 would reopen a holding the next time it is visited.
    const url = urlForScreen('/app?screen=inventory&asset=a1&assetStep=cost', 'dashboard');
    expect(url).toBe('/app');
  });

  it('recognises a repeat of the same view so it replaces rather than stacks', () => {
    const detail = { kind: 'detail', assetId: 'a1' } as const;
    expect(sameInventoryView(detail, { kind: 'detail', assetId: 'a1' })).toBe(true);
    expect(sameInventoryView(detail, { kind: 'detail', assetId: 'a2' })).toBe(false);
    expect(sameInventoryView(detail, { kind: 'edit', assetId: 'a1', step: 'cost' })).toBe(false);
    expect(
      sameInventoryView(
        { kind: 'edit', assetId: 'a1', step: 'cost' },
        { kind: 'edit', assetId: 'a1', step: 'photos' },
      ),
    ).toBe(false);
  });
});

describe('editor steps', () => {
  it('keeps every step small enough to name, and ordered', () => {
    expect(ASSET_EDIT_STEPS.length).toBeGreaterThan(1);
    expect(assetEditStepIndex(FIRST_ASSET_EDIT_STEP)).toBe(0);
    expect(previousAssetEditStep(FIRST_ASSET_EDIT_STEP)).toBeNull();
    expect(nextAssetEditStep(ASSET_EDIT_STEPS[ASSET_EDIT_STEPS.length - 1]!.id)).toBeNull();
  });

  it('walks forwards and backwards through the whole sequence', () => {
    const forwards: string[] = [FIRST_ASSET_EDIT_STEP];
    let step = nextAssetEditStep(FIRST_ASSET_EDIT_STEP);
    while (step) {
      forwards.push(step);
      step = nextAssetEditStep(step);
    }
    expect(forwards).toEqual(ASSET_EDIT_STEPS.map((entry) => entry.id));
    expect(previousAssetEditStep('review')).toBe('documents');
  });

  it('labels a step and rejects anything that is not one', () => {
    expect(assetEditStepLabel('cost')).toBe('成本與幣別');
    expect(isAssetEditStep('cost')).toBe(true);
    expect(isAssetEditStep('costs')).toBe(false);
    expect(isAssetEditStep(null)).toBe(false);
  });
});
