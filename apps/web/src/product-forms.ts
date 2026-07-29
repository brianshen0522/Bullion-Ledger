export const PRODUCT_FORM_OPTIONS = [
  ['bar', '條／塊'],
  ['coin', '幣'],
  ['minted', '鑄造品'],
  ['numismatic', '收藏幣'],
  ['grain', '粒狀／原料'],
  ['jewelry', '飾品'],
  ['other', '其他'],
] as const;

const METAL_FORM_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  XAU: {
    bar: '金條／金塊',
    coin: '金幣',
    grain: '金豆／金料',
    jewelry: '金飾',
  },
  XAG: {
    bar: '銀條／銀塊',
    coin: '銀幣',
    grain: '銀粒／銀料',
    jewelry: '銀飾',
  },
};

export function productFormLabel(value: string, metalCode?: string): string {
  const normalizedMetalCode = metalCode?.trim().toUpperCase();
  return (
    (normalizedMetalCode ? METAL_FORM_LABELS[normalizedMetalCode]?.[value] : undefined) ??
    PRODUCT_FORM_OPTIONS.find(([key]) => key === value)?.[1] ??
    value
  );
}

export function productFormOptions(metalCode?: string): ReadonlyArray<readonly [string, string]> {
  return PRODUCT_FORM_OPTIONS.map(
    ([value]) => [value, productFormLabel(value, metalCode)] as const,
  );
}
