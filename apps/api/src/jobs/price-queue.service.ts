import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  BACKFILL_JOB_OPTIONS,
  DEFAULT_JOB_OPTIONS,
  DEFAULT_SCHEDULE,
  PRICE_QUEUE,
  PURCHASE_SNAPSHOT_JOB_OPTIONS,
  PriceJob,
  type BackfillPayload,
  type PurchaseSnapshotPayload,
  type ScheduleConfig,
} from './price-jobs.js';

/**
 * Enqueues market-data work (PRD §12.3).
 *
 * Enqueuing must never break the request that triggered it: recording a
 * purchase has already committed by the time a snapshot is requested, so a
 * Redis hiccup is logged and swept up by the reconciliation tick rather than
 * failing a write the user has been told succeeded.
 */
@Injectable()
export class PriceQueueService {
  private readonly logger = new Logger('PriceQueue');

  constructor(@InjectQueue(PRICE_QUEUE) private readonly queue: Queue) {}

  /** PRD §12.3: fetch market data the moment a purchase is recorded. */
  async requestPurchaseSnapshot(purchaseId: string): Promise<void> {
    const payload: PurchaseSnapshotPayload = { purchaseId };
    try {
      await this.queue.add(PriceJob.PurchaseSnapshot, payload, {
        ...PURCHASE_SNAPSHOT_JOB_OPTIONS,
        // One outstanding job per purchase, however many times it is requested.
        jobId: jobKey('purchase-snapshot', purchaseId),
      });
    } catch (error) {
      this.logger.warn(
        `Could not enqueue snapshot for purchase ${purchaseId}: ${(error as Error).message}`,
      );
    }
  }

  async requestLatestSync(): Promise<void> {
    await this.queue.add(PriceJob.SyncLatest, {}, DEFAULT_JOB_OPTIONS);
  }

  /**
   * Queues a historical backfill. Never run inline in a request: the range is
   * one upstream call per missing day, which would hold an HTTP connection open
   * for minutes.
   */
  async requestBackfill(metalCode: string, from: Date, to: Date): Promise<{ jobId: string }> {
    const payload: BackfillPayload = {
      metalCode: metalCode.toUpperCase(),
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
    };
    // Keyed by metal and range so an impatient double-click is one job.
    const jobId = jobKey(
      'backfill',
      payload.metalCode,
      payload.fromIso.slice(0, 10),
      payload.toIso.slice(0, 10),
    );
    await this.queue.add(PriceJob.BackfillHistory, payload, {
      ...BACKFILL_JOB_OPTIONS,
      jobId,
    });
    return { jobId };
  }

  /**
   * Declares the repeatable schedule. Stale repeat definitions are removed
   * first so changing an interval does not leave the old cadence running
   * alongside the new one.
   */
  async installSchedule(schedule: ScheduleConfig = DEFAULT_SCHEDULE): Promise<void> {
    for (const existing of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(existing.key);
    }

    await this.queue.add(
      PriceJob.SyncLatest,
      {},
      { ...DEFAULT_JOB_OPTIONS, repeat: { every: schedule.latestEveryMs } },
    );
    await this.queue.add(
      PriceJob.SyncFx,
      {},
      { ...DEFAULT_JOB_OPTIONS, repeat: { pattern: schedule.fxCron } },
    );
    await this.queue.add(
      PriceJob.HourlySnapshot,
      {},
      { ...DEFAULT_JOB_OPTIONS, repeat: { pattern: schedule.hourlyCron } },
    );
    await this.queue.add(
      PriceJob.DailySnapshot,
      {},
      { ...DEFAULT_JOB_OPTIONS, repeat: { pattern: schedule.dailyCron } },
    );

    this.logger.log(
      `Installed price schedule: latest every ${schedule.latestEveryMs}ms, fx "${schedule.fxCron}", hourly "${schedule.hourlyCron}", daily "${schedule.dailyCron}"`,
    );
  }
}

/**
 * Builds a deduplicating BullMQ job id.
 *
 * BullMQ rejects `:` in a custom id — that character delimits its own Redis key
 * scheme — so parts are joined with `-` and any embedded delimiter is stripped.
 * Getting this wrong disables deduplication silently: the enqueue throws rather
 * than the duplicate being skipped.
 */
export function jobKey(...parts: readonly string[]): string {
  return parts.map((part) => part.replace(/:/g, '-')).join('-');
}
