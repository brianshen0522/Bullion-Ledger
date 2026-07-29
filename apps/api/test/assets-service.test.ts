import { validate } from 'class-validator';
import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

import { HELD_ASSET_INCLUDE, presentHeldAsset } from '../src/assets/asset-presenter';
import { AssetsService } from '../src/assets/assets.service';
import { UpdateAssetDto } from '../src/assets/dto/update-asset.dto';

function assetRecord(
  overrides: Partial<{
    purchaseItem: {
      name: string;
      form: string;
      brand: string | null;
      unitWeightGrams: Decimal;
      packagingState: string | null;
      hasCertificate: boolean;
    } | null;
    product: { name: string } | null;
    purchase: { purchasedAt: Date; dealerName: string | null } | null;
    attachments: Array<{
      id: string;
      kind: string;
      isCover: boolean;
      variants: Array<{
        kind: 'THUMBNAIL' | 'CROPPED' | 'ORIGINAL';
        revision: number;
        mime: string;
        width: number | null;
        height: number | null;
      }>;
    }>;
  }> = {},
) {
  return {
    id: 'asset-1',
    purchaseItemId: 'item-1',
    purchaseId: 'purchase-1',
    productDefinitionId: 'product-1',
    metalId: 'metal-1',
    quantity: 2,
    grossWeightGrams: new Decimal('20.123456789'),
    purity: new Decimal('0.9999'),
    fineWeightGrams: new Decimal('20.121444443'),
    allocatedCost: new Decimal('1234.5'),
    currency: 'TWD',
    status: 'HELD',
    serial: 'SERIAL-001',
    storageLocation: 'Home safe',
    acquiredAt: new Date('2026-07-01T03:04:05.000Z'),
    createdAt: new Date('2026-07-02T03:04:05.000Z'),
    updatedAt: new Date('2026-07-03T03:04:05.000Z'),
    metal: { code: 'XAU', name: 'Gold' },
    product: { name: 'Mutable catalog name' },
    purchaseItem: {
      name: 'Purchase snapshot name',
      form: 'bar',
      brand: 'Snapshot brand',
      unitWeightGrams: new Decimal('10.061728394'),
      packagingState: 'sealed',
      hasCertificate: true,
    },
    purchase: {
      purchasedAt: new Date('2026-07-01T03:04:05.000Z'),
      dealerName: 'Trusted dealer',
    },
    attachments: [],
    ...overrides,
  };
}

