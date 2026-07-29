import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import express from 'express';

import { BackupController } from './backup.controller.js';
import { BackupService } from './backup.service.js';
import { BackupDtoModule } from './dto/backup-dto.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';

/** Default ceiling for an uploaded archive, before base64 inflation. */
const DEFAULT_RESTORE_LIMIT_MB = 256;

/** Full backup and restore (PRD §24). */
@Module({
  imports: [BackupDtoModule, AuthModule, StorageModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule implements NestModule {
  constructor(private readonly config: ConfigService) {}

  /**
   * Restore and inspect carry a whole archive in the request body, which is far
   * past the 100 kB the global JSON parser allows. The larger limit is applied
   * to these two routes only — raising it globally would let any endpoint be
   * used to buffer hundreds of megabytes.
   */
  configure(consumer: MiddlewareConsumer): void {
    const limitMb = parseLimitMb(this.config.get<string>('BACKUP_MAX_UPLOAD_MB'));
    consumer
      .apply(express.json({ limit: `${limitMb}mb` }))
      .forRoutes(
        { path: 'backup/restore', method: RequestMethod.POST },
        { path: 'backup/inspect', method: RequestMethod.POST },
      );
  }
}

export function parseLimitMb(value: string | undefined): number {
  if (!value) return DEFAULT_RESTORE_LIMIT_MB;
  const parsed = Number(value);
  // A misconfigured value must not become an unbounded memory allocation.
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2048) {
    return DEFAULT_RESTORE_LIMIT_MB;
  }
  return parsed;
}
