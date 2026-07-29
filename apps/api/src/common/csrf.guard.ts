import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Origin-based CSRF defense for cookie-authenticated requests. SameSite=lax
 * (dev) or SameSite=none+Secure (prod) provides the primary defense; this
 * guard is the second layer and rejects any unsafe request whose Origin is
 * missing or not in the allow-list.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(config: ConfigService) {
    const web =
      config.get<string>('PUBLIC_ORIGIN') ??
      config.get<string>('WEB_ORIGIN') ??
      'http://localhost:5173';
    const extra = config.get<string>('CSRF_ALLOWED_ORIGINS') ?? '';
    this.allowedOrigins = new Set([
      web,
      ...extra
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ]);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return true;

    const origin = req.headers['origin'];
    // If no Origin header (same-origin server-side call or non-browser client),
    // require a Sec-Fetch-Site of same-origin or none. This keeps curl/SSR
    // working without opening cross-origin holes.
    if (!origin) {
      const secFetchSite = req.headers['sec-fetch-site'];
      if (secFetchSite === 'same-origin' || secFetchSite === 'none' || secFetchSite === undefined) {
        return true;
      }
      throw new ForbiddenException('CSRF check failed');
    }

    if (this.allowedOrigins.has(origin)) return true;
    throw new ForbiddenException('CSRF check failed');
  }
}
