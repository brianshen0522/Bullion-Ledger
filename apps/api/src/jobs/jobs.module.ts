import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { PRICE_QUEUE } from './price-jobs.js';
import { PriceQueueService } from './price-queue.service.js';

/**
 * Queue wiring shared by the API (which enqueues) and the worker (which
 * consumes). Registering only the queue here keeps the API process free of
 * job handlers, so a slow market fetch can never occupy a request thread.
 *
 * Deliberately does not import MarketPricesModule: the processor that needs it
 * is provided by WorkerModule, and importing it here would create a cycle with
 * the market controller, which enqueues.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: parseRedisUrl(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379'),
      }),
    }),
    BullModule.registerQueue({ name: PRICE_QUEUE }),
  ],
  providers: [PriceQueueService],
  exports: [PriceQueueService, BullModule],
})
export class JobsModule {}

/** BullMQ wants discrete connection fields rather than a URL. */
export function parseRedisUrl(url: string): {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db?: number;
} {
  const parsed = new URL(url);
  const db = parsed.pathname.replace('/', '');
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(db ? { db: Number(db) } : {}),
  };
}
