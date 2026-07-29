import { describe, expect, it, vi } from 'vitest';
import { WebAuthnChallengePurpose } from '@prisma/client';

import { WebAuthnChallengeService } from '../src/webauthn/webauthn-challenge.service';

interface StoredRow {
  id: string;
  purpose: WebAuthnChallengePurpose;
  userId: string | null;
  challenge: string;
  consumedAt: Date | null;
}

/**
 * Models the one behaviour that matters for replay safety: `updateMany` only
 * matches while `consumedAt` is still null, exactly as Postgres would.
 */
function prismaWith(row: StoredRow | null) {
  const state = row ? { ...row } : null;
  return {
    state,
    client: {
      webAuthnChallenge: {
        create: vi.fn().mockResolvedValue({ id: 'challenge-1' }),
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(state)),
        updateMany: vi.fn().mockImplementation(() => {
          if (!state || state.consumedAt !== null) return Promise.resolve({ count: 0 });
          state.consumedAt = new Date();
          return Promise.resolve({ count: 1 });
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    },
  };
}

function pending(overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    id: 'challenge-1',
    purpose: WebAuthnChallengePurpose.REGISTRATION,
    userId: 'user-1',
    challenge: 'random-challenge',
    consumedAt: null,
    ...overrides,
  };
}

describe('WebAuthnChallengeService', () => {
  it('returns the stored challenge on first consume and nothing on replay', async () => {
    const prisma = prismaWith(pending());
    const service = new WebAuthnChallengeService(prisma.client as never);

    const first = await service.consume(
      'challenge-1',
      WebAuthnChallengePurpose.REGISTRATION,
      'user-1',
    );
    expect(first).toEqual({ challenge: 'random-challenge', userId: 'user-1' });

    const replay = await service.consume(
      'challenge-1',
      WebAuthnChallengePurpose.REGISTRATION,
      'user-1',
    );
    expect(replay).toBeNull();
  });

  it('refuses a challenge issued for a different ceremony', async () => {
    const prisma = prismaWith(pending({ purpose: WebAuthnChallengePurpose.REGISTRATION }));
    const service = new WebAuthnChallengeService(prisma.client as never);

    // A registration challenge must not authorize a step-up.
    const claimed = await service.consume('challenge-1', WebAuthnChallengePurpose.REAUTH, 'user-1');
    expect(claimed).toBeNull();
    expect(prisma.client.webAuthnChallenge.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a user-bound challenge presented by a different user', async () => {
    const prisma = prismaWith(pending({ userId: 'user-1' }));
    const service = new WebAuthnChallengeService(prisma.client as never);

    const claimed = await service.consume(
      'challenge-1',
      WebAuthnChallengePurpose.REGISTRATION,
      'attacker',
    );
    expect(claimed).toBeNull();
    expect(prisma.client.webAuthnChallenge.updateMany).not.toHaveBeenCalled();
  });

  it('accepts an unbound login challenge, which has no user yet', async () => {
    const prisma = prismaWith(
      pending({ purpose: WebAuthnChallengePurpose.AUTHENTICATION, userId: null }),
    );
    const service = new WebAuthnChallengeService(prisma.client as never);

    const claimed = await service.consume(
      'challenge-1',
      WebAuthnChallengePurpose.AUTHENTICATION,
      null,
    );
    expect(claimed).toEqual({ challenge: 'random-challenge', userId: null });
  });

  it('returns nothing for an unknown challenge id', async () => {
    const prisma = prismaWith(null);
    const service = new WebAuthnChallengeService(prisma.client as never);

    expect(
      await service.consume('missing', WebAuthnChallengePurpose.AUTHENTICATION, null),
    ).toBeNull();
  });

  it('scopes the claiming update to an unconsumed, unexpired row', async () => {
    const prisma = prismaWith(pending());
    const service = new WebAuthnChallengeService(prisma.client as never);

    await service.consume('challenge-1', WebAuthnChallengePurpose.REGISTRATION, 'user-1');

    const [[args]] = prisma.client.webAuthnChallenge.updateMany.mock.calls as [
      [{ where: { consumedAt: null; expiresAt: { gt: Date } } }],
    ];
    expect(args.where.consumedAt).toBeNull();
    expect(args.where.expiresAt.gt).toBeInstanceOf(Date);
  });
});
