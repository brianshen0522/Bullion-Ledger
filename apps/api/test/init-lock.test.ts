import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { InitService } from '../src/auth/init.service';
import { PasswordService } from '../src/auth/password.service';

function makePasswordService(): PasswordService {
  const get = (key: string): string | undefined => {
    const map: Record<string, string> = {
      NODE_ENV: 'test',
      ARGON_TIME_COST: '2',
      ARGON_MEMORY_COST: '19456',
      ARGON_PARALLELISM: '1',
    };
    return map[key];
  };
  return new PasswordService({ get } as unknown as ConfigService);
}

describe('InitService race safety', () => {
  it('refuses to initialize when a user already exists', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      appUser: {
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
      appUser: { count: vi.fn().mockResolvedValue(1) },
    };

    const passwords = makePasswordService();
    const hash = vi.spyOn(passwords, 'hash');
    const svc = new InitService(prisma as never, passwords, {
      get: (k: string) => (k === 'NODE_ENV' ? 'test' : undefined),
    } as unknown as ConfigService);

    await expect(
      svc.initialize({ username: 'alice', password: 'password12345' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.appUser.create).not.toHaveBeenCalled();
  });

  it('re-checks under the advisory lock after the fast path', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      appUser: {
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      appUser: { count: vi.fn().mockResolvedValue(0) },
    };
    const passwords = {
      hash: vi.fn().mockResolvedValue('argon-hash'),
    } as unknown as PasswordService;
    const svc = new InitService(prisma as never, passwords, {
      get: (k: string) => (k === 'NODE_ENV' ? 'test' : undefined),
    } as unknown as ConfigService);

    await expect(
      svc.initialize({ username: 'alice', password: 'password12345' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(passwords.hash).toHaveBeenCalledOnce();
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.appUser.create).not.toHaveBeenCalled();
  });

  it('rejects production HTTP initialization unless explicitly enabled', async () => {
    const prisma = { appUser: { count: vi.fn() } };
    const passwords = { hash: vi.fn() } as unknown as PasswordService;
    const svc = new InitService(prisma as never, passwords, {
      get: (k: string) => (k === 'NODE_ENV' ? 'production' : undefined),
    } as unknown as ConfigService);

    await expect(
      svc.initialize({ username: 'alice', password: 'password12345' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.appUser.count).not.toHaveBeenCalled();
    expect(passwords.hash).not.toHaveBeenCalled();
  });

  it('isInitialized returns true when count > 0', async () => {
    const prisma = { appUser: { count: vi.fn().mockResolvedValue(1) } };
    const svc = new InitService(prisma as never, makePasswordService(), {
      get: () => undefined,
    } as unknown as ConfigService);
    expect(await svc.isInitialized()).toBe(true);
  });
});
