import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/api.js';
import { isProductCatalogConflict } from '../src/purchase-wizard/PurchaseWizard.js';

describe('purchase wizard catalog conflict detection', () => {
  it('recognizes only the product version conflict response', () => {
    expect(
      isProductCatalogConflict(new ApiError(409, 'Catalog changed', 'PRODUCT_VERSION_CONFLICT')),
    ).toBe(true);
    expect(isProductCatalogConflict(new ApiError(409, 'Other conflict', 'OTHER_CONFLICT'))).toBe(
      false,
    );
    expect(
      isProductCatalogConflict(new ApiError(400, 'Catalog changed', 'PRODUCT_VERSION_CONFLICT')),
    ).toBe(false);
  });
});
