/**
 * Sub-navigation inside 商品規格庫: the list, and the full-screen wizard that
 * creates or edits one specification. Both live in the URL, so the back button
 * leaves the wizard and a reload keeps the panel you were on.
 */

export const PRODUCT_PARAM = 'product';
export const PRODUCT_STEP_PARAM = 'productStep';

/** The value of `?product=` that means "creating a new one". */
export const NEW_PRODUCT = 'new';

export const PRODUCT_WIZARD_STEPS = [
  { id: 'basics', label: '名稱與金屬' },
  { id: 'origin', label: '品牌與來源' },
  { id: 'spec', label: '純度與重量' },
  { id: 'review', label: '確認' },
] as const;

export type ProductWizardStep = (typeof PRODUCT_WIZARD_STEPS)[number]['id'];

export const FIRST_PRODUCT_STEP: ProductWizardStep = PRODUCT_WIZARD_STEPS[0].id;

export function isProductWizardStep(value: unknown): value is ProductWizardStep {
  return (
    typeof value === 'string' && PRODUCT_WIZARD_STEPS.some((step) => (step.id as string) === value)
  );
}

export function productStepLabel(step: ProductWizardStep): string {
  return PRODUCT_WIZARD_STEPS.find((entry) => entry.id === step)?.label ?? '';
}

export function productStepIndex(step: ProductWizardStep): number {
  return PRODUCT_WIZARD_STEPS.findIndex((entry) => entry.id === step);
}

export function nextProductStep(step: ProductWizardStep): ProductWizardStep | null {
  return PRODUCT_WIZARD_STEPS[productStepIndex(step) + 1]?.id ?? null;
}

export function previousProductStep(step: ProductWizardStep): ProductWizardStep | null {
  const index = productStepIndex(step);
  return index <= 0 ? null : (PRODUCT_WIZARD_STEPS[index - 1]?.id ?? null);
}

export type ProductsView =
  | { kind: 'list' }
  | { kind: 'create'; step: ProductWizardStep }
  | { kind: 'edit'; productId: string; step: ProductWizardStep };

export function readProductsView(search: string): ProductsView {
  const params = new URLSearchParams(search);
  const product = params.get(PRODUCT_PARAM)?.trim();
  if (!product) return { kind: 'list' };
  const requested = params.get(PRODUCT_STEP_PARAM);
  // A hand-edited or stale step opens at the beginning rather than being
  // trusted, and rather than dropping the user back on the list unexplained.
  const step = isProductWizardStep(requested) ? requested : FIRST_PRODUCT_STEP;
  return product === NEW_PRODUCT
    ? { kind: 'create', step }
    : { kind: 'edit', productId: product, step };
}

export function urlForProductsView(href: string, view: ProductsView): string {
  const url = new URL(href, 'http://localhost');
  if (view.kind === 'list') {
    url.searchParams.delete(PRODUCT_PARAM);
    url.searchParams.delete(PRODUCT_STEP_PARAM);
  } else {
    url.searchParams.set(PRODUCT_PARAM, view.kind === 'create' ? NEW_PRODUCT : view.productId);
    url.searchParams.set(PRODUCT_STEP_PARAM, view.step);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
