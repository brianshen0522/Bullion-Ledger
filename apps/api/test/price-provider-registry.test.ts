import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { PriceProviderRegistry } from '../src/price-providers/price-provider.registry';
import type { MetalQuote, PriceProvider } from '../src/price-providers/price-provider.interface';

function config(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function prismaStub() {
  return {
    priceProviderStatus: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

function quote(metalCode: string, price: string): MetalQuote {
  return {
    metalCode,
    price,
    quoteCurrency: 'USD',
    quoteUnit: 'troy_oz',
    quotedAt: new Date('2026-07-28T00:00:00.000Z'),
    sourceType: 'SPOT',
  };
}

function fakeProvider(
  id: string,
  behaviour: { latest?: () => Promise<MetalQuote[]> } = {},
): PriceProvider {
  return {
    descriptor: { id, capabilities: ['spot'], attribution: id },
    supportedMetals: () => ['XAU', 'XAG'],
    fetchLatest: behaviour.latest ?? (() => Promise.resolve([quote('XAU', '4000')])),
  };
}

/** Builds a registry over exactly the providers supplied, in order. */
function registryOf(providers: PriceProvider[], primary?: string) {
  const prisma = prismaStub();
  const registry = new PriceProviderRegistry(
    prisma as never,
    config(primary ? { PRICE_PROVIDER: primary } : {}),
    providers[0] as never,
    providers[1] as never,
    providers[2] as never,
  );
  return { registry, prisma };
}

describe('PriceProviderRegistry failover', () => {
  it('uses the first healthy provider and records the success', async () => {
    const first = fakeProvider('first');
    const { registry, prisma } = registryOf([first, fakeProvider('second'), fakeProvider('third')]);

    const result = await registry.fetchLatest(['XAU']);

    expect(result.provider).toBe('first');
    expect(result.quotes).toHaveLength(1);
    expect(prisma.priceProviderStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: 'first' } }),
    );
  });

  it('falls through to the next provider when one throws', async () => {
    const failing = fakeProvider('failing', {
      latest: () => Promise.reject(new Error('upstream 503')),
    });
    const healthy = fakeProvider('healthy');
    const { registry } = registryOf([failing, healthy, fakeProvider('third')]);

    const result = await registry.fetchLatest(['XAU']);
    expect(result.provider).toBe('healthy');
  });

  it('treats an empty result as a miss so a degraded upstream still fails over', async () => {
    const empty = fakeProvider('empty', { latest: () => Promise.resolve([]) });
    const healthy = fakeProvider('healthy');
    const { registry } = registryOf([empty, healthy, fakeProvider('third')]);

    const result = await registry.fetchLatest(['XAU']);
    expect(result.provider).toBe('healthy');
  });

  it('records a failure with its reason before moving on', async () => {
    const failing = fakeProvider('failing', {
      latest: () => Promise.reject(new Error('upstream 503')),
    });
    const { registry, prisma } = registryOf([failing, fakeProvider('healthy'), fakeProvider('t')]);

    await registry.fetchLatest(['XAU']);

    const failureCall = prisma.priceProviderStatus.upsert.mock.calls.find(
      ([args]: [{ where: { provider: string } }]) => args.where.provider === 'failing',
    ) as [{ create: { lastError: string }; update: { consecutiveFail: unknown } }] | undefined;
    expect(failureCall?.[0].create.lastError).toContain('upstream 503');
    expect(failureCall?.[0].update.consecutiveFail).toEqual({ increment: 1 });
  });

  it('reports unavailable, with every reason, when all providers fail', async () => {
    const boom = (id: string) =>
      fakeProvider(id, { latest: () => Promise.reject(new Error(`${id} down`)) });
    const { registry } = registryOf([boom('a'), boom('b'), boom('c')]);

    await expect(registry.fetchLatest(['XAU'])).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(registry.fetchLatest(['XAU'])).rejects.toThrow(/a down.*b down.*c down/s);
  });

  it('tries the configured primary before the others', async () => {
    const order: string[] = [];
    const track = (id: string) =>
      fakeProvider(id, {
        latest: () => {
          order.push(id);
          return Promise.resolve([quote('XAU', '4000')]);
        },
      });
    const { registry } = registryOf([track('a'), track('b'), track('c')], 'c');

    await registry.fetchLatest(['XAU']);
    expect(order).toEqual(['c']);
  });

  it('never reports a provider that has never run as healthy', async () => {
    const { registry } = registryOf([fakeProvider('a'), fakeProvider('b'), fakeProvider('c')]);

    const statuses = await registry.status();
    expect(statuses).toHaveLength(3);
    expect(statuses.every((status) => status.healthy)).toBe(false);
  });

  it('reports the union of supported metals', async () => {
    const { registry } = registryOf([fakeProvider('a'), fakeProvider('b'), fakeProvider('c')]);
    expect(registry.supportedMetals()).toEqual(['XAG', 'XAU']);
  });
});
