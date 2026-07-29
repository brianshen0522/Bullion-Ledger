import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PriceProcessor } from './jobs/price.processor.js';
import { MarketPricesModule } from './market-prices/market-prices.module.js';

/**
 * Worker process composition (PRD §18.5, §20.1).
 *
 * Deliberately excludes every HTTP controller and the auth stack: this process
 * serves no requests, so it should not be able to.
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
  providers: [PriceProcessor],
})
export class WorkerModule {}
