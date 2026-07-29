import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { SchedulerModule } from './scheduler.module.js';
import { PriceQueueService } from './jobs/price-queue.service.js';
import { MarketPricesService } from './market-prices/market-prices.service.js';
import { DEFAULT_SCHEDULE, type ScheduleConfig } from './jobs/price-jobs.js';

/**
 * A full year of history, so the chart's 1-year and "all" ranges have something
 * to draw. Only days not already stored are fetched, so the cost is paid once.
 */
const DEFAULT_BACKFILL_DAYS = 365;

/**
 * Scheduler entry point (PRD §20.1 `scheduler` service).
 *
 * Owns the repeatable job definitions and nothing else. Keeping it a separate
 * process from the worker means the schedule is declared exactly once no matter
 * how many workers run, so scaling workers can never multiply the fetch rate
 * against a third-party API.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SchedulerModule, { bufferLogs: true });
  // Buffered logs stay invisible until flushed; without this a failing
  // scheduler looks like a silent one.
  app.flushLogs();
  app.enableShutdownHooks();

  const queue = app.get(PriceQueueService);
  await queue.installSchedule(scheduleFromEnv());
  Logger.log('Price schedule installed', 'Scheduler');

  // Fetch once at startup so a fresh deployment has data before the first tick.
  await queue.requestLatestSync().catch((error: unknown) => {
    Logger.warn(`Initial sync could not be queued: ${(error as Error).message}`, 'Scheduler');
  });

  // Seed the chart and let existing purchases be valued (PRD §9, §11.4). The
  // backfill itself skips days already stored, so repeating this on every
  // restart costs nothing once the history is present.
  const backfillDays = backfillDaysFromEnv();
  if (backfillDays > 0) {
    const to = new Date();
    const from = new Date(to.getTime() - backfillDays * 86_400_000);
    const metals = app.get(MarketPricesService);
    for (const metalCode of await metals.activeMetalCodesForBackfill()) {
      await queue.requestBackfill(metalCode, from, to).catch((error: unknown) => {
        Logger.warn(
          `Backfill for ${metalCode} could not be queued: ${(error as Error).message}`,
          'Scheduler',
        );
      });
    }
    Logger.log(`Requested ${backfillDays}-day history backfill`, 'Scheduler');
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      Logger.log(`Received ${signal}, shutting down`, 'Scheduler');
      void app.close().then(() => process.exit(0));
    });
  }
}

/** PRD §12.3: the intervals must be adjustable without a code change. */
export function scheduleFromEnv(env: NodeJS.ProcessEnv = process.env): ScheduleConfig {
  return {
    latestEveryMs: positiveInt(
      env.PRICE_SYNC_INTERVAL_MS,
      DEFAULT_SCHEDULE.latestEveryMs,
      60_000,
      24 * 60 * 60 * 1000,
    ),
    fxCron: env.PRICE_FX_CRON?.trim() || DEFAULT_SCHEDULE.fxCron,
    hourlyCron: env.PRICE_HOURLY_CRON?.trim() || DEFAULT_SCHEDULE.hourlyCron,
    dailyCron: env.PRICE_DAILY_CRON?.trim() || DEFAULT_SCHEDULE.dailyCron,
  };
}

/**
 * Days of history to seed on startup. Capped at the provider's own range limit;
 * 0 disables the bootstrap entirely for anyone who would rather backfill by hand.
 */
export function backfillDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PRICE_BACKFILL_DAYS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_BACKFILL_DAYS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 400) {
    Logger.warn(
      `Ignoring out-of-range PRICE_BACKFILL_DAYS "${raw}"; using ${DEFAULT_BACKFILL_DAYS}`,
      'Scheduler',
    );
    return DEFAULT_BACKFILL_DAYS;
  }
  return parsed;
}

function positiveInt(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    // A misconfigured interval must not become an accidental request flood.
    Logger.warn(`Ignoring out-of-range interval "${value}"; using ${fallback}ms`, 'Scheduler');
    return fallback;
  }
  return parsed;
}

bootstrap().catch((error) => {
  console.error('Fatal scheduler bootstrap error', error);
  process.exit(1);
});