describe('AssetsService', () => {
  it('queries only held assets in acquisition order with the inventory relations', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new AssetsService({ asset: { findMany } } as never);

    await service.list();

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'HELD' },
      orderBy: [{ acquiredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: HELD_ASSET_INCLUDE,
    });
  });

  it('presents catalog product data with live description and serializes decimals and dates', async () => {
    const findMany = vi.fn().mockResolvedValue([assetRecord()]);
    const service = new AssetsService({ asset: { findMany } } as never);

    await expect(service.list()).resolves.toEqual([
      {
        id: 'asset-1',
        productDefinitionId: 'product-1',
        name: 'Mutable catalog name',
        form: 'other',
        brand: null,
        country: null,
        yearOrVersion: null,
        metal: { code: 'XAU', name: 'Gold' },
        quantity: 2,
        unitWeightGrams: '10.061728394',
        grossWeightGrams: '20.123456789',
        purity: '0.9999',
        fineWeightGrams: '20.121444443',
        allocatedCost: '1234.5',
        currency: 'TWD',
        status: 'HELD',
        serial: 'SERIAL-001',
        storageLocation: 'Home safe',
        packagingState: 'sealed',
        hasCertificate: true,
        version: undefined,
        updatedAt: '2026-07-03T03:04:05.000Z',
        acquiredAt: '2026-07-01T03:04:05.000Z',
        purchase: {
          purchasedAt: '2026-07-01T03:04:05.000Z',
          dealerName: 'Trusted dealer',
        },
        coverPhoto: null,
      },
    ]);
  });

  it('presents the selected asset cover using the best private-photo variant metadata', () => {
    const presented = presentHeldAsset(
      assetRecord({
        attachments: [
          {
            id: 'photo-front',
            kind: 'front',
            isCover: false,
            variants: [
              {
                kind: 'CROPPED',
                revision: 3,
                mime: 'image/jpeg',
                width: 1200,
                height: 800,
              },
              {
                kind: 'ORIGINAL',
                revision: 1,
                mime: 'image/png',
                width: 4000,
                height: 3000,
              },
            ],
          },
          {
            id: 'photo-selected',
            kind: 'back',
            isCover: true,
            variants: [
              {
                kind: 'ORIGINAL',
                revision: 1,
                mime: 'image/png',
                width: 3000,
                height: 2000,
              },
              {
                kind: 'THUMBNAIL',
                revision: 2,
                mime: 'image/webp',
                width: 320,
                height: 240,
              },
            ],
          },
        ],
      }) as never,
    );

    expect(presented.coverPhoto).toEqual({
      attachmentId: 'photo-selected',
      variant: 'THUMBNAIL',
      revision: 2,
      mime: 'image/webp',
      width: 320,
      height: 240,
    });
    expect(JSON.stringify(presented)).not.toMatch(/storageKey|sha256|uploadRequestHash/);
  });

  it('falls back to a front photo and its original when no explicit cover or derivative exists', () => {
    const presented = presentHeldAsset(
      assetRecord({
        attachments: [
          {
            id: 'photo-back',
            kind: 'back',
            isCover: false,
            variants: [
              {
                kind: 'ORIGINAL',
                revision: 1,
                mime: 'image/jpeg',
                width: null,
                height: null,
              },
            ],
          },
          {
            id: 'photo-front',
            kind: 'front',
            isCover: false,
            variants: [
              {
                kind: 'ORIGINAL',
                revision: 4,
                mime: 'image/jpeg',
                width: 900,
                height: 900,
              },
            ],
          },
        ],
      }) as never,
    );

    expect(presented.coverPhoto).toMatchObject({
      attachmentId: 'photo-front',
      variant: 'ORIGINAL',
      revision: 4,
    });
  });

  it('serializes foreign Decimal-like instances through fixed-point strings', () => {
    const prismaAsset = assetRecord() as ReturnType<typeof assetRecord> & {
      grossWeightGrams: { dividedBy(value: number): { toFixed(): string }; toFixed(): string };
      fineWeightGrams: { toFixed(): string };
    };
    prismaAsset.grossWeightGrams = {
      dividedBy: () => ({ toFixed: () => '10.0617283945' }),
      toFixed: () => '20.123456789',
    };
    prismaAsset.fineWeightGrams = { toFixed: () => '20.121444443' };

    expect(presentHeldAsset(prismaAsset as never)).toMatchObject({
      unitWeightGrams: '10.061728394',
      grossWeightGrams: '20.123456789',
      fineWeightGrams: '20.121444443',
    });
  });

  it('falls back to the catalog name when the purchase-item snapshot is unavailable', async () => {
    const findMany = vi.fn().mockResolvedValue([
      assetRecord({
        purchaseItem: null,
        product: { name: 'Catalog fallback name' },
        purchase: null,
      }),
    ]);
    const service = new AssetsService({ asset: { findMany } } as never);

    const [asset] = await service.list();

    expect(asset).toMatchObject({
      name: 'Catalog fallback name',
      form: 'other',
      brand: null,
      unitWeightGrams: '10.061728394',
      packagingState: null,
      hasCertificate: false,
      purchase: null,
    });
  });
});

describe('UpdateAssetDto validation', () => {
  it('rejects allocatedCost: null at the DTO level', async () => {
    const dto = new UpdateAssetDto();
    dto.version = 1;
    (dto as Record<string, unknown>).allocatedCost = null;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'allocatedCost')).toBe(true);
  });

  it('accepts allocatedCost "0"', async () => {
    const dto = new UpdateAssetDto();
    dto.version = 1;
    dto.allocatedCost = '0';
    const errors = await validate(dto);
    const costErrors = errors.filter((e) => e.property === 'allocatedCost');
    expect(costErrors).toHaveLength(0);
  });

  it('accepts allocatedCost undefined (not sent)', async () => {
    const dto = new UpdateAssetDto();
    dto.version = 1;
    const errors = await validate(dto);
    const costErrors = errors.filter((e) => e.property === 'allocatedCost');
    expect(costErrors).toHaveLength(0);
  });
});

