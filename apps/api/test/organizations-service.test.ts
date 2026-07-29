import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { OrganizationsService } from '../src/organizations/organizations.service';

function makeService() {
  const organization = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  };
  const tx = {
    organization,
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const prisma = {
    organization,
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    recordInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  return {
    service: new OrganizationsService(prisma as never, audit as never),
    prisma,
    tx,
    audit,
  };
}

describe('OrganizationsService', () => {
  it('searches normalized aliases, requires every capability, and flattens roles', async () => {
    const { service, prisma } = makeService();
    prisma.organization.findMany.mockResolvedValue([
      {
        id: 'org-pamp',
        canonicalName: 'MKS PAMP SA',
        normalizedName: 'mks pamp sa',
        countryCode: 'CH',
        source: 'SYSTEM',
        verified: true,
        active: true,
        aliases: [
          {
            id: 'alias-pamp',
            name: 'PAMP',
            normalizedName: 'pamp',
            kind: 'TRADE_NAME',
            locale: null,
          },
        ],
        capabilities: [{ capability: 'REFINER' }, { capability: 'MANUFACTURER' }],
      },
    ]);

    const result = await service.search({
      q: ' ＰＡＭＰ ',
      capabilities: 'REFINER,MANUFACTURER',
      limit: 10,
    });

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          AND: [
            { capabilities: { some: { capability: 'REFINER' } } },
            { capabilities: { some: { capability: 'MANUFACTURER' } } },
          ],
        }),
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        canonicalName: 'MKS PAMP SA',
        capabilities: ['REFINER', 'MANUFACTURER'],
        matchedAlias: 'PAMP',
        aliases: [expect.not.objectContaining({ normalizedName: expect.anything() })],
      }),
    ]);
  });

  it('rejects unknown capability filters', async () => {
    const { service, prisma } = makeService();
    await expect(service.search({ capabilities: 'REFINER,NOT_A_ROLE' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
  });

  it('creates a normalized user organization with an official alias and audit record', async () => {
    const { service, prisma, tx, audit } = makeService();
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockImplementation(
      async ({ data }: { data: Record<string, any> }) => ({
        id: 'org-new',
        canonicalName: data.canonicalName,
        countryCode: data.countryCode,
        source: data.source,
        verified: data.verified,
        active: true,
        aliases: [{ id: 'alias-new', ...data.aliases.create[0] }],
        capabilities: data.capabilities.create,
      }),
    );

    const created = await service.create(
      { canonicalName: '  Example Bullion Co. ', countryCode: 'TW', capabilities: ['BRAND'] },
      'user-1',
    );

    expect(prisma.organization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { normalizedName: { in: ['example bullion co'] } },
            {
              aliases: {
                some: { normalizedName: { in: ['example bullion co'] } },
              },
            },
          ],
        },
      }),
    );
    expect(prisma.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          canonicalName: 'Example Bullion Co.',
          normalizedName: 'example bullion co',
          source: 'USER',
        }),
      }),
    );
    expect(created.capabilities).toEqual(['BRAND']);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'organization.create', resourceId: 'org-new' }),
    );
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.organization.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(prisma.organization.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.organization.create.mock.invocationCallOrder[0]!,
    );
  });

  it('reports an existing normalized organization as a conflict', async () => {
    const { service, prisma, tx } = makeService();
    prisma.organization.findFirst.mockResolvedValue({
      canonicalName: 'Existing Co.',
      normalizedName: 'existing co',
      aliases: [],
    });
    await expect(service.create({ canonicalName: 'Existing-Co.' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.organization.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'canonical name',
      dto: { canonicalName: ' PAMP ' },
      candidates: ['pamp'],
    },
    {
      label: 'submitted alias',
      dto: {
        canonicalName: 'New Bullion Company',
        aliases: [{ name: 'ＰＡＭＰ', kind: 'TRADE_NAME' as const }],
      },
      candidates: ['new bullion company', 'pamp'],
    },
  ])('rejects a $label matching an existing normalized alias', async ({ dto, candidates }) => {
    const { service, prisma } = makeService();
    prisma.organization.findFirst.mockResolvedValue({
      canonicalName: 'MKS PAMP SA',
      normalizedName: 'mks pamp sa',
      aliases: [{ name: 'PAMP', normalizedName: 'pamp' }],
    });

    await expect(service.create(dto)).rejects.toThrow(
      'Organization name or alias already exists as PAMP (MKS PAMP SA)',
    );
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { normalizedName: { in: candidates } },
            { aliases: { some: { normalizedName: { in: candidates } } } },
          ],
        },
      }),
    );
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate aliases inside one request regardless of locale', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.create({
        canonicalName: 'Example Bullion',
        aliases: [{ name: 'Example-Bullion', kind: 'TRADE_NAME', locale: 'en' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });
});
