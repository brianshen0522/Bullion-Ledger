import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { responseHeadersMiddleware } from '../src/common/middleware/response-headers.middleware';

describe('responseHeadersMiddleware', () => {
  it('marks API responses as uncacheable', () => {
    const setHeader = vi.fn();
    const next = vi.fn() as unknown as NextFunction;

    responseHeadersMiddleware({} as Request, { setHeader } as unknown as Response, next);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledOnce();
  });
});
