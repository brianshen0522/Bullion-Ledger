import { Module } from '@nestjs/common';
import { DealersController } from './dealers.controller.js';
import { DealersService } from './dealers.service.js';

@Module({ controllers: [DealersController], providers: [DealersService] })
export class DealersModule {}
