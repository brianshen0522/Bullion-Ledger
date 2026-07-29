import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';

import { PrismaService } from '../prisma/prisma.module.js';
import { PasswordService } from './password.service.js';
import { InitService } from './init.service.js';
import { SessionService } from './session.service.js';
import { LoginThrottleService, LockedError } from './login-throttle.service.js';
import { InitDto } from './dto/init.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { AuditService } from '../audit/audit.service.js';

// A real Argon2id hash of a non-secret fixed value. Its encoded cost matches
// the default password policy so an unknown username still performs the same
// expensive verification class as a wrong password for an existing account.
const DUMMY_LOGIN_HASH =
  '$argon2id$v=19$m=19456,t=3,p=1$QnVsbGlvbkR1bW15U2FsdA$8Fg35fn41oO/3be+pjIKfcbKeYQnuLAjAL6mrblML4M';

/**
 * Orchestrates initialization and password login. Public registration is
 * never exposed (PRD §4.2). Login failures do not reveal whether the
 * username exists.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly init: InitService,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  async getInitStatus(): Promise<{ initialized: boolean }> {
    return { initialized: await this.init.isInitialized() };
  }

  async initialize(
    dto: InitDto,
    response: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    const { userId, username } = await this.init.initialize(dto);
    await this.sessions.issue(response, userId, ip, userAgent);
    await this.audit.record({
      userId,
      action: 'auth.initialize',
      resourceType: 'AppUser',
      resourceId: userId,
      afterSummary: { username },
      ip,
      userAgent,
    });
  }

  async login(
    dto: LoginDto,
    response: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<{ userId: string; username: string }> {
    try {
      this.throttle.consume(dto.username, ip);
    } catch (e) {
      if (e instanceof LockedError) {
        response.setHeader('Retry-After', String(e.retryAfterSeconds));
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: 'Too many login attempts; please retry later',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw e;
    }

    const user = await this.prisma.appUser.findUnique({ where: { username: dto.username } });
    let ok = false;
    if (user) {
      ok = await this.passwords.verify(user.passwordHash, dto.password);
    } else {
      await this.passwords.verify(DUMMY_LOGIN_HASH, dto.password);
    }

    if (!user || !ok) {
      this.throttle.recordFailure(dto.username, ip);
      await this.audit.record({
        userId: user?.id ?? null,
        action: 'auth.login',
        resourceType: 'AppUser',
        resourceId: user?.id ?? null,
        ip,
        userAgent,
        result: 'failure',
        // No credentials or hash in the summary.
        afterSummary: { reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    this.throttle.recordSuccess(dto.username, ip);
    await this.sessions.issue(response, user.id, ip, userAgent);
    await this.audit.record({
      userId: user.id,
      action: 'auth.login',
      resourceType: 'AppUser',
      resourceId: user.id,
      ip,
      userAgent,
      afterSummary: { username: user.username },
    });
    return { userId: user.id, username: user.username };
  }

  async logout(response: Response, sessionId: string | undefined, userId?: string): Promise<void> {
    await this.sessions.destroy(response, sessionId);
    if (userId && sessionId) {
      await this.audit.record({
        userId,
        action: 'auth.logout',
        resourceType: 'UserSession',
        resourceId: sessionId,
        sessionId,
      });
    }
  }

  async logoutAllOthers(
    userId: string,
    exceptSessionId: string | undefined,
  ): Promise<{ revoked: number }> {
    const revoked = await this.sessions.destroyAllOthers(userId, exceptSessionId);
    await this.audit.record({
      userId,
      action: 'auth.logoutAllOthers',
      resourceType: 'UserSession',
      afterSummary: { revoked },
      sessionId: exceptSessionId,
    });
    return { revoked };
  }

  async changePassword(
    userId: string,
    currentPassword: string | undefined,
    newPassword: string,
    sessionId?: string,
  ): Promise<void> {
    const method = await this.requireReauthentication(userId, currentPassword, sessionId);

    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.appUser.update({ where: { id: userId }, data: { passwordHash } });
    await this.audit.record({
      userId,
      action: 'account.password.change',
      resourceType: 'AppUser',
      resourceId: userId,
      afterSummary: { reauth: method },
      sessionId,
    });
    // Defensive: revoke all other sessions after a password change.
    await this.sessions.destroyAllOthers(userId, sessionId);
  }

  async updateUsername(
    userId: string,
    username: string,
    currentPassword: string | undefined,
    sessionId?: string,
  ): Promise<void> {
    const method = await this.requireReauthentication(userId, currentPassword, sessionId);

    await this.prisma.appUser
      .update({ where: { id: userId }, data: { username } })
      .catch((error: unknown) => {
        // Single-user system, so this only fires on a concurrent rename; still
        // better than surfacing a raw Prisma error.
        if (isUniqueViolation(error)) throw new ConflictException('That username is already taken');
        throw error;
      });
    await this.audit.record({
      userId,
      action: 'account.username.change',
      resourceType: 'AppUser',
      resourceId: userId,
      afterSummary: { username, reauth: method },
      sessionId,
    });
  }

  /**
   * Enforces re-authentication before a sensitive change (PRD §4.3): either
   * the current password, or a passkey step-up already completed on this
   * session. A supplied password is always the method used — a wrong one fails
   * outright rather than quietly falling back to a stored elevation.
   */
  async requireReauthentication(
    userId: string,
    currentPassword: string | undefined,
    sessionId: string | undefined,
  ): Promise<'password' | 'passkey'> {
    if (currentPassword !== undefined) {
      const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      const ok = await this.passwords.verify(user.passwordHash, currentPassword);
      if (!ok) throw new UnauthorizedException('Current password incorrect');
      return 'password';
    }

    if (sessionId && (await this.sessions.consumeReauthentication(userId, sessionId))) {
      return 'passkey';
    }
    throw new UnauthorizedException(
      'Re-authentication required: supply the current password or verify with a passkey',
    );
  }

  async getSession(userId: string): Promise<{ username: string }> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Session invalid');
    return { username: user.username };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
