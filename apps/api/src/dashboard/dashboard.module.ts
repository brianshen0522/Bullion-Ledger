import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { PurchasesModule } from '../purchases/purchases.module.js';
import { AssetsModule } from '../assets/assets.module.js';
import { MarketPricesModule } from '../market-prices/market-prices.module.js';
import { MovementsModule } from '../movements/movements.module.js';

@Module({
  imports: [PurchasesModule, AssetsModule, MarketPricesModule, MovementsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
