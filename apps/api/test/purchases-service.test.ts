import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { PurchasesService } from '../src/purchases/purchases.service';
import { hashPurchaseRequest } from '../src/purchases/purchase-idempotency';
import type { PurchaseDto } from '../src/purchases/dto/purchase.dto';

const IDEMPOTENCY_KEY = 'purchase:test-key-0001';

function purchaseDto(overrides: Partial<PurchaseDto> = {}): PurchaseDto {
  return {
    purchasedAt: '2026-07-28T00:00:00.000Z',
    currency: 'USD',
    subtotal: '100',
    allocationMethod: 'EQUAL',
    items: [
      {
        productDefinitionId: 'product-1',
        productDefinitionVersion: 1,
        metalCode: 'XAU',
        form: 'bar',
        name: 'Gold bar',
        quantity: 1,
        unitWeight: '1',
        weightUnit: 'g',
        purity: '0.9999',
        lineSubtotal: '100',
      },
    ],
    ...overrides,
  };
}

function productRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    version: 1,
    metalId: 'metal-gold',
    active: true,
    name: 'Catalog gold bar',
    form: 'bar',
    brand: null,
    country: null,
    yearOrVersion: null,
    defaultPurity: new Decimal('0.9999'),
    defaultUnitWeightGrams: new Decimal('1'),
    defaultWeightUnit: 'g',
    organizations: [],
    ...overrides,
  };
}

function serviceWithProduct(
  product:
    | ({
        id: string;
        metalId: string;
        active: boolean;
      } & Partial<{
        name: string;
        form: string;
        brand: string | null;
        country: string | null;
        yearOrVersion: string | null;
        version: number;
        defaultPurity: Decimal;
        defaultUnitWeightGrams: Decimal;
        defaultWeightUnit: string;
        organizations: Array<{
          organizationId: string;
          role: 'BRAND' | 'REFINER';
          isPrimary: boolean;
          attributionStatus: 'VERIFIED' | 'DECLARED';
          organization: { canonicalName: string };
        }>;
      }>)
    | null,
  existing: { id: string; requestHash: string } | null = null,
) {
  const record = product ? productRecord(product) : null;
  const findByResult = record ? [record] : [];
  const orgsByProductId = new Map<string, typeof record.organizations>();
  if (record) orgsByProductId.set(record.id, record.organizations);

  const tx = {
    $queryRaw: vi
      .fn()
      .mockImplementation(async (_strings: TemplateStringsArray, ...params: unknown[]) => {
        // Tagged template form: `$queryRaw\`...${id}...\`` passes ID as params[0]
        const id = params[0] as string;
        if (id && findByResult.some((r) => r.id === id)) {
          return [{ id }];
        }
        // Not found — $queryRaw returns empty set -> NotFoundException
        return [];
      }),
    productDefinition: {
      findMany: vi.fn().mockResolvedValue(findByResult),
    },
    purchase: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'purchase-1',
        purchasedAt: new Date('2026-07-28T00:00:00.000Z'),
      }),
    },
    purchaseItem: { create: vi.fn().mockResolvedValue({ id: 'item-1' }) },
    purchaseItemOrganizationSnapshot: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    asset: { create: vi.fn().mockResolvedValue({ id: 'asset-1' }) },
    purchaseIntake: {
      findFirst: vi.fn().mockResolvedValue({ status: 'DRAFT', purchase: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({ id: 'intake-1', status: 'COMPLETED' }),
    },
    attachment: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: 'attachment-1' }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
    purchase: {
      findUnique: vi.fn().mockImplementation(async (args: Record<string, unknown>) => {
        const where = args.where as Record<string, unknown>;
        if ('idempotencyKeyHash' in where) return existing;
        return {
          id: where.id ?? 'purchase-1',
          idempotencyKeyHash: 'internal-key-hash',
          requestHash: 'internal-request-hash',
          items: [],
        };
      }),
    },
    purchaseIntake: {
      findFirst: vi.fn().mockResolvedValue({ status: 'DRAFT', purchase: null }),
    },
  };
  const metals = {
    requireByCode: vi.fn().mockResolvedValue({ id: 'metal-gold', code: 'XAU', active: true }),
  };
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    recordInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  const service = new PurchasesService(prisma as never, metals as never, audit as never);
  return { service, prisma, metals, audit, tx };
}

