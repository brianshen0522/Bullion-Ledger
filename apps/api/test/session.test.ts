import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { SessionService } from '../src/auth/session.service';

function config(values: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('SessionService', () => {
  it('converts the configured cookie lifetime from seconds to milliseconds', async () => {
    const prisma = {
      userSession: {
        create: vi.fn().mockResolvedValue({ id: 'session-1' }),
      },
    };
    const hasher = {
      generate: vi.fn().mockReturnValue({ token: 'raw-token', tokenHash: 'hashed-token' }),
    };
    const response = { cookie: vi.fn() };
    const service = new SessionService(
      prisma as never,
      hasher as never,
      config({
        NODE_ENV: 'test',
        SESSION_ABSOLUTE_TTL_SEC: '604800',
        SESSION_IDLE_TTL_SEC: '1800',
      }),
    );

    await service.issue(response as unknown as Response, 'user-1');

    expect(response.cookie).toHaveBeenCalledWith(
      'bl_session',
      'raw-token',
      expect.objectContaining({ maxAge: 604_800_000 }),
    );
  });

  it('does not clear the cookie or claim success when revocation fails', async () => {
    const prisma = {
      userSession: {
        updateMany: vi.fn().mockRejectedValue(new Error('database unavailable')),
      },
    };
    const response = { clearCookie: vi.fn() };
    const service = new SessionService(prisma as never, {} as never, config({ NODE_ENV: 'test' }));

    await expect(
      service.destroy(response as unknown as Response, 'session-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('clears the cookie after the server-side session is revoked', async () => {
    const prisma = {
      userSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const response = { clearCookie: vi.fn() };
    const service = new SessionService(prisma as never, {} as never, config({ NODE_ENV: 'test' }));

    await service.destroy(response as unknown as Response, 'session-1');
    expect(response.clearCookie).toHaveBeenCalledOnce();
  });
});
