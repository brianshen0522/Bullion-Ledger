import { Injectable, UnauthorizedException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { assertWeightUnit, isWeightUnit, type WeightUnit } from '@bullion-ledger/shared';

import { PurchasesService } from '../purchases/purchases.service.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { MarketPricesService } from '../market-prices/market-prices.service.js';
import { MovementsService } from '../movements/movements.service.js';
import { valuePortfolio } from './valuation.js';

/**
 * Dashboard summary (PRD §11.1). Phase 1 surfaces the cost/holdings facts
 * that can be derived from already-recorded data. Market-derived numbers
 * (intrinsic value, unrealized P&L) require a live price provider and are
 * intentionally NOT fabricated; they remain absent until Phase 2 wiring.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly market: MarketPricesService,
    private readonly movements: MovementsService,
  ) {}

  async summary(userId: string) {
    const [base, user, prices, premium, pendingPrices, realized] = await Promise.all([
      this.purchases.summary(),
      this.prisma.appUser.findUnique({
        where: { id: userId },
        select: { dashboardWeightUnit: true },
      }),
      // A price outage must degrade the Dashboard, not break it.
      this.market.latest().catch(() => []),
      this.premiumTotals(),
      this.countPurchasesAwaitingPrices(),
      // PRD §11.1 已實現損益, from the movement ledger.
      this.movements.realizedTotals(),
    ]);
    if (!user) throw new UnauthorizedException('Session invalid');

    const valuation = valuePortfolio(base.byMetal, prices, this.market.displayCurrency);

    return {
      ...base,
      weightUnit: isWeightUnit(user.dashboardWeightUnit) ? user.dashboardWeightUnit : 'g',
      // PRD §10.2 / §10.4 / §10.7. Still null when no price exists — absent is
      // honest, a fabricated number is not.
      valuationCurrency: valuation.currency,
      intrinsicValue: valuation.intrinsicValue,
      unrealizedPnl: valuation.unrealizedPnl,
      returnRate: valuation.returnRate,
      valuationByMetal: valuation.byMetal,
      unpricedMetals: valuation.unpricedMetals,
      notice: valuation.notice,
      priceAsOf: valuation.priceAsOf,
      // PRD §11.1: cumulative premium paid, and the count of transactions whose
      // market data has not been filled in yet.
      premiumPaid: premium.amount,
      premiumCurrency: premium.currency,
      premiumCurrencies: premium.currencies,
      realizedPnl: realized.amount,
      realizedCurrency: realized.currency,
      realizedCurrencies: realized.currencies,
      purchasesAwaitingPrices: pendingPrices,
    };
  }

  /**
   * Sum of premium recorded on purchase snapshots (PRD §11.1 累計支付溢價).
   *
   * Reports the currencies it found even when it cannot total them, so the UI
   * can distinguish "nothing recorded yet" from "recorded, but spanning
   * currencies that must not be added together".
   */
  private async premiumTotals(): Promise<{
    amount: string | null;
    currency: string | null;
    currencies: string[];
  }> {
    const snapshots = await this.prisma.purchasePriceSnapshot.findMany({
      select: { premiumAmount: true, purchase: { select: { currency: true } } },
    });
    if (snapshots.length === 0) return { amount: null, currency: null, currencies: [] };

    const currencies = [...new Set(snapshots.map((row) => row.purchase.currency))].sort();
    // Never add amounts denominated in different currencies.
    if (currencies.length !== 1) return { amount: null, currency: null, currencies };

    const total = snapshots.reduce(
      (sum, row) => sum.plus(new Decimal(row.premiumAmount.toString())),
      new Decimal(0),
    );
    return {
      amount: total.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2),
      currency: currencies[0] ?? null,
      currencies,
    };
  }

  /** Purchases still missing a snapshot for at least one of their metals. */
  private async countPurchasesAwaitingPrices(): Promise<number> {
    const purchases = await this.prisma.purchase.findMany({
      select: {
        items: { select: { metalId: true } },
        priceSnapshots: { select: { metalId: true } },
      },
    });
    return purchases.filter((purchase) => {
      const have = new Set(purchase.priceSnapshots.map((snapshot) => snapshot.metalId));
      return purchase.items.some((item) => !have.has(item.metalId));
    }).length;
  }

  async updateWeightUnit(
    userId: string,
    input: WeightUnit,
    sessionId?: string,
  ): Promise<{ weightUnit: WeightUnit }> {
    const weightUnit = assertWeightUnit(input, 'weightUnit');
    const updated = await this.prisma.appUser.updateMany({
      where: { id: userId },
      data: { dashboardWeightUnit: weightUnit },
    });
    if (updated.count !== 1) throw new UnauthorizedException('Session invalid');

    await this.audit.record({
      userId,
      sessionId,
      action: 'account.dashboardWeightUnit.change',
      resourceType: 'AppUser',
      resourceId: userId,
      afterSummary: { weightUnit },
    });
    return { weightUnit };
  }
}
