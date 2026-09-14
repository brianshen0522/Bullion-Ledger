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
// Editing moved out of Assets.tsx into the holding editor, so the guards about
// the edit form follow it there.
const editorSource = readFileSync(
  fileURLToPath(new URL('../src/screens/AssetEditWizard.tsx', import.meta.url)),
  'utf8',
);
// The chrome every wizard shares: busy state, focus, scrolling.
const shellSource = readFileSync(
  fileURLToPath(new URL('../src/WizardShell.tsx', import.meta.url)),
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
    expect(DESKTOP_TABLE).toContain('assetActions(asset, onEdit, onDispose, actionsDisabled)');
    expect(MOBILE_LIST).toContain('assetActions(asset, onEdit, onDispose, actionsDisabled)');
  });

  it('opens the holding detail page from both layouts', () => {
    // The row summary cannot show every photo, document and transaction field,
    // so each layout needs a way into the full record.
    expect(DESKTOP_TABLE).toContain('onClick={() => onOpen(asset.id)}');
    expect(MOBILE_LIST).toContain('onOpen={() => onOpen(asset.id)}');
    expect(source).toContain('查看詳細資料');
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

  it('drives every disposal dialog from one piece of state', () => {
    // The list and the detail page each render it, but both read the same
    // `disposal` state, so an action can never open two dialogs at once.
    expect(source).toContain('onDispose={setDisposal}');
    expect(source).toContain('disposal={disposal}');
    expect(source).toContain('target={disposalTarget(');
    expect(source.match(/function disposalTarget/g)).toHaveLength(1);
  });

  it('locks every row action while a disposal dialog is open', () => {
    // Editing is a page of its own now, so there are no rows behind it to lock.
    expect(source).toContain('const actionsDisabled = Boolean(isPending || disposal)');
    expect(editorSource).toContain('busy={saving}');
    expect(shellSource).toContain('<fieldset disabled={busy}');
  });

  it('shows edit context, constrains text fields, and moves focus to the form', () => {
    // The holding's name stays visible in the editor header, above the step.
    expect(editorSource).toContain('{asset.name}');
    expect(editorSource).toContain('label="分攤成本"');
    // Serial and storage location both match the API's 128-character bound.
    expect(editorSource.match(/maxLength=\{128\}/g)).toHaveLength(2);
    expect(shellSource).toContain("querySelector<HTMLInputElement>('input:not(:disabled)')?.focus");
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
