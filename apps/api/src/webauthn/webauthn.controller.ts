import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { PasskeysService, type PasskeySummary } from './passkeys.service.js';
import {
  PasskeyAssertionVerifyDto,
  PasskeyRegistrationVerifyDto,
  RenamePasskeyDto,
  asAuthenticationResponse,
  asRegistrationResponse,
} from './dto/passkey.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator.js';

function context(req: Request): { ip?: string; userAgent?: string } {
  // Express derives ip from the socket and its configured trust-proxy policy.
  return { ip: req.ip || undefined, userAgent: req.headers['user-agent'] };
}

/**
 * Passkey HTTP surface (PRD §5). Registration and step-up require a session;
 * login is public because it is itself the authentication step.
 */
@Controller('auth')
export class WebAuthnController {
  constructor(private readonly passkeys: PasskeysService) {}

  /** Lets the sign-in screen hide the passkey button on unconfigured deployments. */
  @Public()
  @Get('passkey/status')
  status(): { available: boolean } {
    return { available: this.passkeys.available() };
  }

  // --- Registration ---------------------------------------------------------

  @Post('passkey/register/options')
  @HttpCode(200)
  registerOptions(@CurrentUser() user: AuthContext | null) {
    return this.passkeys.beginRegistration(requireUser(user).userId);
  }

  @Post('passkey/register/verify')
  @HttpCode(201)
  registerVerify(
    @Body() dto: PasskeyRegistrationVerifyDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ): Promise<PasskeySummary> {
    const auth = requireUser(user);
    return this.passkeys.finishRegistration(
      auth.userId,
      dto.challengeId,
      asRegistrationResponse(dto.response),
      dto.name,
      auth.sessionId,
      context(req),
    );
  }

  // --- Login ----------------------------------------------------------------

  @Public()
  @Post('passkey/login/options')
  @HttpCode(200)
  loginOptions() {
    return this.passkeys.beginLogin();
  }

  @Public()
  @Post('passkey/login/verify')
  @HttpCode(200)
  loginVerify(
    @Body() dto: PasskeyAssertionVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ username: string }> {
    return this.passkeys.finishLogin(
      dto.challengeId,
      asAuthenticationResponse(dto.response),
      res,
      context(req),
    );
  }

  // --- Step-up re-authentication -------------------------------------------

  @Post('passkey/reauth/options')
  @HttpCode(200)
  reauthOptions(@CurrentUser() user: AuthContext | null) {
    return this.passkeys.beginReauth(requireUser(user).userId);
  }

  @Post('passkey/reauth/verify')
  @HttpCode(200)
  reauthVerify(
    @Body() dto: PasskeyAssertionVerifyDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const auth = requireUser(user);
    if (!auth.sessionId) throw new UnauthorizedException('Session required');
    return this.passkeys.finishReauth(
      auth.userId,
      auth.sessionId,
      dto.challengeId,
      asAuthenticationResponse(dto.response),
      context(req),
    );
  }

  // --- Management -----------------------------------------------------------

  @Get('passkeys')
  list(@CurrentUser() user: AuthContext | null): Promise<PasskeySummary[]> {
    return this.passkeys.list(requireUser(user).userId);
  }

  @Patch('passkeys/:id')
  rename(
    @Param('id') id: string,
    @Body() dto: RenamePasskeyDto,
    @CurrentUser() user: AuthContext | null,
  ): Promise<PasskeySummary> {
    const auth = requireUser(user);
    return this.passkeys.rename(auth.userId, id, dto.name, auth.sessionId);
  }

  @Delete('passkeys/:id')
  @HttpCode(200)
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext | null,
  ): Promise<{ deleted: true }> {
    const auth = requireUser(user);
    return this.passkeys.remove(auth.userId, id, auth.sessionId);
  }
}

function requireUser(user: AuthContext | null): AuthContext {
  if (!user) throw new UnauthorizedException('Session required');
  return user;
}
