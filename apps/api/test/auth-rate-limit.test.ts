import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../src/auth/auth.service';
import { LockedError } from '../src/auth/login-throttle.service';

describe('AuthService login throttling', () => {
  it('returns 429 with Retry-After when a login bucket is locked', async () => {
    const throttle = {
      consume: vi.fn(() => {
        throw new LockedError(42);
      }),
    };
    const response = { setHeader: vi.fn() };
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      throttle as never,
      {} as never,
    );

    let thrown: unknown;
    try {
      await service.login(
        { username: 'alice', password: 'invalid-password' },
        response as unknown as Response,
        '192.0.2.5',
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(throttle.consume).toHaveBeenCalledWith('alice', '192.0.2.5');
  });

  it('executes a valid same-cost Argon2 verification for an unknown username', async () => {
    const prisma = {
      appUser: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const passwords = { verify: vi.fn().mockResolvedValue(false) };
    const throttle = {
      consume: vi.fn(),
      recordFailure: vi.fn(),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const response = { setHeader: vi.fn() };
    const service = new AuthService(
      prisma as never,
      passwords as never,
      {} as never,
      {} as never,
      throttle as never,
      audit as never,
    );

    await expect(
      service.login(
        { username: 'does-not-exist', password: 'candidate-password' },
        response as unknown as Response,
        '192.0.2.5',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(passwords.verify).toHaveBeenCalledOnce();
    const dummyHash = passwords.verify.mock.calls[0]?.[0];
    expect(dummyHash).toContain('m=19456,t=3,p=1');
    expect(await argon2.verify(dummyHash!, 'bullion-ledger-dummy-password')).toBe(true);
    expect(throttle.recordFailure).toHaveBeenCalledWith('does-not-exist', '192.0.2.5');
  });
});
