import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';

interface Harness {
  service: AuthService;
  prisma: {
    appUser: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
  sessions: {
    consumeReauthentication: ReturnType<typeof vi.fn>;
    destroyAllOthers: ReturnType<typeof vi.fn>;
  };
  passwords: { verify: ReturnType<typeof vi.fn>; hash: ReturnType<typeof vi.fn> };
  audit: { record: ReturnType<typeof vi.fn> };
}

function harness(options: { passwordValid?: boolean; reauthAvailable?: boolean } = {}): Harness {
  const prisma = {
    appUser: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-1', passwordHash: 'stored-hash' }),
      update: vi.fn().mockResolvedValue({ id: 'user-1' }),
    },
  };
  const passwords = {
    verify: vi.fn().mockResolvedValue(options.passwordValid ?? true),
    hash: vi.fn().mockResolvedValue('new-hash'),
  };
  const sessions = {
    consumeReauthentication: vi.fn().mockResolvedValue(options.reauthAvailable ?? false),
    destroyAllOthers: vi.fn().mockResolvedValue(0),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  const service = new AuthService(
    prisma as never,
    passwords as never,
    {} as never,
    sessions as never,
    {} as never,
    audit as never,
  );
  return { service, prisma, sessions, passwords, audit };
}

describe('sensitive account changes require re-authentication (PRD §4.3)', () => {
  it('changes the password when the current password is correct', async () => {
    const { service, prisma, sessions } = harness({ passwordValid: true });

    await service.changePassword('user-1', 'current-secret', 'a-much-longer-secret', 'session-1');

    expect(prisma.appUser.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-hash' },
    });
    // Other devices must not keep a session opened under the old password.
    expect(sessions.destroyAllOthers).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('rejects a wrong current password without falling back to a passkey step-up', async () => {
    const { service, prisma, sessions } = harness({
      passwordValid: false,
      reauthAvailable: true,
    });

    await expect(
      service.changePassword('user-1', 'wrong-secret', 'a-much-longer-secret', 'session-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.appUser.update).not.toHaveBeenCalled();
    expect(sessions.consumeReauthentication).not.toHaveBeenCalled();
  });

  it('accepts a completed passkey step-up in place of the password', async () => {
    const { service, prisma, sessions, passwords } = harness({ reauthAvailable: true });

    await service.changePassword('user-1', undefined, 'a-much-longer-secret', 'session-1');

    expect(sessions.consumeReauthentication).toHaveBeenCalledWith('user-1', 'session-1');
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(prisma.appUser.update).toHaveBeenCalled();
  });

  it('rejects the change when neither proof is supplied', async () => {
    const { service, prisma } = harness({ reauthAvailable: false });

    await expect(
      service.changePassword('user-1', undefined, 'a-much-longer-secret', 'session-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.appUser.update).not.toHaveBeenCalled();
  });

  it('never records the password itself in the audit trail', async () => {
    const { service, audit } = harness({ passwordValid: true });

    await service.changePassword('user-1', 'current-secret', 'a-much-longer-secret', 'session-1');

    const serialized = JSON.stringify(audit.record.mock.calls);
    expect(serialized).not.toContain('current-secret');
    expect(serialized).not.toContain('a-much-longer-secret');
    expect(serialized).not.toContain('new-hash');
  });

  it('applies the same re-authentication rule to a username change', async () => {
    const { service, prisma } = harness({ reauthAvailable: false });

    await expect(
      service.updateUsername('user-1', 'renamed', undefined, 'session-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.appUser.update).not.toHaveBeenCalled();
  });

  it('reports a taken username as a conflict rather than a raw driver error', async () => {
    const { service, prisma } = harness({ passwordValid: true });
    prisma.appUser.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(
      service.updateUsername('user-1', 'renamed', 'current-secret', 'session-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SessionService step-up elevation', () => {
  it('clears the elevation as it is claimed, so one prompt authorizes one change', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new SessionService(
      { userSession: { updateMany } } as never,
      {} as never,
      { get: () => undefined } as never,
    );

    expect(await service.consumeReauthentication('user-1', 'session-1')).toBe(true);

    const [[args]] = updateMany.mock.calls as [
      [{ where: { reauthenticatedAt: { gte: Date } }; data: { reauthenticatedAt: null } }],
    ];
    expect(args.data.reauthenticatedAt).toBeNull();
    expect(args.where.reauthenticatedAt.gte).toBeInstanceOf(Date);
  });

  it('reports failure when no unexpired elevation matched', async () => {
    const service = new SessionService(
      { userSession: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as never,
      {} as never,
      { get: () => undefined } as never,
    );

    expect(await service.consumeReauthentication('user-1', 'session-1')).toBe(false);
  });
});
