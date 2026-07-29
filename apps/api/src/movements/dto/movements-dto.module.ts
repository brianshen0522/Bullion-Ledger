import { Module } from '@nestjs/common';

import {
  GiftInDto,
  GiftOutAssetDto,
  LoseAssetDto,
  SellAssetDto,
  TransferStorageDto,
} from './movement.dto.js';

/** DTO barrel so class-validator metadata ships with the movements feature. */
@Module({})
export class MovementsDtoModule {}

export { GiftInDto, GiftOutAssetDto, LoseAssetDto, SellAssetDto, TransferStorageDto };
