import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { MAX_ALLOCATION_ITEMS } from '@bullion-ledger/shared';
import { PurchaseDto } from '../src/purchases/dto/purchase.dto';

function validBody() {
  return {
    purchasedAt: '2026-07-28T00:00:00.000Z',
    currency: 'USD',
    subtotal: '100.00',
    allocationMethod: 'EQUAL',
    items: [
      {
        metalCode: 'XAU',
        form: 'bar',
        name: 'Gold bar',
        quantity: 1,
        unitWeight: '1.000000000',
        weightUnit: 'g',
        purity: '0.9999',
        lineSubtotal: '100.00',
      },
    ],
  };
}

async function validationErrors(body: unknown) {
  return validate(plainToInstance(PurchaseDto, body));
}

describe('PurchaseDto decimal and size boundaries', () => {
  it('accepts canonical plain-decimal input', async () => {
    expect(await validationErrors(validBody())).toHaveLength(0);
  });

  it.each(['NaN', 'Infinity', '-1', '1e2', '0.001', '100000000000000.00'])(
    'rejects invalid money syntax or range: %s',
    async (subtotal) => {
      expect(await validationErrors({ ...validBody(), subtotal })).not.toHaveLength(0);
    },
  );

  it('rejects blank names/forms and over-precision numeric inputs', async () => {
    const body = validBody();
    body.items[0] = {
      ...body.items[0]!,
      form: ' ',
      name: '\t',
      unitWeight: '1.0000000001',
      purity: '0.12345678',
    };
    expect(await validationErrors(body)).not.toHaveLength(0);
  });

  it('rejects an item array above the transaction work ceiling', async () => {
    const body = validBody();
    body.items = Array.from({ length: MAX_ALLOCATION_ITEMS + 1 }, () => ({
      ...body.items[0]!,
    }));
    expect(await validationErrors(body)).not.toHaveLength(0);
  });
});
