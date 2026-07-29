import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { PriceSourceType, WeightUnit } from '@bullion-ledger/shared';

import { MarketPricesService } from './market-prices.service.js';
import { PriceProviderRegistry } from '../price-providers/price-provider.registry.js';
import { MarketMarkersService } from './market-markers.service.js';
import { PriceQueueService } from '../jobs/price-queue.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BackfillDto, HistoryQueryDto, ManualPriceDto, MarkerQueryDto } from './dto/market.dto.js';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator.js';

/** Longest history window served in one request. */
const MAX_HISTORY_DAYS = 400;
const DEFAULT_HISTORY_DAYS = 90;

/**
 * Market data read/write surface (PRD §22.4). Every route requires a session:
 * this is a single-user private ledger, and even public market data reveals
 * that this deployment exists and what it tracks.
 */
@Controller('market')
export class MarketPricesController {
  constructor(
    private readonly market: MarketPricesService,
    private readonly providers: PriceProviderRegistry,
    private readonly markersService: MarketMarkersService,
    private readonly queue: PriceQueueService,
    private readonly audit: AuditService,
  ) {}

  @Get('latest')
  latest() {
    return this.market.latest();
  }

  @Get('history')
  async history(@Query() query: HistoryQueryDto) {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_HISTORY_DAYS * 86_400_000);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('from must be before to');
    }
    if (to.getTime() - from.getTime() > MAX_HISTORY_DAYS * 86_400_000) {
      throw new BadRequestException(`range must not exceed ${MAX_HISTORY_DAYS} days`);
    }

    return {
      metal: query.metal.toUpperCase(),
      from: from.toISOString(),
      to: to.toISOString(),
      points: await this.market.history({
        metalCode: query.metal,
        from,
        to,
        sourceType: query.sourceType as PriceSourceType | undefined,
      }),
    };
  }

  /** PRD §22.4: buy points and cost lines for the market chart. */
  @Get('purchase-markers')
  markers(@Query() query: MarkerQueryDto) {
    return this.markersService.forMetal(query.metal);
  }

  @Get('providers/status')
  async providerStatus() {
    return {
      displayCurrency: this.market.displayCurrency,
      supportedMetals: this.providers.supportedMetals(),
      providers: await this.providers.status(),
    };
  }

  /** PRD §9: the user can always enter a price by hand when a feed is down. */
  @Post('manual-price')
  @HttpCode(201)
  async manualPrice(@Body() dto: ManualPriceDto, @CurrentUser() user: AuthContext | null) {
    const stored = await this.market.recordManualPrice({
      metalCode: dto.metalCode,
      price: dto.price,
      quoteCurrency: dto.quoteCurrency,
      quoteUnit: dto.quoteUnit as WeightUnit,
      timestamp: dto.timestamp,
      sourceType: dto.sourceType as PriceSourceType | undefined,
    });

    await this.audit.record({
      userId: user?.userId,
      sessionId: user?.sessionId,
      action: 'market.manualPrice.record',
      resourceType: 'SpotPriceSnapshot',
      afterSummary: {
        metalCode: stored.metalCode,
        price: stored.price,
        quoteCurrency: stored.quoteCurrency,
        quoteUnit: stored.quoteUnit,
        sourceType: stored.sourceType,
        note: dto.note,
      },
    });
    return stored;
  }

  /**
   * Queues a historical backfill. Accepted rather than performed inline: the
   * range costs one upstream request per missing day, which would hold the
   * connection open far past any sensible request timeout.
   */
  @Post('backfill')
  @HttpCode(202)
  async backfill(@Body() dto: BackfillDto, @CurrentUser() user: AuthContext | null) {
    if (dto.from.getTime() > dto.to.getTime()) {
      throw new BadRequestException('from must be before to');
    }
    if (dto.to.getTime() - dto.from.getTime() > MAX_HISTORY_DAYS * 86_400_000) {
      throw new BadRequestException(`range must not exceed ${MAX_HISTORY_DAYS} days`);
    }

    const pendingDays = await this.market.missingHistoryDays(dto.metalCode, dto.from, dto.to);
    const { jobId } = await this.queue.requestBackfill(dto.metalCode, dto.from, dto.to);

    await this.audit.record({
      userId: user?.userId,
      sessionId: user?.sessionId,
      action: 'market.history.backfill',
      resourceType: 'SpotPriceSnapshot',
      afterSummary: {
        metalCode: dto.metalCode.toUpperCase(),
        from: dto.from.toISOString(),
        to: dto.to.toISOString(),
        pendingDays: pendingDays.length,
        jobId,
      },
    });
    return { queued: true, jobId, pendingDays: pendingDays.length };
  }

  /** Manual "fetch now", for when the user does not want to wait for the tick. */
  @Post('sync')
  @HttpCode(200)
  async sync() {
    const prices = await this.market.syncLatest();
    const fx = await this.market.syncFxRate().catch(() => ({ stored: false, rate: null }));
    return { ...prices, fxRate: fx.rate };
  }
}
