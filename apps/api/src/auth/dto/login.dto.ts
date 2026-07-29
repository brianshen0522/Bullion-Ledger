import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  /** Bounded so an attacker cannot exhaust argon2 with huge payloads. */
  password!: string;
}
