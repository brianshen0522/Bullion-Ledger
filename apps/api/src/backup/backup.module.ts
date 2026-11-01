import { INestApplication, Module } from '@nestjs/common';
import express, { type RequestHandler } from 'express';

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
export class BackupModule {}

/**
 * Restore and inspect carry a whole archive in the request body, which is far
 * past the 100 kB the global JSON parser allows. The larger limit is applied to
 * these two routes only: raising it globally would let any endpoint be used to
 * buffer hundreds of megabytes.
 *
 * Call this before the app initializes. Nest registers its global parser ahead
 * of module middleware, so a limit set in a module never sees these bodies.
 */
export function registerBackupBodyParser(
  app: INestApplication,
  apiPrefix: string,
  limitMb: number,
): void {
  const parser = express.json({ limit: `${limitMb}mb` });
  // The wrapper matters: Nest skips its own parser if it finds a middleware
  // named jsonParser, which would leave every other route without a body.
  const parseArchive: RequestHandler = (req, res, next) => parser(req, res, next);
  app.use(`/${apiPrefix}/backup/restore`, parseArchive);
  app.use(`/${apiPrefix}/backup/inspect`, parseArchive);
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
