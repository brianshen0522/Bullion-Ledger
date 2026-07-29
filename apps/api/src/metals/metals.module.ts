import { Module } from '@nestjs/common';
import { MetalsController } from './metals.controller.js';
import { MetalsService } from './metals.service.js';

@Module({ controllers: [MetalsController], providers: [MetalsService], exports: [MetalsService] })
export class MetalsModule {}
