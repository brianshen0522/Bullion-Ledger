import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PurchaseIntakesService } from '../src/purchase-intakes/purchase-intakes.service';

function intake(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-client-0001',
    userId: 'user-1',
    status: 'DRAFT',
    currentStep: 1,
    schemaVersion: 1,
    version: 3,
    draftData: { transaction: {} },
    attachments: [],
    purchase: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-07-28T00:00:00Z'),
    updatedAt: new Date('2026-07-28T00:00:00Z'),
    ...overrides,
  };
}

function attachment() {
  return {
    id: 'attachment-1',
    intakeId: 'draft-client-0001',
    purchaseId: null,
    assetId: null,
    uploadedById: 'user-1',
    draftItemId: 'draft-item-1',
    kind: 'front',
    mediaClass: 'ASSET_PHOTO',
    captureSource: 'CAMERA',
    status: 'READY',
    processingMode: 'NONE',
    description: null,
    tags: [],
    filename: 'gold.png',
    mime: 'image/png',
    verifiedMime: 'image/png',
    sizeBytes: 24,
    sha256: 'a'.repeat(64),
    width: 2,
    height: 3,
    pageCount: null,
    processingMetadata: null,
    userConfirmed: true,
    uploadKeyHash: 'b'.repeat(64),
    uploadRequestHash: 'c'.repeat(64),
    version: 1,
    storageKey: 'private/object/key',
    isCover: true,
    isSensitive: false,
    deletedAt: null,
    createdAt: new Date('2026-07-28T00:00:00Z'),
    updatedAt: new Date('2026-07-28T00:00:00Z'),
    variants: [
      {
        id: 'variant-1',
        attachmentId: 'attachment-1',
        kind: 'ORIGINAL',
        revision: 1,
        storageKey: 'private/object/key',
        mime: 'image/png',
        sizeBytes: 24,
        sha256: 'a'.repeat(64),
        width: 2,
        height: 3,
        pageCount: null,
        transformMetadata: null,
        createdAt: new Date('2026-07-28T00:00:00Z'),
      },
    ],
  };
}

function service(overrides: Record<string, unknown> = {}) {
  const prisma = {
    purchaseIntake: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(intake()),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
    ...overrides,
  };
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    recordInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  return {
    service: new PurchaseIntakesService(prisma as never, audit as never),
    prisma,
    audit,
  };
}

describe('PurchaseIntakesService', () => {
  it('keeps a client draft id stable and does not create a duplicate', async () => {
    const existing = intake({ attachments: [attachment()] });
    const { service: intakes, prisma } = service();
    prisma.purchaseIntake.findUnique.mockResolvedValueOnce(existing);

    const result = await intakes.create('user-1', { draftId: existing.id });

    expect(result).toEqual(expect.objectContaining({ id: existing.id, version: existing.version }));
    expect(result).not.toHaveProperty('userId');
    expect(JSON.stringify(result)).not.toMatch(/storageKey|uploadKeyHash|uploadRequestHash|sha256/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not reveal a draft owned by another user', async () => {
    const { service: intakes, prisma } = service();
    prisma.purchaseIntake.findUnique.mockResolvedValueOnce(intake({ userId: 'user-2' }));

    await expect(intakes.create('user-1', { draftId: 'draft-client-0001' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns 409 when an autosave uses a stale version', async () => {
    const { service: intakes, prisma } = service();
    prisma.purchaseIntake.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.purchaseIntake.findFirst.mockResolvedValueOnce({ status: 'DRAFT', version: 4 });

    await expect(
      intakes.update('user-1', 'draft-client-0001', {
        version: 3,
        currentStep: 2,
        draftData: { transaction: { dealerName: 'PAMP' } },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 404 rather than a version conflict for a foreign id', async () => {
    const { service: intakes, prisma } = service();
    prisma.purchaseIntake.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.purchaseIntake.findFirst.mockResolvedValueOnce(null);

    await expect(
      intakes.update('user-1', 'draft-client-0001', { version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
