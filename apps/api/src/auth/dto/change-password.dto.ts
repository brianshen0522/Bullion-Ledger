import { IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  /**
   * No minimum length is enforced beyond being non-empty. The upper bound
   * stays: Argon2 hashes the whole input, so an unbounded password is a cheap
   * way to make the server do expensive work.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  newPassword!: string;

  /**
   * Re-authentication before a sensitive change (PRD §4.3). Optional only
   * because a completed passkey step-up on this session is the accepted
   * alternative; the service rejects the request when neither is present.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword?: string;
}

export class UpdateUsernameDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/, {
    message: 'username must be 3-64 chars of [A-Za-z0-9._-]',
  })
  username!: string;

  /** Same re-authentication contract as ChangePasswordDto. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword?: string;
}
