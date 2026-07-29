import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { CsrfGuard } from './csrf.guard.js';
import { AuthGuard } from './auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';

/**
 * Wires application-wide guards. The CsrfGuard is registered only for
 * state-changing routes (see CsrfGuard) so it stays composable; the AuthGuard
 * runs on every request and the public decorator opts out per-route.
 */
@Module({
  imports: [AuthModule],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [],
})
export class SecurityGuardModule {}