describe('PurchasesService product consistency and atomic writes', () => {
  it('rejects a missing product definition before creating the purchase', async () => {
    const { service, tx } = serviceWithProduct(null);

    await expect(service.create(purchaseDto(), IDEMPOTENCY_KEY)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.purchase.create).not.toHaveBeenCalled();
  });

  it('rejects inactive and wrong-metal product definitions', async () => {
    for (const product of [
      { id: 'product-1', metalId: 'metal-gold', active: false },
      { id: 'product-1', metalId: 'metal-silver', active: true },
    ]) {
      const { service, tx } = serviceWithProduct(product);
      await expect(service.create(purchaseDto(), IDEMPOTENCY_KEY)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tx.purchase.create).not.toHaveBeenCalled();
    }
  });

  it('uses the same transaction client for header, item, asset, and audit writes', async () => {
    const { service, prisma, audit, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
    });
    const context = {
      userId: 'user-1',
      sessionId: 'session-1',
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    };

    await service.create(purchaseDto(), IDEMPOTENCY_KEY, context);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.purchase.create).toHaveBeenCalledOnce();
    expect(tx.purchaseItem.create).toHaveBeenCalledOnce();
    expect(tx.asset.create).toHaveBeenCalledOnce();
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        ...context,
        action: 'purchase.create',
        resourceId: 'purchase-1',
      }),
    );
    expect(audit.record).not.toHaveBeenCalled();

    const createData = tx.purchase.create.mock.calls[0]![0].data;
    expect(createData.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createData.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(createData)).not.toContain(IDEMPOTENCY_KEY);
  });

  it('snapshots authoritative catalog parties and derives the compatibility brand', async () => {
    const { service, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
      name: 'PAMP Lady Fortuna 1 g',
      organizations: [
        {
          organizationId: 'org-pamp',
          role: 'BRAND',
          isPrimary: true,
          attributionStatus: 'VERIFIED',
          organization: { canonicalName: 'MKS PAMP SA' },
        },
      ],
    });

    await service.create(purchaseDto(), IDEMPOTENCY_KEY);

    expect(tx.purchaseItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'PAMP Lady Fortuna 1 g', brand: 'MKS PAMP SA' }),
    });
    expect(tx.purchaseItemOrganizationSnapshot.createMany).toHaveBeenCalledWith({
      data: [
        {
          purchaseItemId: 'item-1',
          organizationId: 'org-pamp',
          role: 'BRAND',
          displayName: 'MKS PAMP SA',
          isPrimary: true,
          attributionStatus: 'VERIFIED',
        },
      ],
    });
  });

  it('uses and snapshots the selected primary brand for a custom item', async () => {
    const { service, tx } = serviceWithProduct(null);
    const dto = purchaseDto();
    delete dto.items[0]!.productDefinitionId;
    delete dto.items[0]!.productDefinitionVersion;
    dto.items[0]!.brand = 'Primary Brand';
    dto.items[0]!.parties = [
      {
        role: 'BRAND',
        displayName: 'First Brand',
        isPrimary: false,
      },
      {
        role: 'BRAND',
        displayName: 'Primary Brand',
        isPrimary: true,
      },
    ];

    await service.create(dto, IDEMPOTENCY_KEY);

    expect(tx.purchaseItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ brand: 'Primary Brand' }),
    });
    expect(tx.purchaseItemOrganizationSnapshot.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ displayName: 'First Brand', isPrimary: false }),
        expect.objectContaining({ displayName: 'Primary Brand', isPrimary: true }),
      ],
    });
  });

  it('aborts the purchase path when the transactional audit write fails', async () => {
    const { service, audit, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
    });
    audit.recordInTransaction.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.create(purchaseDto(), IDEMPOTENCY_KEY)).rejects.toThrow(
      'audit unavailable',
    );
    expect(tx.purchase.create).toHaveBeenCalledOnce();
    expect(tx.purchaseItem.create).toHaveBeenCalledOnce();
    expect(tx.asset.create).toHaveBeenCalledOnce();
  });

  it('locks multiple product IDs in sorted order with correct fine weight and allocation', async () => {
    const { service, tx } = serviceWithProduct(null);
    // Override $queryRaw to serve both products
    tx.$queryRaw.mockImplementation(
      async (_strings: TemplateStringsArray, ...params: unknown[]) => {
        const id = params[0] as string;
        if (['product-a', 'product-b'].includes(id)) return [{ id }];
        return [];
      },
    );
    // Override findMany to return both product definitions
    const productA = productRecord({
      id: 'product-a',
      defaultUnitWeightGrams: new Decimal('31.1034768'),
      defaultPurity: new Decimal('0.9999'),
    });
    const productB = productRecord({
      id: 'product-b',
      defaultUnitWeightGrams: new Decimal('31.1034768'),
      defaultPurity: new Decimal('0.9999'),
    });
    tx.productDefinition.findMany.mockResolvedValue([productA, productB]);

    const dto = purchaseDto();
    dto.items[0]!.productDefinitionId = 'product-a';
    dto.items[0]!.unitWeight = '31.1034768';
    dto.items.push({
      ...dto.items[0]!,
      productDefinitionId: 'product-b',
      lineSubtotal: '100',
    });
    dto.subtotal = '200';

    await service.create(dto, IDEMPOTENCY_KEY);

    // Lock queries in sorted order: product-a before product-b
    const ids = tx.$queryRaw.mock.calls.map((call) => call[1] as string);
    expect(ids).toEqual(['product-a', 'product-b']);

    // Each item's fine weight: quantizeWeightGrams(31.1034768 × 0.9999 × 1)
    // = quantizeWeightGrams(31.10036645232) = 31.100366452 (9 decimal, ROUND_HALF_EVEN)
    expect(tx.asset.create.mock.calls[0][0].data.fineWeightGrams).toBe('31.100366452');
    expect(tx.asset.create.mock.calls[1][0].data.fineWeightGrams).toBe('31.100366452');

    // EQUAL allocation: each item gets half of totalAmount (200)
    // totalAmount = quantizeMoney(200 + 0 + 0 + 0 + 0 + 0 + 0 - 0) = 200
    expect(tx.asset.create.mock.calls[0][0].data.allocatedCost).toBe('100');
    expect(tx.asset.create.mock.calls[1][0].data.allocatedCost).toBe('100');
  });

  it('rejects forged unitWeight that does not round-trip to canonical grams', async () => {
    const { service, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
      defaultUnitWeightGrams: new Decimal('31.1034768'),
      defaultWeightUnit: 'g',
    });
    // Catalog says 31.1034768 g. Item submits wrong weight in g.
    const dto = purchaseDto({ unitWeight: '30' } as never);
    dto.items[0]!.unitWeight = '30';
    dto.items[0]!.weightUnit = 'g';

    await expect(service.create(dto, IDEMPOTENCY_KEY)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.purchase.create).not.toHaveBeenCalled();
    expect(tx.purchaseItem.create).not.toHaveBeenCalled();
    expect(tx.asset.create).not.toHaveBeenCalled();
  });

  it('rejects forged purity that does not match catalog default', async () => {
    const { service, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
      defaultPurity: new Decimal('0.9999'),
    });
    const dto = purchaseDto({ purity: '0.5' } as never);
    dto.items[0]!.purity = '0.5';

    await expect(service.create(dto, IDEMPOTENCY_KEY)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.purchase.create).not.toHaveBeenCalled();
    expect(tx.purchaseItem.create).not.toHaveBeenCalled();
    expect(tx.asset.create).not.toHaveBeenCalled();
  });

  it('accepts legitimate troy-ounce round-trip: 31.1034768 g -> 1 troy_oz', async () => {
    const { service, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
      defaultUnitWeightGrams: new Decimal('31.1034768'),
      defaultWeightUnit: 'g',
    });
    const dto = purchaseDto();
    dto.items[0]!.unitWeight = '1';
    dto.items[0]!.weightUnit = 'troy_oz';
    dto.items[0]!.purity = '0.9999';

    await expect(service.create(dto, IDEMPOTENCY_KEY)).resolves.toBeDefined();
    expect(tx.purchase.create).toHaveBeenCalled();
  });

  it('rejects forged unitWeight in troy_oz that does not round-trip', async () => {
    const { service, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
      defaultUnitWeightGrams: new Decimal('31.1034768'),
      defaultWeightUnit: 'g',
    });
    const dto = purchaseDto();
    dto.items[0]!.unitWeight = '1.5';
    dto.items[0]!.weightUnit = 'troy_oz';

    await expect(service.create(dto, IDEMPOTENCY_KEY)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.purchase.create).not.toHaveBeenCalled();
  });

  it('persists authoritative canonical grams and purity in PurchaseItem and Asset', async () => {
    const { service, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
      defaultUnitWeightGrams: new Decimal('31.1034768'),
      defaultWeightUnit: 'g',
    });
    const dto = purchaseDto();
    dto.items[0]!.unitWeight = '31.1034768';
    dto.items[0]!.weightUnit = 'g';
    dto.items[0]!.purity = '0.9999';
    dto.items[0]!.quantity = 2;

    await service.create(dto, IDEMPOTENCY_KEY);

    // PurchaseItem: unitWeightGrams from authoritative grams, purity from catalog, etc.
    expect(tx.purchaseItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        unitWeightGrams: '31.1034768',
        purity: '0.9999',
        grossWeightGrams: '62.2069536',
        fineWeightGrams: expect.stringMatching(/62\.\d+/),
        weightUnit: 'g',
        allocatedCost: expect.any(String),
      }),
    });
    // Asset: same canonical values
    expect(tx.asset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purity: '0.9999',
        grossWeightGrams: '62.2069536',
        fineWeightGrams: expect.stringMatching(/62\.\d+/),
        allocatedCost: expect.any(String),
      }),
    });
  });

  it('does not reach audit when physical validation fails', async () => {
    const { service, audit, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
      defaultPurity: new Decimal('0.9999'),
    });
    const dto = purchaseDto({ purity: '0.5' } as never);
    dto.items[0]!.purity = '0.5';

    await expect(service.create(dto, IDEMPOTENCY_KEY)).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
    expect(tx.purchase.create).not.toHaveBeenCalled();
  });

  it('does not reach audit when an earlier transactional write fails', async () => {
    const { service, audit, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
    });
    tx.asset.create.mockRejectedValueOnce(new Error('asset write failed'));

    await expect(service.create(purchaseDto(), IDEMPOTENCY_KEY)).rejects.toThrow(
      'asset write failed',
    );
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });
});

