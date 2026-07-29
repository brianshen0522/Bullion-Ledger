import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  CustomSelect,
  enabledCustomSelectIndex,
  withCurrentCustomSelectOption,
} from '../src/CustomSelect.js';

const options = [
  { value: 'g', label: '公克' },
  { value: 'kg', label: '公斤', disabled: true },
  { value: 'troy_oz', label: '金衡盎司' },
] as const;

describe('CustomSelect', () => {
  it('renders an accessible custom trigger without a native select element', () => {
    const markup = renderToStaticMarkup(
      createElement(CustomSelect, {
        id: 'weight-unit',
        label: '重量單位',
        value: 'g',
        onChange: () => undefined,
        options,
        required: true,
        error: '請選擇重量單位',
        dataPath: 'items.item-1.weightUnit',
      }),
    );

    expect(markup).not.toContain('<select');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="weight-unit-error"');
    expect(markup).toContain('data-wizard-path="items.item-1.weightUnit"');
    expect(markup).toContain('公克');
    expect(markup).toContain('min-h-11');
  });

  it('keeps unknown legacy values available', () => {
    expect(withCurrentCustomSelectOption(options, '台兩')[0]).toEqual({
      value: '台兩',
      label: '台兩',
      description: '既有資料',
    });
    expect(withCurrentCustomSelectOption(options, 'g')).toBe(options);
  });

  it('moves between enabled options without selecting disabled entries', () => {
    expect(enabledCustomSelectIndex(options, 0, 1)).toBe(2);
    expect(enabledCustomSelectIndex(options, 2, -1)).toBe(0);
    expect(enabledCustomSelectIndex(options, 0, -1)).toBe(0);
    expect(enabledCustomSelectIndex([{ value: 'x', label: 'X', disabled: true }], 0, 1)).toBe(-1);
  });

  it('supports a visually hidden compact label and disabled state', () => {
    const markup = renderToStaticMarkup(
      createElement(CustomSelect, {
        id: 'dashboard-unit',
        label: '重量顯示單位',
        hideLabel: true,
        compact: true,
        value: 'g',
        onChange: () => undefined,
        options,
        disabled: true,
      }),
    );

    expect(markup).toContain('class="sr-only"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('px-3 py-1.5 text-sm');
  });
});
