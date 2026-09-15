import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A wide table inside `overflow-x-auto` is readable on a desktop and hostile on
 * a phone: the columns that carry the point of the row (amount, realized gain,
 * premium rate) sit off the right edge. Every such table needs a card layout
 * beside it, the way the inventory screen already does.
 */
function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');
}

const movements = read('screens/Movements.tsx');
const market = read('screens/Market.tsx');
const chart = read('screens/MarketChart.tsx');
const wizard = read('purchase-wizard/PurchaseWizard.tsx');

describe('wide tables have a phone layout', () => {
  it('confines the movement table to large screens and cards the rest', () => {
    expect(movements).toContain('className="hidden overflow-x-auto lg:block"');
    expect(movements).toContain('<ol className="space-y-3 lg:hidden">');
    expect(movements).toContain('<MovementFact');
  });

  it('confines the market transaction table to large screens and cards the rest', () => {
    expect(market).toContain('className="hidden overflow-x-auto lg:block"');
    expect(market).toContain('<ol className="space-y-3 lg:hidden">');
    expect(market).toContain('<MarketFact');
  });

  it('keeps every table column present in the phone cards', () => {
    for (const label of ['日期', '數量／純重', '對象', '金額', '已實現損益']) {
      expect(movements).toContain(label);
    }
    for (const label of ['重量', '購買總價', '當時現貨', '溢價率']) {
      expect(market).toContain(label);
    }
  });

  it('scrolls to whichever transaction layout is on screen', () => {
    // scrollIntoView silently does nothing on a display:none element, so the
    // chart cannot hard-code the desktop row id.
    expect(chart).toContain('visibleTransactionEntry');
    expect(chart).toContain('element.offsetParent !== null');
    expect(market).toContain('id={`purchase-card-${marker.purchaseId}`}');
    expect(market).toContain('id={`purchase-row-${marker.purchaseId}`}');
  });
});

describe('wizard steps are reachable on a phone', () => {
  it('drops the button strips that needed a sideways scroll', () => {
    for (const source of [wizard, read('screens/AssetEditWizard.tsx')]) {
      expect(source).not.toContain('min-w-[34rem]');
      expect(source).not.toContain('aria-label="入庫步驟"');
    }
  });

  it('names the current step and shows how far along it is', () => {
    const shell = read('WizardShell.tsx');
    expect(shell).toContain('role="progressbar"');
    expect(read('screens/AssetEditWizard.tsx')).toContain('stepLabel={assetEditStepLabel(step)}');
  });

  it('offers a jump menu, because eight steps will not fit as buttons', () => {
    expect(read('WizardShell.tsx')).toContain('label="跳至步驟"');
    // The two long flows both opt in; short, strictly ordered creation does not
    // need to.
    expect(read('screens/AssetEditWizard.tsx')).toContain('steps={ASSET_EDIT_STEPS}');
    expect(wizard).toContain('onStepSelect=');
  });
});
