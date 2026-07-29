import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SearchableSelect, nextSearchableSelectIndex } from '../src/SearchableSelect.js';

const options = [
  { value: 'TW', label: 'TW — 台灣', aliases: ['臺灣', 'ROC'] },
  { value: 'US', label: 'US — 美國', aliases: ['USA'] },
] as const;

describe('SearchableSelect', () => {
  it('clamps arrow-key navigation to available options', () => {
    expect(nextSearchableSelectIndex(0, 2, 1)).toBe(1);
    expect(nextSearchableSelectIndex(1, 2, 1)).toBe(1);
    expect(nextSearchableSelectIndex(1, 2, -1)).toBe(0);
    expect(nextSearchableSelectIndex(0, 2, -1)).toBe(0);
    expect(nextSearchableSelectIndex(3, 0, -1)).toBe(0);
  });

  it('renders an accessible controlled combobox with Wizard path and touch target', () => {
    const markup = renderToStaticMarkup(
      createElement(SearchableSelect, {
        id: 'country',
        label: '生產國家',
        value: 'TW',
        onChange: () => undefined,
        options,
        required: true,
        error: '請選擇國家',
        dataPath: 'items.item-1.country',
      }),
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="country-error"');
    expect(markup).toContain('data-wizard-path="items.item-1.country"');
    expect(markup).toContain('min-h-11');
    expect(markup).toContain('value="TW — 台灣"');
    expect(markup).toContain('請選擇國家');
  });

  it('keeps an unknown controlled value visible instead of clearing it', () => {
    const markup = renderToStaticMarkup(
      createElement(SearchableSelect, {
        id: 'legacy-country',
        label: '生產國家',
        value: '舊國家名稱',
        onChange: () => undefined,
        options,
        hint: '可用別名搜尋',
      }),
    );

    expect(markup).toContain('value="舊國家名稱"');
    expect(markup).toContain('aria-describedby="legacy-country-hint"');
    expect(markup).toContain('可用別名搜尋');
  });
});
