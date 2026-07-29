import { Module } from '@nestjs/common';

import { BackfillDto, HistoryQueryDto, ManualPriceDto, MarkerQueryDto } from './market.dto.js';

/** DTO barrel so class-validator metadata ships with the market feature. */
@Module({})
export class MarketDtoModule {}

export { BackfillDto, HistoryQueryDto, ManualPriceDto, MarkerQueryDto };
