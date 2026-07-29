import { Module } from '@nestjs/common';

import { MovementsController } from './movements.controller.js';
import { MovementsService } from './movements.service.js';
import { MovementsDtoModule } from './dto/movements-dto.module.js';
import { MarketPricesModule } from '../market-prices/market-prices.module.js';
import { MetalsModule } from '../metals/metals.module.js';

/**
 * Asset lifecycle movements (PRD §6.4, §15.3): sale, gift out, gift received,
 * loss, and storage transfer.
 */
@Module({
  imports: [MovementsDtoModule, MarketPricesModule, MetalsModule],
  controllers: [MovementsController],
  providers: [MovementsService],
  exports: [MovementsService],
})
export class MovementsModule {}
