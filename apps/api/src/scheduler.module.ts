import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MarketPricesModule } from './market-prices/market-prices.module.js';

/**
 * Scheduler process composition (PRD §20.1). Imports the queue producer only —
 * no processor — so this process declares schedules but never executes a job.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../.env', '../../.env'],
    }),
    PrismaModule,
    AuditModule,
    MarketPricesModule,
    JobsModule,
  ],
})
export class SchedulerModule {}
