import { Module } from '@nestjs/common';

import { PurchasesModule } from '../purchases/purchases.module.js';
import { PurchaseIntakesDtoModule } from './dto/purchase-intakes-dto.module.js';
import { PurchaseIntakesController } from './purchase-intakes.controller.js';
import { PurchaseIntakesService } from './purchase-intakes.service.js';

@Module({
  imports: [PurchaseIntakesDtoModule, PurchasesModule],
  controllers: [PurchaseIntakesController],
  providers: [PurchaseIntakesService],
  exports: [PurchaseIntakesService],
})
export class PurchaseIntakesModule {}
