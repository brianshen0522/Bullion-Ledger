import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { MIN_PASSPHRASE_LENGTH } from '../backup-crypto.js';

class ReauthenticatedDto {
  /**
   * Optional only because a passkey step-up on this session is the accepted
   * alternative; the service rejects the request when neither is present.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword?: string;
}

export class BackupExportDto extends ReauthenticatedDto {
  @IsString()
  @MinLength(MIN_PASSPHRASE_LENGTH)
  @MaxLength(512)
  passphrase!: string;
}

export class BackupRestoreDto extends ReauthenticatedDto {
  @IsString()
  @MinLength(MIN_PASSPHRASE_LENGTH)
  @MaxLength(512)
  passphrase!: string;

  /** Base64-encoded archive. */
  @IsString()
  @MinLength(1)
  file!: string;
}
