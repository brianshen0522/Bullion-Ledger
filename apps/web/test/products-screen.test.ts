import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../src/screens/Products.tsx', import.meta.url)),
  'utf8',
);
const movements = readFileSync(
  fileURLToPath(new URL('../src/screens/Movements.tsx', import.meta.url)),
  'utf8',
);

/**
 * 商品規格庫 used to open on an eight-field create form, permanently expanded
 * above the catalogue — on a phone that is most of a screen before the first
 * specification. Editing was an inline card that shoved the rows around.
 */
describe('商品規格庫 opens on the catalogue', () => {
  it('replaces the always-open create form with one button', () => {
    expect(source).not.toContain('aria-labelledby="new-product-heading"');
    expect(source).toContain('新增商品規格');
    expect(source).toContain("navigate({ kind: 'create', step: FIRST_PRODUCT_STEP })");
  });

  it('edits through the wizard rather than an inline card in the list', () => {
    expect(source).not.toContain('ProductEditCard');
    expect(source).not.toContain('ProductEditForm');
    expect(source).toContain('<ProductWizard');
    expect(source).toContain("navigate({ kind: 'edit', productId: id, step: FIRST_PRODUCT_STEP })");
  });

  it('keeps the search field and both list layouts', () => {
    expect(source).toContain('搜尋名稱、品牌或金屬');
    expect(source).toContain('md:hidden');
    expect(source).toContain('hidden overflow-hidden rounded-xl md:block');
  });
});

describe('收到贈與 is a sheet, not an inline form', () => {
  it('opens over the movement list instead of pushing it down', () => {
    expect(movements).toContain('role="dialog"');
    expect(movements).toContain('aria-modal="true"');
    expect(movements).toContain('max-h-[90dvh]');
    // Same bottom-sheet shape as the disposal dialog.
    expect(movements).toContain('flex items-end justify-center bg-black/50');
  });

  it('closes on Escape, on the backdrop, and locks the page behind it', () => {
    expect(movements).toContain("event.key === 'Escape'");
    expect(movements).toContain('event.target === event.currentTarget');
    expect(movements).toContain("document.body.style.overflow = 'hidden'");
  });
});
