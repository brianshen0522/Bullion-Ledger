import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, onUnauthorized } from '../src/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API errors', () => {
  it('normalizes a non-JSON proxy error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })));

    await expect(api.get('/health')).rejects.toMatchObject({
      status: 502,
      message: 'Bad gateway',
    });
  });

  it('preserves a machine-readable API error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: 'Catalog changed',
            code: 'PRODUCT_VERSION_CONFLICT',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(api.post('/purchases', {})).rejects.toMatchObject({
      status: 409,
      message: 'Catalog changed',
      code: 'PRODUCT_VERSION_CONFLICT',
    });
  });

  it('notifies the app when a protected request loses authorization', async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(api.get('/dashboard/summary')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});

describe('API request options', () => {
  it('forwards an idempotency header on a POST', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.post(
      '/purchases',
      { subtotal: '10' },
      {
        headers: { 'Idempotency-Key': 'purchase:test-key' },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/purchases',
      expect.objectContaining({ method: 'POST' }),
    );
    const requestInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(requestInit.headers).get('Idempotency-Key')).toBe('purchase:test-key');
  });
});
