import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

/**
 * Private MinIO object-storage boundary (PRD §14, §23). Files are never
 * publicly accessible; access requires a short-lived signed URL issued to an
 * authenticated session. The service exposes upload/start, upload/complete,
 * and presigned-GET operations; the underlying client is lazily created so
 * the API still boots without MinIO running in dev.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
