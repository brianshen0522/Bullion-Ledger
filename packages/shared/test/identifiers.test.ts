import { describe, expect, it } from 'vitest';

import { CLIENT_DRAFT_ID_PATTERN } from '../src/identifiers.js';

describe('client draft ids', () => {
  it('keeps browser storage and API ids on one bounded format', () => {
    expect(CLIENT_DRAFT_ID_PATTERN.test('draft-01')).toBe(true);
    expect(CLIENT_DRAFT_ID_PATTERN.test('purchase-draft_12345678')).toBe(true);
    expect(CLIENT_DRAFT_ID_PATTERN.test('x')).toBe(false);
    expect(CLIENT_DRAFT_ID_PATTERN.test('-draft-01')).toBe(false);
  });
});
