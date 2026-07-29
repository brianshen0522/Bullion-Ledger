import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { HealthController } from '../src/health/health.controller';

function responseMock(): { response: Response; status: ReturnType<typeof vi.fn> } {
  const status = vi.fn();
  return { response: { status } as unknown as Response, status };
}

describe('HealthController readiness', () => {
  it('returns HTTP 503 and dependency detail when a dependency is unavailable', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const storage = { checkReady: vi.fn().mockResolvedValue(false) };
    const redis = { checkReady: vi.fn().mockResolvedValue(false) };
    const { response, status } = responseMock();
    const controller = new HealthController(prisma as never, storage as never, redis as never);

    const body = await controller.ready(response);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body).toEqual({
      status: 'degraded',
      deps: { database: false, redis: false, objectStorage: false },
    });
  });

  it('returns HTTP 200 only when all required dependencies are ready', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const storage = { checkReady: vi.fn().mockResolvedValue(true) };
    const redis = { checkReady: vi.fn().mockResolvedValue(true) };
    const { response, status } = responseMock();
    const controller = new HealthController(prisma as never, storage as never, redis as never);

    const body = await controller.ready(response);

    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(body.status).toBe('ok');
    expect(body.deps).toEqual({ database: true, redis: true, objectStorage: true });
  });
});
