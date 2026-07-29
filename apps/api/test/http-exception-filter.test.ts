import { ConflictException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('HttpExceptionFilter', () => {
  it('preserves a safe machine-readable error code', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: 'POST',
          url: '/purchases',
          headers: { 'x-request-id': 'request-1' },
        }),
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(
      new ConflictException({
        code: 'PRODUCT_VERSION_CONFLICT',
        message: 'Catalog changed',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      error: 'ConflictException',
      message: 'Catalog changed',
      code: 'PRODUCT_VERSION_CONFLICT',
      requestId: 'request-1',
    });
  });

  it('does not expose a non-string code', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'GET', url: '/test', headers: {} }),
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(
      new ConflictException({ code: { unsafe: true }, message: 'Conflict' }),
      host,
    );

    expect(json).toHaveBeenCalledWith(expect.not.objectContaining({ code: expect.anything() }));
  });
});
