import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { MarketPricesService } from '../src/market-prices/market-prices.service';
import type { MetalQuote } from '../src/price-providers/price-provider.interface';

function config(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const UNIQUE_VIOLATION = Object.assign(new Error('duplicate'), { code: 'P2002' });

function quote(overrides: Partial<MetalQuote> = {}): MetalQuote {
  return {
    metalCode: 'XAU',
    price: '3110.34768',
    quoteCurrency: 'USD',
    quoteUnit: 'troy_oz',
    quotedAt: new Date('2026-07-28T12:00:00.000Z'),
    sourceType: 'SPOT',
    ...overrides,
  };
}

function build(options: { createRejects?: unknown; metal?: { id: string } | null } = {}) {
  const create = options.createRejects
    ? vi.fn().mockRejectedValue(options.createRejects)
    : vi.fn().mockResolvedValue({ id: 'snapshot-1' });

  const prisma = {
    metal: {
      findUnique: vi
        .fn()
        .mockResolvedValue(options.metal === undefined ? { id: 'metal-xau' } : options.metal),
      findMany: vi.fn().mockResolvedValue([{ id: 'metal-xau', code: 'XAU' }]),
    },
    spotPriceSnapshot: { create, findFirst: vi.fn(), upsert: vi.fn() },
    fxRateSnapshot: { create: vi.fn(), findFirst: vi.fn() },
  };
  const providers = { fetchLatest: vi.fn(), fetchFxRate: vi.fn(), fetchHistory: vi.fn() };
  const service = new MarketPricesService(
    prisma as never,
    providers as never,
    config({ PRICE_BASE_CURRENCY: 'USD', DEFAULT_CURRENCY: 'TWD' }),
  );
  return { service, prisma, providers, create };
}

describe('storing a quote (PRD §12.4)', () => {
  it('normalizes a troy-ounce quote to price per gram before writing', async () => {
    const { service, create } = build();

    await service.storeQuote(quote(), 'gold-api');

    const [[args]] = create.mock.calls as [[{ data: Record<string, string> }]];
    // 3110.34768 USD/ozt ÷ 31.1034768 g = exactly 100 USD/g.
    expect(args.data.normalizedPricePerGram).toBe('100');
    expect(args.data.price).toBe('3110.34768');
    expect(args.data.quoteUnit).toBe('troy_oz');
  });

  it('preserves the source type rather than collapsing it to spot', async () => {
    const { service, create } = build();

    await service.storeQuote(quote({ sourceType: 'DEALER_BUYBACK' }), 'manual-dealer');

    const [[args]] = create.mock.calls as [[{ data: Record<string, string> }]];
    expect(args.data.sourceType).toBe('DEALER_BUYBACK');
  });

  it('treats a duplicate row as a no-op instead of an error', async () => {
    const { service } = build({ createRejects: UNIQUE_VIOLATION });

    // PRD §12.4: the same source, metal and instant must not be written twice.
    await expect(service.storeQuote(quote(), 'gold-api')).resolves.toBe(false);
  });

  it('propagates a genuine database error', async () => {
    const { service } = build({ createRejects: new Error('connection lost') });

    await expect(service.storeQuote(quote(), 'gold-api')).rejects.toThrow('connection lost');
  });

  it('skips a quote for a metal that is not in the catalog', async () => {
    const { service, create } = build({ metal: null });

    await expect(service.storeQuote(quote({ metalCode: 'XPD' }), 'gold-api')).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('uppercases the metal code when looking the metal up', async () => {
    const { service, prisma } = build();

    await service.storeQuote(quote({ metalCode: 'xau' }), 'gold-api');
    expect(prisma.metal.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'XAU' } }),
    );
  });
});

describe('FX handling', () => {
  it('reports a rate of 1 and stores nothing when base equals display', async () => {
    const prisma = { fxRateSnapshot: { create: vi.fn() } };
    const service = new MarketPricesService(
      prisma as never,
      {} as never,
      config({ PRICE_BASE_CURRENCY: 'TWD', DEFAULT_CURRENCY: 'TWD' }),
    );

    await expect(service.syncFxRate()).resolves.toEqual({ stored: false, rate: '1' });
    expect(prisma.fxRateSnapshot.create).not.toHaveBeenCalled();
  });

  it('treats a repeated identical rate as already recorded', async () => {
    const { service, prisma, providers } = build();
    providers.fetchFxRate.mockResolvedValue({
      baseCurrency: 'USD',
      quoteCurrency: 'TWD',
      rate: '32.327371',
      quotedAt: new Date('2026-07-28T00:00:00.000Z'),
    });
    prisma.fxRateSnapshot.create.mockRejectedValue(UNIQUE_VIOLATION);

    await expect(service.syncFxRate()).resolves.toEqual({ stored: false, rate: '32.327371' });
  });
});

describe('display conversion', () => {
  it('converts a USD quote into TWD and every display unit', async () => {
    const { service, prisma } = build();
    prisma.spotPriceSnapshot.findFirst.mockResolvedValue({
      timestamp: new Date('2026-07-28T12:00:00.000Z'),
      price: { toString: () => '3110.34768' },
      quoteCurrency: 'USD',
      quoteUnit: 'troy_oz',
      normalizedPricePerGram: { toString: () => '100' },
      provider: 'gold-api',
      sourceType: 'SPOT',
    });
    prisma.fxRateSnapshot.findFirst.mockResolvedValue({
      rate: { toString: () => '32.327371' },
      timestamp: new Date('2026-07-28T00:00:00.000Z'),
    });

    const [latest] = await service.latest();

    expect(latest.pricePerGramDisplay).toBe('3232.737100');
    // 3232.7371 × 3.75 g per 台錢.
    expect(latest.pricePerQianDisplay).toBe('12122.7641');
    expect(latest.displayCurrency).toBe('TWD');
    expect(latest.fxRate).toBe('32.327371');
  });

  it('reports no converted price rather than a wrong one when FX is missing', async () => {
    const { service, prisma } = build();
    prisma.spotPriceSnapshot.findFirst.mockResolvedValue({
      timestamp: new Date(),
      price: { toString: () => '3110.34768' },
      quoteCurrency: 'USD',
      quoteUnit: 'troy_oz',
      normalizedPricePerGram: { toString: () => '100' },
      provider: 'gold-api',
      sourceType: 'SPOT',
    });
    prisma.fxRateSnapshot.findFirst.mockResolvedValue(null);

    const [latest] = await service.latest();
    expect(latest.pricePerGram).toBe('100');
    expect(latest.pricePerGramDisplay).toBeNull();
  });

  it('does not convert a quote in an unexpected third currency', async () => {
    const { service, prisma } = build();
    prisma.spotPriceSnapshot.findFirst.mockResolvedValue({
      timestamp: new Date(),
      price: { toString: () => '2800' },
      quoteCurrency: 'EUR',
      quoteUnit: 'troy_oz',
      normalizedPricePerGram: { toString: () => '90' },
      provider: 'someone',
      sourceType: 'SPOT',
    });
    prisma.fxRateSnapshot.findFirst.mockResolvedValue({
      rate: { toString: () => '32.327371' },
      timestamp: new Date(),
    });

    const [latest] = await service.latest();
    // A USD→TWD rate must never be applied to a EUR quote.
    expect(latest.pricePerGramDisplay).toBeNull();
  });
});
