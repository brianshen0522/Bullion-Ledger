import { describe, expect, it, vi } from 'vitest';

import { PurchasesController } from '../src/purchases/purchases.controller';
import type { PurchaseDto } from '../src/purchases/dto/purchase.dto';

describe('PurchasesController create audit context', () => {
  it('passes the stable idempotency header and trusted Express request metadata', async () => {
    const purchases = { create: vi.fn().mockResolvedValue({ id: 'purchase-1' }) };
    const controller = new PurchasesController(purchases as never);
    const dto = {} as PurchaseDto;
    const request = {
      ip: '10.0.0.8',
      headers: {
        'user-agent': 'test-agent',
        'x-forwarded-for': '203.0.113.99',
      },
    };

    await controller.create(
      dto,
      'purchase:test-key-0001',
      { userId: 'user-1', sessionId: 'session-1' },
      request as never,
    );

    expect(purchases.create).toHaveBeenCalledWith(dto, 'purchase:test-key-0001', {
      userId: 'user-1',
      sessionId: 'session-1',
      ip: '10.0.0.8',
      userAgent: 'test-agent',
    });
  });
});
