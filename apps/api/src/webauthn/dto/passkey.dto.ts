import { BadRequestException } from '@nestjs/common';
import { IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '../webauthn.types.js';

/**
 * The authenticator response is deliberately typed as a bare object rather
 * than a nested DTO. The global pipe runs `forbidNonWhitelisted`, and browsers
 * legitimately add fields to this payload over time (`authenticatorAttachment`,
 * newer `clientExtensionResults`, …); deep-whitelisting it would reject valid
 * ceremonies whenever a browser evolves. Structure is instead checked at the
 * point of use by the narrowing helpers below, and the payload's real integrity
 * comes from the cryptographic verification, not from field spelling.
 */
export class PasskeyRegistrationVerifyDto {
  @IsString()
  @Length(1, 64)
  challengeId!: string;

  @IsObject()
  response!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}

export class PasskeyAssertionVerifyDto {
  @IsString()
  @Length(1, 64)
  challengeId!: string;

  @IsObject()
  response!: Record<string, unknown>;
}

export class RenamePasskeyDto {
  @IsString()
  @Length(1, 64)
  name!: string;
}

/** Every WebAuthn response we accept must at least name its credential. */
function requireCredentialId(response: Record<string, unknown>): void {
  const { id, rawId, type } = response;
  if (typeof id !== 'string' || id.length === 0 || id.length > 512) {
    throw new BadRequestException('response.id must be a base64url credential id');
  }
  if (typeof rawId !== 'string' || rawId.length === 0) {
    throw new BadRequestException('response.rawId is required');
  }
  if (type !== 'public-key') {
    throw new BadRequestException('response.type must be "public-key"');
  }
  if (typeof response.response !== 'object' || response.response === null) {
    throw new BadRequestException('response.response is required');
  }
}

export function asRegistrationResponse(
  response: Record<string, unknown>,
): RegistrationResponseJSON {
  requireCredentialId(response);
  return response as unknown as RegistrationResponseJSON;
}

export function asAuthenticationResponse(
  response: Record<string, unknown>,
): AuthenticationResponseJSON {
  requireCredentialId(response);
  return response as unknown as AuthenticationResponseJSON;
}
