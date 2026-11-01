import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpFetchError, PriceHttpClient } from '../src/price-providers/http-client';

const START = 'https://prices.example.test/latest';

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PriceHttpClient redirects', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows an HTTPS redirect and asks fetch not to follow on its own', async () => {
    const fetchMock = stubFetch(redirectTo('/moved'), new Response('{"price":1}', { status: 200 }));

    await expect(new PriceHttpClient().getJson(START, { attempts: 1 })).resolves.toEqual({
      price: 1,
    });

    expect(fetchMock.mock.calls[0]![1].redirect).toBe('manual');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://prices.example.test/moved');
  });

  it.each(['http://minio:9000/bullion-ledger/', 'http://169.254.169.254/latest/meta-data/'])(
    'refuses a redirect to %s',
    async (target) => {
      const fetchMock = stubFetch(redirectTo(target));

      await expect(new PriceHttpClient().getJson(START, { attempts: 1 })).rejects.toBeInstanceOf(
        HttpFetchError,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('gives up on a redirect loop', async () => {
    const fetchMock = stubFetch(
      redirectTo(START),
      redirectTo(START),
      redirectTo(START),
      redirectTo(START),
      redirectTo(START),
    );

    await expect(new PriceHttpClient().getJson(START, { attempts: 1 })).rejects.toThrow(
      'too many times',
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
