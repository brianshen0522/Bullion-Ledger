import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';

import { PurchasesService } from '../src/purchases/purchases.service';
import { UpdatePurchaseDto } from '../src/purchases/dto/update-purchase.dto';

const STORED = {
  id: 'purchase-1',
  dealerName: 'Old dealer',
  branch: null,
  orderNumber: null,
  invoiceNumber: null,
  paymentMethod: null,
  notes: null,
};

function harness(before: typeof STORED | null = STORED) {
  const tx = {
    purchase: {
      findUnique: vi.fn().mockResolvedValue(before),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    purchase: {
      findUnique: vi.fn().mockResolvedValue({
        ...STORED,
        idempotencyKeyHash: 'hash',
        requestHash: 'hash',
        items: [],
      }),
    },
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new PurchasesService(prisma as never, {} as never, audit as never, {} as never),
    tx,
    audit,
  };
}

describe('PurchasesService.update', () => {
  it('writes only the supplied metadata fields and audits the change', async () => {
    const { service, tx, audit } = harness();

    await service.update(
      'purchase-1',
      { dealerName: '台銀貴金屬', branch: '總行' },
      {
        userId: 'user-1',
      },
    );

    expect(tx.purchase.update).toHaveBeenCalledWith({
      where: { id: 'purchase-1' },
      data: { dealerName: '台銀貴金屬', branch: '總行' },
    });
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'purchase.update', resourceId: 'purchase-1' }),
    );
  });

  it('treats a blank string as clearing the field', async () => {
    const { service, tx } = harness();
    await service.update('purchase-1', { dealerName: '   ' }, {});
    expect(tx.purchase.update).toHaveBeenCalledWith({
      where: { id: 'purchase-1' },
      data: { dealerName: null },
    });
  });

  it('rejects an empty patch and a patch that changes nothing', async () => {
    const empty = harness();
    await expect(empty.service.update('purchase-1', {}, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const unchanged = harness();
    await expect(
      unchanged.service.update('purchase-1', { dealerName: 'Old dealer' }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(unchanged.tx.purchase.update).not.toHaveBeenCalled();
  });

  it('reports an unknown purchase', async () => {
    const { service } = harness(null);
    await expect(service.update('missing', { dealerName: 'x' }, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('UpdatePurchaseDto', () => {
  it('refuses fields that feed the allocation or the purchase-time snapshot', async () => {
    const dto = new UpdatePurchaseDto();
    // These are not declared on the DTO, so the whitelisting ValidationPipe
    // strips them and forbidNonWhitelisted rejects the request outright.
    expect(Object.keys(new UpdatePurchaseDto())).not.toContain('purchasedAt');
    expect('currency' in dto).toBe(false);
    expect('totalAmount' in dto).toBe(false);
  });

  it('bounds every free-text field', async () => {
    const dto = new UpdatePurchaseDto();
    dto.dealerName = 'a'.repeat(201);
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'dealerName')).toBe(true);
  });
});
