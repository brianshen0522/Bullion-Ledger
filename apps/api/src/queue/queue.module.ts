import { Module } from '@nestjs/common';

import { RedisHealthService } from './redis-health.service.js';

/** Infrastructure boundary for Redis-backed BullMQ work introduced after Phase 1. */
@Module({
  providers: [RedisHealthService],
  exports: [RedisHealthService],
})
export class QueueModule {}
