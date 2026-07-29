import { Injectable, Logger } from '@nestjs/common';
import { WebAuthnChallengePurpose } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.module.js';

/** A ceremony must complete within this window. Matches the browser timeout. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Consumed/expired rows are swept opportunistically, not by a cron. */
const SWEEP_MIN_INTERVAL_MS = 60 * 1000;

export interface ConsumedChallenge {
  challenge: string;
  userId: string | null;
}

/**
 * Server-side lifecycle for WebAuthn challenges (PRD §5.3).
 *
 * The challenge is the anti-replay primitive of the whole ceremony, so it is
 * never trusted from the client: the server stores what it issued and marks it
 * consumed with a conditional update. Two concurrent verifies of one challenge
 * therefore resolve to exactly one winner.
 */
@Injectable()
export class WebAuthnChallengeService {
  private readonly logger = new Logger('WebAuthnChallenge');
  private nextSweepAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** Persists an issued challenge and returns the id the client echoes back. */
  async issue(
    purpose: WebAuthnChallengePurpose,
    challenge: string,
    userId: string | null,
  ): Promise<string> {
    await this.sweepExpired();
    const row = await this.prisma.webAuthnChallenge.create({
      data: {
        purpose,
        challenge,
        userId,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Atomically claims a pending challenge. Returns null when the id is unknown,
   * already used, expired, of the wrong purpose, or belongs to another user —
   * all of which the caller must treat as a failed ceremony.
   */
  async consume(
    challengeId: string,
    purpose: WebAuthnChallengePurpose,
    userId: string | null,
  ): Promise<ConsumedChallenge | null> {
    const pending = await this.prisma.webAuthnChallenge.findUnique({
      where: { id: challengeId },
      select: { id: true, purpose: true, userId: true, challenge: true, consumedAt: true },
    });
    if (!pending) return null;
    if (pending.purpose !== purpose) return null;
    if (pending.consumedAt) return null;
    // A challenge bound to a user may only be redeemed by that user.
    if (pending.userId !== null && pending.userId !== userId) return null;

    // The conditional `consumedAt: null` is what makes this single-use under
    // concurrency; the read above is only a fast, informative pre-check.
    const claimed = await this.prisma.webAuthnChallenge.updateMany({
      where: { id: pending.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) return null;

    return { challenge: pending.challenge, userId: pending.userId };
  }

  /** Drops rows that can no longer be redeemed. Never fatal to a request. */
  private async sweepExpired(): Promise<void> {
    const now = Date.now();
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + SWEEP_MIN_INTERVAL_MS;
    try {
      await this.prisma.webAuthnChallenge.deleteMany({
        where: { OR: [{ expiresAt: { lt: new Date(now) } }, { consumedAt: { not: null } }] },
      });
    } catch (error) {
      this.logger.warn(`Challenge sweep failed: ${(error as Error).message}`);
    }
  }
}
