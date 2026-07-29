import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from './purchases.service.js';
import { PurchasesDtoModule } from './dto/purchases-dto.module.js';
import { MetalsModule } from '../metals/metals.module.js';
import { JobsModule } from '../jobs/jobs.module.js';

@Module({
  imports: [PurchasesDtoModule, MetalsModule, JobsModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
