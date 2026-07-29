import type { JobsOptions } from 'bullmq';

/** Single queue for all market-data work. */
export const PRICE_QUEUE = 'market-prices';

/**
 * Job names (PRD §12.3). Kept as literals shared by the scheduler and the
 * worker so a rename cannot silently orphan a repeatable schedule.
 */
export const PriceJob = {
  /** Fetch the newest quote from the provider chain. */
  SyncLatest: 'sync-latest',
  /** Refresh the base→display FX rate. */
  SyncFx: 'sync-fx',
  /** Persist a durable hourly point for the chart. */
  HourlySnapshot: 'hourly-snapshot',
  /** Persist the permanent daily close. */
  DailySnapshot: 'daily-snapshot',
  /** Immediately capture market conditions for one purchase (PRD §9). */
  PurchaseSnapshot: 'purchase-snapshot',
  /** Pull a dated historical series into storage (PRD §11.4, §12.4). */
  BackfillHistory: 'backfill-history',
} as const;

export type PriceJobName = (typeof PriceJob)[keyof typeof PriceJob];

export interface PurchaseSnapshotPayload {
  purchaseId: string;
}

export interface BackfillPayload {
  metalCode: string;
  fromIso: string;
  toIso: string;
}

/**
 * Backfill is one upstream request per missing day, so it is given room to run
 * and only one attempt beyond the first: a failure part-way through has already
 * stored what it fetched, and the next run skips those days.
 */
export const BACKFILL_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 50 },
};

/**
 * Retry policy for scheduled market work (PRD §12.3 "背景重試").
 *
 * Exponential backoff with a small attempt count: a five-minute tick will come
 * round again shortly, so grinding away at a failing upstream only adds load
 * without improving the outcome.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

/**
 * A purchase snapshot is worth retrying harder and longer: the user is waiting
 * for the premium figure on a transaction they just recorded, and unlike a
 * price tick there is no next one coming.
 */
export const PURCHASE_SNAPSHOT_JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
};

export interface ScheduleConfig {
  latestEveryMs: number;
  fxCron: string;
  hourlyCron: string;
  dailyCron: string;
}

/** PRD §12.3 defaults; every interval is overridable from settings. */
export const DEFAULT_SCHEDULE: ScheduleConfig = {
  latestEveryMs: 5 * 60 * 1000,
  // FX moves slowly and the free feed updates about once a day.
  fxCron: '7 * * * *',
  hourlyCron: '0 * * * *',
  // 00:05 UTC, just after the daily datasets settle.
  dailyCron: '5 0 * * *',
};
