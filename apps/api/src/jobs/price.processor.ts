import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { MarketPricesService } from '../market-prices/market-prices.service.js';
import { PurchaseSnapshotService } from '../market-prices/purchase-snapshot.service.js';
import {
  PRICE_QUEUE,
  PriceJob,
  type BackfillPayload,
  type PurchaseSnapshotPayload,
} from './price-jobs.js';

/**
 * Executes market-data jobs (PRD §12.3, §18.5).
 *
 * Handlers throw on failure so BullMQ applies the configured backoff — a job
 * that swallows its own error looks successful and silently stops retrying.
 */
@Processor(PRICE_QUEUE, { concurrency: 2 })
export class PriceProcessor extends WorkerHost {
  private readonly logger = new Logger('PriceWorker');

  constructor(
    private readonly market: MarketPricesService,
    private readonly purchaseSnapshots: PurchaseSnapshotService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case PriceJob.SyncLatest:
      case PriceJob.HourlySnapshot:
      case PriceJob.DailySnapshot:
        return this.syncLatest(job.name);
      case PriceJob.SyncFx:
        return this.syncFx();
      case PriceJob.PurchaseSnapshot:
        return this.capturePurchase(job.data as PurchaseSnapshotPayload);
      case PriceJob.BackfillHistory:
        return this.backfill(job.data as BackfillPayload);
      default:
        this.logger.warn(`Ignoring unknown job "${job.name}"`);
        return { ignored: true };
    }
  }

  /**
   * All three cadences write through the same dedupe path. The hourly and
   * daily ticks exist to guarantee a durable point even if the 5-minute tick
   * was failing; when it was not, the unique constraint makes them no-ops.
   */
  private async syncLatest(jobName: string) {
    const result = await this.market.syncLatest();
    this.logger.log(`${jobName}: stored ${result.stored} quote(s) from ${result.provider}`);

    // Newly-arrived prices may be exactly what a pending purchase was waiting
    // for, so reconcile in the same pass (PRD §9 background retry).
    await this.reconcilePendingPurchases();
    return result;
  }

  private async syncFx() {
    const result = await this.market.syncFxRate();
    this.logger.log(`sync-fx: rate ${result.rate}${result.stored ? ' (stored)' : ' (unchanged)'}`);
    return result;
  }

  private async capturePurchase(payload: PurchaseSnapshotPayload) {
    const result = await this.purchaseSnapshots.capture(payload.purchaseId);
    if (result.skipped.length > 0) {
      // Throwing keeps the job retrying until a price exists for every metal.
      throw new Error(
        `purchase ${payload.purchaseId} still missing prices for ${result.skipped.join(', ')}`,
      );
    }
    return result;
  }

  private async backfill(payload: BackfillPayload) {
    const result = await this.market.backfillHistory(
      payload.metalCode,
      new Date(payload.fromIso),
      new Date(payload.toIso),
    );
    this.logger.log(
      `backfill-history ${payload.metalCode}: stored ${result.stored} day(s), ` +
        `${result.skippedDays} already held`,
    );

    // Backfilled history often covers the purchase dates that were previously
    // unvaluable, so retry them straight away rather than at the next tick.
    await this.reconcilePendingPurchases();
    return result;
  }

  private async reconcilePendingPurchases(): Promise<void> {
    const pending = await this.purchaseSnapshots.pendingPurchaseIds(25);
    for (const purchaseId of pending) {
      try {
        await this.purchaseSnapshots.capture(purchaseId);
      } catch (error) {
        this.logger.warn(`Reconciling purchase ${purchaseId} failed: ${(error as Error).message}`);
      }
    }
  }
}
