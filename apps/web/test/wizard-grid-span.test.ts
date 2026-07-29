import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  BrandOrganizationSelector,
  OrganizationAssignmentsEditor,
} from '../src/purchase-wizard/organization-search.js';

/**
 * The item step lays fields out in a `lg:grid-cols-3` grid. A child declaring a
 * span wider than that (`lg:col-span-6`) makes CSS Grid create implicit,
 * content-sized columns; every sibling then collapses to the width of its own
 * label. It only reproduces at >=1024px, which is why it was invisible on a
 * phone and disfiguring on a desktop.
 *
 * `col-span-full` expresses "the whole row" without naming a count, so it stays
 * correct however many columns the container declares.
 */
const NUMERIC_SPAN = /col-span-\d/;

function rootClassOf(markup: string): string {
  return /class="([^"]*)"/.exec(markup)?.[1] ?? '';
}

describe('full-width children of the item grid', () => {
  it('spans the brand selector across the row without a counted span', () => {
    const markup = renderToStaticMarkup(
      createElement(BrandOrganizationSelector, {
        assignments: [],
        localOptions: [],
        searchProvider: () => Promise.resolve([]),
        onChange: () => undefined,
      }),
    );

    const rootClass = rootClassOf(markup);
    expect(rootClass).toContain('col-span-full');
    expect(rootClass).not.toMatch(NUMERIC_SPAN);
  });

  it('spans the organization editor across the row without a counted span', () => {
    const markup = renderToStaticMarkup(
      createElement(OrganizationAssignmentsEditor, {
        assignments: [],
        localOptions: [],
        searchProvider: () => Promise.resolve([]),
        roles: ['REFINER'],
        roleLabel: '其他來源角色',
        emptyMessage: '尚未指定。',
        onChange: () => undefined,
      }),
    );

    const rootClass = rootClassOf(markup);
    expect(rootClass).toContain('col-span-full');
    expect(rootClass).not.toMatch(NUMERIC_SPAN);
  });
});
