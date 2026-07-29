import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import { SessionService } from '../auth/session.service.js';
import { AuthContext } from './decorators/current-user.decorator.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthContext }>();
    const auth = await this.sessions.authenticate(req);

    if (auth) {
      req.user = auth;
      return true;
    }
    if (isPublic) {
      return true;
    }
    throw new UnauthorizedException('Session required');
  }
}
