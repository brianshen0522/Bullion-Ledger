import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

import { PrismaService } from '../prisma/prisma.module.js';
import { loadRuntimeConfig } from '../config/runtime.config.js';
import { SessionTokenHasher } from './session-token-hasher.service.js';
import { AuthContext } from '../common/decorators/current-user.decorator.js';

const SLIDE_REFRESH_MIN_INTERVAL_MS = 60 * 1000;

/**
 * How long a passkey step-up stays redeemable. Short enough that walking away
 * from an unlocked screen does not leave a usable elevation behind.
 */
export const REAUTH_VALIDITY_MS = 5 * 60 * 1000;

/**
 * HttpOnly cookie session lifecycle (PRD §5.4). Tokens are random 256-bit
 * values; only their HMAC digest is stored. Idle (sliding) expiry is updated
 * on activity with a write throttle to avoid DB pressure.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger('Session');
  private readonly cookieName: string;
  private readonly absoluteTtlSec: number;
  private readonly idleTtlSec: number;
  private readonly cookieSecure: boolean;
  private readonly cookieSameSite: 'strict' | 'lax' | 'none';

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SessionTokenHasher,
    configService: ConfigService,
  ) {
    const cfg = loadRuntimeConfig(configService);
    this.cookieName = cfg.cookie.name;
    this.absoluteTtlSec = cfg.cookie.absoluteTtlSec;
    this.idleTtlSec = cfg.cookie.idleTtlSec;
    this.cookieSecure = cfg.cookie.secure;
    this.cookieSameSite = cfg.cookie.sameSite;
  }

  async authenticate(req: Request): Promise<AuthContext | null> {
    const token = this.readToken(req);
    if (!token) return null;

    const tokenHash = this.hasher.hash(token);
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
    });
    if (!session) return null;
    if (session.revokedAt) return null;

    const now = Date.now();
    if (session.absoluteExpiresAt.getTime() <= now) return null;
    if (session.idleExpiresAt.getTime() <= now) return null;

    // Throttle idle-expiry slide writes.
    if (now - session.lastUsedAt.getTime() > SLIDE_REFRESH_MIN_INTERVAL_MS) {
      const nextIdle = new Date(now + this.idleTtlSec * 1000);
      await this.prisma.userSession
        .update({
          where: { id: session.id },
          data: { idleExpiresAt: nextIdle, lastUsedAt: new Date(now) },
        })
        .catch((e: unknown) => {
          // Non-fatal; the in-memory check already authorized the request.
          this.logger.warn(`Session slide update failed: ${(e as Error).message}`);
        });
    }

    return { userId: session.userId, sessionId: session.id };
  }

  async issue(response: Response, userId: string, ip?: string, userAgent?: string): Promise<void> {
    const { token, tokenHash } = this.hasher.generate();
    const now = Date.now();
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash,
        absoluteExpiresAt: new Date(now + this.absoluteTtlSec * 1000),
        idleExpiresAt: new Date(now + this.idleTtlSec * 1000),
        lastUsedAt: new Date(now),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    });
    response.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: '/',
      // Express expects milliseconds; runtime TTL configuration is seconds.
      maxAge: this.absoluteTtlSec * 1000,
    });
    void session; // session row created; id surfaced via authenticate()
  }

  async destroy(response: Response, sessionId: string | undefined): Promise<void> {
    if (sessionId) {
      try {
        await this.prisma.userSession.updateMany({
          where: { id: sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } catch (error) {
        // Do not report a successful logout while a reusable server-side
        // session remains active. Keeping the cookie lets the caller retry.
        this.logger.error(`Session revocation failed: ${(error as Error).message}`);
        throw new ServiceUnavailableException('Unable to revoke session');
      }
    }
    response.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: '/',
    });
  }

  async destroyAllOthers(userId: string, exceptSessionId: string | undefined): Promise<number> {
    const where = {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}),
    };
    const result = await this.prisma.userSession.updateMany({
      where,
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Records a successful step-up verification (PRD §4.3) on this session.
   * Scoped to one session so a passkey prompt on the desktop cannot elevate a
   * session that is open on some other device.
   */
  async markReauthenticated(userId: string, sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { reauthenticatedAt: new Date() },
    });
  }

  /**
   * Claims a recent step-up verification, clearing it in the same statement so
   * one passkey prompt authorizes exactly one sensitive change. Returns false
   * when no unexpired elevation exists.
   */
  async consumeReauthentication(userId: string, sessionId: string): Promise<boolean> {
    const notBefore = new Date(Date.now() - REAUTH_VALIDITY_MS);
    const claimed = await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        reauthenticatedAt: { gte: notBefore },
      },
      data: { reauthenticatedAt: null },
    });
    return claimed.count === 1;
  }

  async destroyAll(userId: string): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  private readToken(req: Request): string | undefined {
    const raw = req.cookies?.[this.cookieName];
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return undefined;
    return raw;
  }
}
