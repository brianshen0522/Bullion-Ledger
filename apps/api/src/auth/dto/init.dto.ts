import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class InitDto {
  /**
   * Username for the single user. PRD §4.2. No PII assumptions; allows
   * alphanumerics, dot, underscore, hyphen.
   */
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/, {
    message: 'username must be 3-64 chars of [A-Za-z0-9._-]',
  })
  username!: string;

  /**
   * No minimum length is enforced beyond being non-empty. The upper bound
   * stays: Argon2 hashes the whole input, so an unbounded password is a cheap
   * way to make the server do expensive work.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
