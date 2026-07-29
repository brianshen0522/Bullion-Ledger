import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { WebAuthnChallengePurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import { LockedError, LoginThrottleService } from '../auth/login-throttle.service.js';
import { WebAuthnService, type StoredCredential } from './webauthn.service.js';
import { WebAuthnChallengeService } from './webauthn-challenge.service.js';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from './webauthn.types.js';

/** Throttle bucket for assertions, which carry no username to charge. */
const PASSKEY_THROTTLE_ACCOUNT = '@passkey';

const MAX_PASSKEYS_PER_USER = 20;

export interface PasskeySummary {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  transports: string[];
  backedUp: boolean;
  deviceType: string | null;
}

export interface CeremonyOptions<T> {
  challengeId: string;
  options: T;
}

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Passkey registration, login, step-up re-authentication and management
 * (PRD §5.2–§5.4, §4.3).
 *
 * Every ceremony is two calls: the server issues a stored challenge, then
 * verifies the authenticator's response against that exact stored value. The
 * client cannot influence which challenge is checked — it only names one.
 */
@Injectable()
export class PasskeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webauthn: WebAuthnService,
    private readonly challenges: WebAuthnChallengeService,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  available(): boolean {
    return this.webauthn.configured();
  }

  async list(userId: string): Promise<PasskeySummary[]> {
    const rows = await this.prisma.userPasskey.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        transports: true,
        backedUp: true,
        deviceType: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      transports: row.transports,
      backedUp: row.backedUp,
      deviceType: row.deviceType,
    }));
  }

  // --- Registration ---------------------------------------------------------

  async beginRegistration(
    userId: string,
  ): Promise<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    if (!user) throw new UnauthorizedException('Session invalid');

    const existing = await this.loadCredentials(userId);
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      throw new ConflictException(`At most ${MAX_PASSKEYS_PER_USER} passkeys can be registered`);
    }

    const options = await this.webauthn.buildRegistrationOptions(userId, user.username, existing);
    const challengeId = await this.challenges.issue(
      WebAuthnChallengePurpose.REGISTRATION,
      options.challenge,
      userId,
    );
    return { challengeId, options };
  }

  async finishRegistration(
    userId: string,
    challengeId: string,
    response: RegistrationResponseJSON,
    name: string | undefined,
    sessionId: string | undefined,
    context: RequestContext,
  ): Promise<PasskeySummary> {
    const pending = await this.challenges.consume(
      challengeId,
      WebAuthnChallengePurpose.REGISTRATION,
      userId,
    );
    if (!pending) throw new BadRequestException('Passkey challenge expired or already used');

    const verified = await this.webauthn.verifyRegistration(response, pending.challenge);
    if (!verified) {
      await this.audit.record({
        userId,
        sessionId,
        action: 'account.passkey.register',
        resourceType: 'UserPasskey',
        result: 'failure',
        afterSummary: { reason: 'verification_failed' },
        ...context,
      });
      throw new BadRequestException('Passkey registration could not be verified');
    }

    const created = await this.prisma.userPasskey
      .create({
        data: {
          userId,
          credentialId: verified.credentialId,
          // Prisma `Bytes` expects a Buffer on this client version.
          publicKey: Buffer.from(verified.publicKey),
          counter: verified.counter,
          transports: verified.transports,
          deviceType: verified.deviceType,
          backedUp: verified.backedUp,
          name: normalizeName(name),
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
          lastUsedAt: true,
          transports: true,
          backedUp: true,
          deviceType: true,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictException('This passkey is already registered');
        }
        throw error;
      });

    await this.audit.record({
      userId,
      sessionId,
      action: 'account.passkey.register',
      resourceType: 'UserPasskey',
      resourceId: created.id,
      // Never the credential id or public key.
      afterSummary: { name: created.name, backedUp: created.backedUp },
      ...context,
    });

    return {
      id: created.id,
      name: created.name,
      createdAt: created.createdAt.toISOString(),
      lastUsedAt: created.lastUsedAt?.toISOString() ?? null,
      transports: created.transports,
      backedUp: created.backedUp,
      deviceType: created.deviceType,
    };
  }

  // --- Login ----------------------------------------------------------------

  async beginLogin(): Promise<CeremonyOptions<PublicKeyCredentialRequestOptionsJSON>> {
    const options = await this.webauthn.buildAuthenticationOptions();
    const challengeId = await this.challenges.issue(
      WebAuthnChallengePurpose.AUTHENTICATION,
      options.challenge,
      null,
    );
    return { challengeId, options };
  }

  async finishLogin(
    challengeId: string,
    response: AuthenticationResponseJSON,
    httpResponse: Response,
    context: RequestContext,
  ): Promise<{ username: string }> {
    this.enforceThrottle(httpResponse, context.ip);

    const pending = await this.challenges.consume(
      challengeId,
      WebAuthnChallengePurpose.AUTHENTICATION,
      null,
    );
    if (!pending) throw new BadRequestException('Passkey challenge expired or already used');

    const { credential, verification } = await this.assertCredential(response, pending.challenge);
    if (!credential || !verification) {
      this.throttle.recordFailure(PASSKEY_THROTTLE_ACCOUNT, context.ip);
      await this.audit.record({
        userId: credential?.userId ?? null,
        action: 'auth.login.passkey',
        resourceType: 'AppUser',
        resourceId: credential?.userId ?? null,
        result: 'failure',
        afterSummary: { reason: 'invalid_assertion' },
        ...context,
      });
      throw new UnauthorizedException('Passkey verification failed');
    }

    this.throttle.recordSuccess(PASSKEY_THROTTLE_ACCOUNT, context.ip);
    await this.recordUse(credential.id, verification.newCounter);
    await this.sessions.issue(httpResponse, credential.userId, context.ip, context.userAgent);
    await this.audit.record({
      userId: credential.userId,
      action: 'auth.login.passkey',
      resourceType: 'AppUser',
      resourceId: credential.userId,
      afterSummary: { username: credential.username, passkeyId: credential.id },
      ...context,
    });
    return { username: credential.username };
  }

  // --- Step-up re-authentication -------------------------------------------

  async beginReauth(
    userId: string,
  ): Promise<CeremonyOptions<PublicKeyCredentialRequestOptionsJSON>> {
    const count = await this.prisma.userPasskey.count({ where: { userId } });
    if (count === 0) throw new NotFoundException('No passkey is registered on this account');

    const options = await this.webauthn.buildAuthenticationOptions();
    const challengeId = await this.challenges.issue(
      WebAuthnChallengePurpose.REAUTH,
      options.challenge,
      userId,
    );
    return { challengeId, options };
  }

  /**
   * Verifies a passkey assertion and elevates the current session so the next
   * sensitive change can proceed without the account password (PRD §4.3).
   */
  async finishReauth(
    userId: string,
    sessionId: string,
    challengeId: string,
    response: AuthenticationResponseJSON,
    context: RequestContext,
  ): Promise<{ ok: true }> {
    const pending = await this.challenges.consume(
      challengeId,
      WebAuthnChallengePurpose.REAUTH,
      userId,
    );
    if (!pending) throw new BadRequestException('Passkey challenge expired or already used');

    const { credential, verification } = await this.assertCredential(response, pending.challenge);
    // The asserted credential must belong to the session's own account.
    if (!credential || !verification || credential.userId !== userId) {
      await this.audit.record({
        userId,
        sessionId,
        action: 'account.reauth.passkey',
        resourceType: 'UserSession',
        resourceId: sessionId,
        result: 'failure',
        afterSummary: { reason: 'invalid_assertion' },
        ...context,
      });
      throw new UnauthorizedException('Passkey verification failed');
    }

    await this.recordUse(credential.id, verification.newCounter);
    await this.sessions.markReauthenticated(userId, sessionId);
    await this.audit.record({
      userId,
      sessionId,
      action: 'account.reauth.passkey',
      resourceType: 'UserSession',
      resourceId: sessionId,
      afterSummary: { passkeyId: credential.id },
      ...context,
    });
    return { ok: true };
  }

  // --- Management -----------------------------------------------------------

  async rename(
    userId: string,
    passkeyId: string,
    name: string,
    sessionId: string | undefined,
  ): Promise<PasskeySummary> {
    const updated = await this.prisma.userPasskey.updateMany({
      where: { id: passkeyId, userId },
      data: { name: normalizeName(name) },
    });
    if (updated.count !== 1) throw new NotFoundException('Passkey not found');

    await this.audit.record({
      userId,
      sessionId,
      action: 'account.passkey.rename',
      resourceType: 'UserPasskey',
      resourceId: passkeyId,
      afterSummary: { name: normalizeName(name) },
    });

    const all = await this.list(userId);
    const summary = all.find((passkey) => passkey.id === passkeyId);
    if (!summary) throw new NotFoundException('Passkey not found');
    return summary;
  }

  /**
   * Removes a passkey. Username + password always remains as the recovery
   * path (PRD §5.3), so removing the last passkey never locks the user out.
   */
  async remove(
    userId: string,
    passkeyId: string,
    sessionId: string | undefined,
  ): Promise<{ deleted: true }> {
    const deleted = await this.prisma.userPasskey.deleteMany({
      where: { id: passkeyId, userId },
    });
    if (deleted.count !== 1) throw new NotFoundException('Passkey not found');

    await this.audit.record({
      userId,
      sessionId,
      action: 'account.passkey.delete',
      resourceType: 'UserPasskey',
      resourceId: passkeyId,
    });
    return { deleted: true };
  }

  // --- internals ------------------------------------------------------------

  /**
   * Resolves the asserted credential and verifies the signature. Returns nulls
   * instead of throwing so callers can apply their own audit/throttle policy.
   */
  private async assertCredential(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
  ): Promise<{
    credential: { id: string; userId: string; username: string } | null;
    verification: { newCounter: number } | null;
  }> {
    const stored = await this.prisma.userPasskey.findUnique({
      where: { credentialId: response.id },
      select: {
        id: true,
        userId: true,
        credentialId: true,
        publicKey: true,
        counter: true,
        transports: true,
        user: { select: { username: true } },
      },
    });
    if (!stored) return { credential: null, verification: null };

    const verification = await this.webauthn.verifyAuthentication(response, expectedChallenge, {
      credentialId: stored.credentialId,
      publicKey: new Uint8Array(stored.publicKey),
      counter: stored.counter,
      transports: stored.transports,
    });

    return {
      credential: { id: stored.id, userId: stored.userId, username: stored.user.username },
      verification,
    };
  }

  private async recordUse(passkeyId: string, newCounter: number): Promise<void> {
    await this.prisma.userPasskey.update({
      where: { id: passkeyId },
      data: { counter: newCounter, lastUsedAt: new Date() },
    });
  }

  private async loadCredentials(userId: string): Promise<StoredCredential[]> {
    const rows = await this.prisma.userPasskey.findMany({
      where: { userId },
      select: { credentialId: true, publicKey: true, counter: true, transports: true },
    });
    return rows.map((row) => ({
      credentialId: row.credentialId,
      publicKey: new Uint8Array(row.publicKey),
      counter: row.counter,
      transports: row.transports,
    }));
  }

  private enforceThrottle(httpResponse: Response, ip?: string): void {
    try {
      this.throttle.consume(PASSKEY_THROTTLE_ACCOUNT, ip);
    } catch (error) {
      if (error instanceof LockedError) {
        httpResponse.setHeader('Retry-After', String(error.retryAfterSeconds));
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: 'Too many passkey attempts; please retry later',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw error;
    }
  }
}

function normalizeName(name: string | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
