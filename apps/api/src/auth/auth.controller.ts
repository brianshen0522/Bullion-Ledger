import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { AuthService } from './auth.service.js';
import { InitDto } from './dto/init.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto, UpdateUsernameDto } from './dto/change-password.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator.js';

function clientIp(req: Request): string | undefined {
  // Express derives this from the socket and its configured trust-proxy
  // policy. Never trust X-Forwarded-For directly from an arbitrary client.
  return req.ip || undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('init-status')
  initStatus(): Promise<{ initialized: boolean }> {
    return this.auth.getInitStatus();
  }

  @Public()
  @Post('init')
  @HttpCode(201)
  async init(
    @Body() dto: InitDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.auth.initialize(dto, res, clientIp(req), req.headers['user-agent']);
    return { ok: true };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.auth.login(dto, res, clientIp(req), req.headers['user-agent']);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthContext | null,
  ): Promise<void> {
    await this.auth.logout(res, user?.sessionId, user?.userId);
  }

  @Post('logout-all-others')
  @HttpCode(200)
  async logoutAllOthers(@CurrentUser() user: AuthContext | null): Promise<{ revoked: number }> {
    if (!user) return { revoked: 0 };
    return this.auth.logoutAllOthers(user.userId, user.sessionId);
  }

  @Get('session')
  async session(@CurrentUser() user: AuthContext | null): Promise<{ username: string | null }> {
    if (!user) return { username: null };
    return this.auth.getSession(user.userId);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthContext | null,
  ): Promise<void> {
    // AuthGuard already rejects anonymous callers; failing loudly here keeps a
    // future guard change from silently reporting success without a change.
    if (!user) throw new UnauthorizedException('Session required');
    await this.auth.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
      user.sessionId,
    );
  }

  @Post('change-username')
  @HttpCode(204)
  async changeUsername(
    @Body() dto: UpdateUsernameDto,
    @CurrentUser() user: AuthContext | null,
  ): Promise<void> {
    if (!user) throw new UnauthorizedException('Session required');
    await this.auth.updateUsername(user.userId, dto.username, dto.currentPassword, user.sessionId);
  }
}
