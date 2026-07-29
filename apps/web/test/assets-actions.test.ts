import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The inventory screen has two layouts — a mobile card list and a desktop
 * table — and an action added to only one of them is invisible to anyone using
 * the other. This guards the pairing that was previously missed: the desktop
 * table shipped with just "編輯" while the disposal actions existed only on the
 * card layout.
 */
const source = readFileSync(
  fileURLToPath(new URL('../src/screens/Assets.tsx', import.meta.url)),
  'utf8',
);
const rowActionsSource = readFileSync(
  fileURLToPath(new URL('../src/RowActionsMenu.tsx', import.meta.url)),
  'utf8',
);

// The brace prefix disambiguates the two guards: searching for
// `isDesktop && (` alone also matches inside `!isDesktop && (`.
const MOBILE_START = source.indexOf('{!isDesktop && assets.length > 0 && (');
const DESKTOP_START = source.indexOf('{isDesktop && assets.length > 0 && (');

const MOBILE_LIST = source.slice(MOBILE_START, DESKTOP_START);
const DESKTOP_TABLE = source.slice(DESKTOP_START);

describe('inventory actions reach both layouts', () => {
  it('finds the guarded mobile and desktop layout sections', () => {
    expect(MOBILE_START).toBeGreaterThan(-1);
    expect(DESKTOP_START).toBeGreaterThan(MOBILE_START);
  });

  it('builds both layouts from the one shared action list', () => {
    // Sharing the list is what stops an action existing in only one layout.
    expect(DESKTOP_TABLE).toContain('assetActions(asset, onEdit, setDisposal, actionsDisabled)');
    expect(MOBILE_LIST).toContain('assetActions(asset, onEdit, setDisposal, actionsDisabled)');
  });

  it('includes every action in that shared list', () => {
    for (const action of ['SALE', 'GIFT_OUT', 'LOST']) {
      expect(source).toContain(`action: '${action}'`);
    }
    expect(source).toContain("id: 'edit'");
  });

  it('renders row actions through the compact overflow menu', () => {
    // Four stacked buttons previously forced every row to their combined
    // height; one trigger keeps a row as tall as its data.
    expect(DESKTOP_TABLE).toContain('<RowActionsMenu');
    expect(DESKTOP_TABLE).not.toContain('flex-col items-start gap-0.5');
  });

  it('renders the disposal dialog once, driven by shared state', () => {
    expect(source).toContain('<AssetDisposalDialog');
    expect(source.match(/<AssetDisposalDialog/g)).toHaveLength(1);
  });

  it('keeps an edit draft mounted when filters hide its row', () => {
    expect(source).toContain('allAssets={allAssets}');
    expect(source).toContain('allAssets.find((asset) => asset.id === editingId)');
    expect(source.indexOf('<InventoryList')).toBeLessThan(
      source.indexOf('{visibleAssets.length === 0 && ('),
    );
  });

  it('locks every row action while an edit is active', () => {
    expect(source).toContain('const actionsDisabled = Boolean(isPending || editingId || disposal)');
    expect(source).toContain('<fieldset disabled={isPending || isConflict}>');
  });

  it('shows edit context, constrains text fields, and moves focus to the form', () => {
    expect(source).toContain('{asset.name} · 成本幣別 {asset.currency}');
    expect(source).toContain('label={`分攤成本 (${asset.currency})`}');
    expect(source.match(/maxLength=\{128\}/g)).toHaveLength(2);
    expect(source).toContain('form.serial.trim().length > 128');
    expect(source).toContain('form.storageLocation.trim().length > 128');
    expect(source).toContain("querySelector<HTMLInputElement>('input:not(:disabled)')?.focus");
    expect(source).toContain('formElement.scrollIntoView');
    expect(source).toContain('aria-invalid={invalid || undefined}');
  });

  it('uses the whole failed thumbnail as an accessible retry target', () => {
    expect(source).toContain('aria-label={`重新載入 ${asset.name} 的資產照片`}');
    expect(source).toContain('min-h-[44px] min-w-[44px]');
    expect(source).toContain('disabled={signedUrl.isFetching}');
    expect(source).toContain('if (result.isSuccess) setImageFailed(false)');
    expect(source).not.toContain(
      'role="img"\n        aria-label={`${asset.name} 的資產照片無法載入`}',
    );
  });
});

describe('row action menu interaction', () => {
  it('does not rely on a clipped table container', () => {
    expect(DESKTOP_TABLE).toContain('<div className="surface rounded-xl">');
    expect(DESKTOP_TABLE).not.toContain('surface overflow-hidden rounded-xl');
    expect(rowActionsSource).toContain("placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'");
  });

  it('has full-size touch targets and ARIA menu semantics', () => {
    expect(rowActionsSource).toContain('className="interactive-muted flex h-11 w-11');
    expect(rowActionsSource).toContain('role="menu"');
    expect(rowActionsSource).toContain('role="menuitem"');
    expect(rowActionsSource).toContain('tabIndex={-1}');
  });

  it('supports menu navigation and restores trigger focus on Escape', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(rowActionsSource).toContain(`case '${key}':`);
    }
    expect(rowActionsSource).toContain('focusEdge(initialFocusRef.current)');
    expect(rowActionsSource).toContain('closeMenu(true)');
    expect(rowActionsSource).toContain("case 'Tab':");
  });
});