describe('PurchasesService idempotency', () => {
  const product = { id: 'product-1', metalId: 'metal-gold', active: true };

  it('returns the original purchase for the same key and same semantic request', async () => {
    const dto = purchaseDto();
    const { service, prisma, metals, audit, tx } = serviceWithProduct(product, {
      id: 'purchase-existing',
      requestHash: hashPurchaseRequest(dto),
    });

    const result = await service.create(dto, IDEMPOTENCY_KEY);

    expect(result).toEqual({ id: 'purchase-existing', items: [] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(metals.requireByCode).not.toHaveBeenCalled();
    expect(tx.purchase.create).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });

  it('returns 409 when a key is replayed with different content', async () => {
    const { service, prisma, metals } = serviceWithProduct(product, {
      id: 'purchase-existing',
      requestHash: hashPurchaseRequest(purchaseDto({ notes: 'original' })),
    });

    await expect(
      service.create(purchaseDto({ notes: 'changed' }), IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(metals.requireByCode).not.toHaveBeenCalled();
  });

  it('recovers a concurrent unique-key race and returns the committed winner', async () => {
    const dto = purchaseDto();
    const { service, prisma, tx, audit } = serviceWithProduct(product);
    let keyLookupCount = 0;
    prisma.purchase.findUnique.mockImplementation(async (args: Record<string, unknown>) => {
      const where = args.where as Record<string, unknown>;
      if ('idempotencyKeyHash' in where) {
        keyLookupCount += 1;
        return keyLookupCount === 1
          ? null
          : { id: 'purchase-winner', requestHash: hashPurchaseRequest(dto) };
      }
      return {
        id: where.id,
        idempotencyKeyHash: 'internal-key-hash',
        requestHash: 'internal-request-hash',
        items: [],
      };
    });
    tx.purchase.create.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['idempotencyKeyHash'] },
    });

    const result = await service.create(dto, IDEMPOTENCY_KEY);

    expect(result).toEqual({ id: 'purchase-winner', items: [] });
    expect(keyLookupCount).toBe(2);
    expect(tx.purchaseItem.create).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });

  it('turns a concurrent same-key/different-request race into 409', async () => {
    const dto = purchaseDto();
    const { service, prisma, tx } = serviceWithProduct(product);
    let keyLookupCount = 0;
    prisma.purchase.findUnique.mockImplementation(async (args: Record<string, unknown>) => {
      const where = args.where as Record<string, unknown>;
      if ('idempotencyKeyHash' in where) {
        keyLookupCount += 1;
        return keyLookupCount === 1
          ? null
          : {
              id: 'purchase-winner',
              requestHash: hashPurchaseRequest(purchaseDto({ notes: 'other payload' })),
            };
      }
      return {
        id: where.id,
        idempotencyKeyHash: 'internal-key-hash',
        requestHash: 'internal-request-hash',
        items: [],
      };
    });
    tx.purchase.create.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['idempotencyKeyHash'] },
    });

    await expect(service.create(dto, IDEMPOTENCY_KEY)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not mask a unique conflict from an unrelated constraint', async () => {
    const { service, tx } = serviceWithProduct(product);
    const unrelated = { code: 'P2002', meta: { target: ['storageKey'] } };
    tx.purchase.create.mockRejectedValueOnce(unrelated);

    await expect(service.create(purchaseDto(), IDEMPOTENCY_KEY)).rejects.toBe(unrelated);
  });

  it('rejects a stale productDefinitionVersion with ConflictException', async () => {
    const dto = purchaseDto();
    dto.items[0]!.productDefinitionVersion = 1;
    const staleProduct = { id: 'product-1', metalId: 'metal-gold', active: true, version: 2 };
    const { service, tx } = serviceWithProduct(staleProduct);

    const error = await service.create(dto, IDEMPOTENCY_KEY).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'PRODUCT_VERSION_CONFLICT',
    });
    expect(tx.purchase.create).not.toHaveBeenCalled();
  });

  it('rejects productDefinitionVersion without productDefinitionId', async () => {
    const dto = purchaseDto();
    dto.items[0]!.productDefinitionVersion = 1;
    delete dto.items[0]!.productDefinitionId;

    const { service, tx } = serviceWithProduct({
      id: 'product-1',
      metalId: 'metal-gold',
      active: true,
    });

    await expect(service.create(dto, IDEMPOTENCY_KEY)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('PurchasesService intake finalization', () => {
  const product = { id: 'product-1', metalId: 'metal-gold', active: true };

  it('atomically links the source intake, reassigns attachments, and completes the draft', async () => {
    const { service, tx } = serviceWithProduct(product);
    tx.attachment.findMany.mockResolvedValueOnce([
      {
        id: 'document-1',
        mediaClass: 'DOCUMENT',
        draftItemId: null,
        status: 'READY',
        processingMode: 'DOCUMENT_SCAN',
        userConfirmed: true,
      },
      {
        id: 'photo-front',
        mediaClass: 'ASSET_PHOTO',
        draftItemId: 'draft-item-1',
        kind: 'front',
        isCover: false,
        status: 'READY',
        processingMode: 'OBJECT_CROP',
        userConfirmed: true,
      },
      {
        id: 'photo-1',
        mediaClass: 'ASSET_PHOTO',
        draftItemId: 'draft-item-1',
        kind: 'back',
        isCover: true,
        status: 'READY',
        processingMode: 'OBJECT_CROP',
        userConfirmed: true,
      },
      {
        id: 'purchase-photo-1',
        mediaClass: 'ASSET_PHOTO',
        draftItemId: null,
        kind: 'front',
        isCover: false,
        status: 'READY',
        processingMode: 'OBJECT_CROP',
        userConfirmed: true,
      },
    ]);
    const dto = purchaseDto();
    dto.items[0]!.draftItemId = 'draft-item-1';

    await service.createFromIntake('intake-1', 'user-1', dto, 'purchase:intake-finalize-1', {
      userId: 'user-1',
    });

    expect(tx.purchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceIntakeId: 'intake-1' }),
    });
    expect(tx.purchaseIntake.updateMany).toHaveBeenCalledWith({
      where: { id: 'intake-1', userId: 'user-1', status: 'DRAFT' },
      data: { version: { increment: 0 } },
    });
    expect(tx.purchaseIntake.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.purchase.create.mock.invocationCallOrder[0]!,
    );
    expect(tx.purchaseIntake.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.attachment.findMany.mock.invocationCallOrder[0]!,
    );
    expect(tx.attachment.update).toHaveBeenCalledWith({
      where: { id: 'document-1' },
      data: { intakeId: null, purchaseId: 'purchase-1', assetId: null },
    });
    expect(tx.attachment.update).toHaveBeenCalledWith({
      where: { id: 'photo-front' },
      data: { intakeId: null, purchaseId: null, assetId: 'asset-1', isCover: false },
    });
    expect(tx.attachment.update).toHaveBeenCalledWith({
      where: { id: 'photo-1' },
      data: { intakeId: null, purchaseId: null, assetId: 'asset-1', isCover: true },
    });
    expect(tx.attachment.update).toHaveBeenCalledWith({
      where: { id: 'purchase-photo-1' },
      data: { intakeId: null, purchaseId: 'purchase-1', assetId: null },
    });
    expect(tx.purchaseIntake.update).toHaveBeenCalledWith({
      where: { id: 'intake-1' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
  });

  it('returns the same completed purchase even when a retry uses a different key', async () => {
    const { service, prisma } = serviceWithProduct(product);
    prisma.purchaseIntake.findFirst.mockResolvedValue({
      status: 'COMPLETED',
      purchase: { id: 'purchase-existing' },
    });

    const first = await service.createFromIntake(
      'intake-1',
      'user-1',
      purchaseDto(),
      'purchase:first-finalize-key',
    );
    const second = await service.createFromIntake(
      'intake-1',
      'user-1',
      purchaseDto({ notes: 'retry body is ignored after completion' }),
      'purchase:different-finalize-key',
    );

    expect(first).toEqual(second);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns the winning purchase when another finalizer completes while waiting for the lock', async () => {
    const { service, prisma, tx } = serviceWithProduct(product);
    tx.purchaseIntake.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.purchaseIntake.findFirst.mockResolvedValueOnce({
      status: 'COMPLETED',
      purchase: { id: 'purchase-winning-finalizer' },
    });

    const result = await service.createFromIntake(
      'intake-1',
      'user-1',
      purchaseDto(),
      'purchase:concurrent-finalize',
    );

    expect(result).toEqual(expect.objectContaining({ id: 'purchase-winning-finalizer' }));
    expect(tx.purchase.create).not.toHaveBeenCalled();
    expect(tx.attachment.findMany).not.toHaveBeenCalled();
    expect(prisma.purchase.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'purchase-winning-finalizer' } }),
    );
  });

  it('does not snapshot attachments after losing the draft lock to cancellation', async () => {
    const { service, tx } = serviceWithProduct(product);
    tx.purchaseIntake.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.purchaseIntake.findFirst.mockResolvedValueOnce({ status: 'CANCELLED', purchase: null });

    await expect(
      service.createFromIntake(
        'intake-1',
        'user-1',
        purchaseDto(),
        'purchase:cancelled-during-finalize',
      ),
    ).rejects.toThrow(/cancelled/);
    expect(tx.purchase.create).not.toHaveBeenCalled();
    expect(tx.attachment.findMany).not.toHaveBeenCalled();
  });

  it('blocks finalization while an active attachment still needs review', async () => {
    const { service, tx } = serviceWithProduct(product);
    tx.attachment.findMany.mockResolvedValueOnce([
      {
        id: 'photo-unconfirmed',
        mediaClass: 'ASSET_PHOTO',
        draftItemId: null,
        status: 'NEEDS_REVIEW',
        processingMode: 'OBJECT_CROP',
        userConfirmed: false,
      },
    ]);

    await expect(
      service.createFromIntake(
        'intake-1',
        'user-1',
        purchaseDto(),
        'purchase:unconfirmed-attachment',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchaseIntake.update).not.toHaveBeenCalled();
  });
});
