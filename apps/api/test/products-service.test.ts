import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { ProductsService } from '../src/products/products.service';

interface ProductPartyCreateInput {
  organizationId: string;
  role: string;
  isPrimary: boolean;
  attributionStatus: string;
}

interface ProductCreateCall {
  data: {
    name: string;
    form: string;
    brand: string | null;
    country: string | null;
    yearOrVersion: string | null;
    defaultPurity: string;
    defaultUnitWeightGrams: string;
    defaultWeightUnit: string;
    active: boolean;
    organizations: { create: ProductPartyCreateInput[] };
  };
}

function makeService() {
  const prisma = {
    organization: { findMany: vi.fn() },
    productDefinition: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  };
  const metals = {
    requireByCode: vi.fn().mockResolvedValue({ id: 'metal-gold', code: 'XAU' }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new ProductsService(prisma as never, metals as never, audit as never),
    prisma,
    audit,
  };
}

describe('ProductsService organization parties', () => {
  it('persists structured parties and derives the legacy brand from the primary BRAND', async () => {
    const { service, prisma, audit } = makeService();
    const organizations = [
      { id: 'org-bank', canonicalName: 'UBS AG' },
      { id: 'org-refiner', canonicalName: 'Argor-Heraeus SA' },
    ];
    prisma.organization.findMany.mockResolvedValue(organizations);
    prisma.productDefinition.create.mockImplementation(async ({ data }: ProductCreateCall) =>
      productRecord({
        name: data.name,
        form: data.form,
        brand: data.brand,
        country: data.country,
        yearOrVersion: data.yearOrVersion,
        defaultPurity: new Decimal(data.defaultPurity),
        defaultUnitWeightGrams: new Decimal(data.defaultUnitWeightGrams),
        defaultWeightUnit: data.defaultWeightUnit,
        active: data.active,
        organizations: data.organizations.create.map((party, index) => ({
          id: `product-party-${index + 1}`,
          role: party.role,
          isPrimary: party.isPrimary,
          attributionStatus: party.attributionStatus,
          organization: {
            id: party.organizationId,
            canonicalName: organizations.find(({ id }) => id === party.organizationId)!
              .canonicalName,
            countryCode: null,
            verified: false,
          },
        })),
      }),
    );

    const created = await service.create(
      {
        name: '1 oz branded bar',
        metalCode: 'XAU',
        form: 'bar',
        purity: '0.9999',
        unitWeight: '1',
        weightUnit: 'g',
        parties: [
          { organizationId: 'org-bank', role: 'BRAND', isPrimary: true },
          { organizationId: 'org-refiner', role: 'REFINER' },
        ],
      },
      'user-1',
    );

    expect(created.brand).toBe('UBS AG');
    expect(created.defaultPurity).toBe('0.9999');
    expect(created.defaultUnitWeightGrams).toBe('1');
    expect(created.createdAt).toBe('2026-07-28T00:00:00.000Z');
    expect(created.organizations).toEqual([
      expect.objectContaining({
        id: 'product-party-1',
        role: 'BRAND',
        organization: expect.objectContaining({ canonicalName: 'UBS AG' }),
      }),
      expect.objectContaining({
        id: 'product-party-2',
        role: 'REFINER',
        organization: expect.objectContaining({ canonicalName: 'Argor-Heraeus SA' }),
      }),
    ]);
    expect(prisma.productDefinition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brand: 'UBS AG',
          organizations: {
            create: [
              expect.objectContaining({ organizationId: 'org-bank', role: 'BRAND' }),
              expect.objectContaining({ organizationId: 'org-refiner', role: 'REFINER' }),
            ],
          },
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ afterSummary: expect.objectContaining({ parties: 2 }) }),
    );
  });

  it('presents list Decimal values as strings and dates as ISO timestamps', async () => {
    const { service, prisma } = makeService();
    prisma.productDefinition.findMany.mockResolvedValue([
      productRecord({
        defaultPurity: new Decimal('0.9999000'),
        defaultUnitWeightGrams: new Decimal('31.103476800'),
      }),
    ]);

    const [product] = await service.list();

    expect(product).toEqual(
      expect.objectContaining({
        id: 'product-1',
        defaultPurity: '0.9999',
        defaultUnitWeightGrams: '31.1034768',
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T01:00:00.000Z',
      }),
    );
    expect(typeof product!.defaultPurity).toBe('string');
    expect(typeof product!.defaultUnitWeightGrams).toBe('string');
    expect(product).not.toHaveProperty('catalogKey');
    expect(product).not.toHaveProperty('metalId');
  });

  it('presents the smallest legal decimals without exponent notation', async () => {
    const { service, prisma } = makeService();
    prisma.productDefinition.findMany.mockResolvedValue([
      productRecord({
        defaultPurity: new Decimal('0.0000001'),
        defaultUnitWeightGrams: new Decimal('0.000000001'),
      }),
    ]);

    const [product] = await service.list();

    expect(product?.defaultPurity).toBe('0.0000001');
    expect(product?.defaultUnitWeightGrams).toBe('0.000000001');
  });

  it('rejects multiple primary organizations for the same role', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.create({
        name: 'Invalid product',
        metalCode: 'XAU',
        form: 'bar',
        purity: '0.9999',
        unitWeight: '1',
        weightUnit: 'g',
        parties: [
          { organizationId: 'org-a', role: 'BRAND', isPrimary: true },
          { organizationId: 'org-b', role: 'BRAND', isPrimary: true },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
  });
});

describe('ProductsService update', () => {
  function makeServiceWithTx() {
    const tx: Record<string, unknown> = {};
    const prisma = {
      $transaction: vi.fn(async (work: (t: typeof tx) => Promise<unknown>) => work(tx)),
      organization: { findMany: vi.fn() },
      productDefinition: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      productOrganization: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const metals = {
      requireByCode: vi.fn().mockResolvedValue({ id: 'metal-gold', code: 'XAU' }),
    };
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    tx.productDefinition = prisma.productDefinition;
    tx.organization = prisma.organization;
    tx.productOrganization = prisma.productOrganization;
    return {
      service: new ProductsService(prisma as never, metals as never, audit as never),
      prisma,
      tx,
      audit,
    };
  }

  const BASE_PRODUCT = {
    id: 'product-1',
    version: 1,
    name: 'Gold bar',
    form: 'bar',
    brand: 'UBS',
    country: 'CH',
    yearOrVersion: '2026',
    defaultPurity: new Decimal('0.9999'),
    defaultUnitWeightGrams: new Decimal('31.1035'),
    defaultWeightUnit: 'g',
    active: true,
    metalId: 'metal-gold',
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T01:00:00.000Z'),
    metal: { code: 'XAU', name: 'Gold' },
    organizations: [],
  };

  it('updates name, form, and purity and increments version', async () => {
    const { service, tx, audit } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue(BASE_PRODUCT);
    tx.productDefinition.updateMany.mockResolvedValue({ count: 1 });
    tx.productDefinition.findUnique.mockResolvedValueOnce(BASE_PRODUCT).mockResolvedValueOnce({
      ...BASE_PRODUCT,
      name: 'Silver bar',
      form: 'coin',
      defaultPurity: new Decimal('0.999'),
      version: 2,
    });

    const result = await service.update(
      'product-1',
      {
        version: 1,
        name: 'Silver bar',
        form: 'coin',
        purity: '0.999',
      },
      { userId: 'user-1', sessionId: 'session-1', ip: '127.0.0.1', userAgent: 'test-agent' },
    );

    expect(tx.productDefinition.updateMany).toHaveBeenCalledWith({
      where: { id: 'product-1', version: 1 },
      data: expect.objectContaining({
        name: 'Silver bar',
        form: 'coin',
        defaultPurity: '0.999',
        version: { increment: 1 },
      }),
    });
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'session-1',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
        beforeSummary: expect.objectContaining({ version: 1 }),
      }),
    );
    expect(result.version).toBe(2);
  });

  it('rejects a stale version with ConflictException and no writes', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue({ ...BASE_PRODUCT, version: 2 });

    await expect(
      service.update('product-1', { version: 1, name: 'New' }, { userId: 'user-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.productDefinition.updateMany).not.toHaveBeenCalled();
  });

  it('rejects scalar brand change when a BRAND organization exists and parties not supplied', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue({
      ...BASE_PRODUCT,
      organizations: [
        {
          id: 'party-1',
          role: 'BRAND',
          organization: { canonicalName: 'PAMP SA' },
        },
      ],
    });

    await expect(
      service.update('product-1', { version: 1, brand: 'Other Brand' }, { userId: 'user-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.productDefinition.updateMany).not.toHaveBeenCalled();
  });

  it('allows scalar brand when parties are also supplied (coherent replacement)', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue(BASE_PRODUCT);
    tx.organization.findMany.mockResolvedValue([{ id: 'org-pamp', canonicalName: 'PAMP SA' }]);
    tx.productDefinition.updateMany.mockResolvedValue({ count: 1 });
    tx.productDefinition.findUnique.mockResolvedValueOnce(BASE_PRODUCT).mockResolvedValueOnce({
      ...BASE_PRODUCT,
      brand: 'PAMP SA',
      version: 2,
      organizations: [
        {
          id: 'new-party-1',
          role: 'BRAND',
          isPrimary: true,
          attributionStatus: 'DECLARED',
          organization: { canonicalName: 'PAMP SA' },
        },
      ],
    });

    const result = await service.update(
      'product-1',
      {
        version: 1,
        brand: 'ignored',
        parties: [{ organizationId: 'org-pamp', role: 'BRAND', isPrimary: true }],
      },
      { userId: 'user-1' },
    );

    expect(result.version).toBe(2);
    expect(result.brand).toBe('PAMP SA');
    expect(tx.productOrganization.deleteMany).toHaveBeenCalled();
    expect(tx.productOrganization.createMany).toHaveBeenCalled();
  });

  it('rejects semantic no-op with same parties', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue({
      ...BASE_PRODUCT,
      brand: 'PAMP SA',
      organizations: [
        {
          id: 'party-1',
          organizationId: 'org-pamp',
          role: 'BRAND',
          isPrimary: true,
          attributionStatus: 'DECLARED',
          organization: { canonicalName: 'PAMP SA' },
        },
      ],
    });
    tx.organization.findMany.mockResolvedValue([{ id: 'org-pamp', canonicalName: 'PAMP SA' }]);

    await expect(
      service.update(
        'product-1',
        { version: 1, parties: [{ organizationId: 'org-pamp', role: 'BRAND', isPrimary: true }] },
        { userId: 'user-1' },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tx.productDefinition.updateMany).not.toHaveBeenCalled();
  });

  it('accepts changed parties as a real semantic change', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue(BASE_PRODUCT);
    tx.organization.findMany.mockResolvedValue([{ id: 'org-pamp', canonicalName: 'PAMP SA' }]);
    tx.productDefinition.updateMany.mockResolvedValue({ count: 1 });
    tx.productDefinition.findUnique.mockResolvedValueOnce(BASE_PRODUCT).mockResolvedValueOnce({
      ...BASE_PRODUCT,
      brand: 'PAMP SA',
      version: 2,
      organizations: [
        {
          id: 'new-party-1',
          role: 'BRAND',
          isPrimary: true,
          attributionStatus: 'DECLARED',
          organization: { canonicalName: 'PAMP SA' },
        },
      ],
    });

    const result = await service.update(
      'product-1',
      { version: 1, parties: [{ organizationId: 'org-pamp', role: 'BRAND', isPrimary: true }] },
      { userId: 'user-1' },
    );

    expect(result.version).toBe(2);
    expect(tx.productDefinition.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ brand: 'PAMP SA' }),
      }),
    );
  });

  it('rejects semantic no-op where all sent fields match current state', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue(BASE_PRODUCT);

    await expect(
      service.update('product-1', { version: 1, name: 'Gold bar' }, { userId: 'user-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.productDefinition.updateMany).not.toHaveBeenCalled();
  });

  it('rejects version-only noop patch with BadRequestException', async () => {
    const { service } = makeServiceWithTx();

    await expect(
      service.update('product-1', { version: 1 }, { userId: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears brand, country, yearOrVersion when null is sent', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue(BASE_PRODUCT);
    tx.productDefinition.updateMany.mockResolvedValue({ count: 1 });
    tx.productDefinition.findUnique.mockResolvedValueOnce(BASE_PRODUCT).mockResolvedValueOnce({
      ...BASE_PRODUCT,
      brand: null,
      country: null,
      yearOrVersion: null,
      version: 2,
    });

    await service.update(
      'product-1',
      {
        version: 1,
        brand: null,
        country: null,
        yearOrVersion: null,
      },
      { userId: 'user-1' },
    );

    expect(tx.productDefinition.updateMany).toHaveBeenCalledWith({
      where: { id: 'product-1', version: 1 },
      data: expect.objectContaining({ brand: null, country: null, yearOrVersion: null }),
    });
  });

  it('does not recompute unitWeight when unitWeight is absent', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue(BASE_PRODUCT);
    tx.productDefinition.updateMany.mockResolvedValue({ count: 1 });
    tx.productDefinition.findUnique
      .mockResolvedValueOnce(BASE_PRODUCT)
      .mockResolvedValueOnce({ ...BASE_PRODUCT, name: 'Renamed', version: 2 });

    await service.update('product-1', { version: 1, name: 'Renamed' }, { userId: 'user-1' });

    const call = tx.productDefinition.updateMany.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.data).not.toHaveProperty('defaultUnitWeightGrams');
    expect(call.data).not.toHaveProperty('defaultWeightUnit');
  });

  it('writes both audit before and after on success', async () => {
    const { service, tx, audit } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue(BASE_PRODUCT);
    tx.productDefinition.updateMany.mockResolvedValue({ count: 1 });
    tx.productDefinition.findUnique
      .mockResolvedValueOnce(BASE_PRODUCT)
      .mockResolvedValueOnce({ ...BASE_PRODUCT, active: false, version: 2 });

    await service.update('product-1', { version: 1, active: false }, { userId: 'user-1' });

    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        beforeSummary: expect.objectContaining({ active: true }),
        afterSummary: expect.objectContaining({ active: false }),
      }),
    );
  });

  it('uses atomic CAS: two concurrent requests for same version, only one succeeds', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue(BASE_PRODUCT);
    tx.productDefinition.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    tx.productDefinition.findUnique
      .mockResolvedValueOnce(BASE_PRODUCT)
      .mockResolvedValueOnce({ ...BASE_PRODUCT, name: 'Winner', version: 2 })
      .mockResolvedValueOnce(BASE_PRODUCT);

    const first = service.update('product-1', { version: 1, name: 'Winner' }, { userId: 'user-1' });
    const second = service.update('product-1', { version: 1, name: 'Loser' }, { userId: 'user-1' });

    await expect(first).resolves.toBeDefined();
    await expect(second).rejects.toBeInstanceOf(ConflictException);
  });

  it('treats minimum purity in exponential form as a semantic no-op', async () => {
    const { service, tx, audit } = makeServiceWithTx();
    tx.productDefinition.findUnique.mockResolvedValue({
      ...BASE_PRODUCT,
      defaultPurity: new Decimal('0.0000001'),
    });

    await expect(
      service.update('product-1', { version: 1, purity: '0.0000001' }, { userId: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.productDefinition.updateMany).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });
});

function productRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    catalogKey: null,
    source: 'USER',
    metalId: 'metal-gold',
    name: 'Gold bar',
    form: 'bar',
    brand: null,
    country: null,
    yearOrVersion: null,
    defaultPurity: new Decimal('0.9999'),
    defaultUnitWeightGrams: new Decimal('1'),
    defaultWeightUnit: 'g',
    active: true,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T01:00:00.000Z'),
    metal: { code: 'XAU', name: 'Gold' },
    organizations: [],
    ...overrides,
  };
}
