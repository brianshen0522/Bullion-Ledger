import { BadRequestException, ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { MovementsService } from '../src/movements/movements.service';

const HELD_LOT = {
  id: 'asset-1',
  status: 'HELD',
  version: 3,
  quantity: 4,
  fineWeightGrams: new Decimal('40'),
  grossWeightGrams: new Decimal('40'),
  allocatedCost: new Decimal('1000'),
  currency: 'USD',
  storageLocation: 'Safe',
  metal: { code: 'XAU' },
};

function harness(options: { asset?: Record<string, unknown>; quoteCurrency?: string } = {}) {
  const tx = {
    asset: {
      findUnique: vi.fn().mockResolvedValue({ ...HELD_LOT, ...options.asset }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'asset-2' }),
    },
    assetMovement: { create: vi.fn().mockResolvedValue({ id: 'movement-1' }) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    assetMovement: { findMany: vi.fn() },
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const market = {
    displayCurrency: 'TWD',
    priceBaseCurrency: 'USD',
    priceAt: vi.fn().mockResolvedValue({
      pricePerGram: new Decimal('100'),
      row: { quoteCurrency: options.quoteCurrency ?? 'USD' },
    }),
    latestFxRate: vi.fn().mockResolvedValue({ rate: new Decimal('30') }),
  };
  const metals = { requireByCode: vi.fn().mockResolvedValue({ id: 'metal-1', active: true }) };
  return {
    service: new MovementsService(
      prisma as never,
      audit as never,
      market as never,
      metals as never,
    ),
    prisma,
    tx,
  };
}

const GIFT = {
  occurredAt: new Date('2026-07-01T00:00:00.000Z'),
  metalCode: 'XAU',
  name: 'Gift bar',
  quantity: 1,
  unitWeight: '10',
  weightUnit: 'g' as const,
  purity: '0.9999',
};

describe('MovementsService storage transfer', () => {
  it.each(['SOLD', 'GIFTED', 'LOST', 'DAMAGED'])('refuses to move a %s lot', async (status) => {
    const { service, tx } = harness({ asset: { status } });

    await expect(
      service.transferStorage({
        assetId: 'asset-1',
        occurredAt: new Date(),
        toStorageLocation: 'Vault',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.asset.updateMany).not.toHaveBeenCalled();
    expect(tx.assetMovement.create).not.toHaveBeenCalled();
  });

  it('still moves a held lot', async () => {
    const { service, tx } = harness();

    await service.transferStorage({
      assetId: 'asset-1',
      occurredAt: new Date(),
      toStorageLocation: 'Vault',
    });

    expect(tx.assetMovement.create).toHaveBeenCalledOnce();
  });
});

describe('MovementsService gift received', () => {
  it('rejects a holding with no weight', async () => {
    const { service, prisma } = harness();

    await expect(service.giftIn({ ...GIFT, unitWeight: '0' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('values the gift through the base-currency FX rate', async () => {
    const { service, tx } = harness();

    await service.giftIn(GIFT);

    const [[args]] = tx.asset.create.mock.calls as [[{ data: Record<string, unknown> }]];
    expect(args.data).toMatchObject({ currency: 'TWD', allocatedCost: '29997.0000' });
  });

  it('does not apply the base-currency FX rate to a quote in another currency', async () => {
    const { service, tx } = harness({ quoteCurrency: 'EUR' });

    await service.giftIn(GIFT);

    const [[args]] = tx.asset.create.mock.calls as [[{ data: Record<string, unknown> }]];
    expect(args.data).toMatchObject({ currency: 'TWD', allocatedCost: '0.0000' });
  });
});

describe('MovementsService realized P&L currency', () => {
  it('books a loss in the currency of the lot, not of the market', async () => {
    const { service, tx } = harness();

    await service.markLost({ assetId: 'asset-1', occurredAt: new Date(), quantity: 1 });

    const [[args]] = tx.assetMovement.create.mock.calls as [[{ data: Record<string, unknown> }]];
    expect(args.data).toMatchObject({
      realizedPnl: '-250.0000',
      currency: 'USD',
      marketCurrency: 'TWD',
    });
  });

  it('leaves a gift out without a currency, since it books no P&L', async () => {
    const { service, tx } = harness();

    await service.giftOut({ assetId: 'asset-1', occurredAt: new Date(), quantity: 1 });

    const [[args]] = tx.assetMovement.create.mock.calls as [[{ data: Record<string, unknown> }]];
    expect(args.data).toMatchObject({ realizedPnl: null, currency: null });
  });

  it('totals a loss recorded without a currency under its lot currency', async () => {
    const { service, prisma } = harness();
    prisma.assetMovement.findMany.mockResolvedValue([
      { realizedPnl: new Decimal('100'), currency: 'USD', asset: { currency: 'USD' } },
      { realizedPnl: new Decimal('-40'), currency: null, asset: { currency: 'USD' } },
    ]);

    await expect(service.realizedTotals()).resolves.toEqual({
      amount: '60.00',
      currency: 'USD',
      currencies: ['USD'],
    });
  });
});
