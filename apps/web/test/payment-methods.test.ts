import { describe, expect, it } from 'vitest';

import {
  PAYMENT_METHOD_OPTIONS,
  paymentMethodLabel,
  paymentMethodOptions,
} from '../src/purchase-wizard/payment-methods';

describe('purchase payment methods', () => {
  it('provides the common selectable payment methods', () => {
    expect(PAYMENT_METHOD_OPTIONS).toEqual(
      expect.arrayContaining([
        ['現金', '現金'],
        ['銀行轉帳', '銀行轉帳／匯款'],
        ['信用卡', '信用卡'],
        ['行動支付', '行動／電子支付'],
        ['其他', '其他'],
      ]),
    );
  });

  it('formats known values and preserves a legacy free-text value', () => {
    expect(paymentMethodLabel('信用卡')).toBe('信用卡');
    expect(paymentMethodLabel('門市禮券')).toBe('門市禮券');
    expect(paymentMethodOptions('門市禮券')[0]).toEqual(['門市禮券', '門市禮券（既有值）']);
  });

  it('does not duplicate a known current value', () => {
    expect(paymentMethodOptions('現金')).toBe(PAYMENT_METHOD_OPTIONS);
    expect(paymentMethodOptions('現金').filter(([key]) => key === '現金')).toHaveLength(1);
  });
});
