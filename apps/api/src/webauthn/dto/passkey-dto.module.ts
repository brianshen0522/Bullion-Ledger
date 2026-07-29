import { Module } from '@nestjs/common';

import {
  PasskeyAssertionVerifyDto,
  PasskeyRegistrationVerifyDto,
  RenamePasskeyDto,
} from './passkey.dto.js';

/** DTO barrel so class-validator metadata ships with the passkey feature. */
@Module({})
export class PasskeyDtoModule {}

export { PasskeyAssertionVerifyDto, PasskeyRegistrationVerifyDto, RenamePasskeyDto };
