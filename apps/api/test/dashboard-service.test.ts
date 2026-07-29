import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DashboardService } from '../src/dashboard/dashboard.service.js';

const heldSummary = {
  heldAssetLots: 1,
  heldAssetUnits: '2',
  purchaseCount: 1,
  costByCurrency: [{ currency: 'TWD', totalCost: '100' }],
  byMetal: [],
};

function makeService(user: { dashboardWeightUnit: string } | null = { dashboardWeightUnit: 'kg' }) {
  const purchases = { summary: vi.fn().mockResolvedValue(heldSummary) };
  const prisma = {
    appUser: {
      findUnique: vi.fn().mockResolvedValue(user),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    purchasePriceSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    purchase: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const market = {
    displayCurrency: 'TWD',
    latest: vi.fn().mockResolvedValue([]),
  };
  const movements = {
    realizedTotals: vi.fn().mockResolvedValue({ amount: null, currency: null, currencies: [] }),
  };
  return {
    service: new DashboardService(
      purchases as never,
      prisma as never,
      audit as never,
      market as never,
      movements as never,
    ),
    purchases,
    prisma,
    audit,
    market,
    movements,
  };
}

/** Valuation fields present when nothing can be priced yet. */
const unpriced = {
  valuationCurrency: 'TWD',
  intrinsicValue: null,
  unrealizedPnl: null,
  returnRate: null,
  valuationByMetal: [],
  unpricedMetals: [],
  notice: null,
  priceAsOf: null,
  premiumPaid: null,
  premiumCurrency: null,
  premiumCurrencies: [],
  realizedPnl: null,
  realizedCurrency: null,
  realizedCurrencies: [],
  purchasesAwaitingPrices: 0,
};

describe('DashboardService user weight preference', () => {
  it('includes the current user database preference in the summary', async () => {
    const { service, prisma } = makeService({ dashboardWeightUnit: 'troy_oz' });

    await expect(service.summary('user-1')).resolves.toEqual({
      ...heldSummary,
      ...unpriced,
      weightUnit: 'troy_oz',
    });
    expect(prisma.appUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { dashboardWeightUnit: true },
    });
  });

  it('updates only the authenticated user and audits the preference', async () => {
    const { service, prisma, audit } = makeService();

    await expect(service.updateWeightUnit('user-1', 'qian', 'session-1')).resolves.toEqual({
      weightUnit: 'qian',
    });
    expect(prisma.appUser.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { dashboardWeightUnit: 'qian' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'session-1',
        action: 'account.dashboardWeightUnit.change',
        afterSummary: { weightUnit: 'qian' },
      }),
    );
  });

  it('rejects a preference request when its session user no longer exists', async () => {
    const missingSummary = makeService(null);
    await expect(missingSummary.service.summary('missing')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const missingUpdate = makeService();
    missingUpdate.prisma.appUser.updateMany.mockResolvedValue({ count: 0 });
    await expect(missingUpdate.service.updateWeightUnit('missing', 'g')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
