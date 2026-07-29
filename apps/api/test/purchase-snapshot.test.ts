import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import {
  PurchaseSnapshotService,
  groupByMetal,
} from '../src/market-prices/purchase-snapshot.service';

describe('grouping purchase lines by metal', () => {
  it('sums cost and fine weight per metal', () => {
    const groups = groupByMetal([
      {
        allocatedCost: new Decimal('100000'),
        fineWeightGrams: new Decimal('37.49625'),
        metal: { id: 'm-xau', code: 'XAU' },
      },
      {
        allocatedCost: new Decimal('50000'),
        fineWeightGrams: new Decimal('18.748125'),
        metal: { id: 'm-xau', code: 'XAU' },
      },
      {
        allocatedCost: new Decimal('8000'),
        fineWeightGrams: new Decimal('311.035'),
        metal: { id: 'm-xag', code: 'XAG' },
      },
    ]);

    expect(groups.get('XAU')?.allocatedCost.toString()).toBe('150000');
    expect(groups.get('XAU')?.fineWeightGrams.toString()).toBe('56.244375');
    expect(groups.get('XAG')?.allocatedCost.toString()).toBe('8000');
    expect(groups.size).toBe(2);
  });
});

interface Harness {
  service: PurchaseSnapshotService;
  upsert: ReturnType<typeof vi.fn>;
}

function harness(options: {
  purchaseCurrency?: string;
  quoteCurrency?: string;
  pricePerGram?: string;
  fxRate?: string | null;
  allocatedCost?: string;
  fineWeightGrams?: string;
  priceMissing?: boolean;
}): Harness {
  const upsert = vi.fn().mockResolvedValue({});
  const prisma = {
    purchase: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'purchase-1',
        currency: options.purchaseCurrency ?? 'TWD',
        purchasedAt: new Date('2026-07-28T02:00:00.000Z'),
        items: [
          {
            allocatedCost: new Decimal(options.allocatedCost ?? '130000'),
            fineWeightGrams: new Decimal(options.fineWeightGrams ?? '37.49625'),
            metal: { id: 'm-xau', code: 'XAU' },
          },
        ],
      }),
    },
    purchasePriceSnapshot: { upsert },
  };

  const market = {
    displayCurrency: 'TWD',
    latestFxRate: vi
      .fn()
      .mockResolvedValue(
        options.fxRate === null
          ? null
          : { rate: new Decimal(options.fxRate ?? '32.327371'), timestamp: new Date() },
      ),
    priceAt: vi.fn().mockResolvedValue(
      options.priceMissing
        ? null
        : {
            pricePerGram: new Decimal(options.pricePerGram ?? '100'),
            row: {
              timestamp: new Date('2026-07-28T01:00:00.000Z'),
              quoteCurrency: options.quoteCurrency ?? 'USD',
              provider: 'gold-api',
            },
          },
    ),
  };

  return {
    service: new PurchaseSnapshotService(prisma as never, market as never),
    upsert,
  };
}

describe('purchase-time snapshot (PRD §9, §10.3)', () => {
  it('converts spot into the purchase currency and derives the premium paid', async () => {
    // 100 USD/g × 32.327371 = 3232.7371 TWD/g.
    // 37.49625 g fine × 3232.7371 = 121,215.5185 TWD melt value,
    // against a 130,000 TWD purchase → 8,784.4815 paid over melt.
    const { service, upsert } = harness({});

    const result = await service.capture('purchase-1');

    expect(result.metals).toBe(1);
    expect(result.skipped).toEqual([]);

    const [[args]] = upsert.mock.calls as [[{ create: Record<string, string> }]];
    expect(args.create.pricePerGram).toBe('3232.7371');
    expect(args.create.intrinsicValue).toBe('121215.5185');
    expect(args.create.premiumAmount).toBe('8784.4815');
    // 8784.4815 / 121215.5185 ≈ 7.247%.
    expect(args.create.premiumRate).toBe('0.07246994');
    expect(args.create.fxRate).toBe('32.327371');
  });

  it('records the per-qian price Taiwanese dealers actually quote', async () => {
    const { service, upsert } = harness({});
    await service.capture('purchase-1');

    const [[args]] = upsert.mock.calls as [[{ create: Record<string, string> }]];
    // 3232.7371 × 3.75 g.
    expect(args.create.pricePerQian).toBe('12122.764125');
  });

  it('applies no FX when the quote is already in the purchase currency', async () => {
    const { service, upsert } = harness({
      quoteCurrency: 'TWD',
      pricePerGram: '3232.7371',
    });
    await service.capture('purchase-1');

    const [[args]] = upsert.mock.calls as [[{ create: Record<string, string | null> }]];
    expect(args.create.fxRate).toBeNull();
    expect(args.create.pricePerGram).toBe('3232.7371');
  });

  it('reports a negative premium when the purchase was below melt', async () => {
    const { service, upsert } = harness({ allocatedCost: '100000' });
    await service.capture('purchase-1');

    const [[args]] = upsert.mock.calls as [[{ create: Record<string, string> }]];
    expect(new Decimal(args.create.premiumAmount).isNegative()).toBe(true);
  });

  it('skips a metal with no usable price instead of inventing one', async () => {
    const { service, upsert } = harness({ priceMissing: true });

    const result = await service.capture('purchase-1');

    expect(result.skipped).toEqual(['XAU']);
    expect(result.metals).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('skips when a cross-currency purchase has no FX rate available', async () => {
    const { service, upsert } = harness({ fxRate: null });

    const result = await service.capture('purchase-1');

    expect(result.skipped).toEqual(['XAU']);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('records a zero rate rather than a division by zero for a weightless line', async () => {
    const { service, upsert } = harness({ fineWeightGrams: '0' });
    await service.capture('purchase-1');

    const [[args]] = upsert.mock.calls as [[{ create: Record<string, string> }]];
    expect(args.create.intrinsicValue).toBe('0');
    expect(args.create.premiumRate).toBe('0');
  });
});
