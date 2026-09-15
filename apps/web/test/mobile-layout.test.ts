import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');
}

const app = read('App.tsx');
const shell = read('WizardShell.tsx');
const assets = read('screens/Assets.tsx');
const purchase = read('purchase-wizard/PurchaseWizard.tsx');

/**
 * Regressions found by measuring the running app at 320/360/390px. Each one
 * was a field or control squeezed out of its box on a phone — the kind of
 * break that does not show up on a desktop and does not fail a type check.
 */
describe('phone layout regressions', () => {
  it('lets the brand shrink and pins the account controls', () => {
    // The account block was compressed 3px narrower than its own contents on
    // every screen; the brand is the part of the bar that can afford a trim.
    expect(app).toContain('ml-auto flex shrink-0 items-center gap-1');
    expect(app).toContain('<AppIcon className="h-8 w-8 shrink-0 shadow-sm" />');
    expect(app).toContain('<span className="truncate">Bullion Ledger</span>');
  });

  it('keeps the sign-out control short, and in the same language as the app', () => {
    expect(app).toContain("'登出中…' : '登出'");
    expect(app).not.toContain("'Signing out…'");
    expect(app).not.toContain("'Sign out'");
  });

  it('gives the wizard title a width of its own', () => {
    // flex-1 alone means a zero basis: the status pills beside it took the
    // whole row and the title rendered at 0px on every viewport.
    expect(shell).toContain('min-w-0 flex-1 basis-32 truncate');
    // …and the pills must stay shrinkable, or they overflow a 320px row.
    expect(shell).toContain('{headerAside && <div className="min-w-0 max-w-full">');
    expect(shell).toContain('flex-wrap items-center gap-x-3 gap-y-1');
    expect(purchase).toContain('flex min-w-0 flex-wrap justify-end gap-1 text-xs');
  });

  it('does not put a fixed column beside the holding name', () => {
    // The metal badge and status sat in a 98px column; with the thumbnail that
    // left the name — the link into the holding — 36px wide at 320px.
    expect(assets).toContain('mt-1 flex flex-wrap items-center gap-x-2 gap-y-1');
    expect(assets).toContain('h-16 w-16 sm:h-24 sm:w-24');
    expect(assets).not.toContain('flex shrink-0 items-start gap-2');
  });

  it('stops a date control sizing itself out of its card', () => {
    // A date input takes its width from the locale's format and iOS Safari
    // will not shrink one below that, however narrow the container. In zh-TW
    // the value is long, and at 320px all three date fields in the app had
    // 5px, 0px and -1px of room. Dropping the native appearance makes the box
    // obey width:100%; the value element needs the same or it re-inflates it.
    const css = read('index.css');
    expect(css).toContain('-webkit-appearance: none');
    expect(css).toContain('::-webkit-date-and-time-value');
    for (const type of ['datetime-local', 'date', 'time']) {
      expect(css).toContain(`input[type="${type}"]`);
    }
  });

  it('narrows the page gutter on small phones, where those few pixels decide it', () => {
    const css = read('index.css');
    expect(css).toContain('--app-gutter: 1rem');
    expect(css).toContain('--app-gutter: 0.75rem');
    expect(css).toContain('@media (max-width: 379.98px)');
    // Every gutter reads the variable, so one change moves all of them.
    expect(css).not.toContain('padding-left: calc(1rem + env(safe-area-inset-left))');
  });

  it('keeps the sheets that hold a date field off the screen edges', () => {
    for (const source of [read('screens/Movements.tsx'), read('screens/AssetDisposalDialog.tsx')]) {
      expect(source).toContain('rounded-2xl p-4 sm:p-5');
      expect(source).toContain('bg-black/50 px-2 pt-4 sm:px-4');
    }
  });

  it('floats the overflow sheet above the tab bar without doing its arithmetic', () => {
    // The sheet used to be its own fixed box offset by --app-bottom-nav, which
    // is the bar's content height and excludes the home indicator the bar adds
    // itself. On any phone with an indicator that put the last row — 設定 —
    // behind the bar. As a sibling stacked above the bar in one fixed
    // container it tracks the bar's real height, whatever the inset is.
    expect(app).toContain('fixed inset-x-0 bottom-0 z-40 flex flex-col');
    expect(app).not.toContain('bottom-[calc(var(--app-bottom-nav)');
    // The sheet must precede the bar in the column, and the bar keeps the inset.
    expect(app.indexOf('id="app-nav-overflow"')).toBeLessThan(
      app.indexOf('aria-label="Primary"\n          className="grid grid-cols-5'),
    );
    expect(app).toContain('pb-[env(safe-area-inset-bottom)]');
    // A longer list must scroll rather than run off the top.
    expect(app).toContain('max-h-[60dvh] gap-1 overflow-y-auto');
  });

  it('stacks a number and its unit picker until both fit', () => {
    // A 9rem unit picker beside the number left the number narrower than the
    // picker on a 320px phone.
    for (const source of [read('screens/AssetEditWizard.tsx'), read('screens/ProductWizard.tsx')]) {
      expect(source).toContain('grid-cols-1 gap-2 min-[380px]:grid-cols-[minmax(0,1fr)_9rem]');
    }
  });
});
