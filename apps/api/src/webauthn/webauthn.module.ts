import { Module } from '@nestjs/common';

import { WebAuthnService } from './webauthn.service.js';
import { WebAuthnChallengeService } from './webauthn-challenge.service.js';
import { PasskeysService } from './passkeys.service.js';
import { WebAuthnController } from './webauthn.controller.js';
import { PasskeyDtoModule } from './dto/passkey-dto.module.js';
import { AuthModule } from '../auth/auth.module.js';

/**
 * WebAuthn / Passkey module (PRD §5). Owns credential storage, the challenge
 * lifecycle, and the registration / login / step-up ceremonies. Session
 * issuing is delegated to AuthModule so a passkey login and a password login
 * produce exactly the same session semantics.
 */
@Module({
  imports: [AuthModule, PasskeyDtoModule],
  controllers: [WebAuthnController],
  providers: [WebAuthnService, WebAuthnChallengeService, PasskeysService],
  exports: [WebAuthnService, PasskeysService],
})
export class WebAuthnModule {}
