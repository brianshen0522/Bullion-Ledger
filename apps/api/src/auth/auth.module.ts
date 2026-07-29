import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import { SessionTokenHasher } from './session-token-hasher.service.js';
import { PasswordService } from './password.service.js';
import { InitService } from './init.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { AuthDtoModule } from './dto/auth-dto.module.js';

@Module({
  imports: [AuthDtoModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    SessionTokenHasher,
    PasswordService,
    InitService,
    LoginThrottleService,
  ],
  exports: [AuthService, SessionService, PasswordService, LoginThrottleService],
})
export class AuthModule {}
