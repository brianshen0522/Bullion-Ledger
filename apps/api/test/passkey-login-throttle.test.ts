import { BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { PasskeysService } from '../src/webauthn/passkeys.service';

describe('passkey login throttle accounting', () => {
  it('returns the reserved attempt when the ceremony has no usable challenge', async () => {
    const throttle = { consume: vi.fn(), release: vi.fn(), recordFailure: vi.fn() };
    const challenges = { consume: vi.fn().mockResolvedValue(null) };
    const service = new PasskeysService(
      {} as never,
      {} as never,
      challenges as never,
      {} as never,
      throttle as never,
      {} as never,
    );

    await expect(
      service.finishLogin('challenge-1', { id: 'x' } as never, {} as Response, { ip: '192.0.2.5' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(throttle.consume).toHaveBeenCalledOnce();
    expect(throttle.release).toHaveBeenCalledWith('@passkey', '192.0.2.5');
    expect(throttle.recordFailure).not.toHaveBeenCalled();
  });
});
