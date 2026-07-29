import { Module } from '@nestjs/common';

import { MarketPricesService } from './market-prices.service.js';
import { PurchaseSnapshotService } from './purchase-snapshot.service.js';
import { MarketMarkersService } from './market-markers.service.js';
import { MarketPricesController } from './market-prices.controller.js';
import { MarketDtoModule } from './dto/market-dto.module.js';
import { PriceProvidersModule } from '../price-providers/price-providers.module.js';
import { JobsModule } from '../jobs/jobs.module.js';

/**
 * Market price storage, normalization and query (PRD §12.2, §12.4, §22.4),
 * plus the purchase-time snapshot required by PRD §9.
 */
@Module({
  imports: [PriceProvidersModule, MarketDtoModule, JobsModule],
  controllers: [MarketPricesController],
  providers: [MarketPricesService, PurchaseSnapshotService, MarketMarkersService],
  exports: [MarketPricesService, PurchaseSnapshotService, MarketMarkersService],
})
export class MarketPricesModule {}
