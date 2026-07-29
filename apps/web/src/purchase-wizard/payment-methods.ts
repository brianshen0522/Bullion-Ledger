export const PAYMENT_METHOD_OPTIONS = [
  ['現金', '現金'],
  ['銀行轉帳', '銀行轉帳／匯款'],
  ['信用卡', '信用卡'],
  ['金融卡', '簽帳金融卡'],
  ['行動支付', '行動／電子支付'],
  ['支票', '支票'],
  ['分期付款', '分期付款'],
  ['貴金屬折抵', '貴金屬／舊金折抵'],
  ['混合付款', '多種方式／混合付款'],
  ['其他', '其他'],
] as const;

export function paymentMethodLabel(value: string): string {
  if (!value) return '未選擇';
  return PAYMENT_METHOD_OPTIONS.find(([key]) => key === value)?.[1] ?? value;
}

/**
 * Older drafts may contain a free-text payment method. Keep it selectable so
 * opening the new dropdown never silently clears an existing draft value.
 */
export function paymentMethodOptions(
  currentValue: string,
): ReadonlyArray<readonly [string, string]> {
  if (!currentValue || PAYMENT_METHOD_OPTIONS.some(([key]) => key === currentValue)) {
    return PAYMENT_METHOD_OPTIONS;
  }
  return [[currentValue, `${currentValue}（既有值）`] as const, ...PAYMENT_METHOD_OPTIONS];
}
