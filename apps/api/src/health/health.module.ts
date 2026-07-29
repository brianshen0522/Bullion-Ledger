import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { StorageModule } from '../storage/storage.module.js';
import { QueueModule } from '../queue/queue.module.js';

@Module({ imports: [StorageModule, QueueModule], controllers: [HealthController] })
export class HealthModule {}
