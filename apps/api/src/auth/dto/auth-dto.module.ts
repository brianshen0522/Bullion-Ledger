import { Module } from '@nestjs/common';

import { InitDto } from './init.dto.js';
import { LoginDto } from './login.dto.js';
import { ChangePasswordDto, UpdateUsernameDto } from './change-password.dto.js';

/** DTO barrel so class-validator metadata ships with the auth feature. */
@Module({})
export class AuthDtoModule {}

export { InitDto, LoginDto, ChangePasswordDto, UpdateUsernameDto };
