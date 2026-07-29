import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthContext }>();
  return req.user ?? null;
});