describe('AssetsService update', () => {
  function makeServiceWithTx() {
    const tx: Record<string, unknown> = {};
    const prisma = {
      $transaction: vi.fn(async (work: (t: typeof tx) => Promise<unknown>) => work(tx)),
      asset: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    };
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    tx.asset = prisma.asset;
    return {
      service: new AssetsService(prisma as never, audit as never),
      prisma,
      tx,
      audit,
    };
  }

  const BASE_ASSET = {
    id: 'asset-1',
    productDefinitionId: 'product-1',
    version: 1,
    status: 'HELD',
    quantity: 2,
    grossWeightGrams: new Decimal('20.123456789'),
    purity: new Decimal('0.9999'),
    fineWeightGrams: new Decimal('20.121444443'),
    allocatedCost: new Decimal('1000'),
    currency: 'USD',
    serial: 'SERIAL-001',
    storageLocation: 'Safe',
    metalId: 'metal-1',
    purchaseItemId: 'item-1',
    purchaseId: 'purchase-1',
    acquiredAt: new Date('2026-07-01T00:00:00.000Z'),
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    updatedAt: new Date('2026-07-03T00:00:00.000Z'),
    metal: { code: 'XAU', name: 'Gold' },
    product: { name: 'Gold bar', form: 'bar', brand: null, country: null, yearOrVersion: null },
    purchaseItem: {
      name: 'Gold bar',
      form: 'bar',
      brand: null,
      country: null,
      yearOrVersion: null,
      unitWeightGrams: new Decimal('10.061728394'),
      packagingState: 'sealed',
      hasCertificate: true,
    },
    purchase: { purchasedAt: new Date('2026-07-01T00:00:00.000Z'), dealerName: 'Dealer' },
    attachments: [],
  };

  it('updates quantity-only: derives unit weight from old gross/old quantity, no drift', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue(BASE_ASSET);
    tx.asset.updateMany.mockResolvedValue({ count: 1 });
    tx.asset.findUnique.mockResolvedValueOnce(BASE_ASSET).mockResolvedValueOnce({
      ...BASE_ASSET,
      quantity: 4,
      grossWeightGrams: new Decimal('40.246913578'),
      fineWeightGrams: new Decimal('40.242888887'),
      version: 2,
    });

    const result = await service.update(
      'asset-1',
      { version: 1, quantity: 4 },
      { userId: 'user-1', sessionId: 'session-1' },
    );

    expect(result.version).toBe(2);
    expect(tx.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 4,
          grossWeightGrams: '40.246913578',
          fineWeightGrams: '40.242888887',
        }),
      }),
    );
    expect(result.grossWeightGrams).toBe('40.246913578');
    expect(result.fineWeightGrams).toBe('40.242888887');
  });

  it('updates purity and fineWeightGrams without changing grossWeightGrams', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue(BASE_ASSET);
    tx.asset.updateMany.mockResolvedValue({ count: 1 });
    tx.asset.findUnique.mockResolvedValueOnce(BASE_ASSET).mockResolvedValueOnce({
      ...BASE_ASSET,
      purity: new Decimal('0.5'),
      fineWeightGrams: new Decimal('10.061728394'),
      version: 2,
    });

    const result = await service.update(
      'asset-1',
      { version: 1, purity: '0.5' },
      { userId: 'user-1' },
    );

    expect(tx.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purity: '0.5',
          fineWeightGrams: '10.061728394',
        }),
      }),
    );
    expect(result.grossWeightGrams).toBe('20.123456789');
    expect(result.purity).toBe('0.5');
    expect(result.fineWeightGrams).toBe('10.061728394');
  });

  it('metadata-only (serial+storage) does not change physical decimals', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue(BASE_ASSET);
    tx.asset.updateMany.mockResolvedValue({ count: 1 });
    tx.asset.findUnique.mockResolvedValueOnce(BASE_ASSET).mockResolvedValueOnce({
      ...BASE_ASSET,
      serial: 'NEW-SERIAL',
      storageLocation: 'New Safe',
      version: 2,
    });

    const result = await service.update(
      'asset-1',
      { version: 1, serial: 'NEW-SERIAL', storageLocation: 'New Safe' },
      { userId: 'user-1' },
    );

    expect(result.unitWeightGrams).toBe('10.061728394');
    expect(result.grossWeightGrams).toBe('20.123456789');
    expect(result.fineWeightGrams).toBe('20.121444443');
  });

  it('rejects allocatedCost: null with BadRequestException', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue(BASE_ASSET);
    await expect(
      service.update('asset-1', { version: 1, allocatedCost: null as never }, { userId: 'user-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects semantic no-op where all sent fields match current state', async () => {
    const { service, tx, audit } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue(BASE_ASSET);

    await expect(
      service.update(
        'asset-1',
        { version: 1, serial: 'SERIAL-001', storageLocation: 'Safe' },
        { userId: 'user-1' },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tx.asset.updateMany).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });

  it('accepts allocatedCost "0" and persists zero cost', async () => {
    const { service, tx, audit } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue(BASE_ASSET);
    tx.asset.updateMany.mockResolvedValue({ count: 1 });
    tx.asset.findUnique
      .mockResolvedValueOnce(BASE_ASSET)
      .mockResolvedValueOnce({ ...BASE_ASSET, allocatedCost: new Decimal('0'), version: 2 });

    await service.update('asset-1', { version: 1, allocatedCost: '0' }, { userId: 'user-1' });

    expect(tx.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ allocatedCost: '0' }),
      }),
    );
  });

  it('rejects negative allocatedCost', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue(BASE_ASSET);
    await expect(
      service.update('asset-1', { version: 1, allocatedCost: '-100' }, { userId: 'user-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-held asset', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue({ ...BASE_ASSET, status: 'SOLD' });

    await expect(
      service.update('asset-1', { version: 1, serial: 'X' }, { userId: 'user-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects weightUnit without unitWeight', async () => {
    const { service } = makeServiceWithTx();
    await expect(
      service.update('asset-1', { version: 1, weightUnit: 'kg' } as never, { userId: 'user-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects no-op patch with BadRequestException', async () => {
    const { service } = makeServiceWithTx();
    const noop = { version: 1 } as { version: number };
    await expect(service.update('asset-1', noop as never, { userId: 'user-1' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects stale version with ConflictException', async () => {
    const { service, tx } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue({ ...BASE_ASSET, version: 2 });

    await expect(
      service.update('asset-1', { version: 1, serial: 'X' }, { userId: 'user-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.asset.updateMany).not.toHaveBeenCalled();
  });

  it('records the full audit context', async () => {
    const { service, tx, audit } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue(BASE_ASSET);
    tx.asset.updateMany.mockResolvedValue({ count: 1 });
    tx.asset.findUnique
      .mockResolvedValueOnce(BASE_ASSET)
      .mockResolvedValueOnce({ ...BASE_ASSET, serial: 'AUDIT-TEST', version: 2 });

    await service.update(
      'asset-1',
      { version: 1, serial: 'AUDIT-TEST' },
      {
        userId: 'user-1',
        sessionId: 'session-99',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      },
    );

    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'session-99',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      }),
    );
  });

  it('treats minimum purity in exponential form as a semantic no-op', async () => {
    const { service, tx, audit } = makeServiceWithTx();
    tx.asset.findUnique.mockResolvedValue({
      ...BASE_ASSET,
      purity: new Decimal('0.0000001'),
      fineWeightGrams: new Decimal('0.000002012'),
    });

    await expect(
      service.update('asset-1', { version: 1, purity: '0.0000001' }, { userId: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.asset.updateMany).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
  });

  it('preserves packagingState/hasCertificate from PurchaseItem in presenter', async () => {
    const findMany = vi.fn().mockResolvedValue([BASE_ASSET]);
    const service = new AssetsService({ asset: { findMany } } as never);

    const [asset] = await service.list();

    expect(asset.packagingState).toBe('sealed');
    expect(asset.hasCertificate).toBe(true);
  });
});
