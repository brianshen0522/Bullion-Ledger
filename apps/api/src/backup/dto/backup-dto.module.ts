import { Module } from '@nestjs/common';

import { BackupExportDto, BackupRestoreDto } from './backup.dto.js';

/** DTO barrel so class-validator metadata ships with the backup feature. */
@Module({})
export class BackupDtoModule {}

export { BackupExportDto, BackupRestoreDto };
