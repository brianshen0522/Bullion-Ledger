import { ConflictException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import {
  AttachmentCaptureSource,
  AttachmentMediaClass,
  AttachmentProcessingMode,
  AttachmentVariantKind,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { readBoundedRawBody } from '../src/attachments/attachments.controller';
import { AttachmentsService } from '../src/attachments/attachments.service';

function png(width = 2, height = 3): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  bytes.set([(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff], 16);
  bytes.set(
    [(height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff],
    20,
  );
  return bytes;
}

function harness(configValues: Record<string, string | undefined> = {}) {
  let stored: Record<string, unknown> | null = null;
  let variantStored: Record<string, unknown> | null = null;
  const tx = {
    purchaseIntake: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    attachment: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        stored = {
          id: 'attachment-1',
          ...data,
          deletedAt: null,
          version: 1,
          variants: [
            {
              id: 'variant-1',
              ...(data.variants as { create: Record<string, unknown> }).create,
            },
          ],
        };
        return stored;
      }),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const increment = (data.version as { increment?: number } | undefined)?.increment ?? 0;
        stored = {
          ...(stored ?? {}),
          ...data,
          version: Number(stored?.version ?? 1) + increment,
        };
        return stored;
      }),
      updateMany: vi
        .fn()
        .mockImplementation(
          async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            if (!stored || (where.version !== undefined && where.version !== stored.version)) {
              return { count: 0 };
            }
            const increment = (data.version as { increment?: number } | undefined)?.increment ?? 0;
            stored = {
              ...stored,
              ...data,
              version: Number(stored.version ?? 1) + increment,
            };
            return { count: 1 };
          },
        ),
      findUnique: vi.fn().mockImplementation(async () => stored),
    },
    attachmentVariant: {
      findFirst: vi.fn().mockImplementation(async () => variantStored),
      aggregate: vi.fn().mockResolvedValue({
        _count: { _all: 0 },
        _sum: { sizeBytes: 0 },
      }),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        variantStored = { id: 'variant-derived-1', ...data };
        return variantStored;
      }),
    },
  };
  const prisma = {
    purchaseIntake: {
      findFirst: vi.fn().mockResolvedValue({ id: 'draft-client-0001', status: 'DRAFT' }),
    },
    attachment: {
      findUnique: vi.fn().mockImplementation(async () =>
        stored
          ? {
              ...stored,
              intake: { userId: 'user-1', status: 'DRAFT' },
            }
          : null,
      ),
      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        stored = { ...(stored ?? {}), ...data, deletedAt: new Date('2026-07-28T01:00:00Z') };
        return stored;
      }),
    },
    attachmentVariant: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockImplementation(async () => variantStored),
      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
    },
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const storage = {
    putObject: vi.fn().mockResolvedValue({ etag: 'etag-1' }),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    issueReadUrl: vi.fn().mockResolvedValue({ url: 'signed', expiresInSeconds: 300 }),
  };
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    recordInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  const config = { get: vi.fn((key: string) => configValues[key]) };
  return {
    service: new AttachmentsService(
      prisma as never,
      storage as never,
      audit as never,
      config as never,
    ),
    prisma,
    storage,
    audit,
    tx,
    getStored: () => stored,
  };
}

function uploadInput(filename = 'gold.png') {
  return {
    intakeId: 'draft-client-0001',
    userId: 'user-1',
    filename,
    declaredMime: 'image/png',
    idempotencyKey: 'attachment:upload-0001',
    bytes: png(),
    metadata: {
      kind: 'front',
      mediaClass: AttachmentMediaClass.ASSET_PHOTO,
      captureSource: AttachmentCaptureSource.CAMERA,
      processingMode: AttachmentProcessingMode.OBJECT_CROP,
      draftItemId: 'draft-item-1',
      clientMediaId: 'media-client-1',
    },
  };
}

describe('AttachmentsService', () => {
  it('rejects active content renamed as an image before writing storage', async () => {
    const { service, storage } = harness();
    await expect(
      service.upload({
        ...uploadInput(),
        bytes: new TextEncoder().encode('<svg><script>alert(1)</script></svg>'),
      }),
    ).rejects.toThrow(/Only valid JPEG/);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejects a document uploaded as the purchase cover', async () => {
    const { service, storage } = harness();

    await expect(
      service.upload({
        ...uploadInput('invoice.png'),
        metadata: {
          ...uploadInput().metadata,
          mediaClass: AttachmentMediaClass.DOCUMENT,
          processingMode: AttachmentProcessingMode.DOCUMENT_SCAN,
          isCover: 'true',
        },
      }),
    ).rejects.toThrow(/Only asset photos/);

    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('stores one ORIGINAL and treats a repeated upload key as completion replay', async () => {
    const { service, storage, tx } = harness();

    const first = await service.upload(uploadInput());
    const second = await service.upload(uploadInput());

    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/storageKey|uploadKeyHash|uploadRequestHash|sha256/);
    expect(first.processingMetadata).toEqual(
      expect.objectContaining({ clientMediaId: 'media-client-1' }),
    );
    expect(storage.putObject).toHaveBeenCalledOnce();
    expect(tx.attachment.create).toHaveBeenCalledOnce();
    expect(tx.purchaseIntake.updateMany).toHaveBeenCalledWith({
      where: { id: 'draft-client-0001', userId: 'user-1', status: 'DRAFT' },
      data: { version: { increment: 0 } },
    });
    expect(tx.purchaseIntake.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.attachment.aggregate.mock.invocationCallOrder[0]!,
    );
    expect(tx.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        verifiedMime: 'image/png',
        width: 2,
        height: 3,
        variants: {
          create: expect.objectContaining({ kind: 'ORIGINAL', revision: 1 }),
        },
      }),
      include: expect.any(Object),
    });
  });

  it('decodes an RFC 5987-style UTF-8 filename header', async () => {
    const { service, getStored } = harness();

    await service.upload(uploadInput("UTF-8''%E9%87%91%E6%A2%9D%E6%AD%A3%E9%9D%A2.png"));

    expect(getStored()).toEqual(expect.objectContaining({ filename: '金條正面.png' }));
  });

  it('counts retained soft-deleted originals toward the intake storage quota', async () => {
    const { service, prisma, storage } = harness({ ATTACHMENT_INTAKE_MAX_BYTES: '1048576' });
    prisma.attachment.aggregate.mockResolvedValueOnce({ _sum: { sizeBytes: 1_048_560 } });

    await expect(service.upload(uploadInput())).rejects.toThrow(/retained storage quota/);

    expect(prisma.attachment.aggregate).toHaveBeenCalledWith({
      where: { intakeId: 'draft-client-0001' },
      _sum: { sizeBytes: true },
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('stores revisioned derivatives and replays identical content by hash', async () => {
    const { service, storage, tx } = harness();
    await service.upload(uploadInput());

    const first = await service.uploadVariant(
      'user-1',
      'attachment-1',
      AttachmentVariantKind.CROPPED,
      'image/png',
      png(4, 5),
    );
    const second = await service.uploadVariant(
      'user-1',
      'attachment-1',
      AttachmentVariantKind.CROPPED,
      'image/png',
      png(4, 5),
    );

    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/storageKey|sha256/);
    expect(storage.putObject).toHaveBeenCalledTimes(2); // ORIGINAL + one CROPPED object
    expect(tx.purchaseIntake.updateMany.mock.invocationCallOrder[1]!).toBeLessThan(
      tx.attachment.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(tx.attachmentVariant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attachmentId: 'attachment-1',
        kind: 'CROPPED',
        revision: 1,
        width: 4,
        height: 5,
      }),
    });
  });

  it('signs derivative downloads with an extension matching the derivative MIME', async () => {
    const { service, prisma, storage } = harness();
    await service.upload({
      ...uploadInput('receipt.png'),
      metadata: {
        ...uploadInput().metadata,
        mediaClass: AttachmentMediaClass.DOCUMENT,
        processingMode: AttachmentProcessingMode.DOCUMENT_SCAN,
        kind: 'receipt',
      },
    });
    prisma.attachmentVariant.findMany.mockResolvedValueOnce([
      {
        id: 'variant-scan-1',
        attachmentId: 'attachment-1',
        kind: AttachmentVariantKind.SCAN_COLOR,
        revision: 1,
        storageKey: 'variants/scan-color',
        mime: 'image/jpeg',
        sizeBytes: 24,
        sha256: 'hash',
        width: 4,
        height: 5,
        pageCount: null,
        createdAt: new Date('2026-07-28T00:00:00.000Z'),
      },
    ]);

    await service.issueReadUrl('user-1', 'attachment-1', AttachmentVariantKind.SCAN_COLOR);

    expect(storage.issueReadUrl).toHaveBeenCalledWith('variants/scan-color', {
      filename: 'receipt.jpg',
      mime: 'image/jpeg',
      download: true,
    });
  });

  it('keeps ORIGINAL immutable through the derivative endpoint', async () => {
    const { service, storage } = harness();
    await expect(
      service.uploadVariant(
        'user-1',
        'attachment-1',
        AttachmentVariantKind.ORIGINAL,
        'image/png',
        png(),
      ),
    ).rejects.toThrow(/immutable/);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('enforces the derivative revision quota under the serialized parent update', async () => {
    const { service, storage, tx } = harness({ ATTACHMENT_DERIVATIVE_MAX_REVISIONS: '1' });
    await service.upload(uploadInput());
    tx.attachmentVariant.aggregate.mockResolvedValueOnce({
      _count: { _all: 1 },
      _sum: { sizeBytes: 24 },
    });

    await expect(
      service.uploadVariant(
        'user-1',
        'attachment-1',
        AttachmentVariantKind.CROPPED,
        'image/png',
        png(4, 5),
      ),
    ).rejects.toThrow(/revision quota/);

    expect(storage.putObject).toHaveBeenCalledOnce(); // ORIGINAL only
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(tx.attachmentVariant.create).not.toHaveBeenCalled();
  });

  it('enforces total derivative bytes before persisting the next object', async () => {
    const { service, storage, tx } = harness({ ATTACHMENT_DERIVATIVE_MAX_BYTES: '30' });
    await service.upload(uploadInput());
    tx.attachmentVariant.aggregate.mockResolvedValueOnce({
      _count: { _all: 1 },
      _sum: { sizeBytes: 24 },
    });

    await expect(
      service.uploadVariant(
        'user-1',
        'attachment-1',
        AttachmentVariantKind.CROPPED,
        'image/png',
        png(4, 5),
      ),
    ).rejects.toThrow(/byte quota/);

    expect(storage.putObject).toHaveBeenCalledOnce(); // ORIGINAL only
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('counts retained derivatives toward the intake-wide storage quota', async () => {
    const { service, storage, tx } = harness({ ATTACHMENT_INTAKE_MAX_BYTES: '1048576' });
    await service.upload(uploadInput());
    tx.attachmentVariant.aggregate
      .mockResolvedValueOnce({
        _count: { _all: 0 },
        _sum: { sizeBytes: 0 },
      })
      .mockResolvedValueOnce({
        _count: { _all: 3 },
        _sum: { sizeBytes: 1_048_560 },
      });

    await expect(
      service.uploadVariant(
        'user-1',
        'attachment-1',
        AttachmentVariantKind.CROPPED,
        'image/png',
        png(4, 5),
      ),
    ).rejects.toThrow(/retained storage quota/);

    expect(tx.attachmentVariant.aggregate).toHaveBeenLastCalledWith({
      where: {
        attachment: { intakeId: 'draft-client-0001' },
        kind: { not: AttachmentVariantKind.ORIGINAL },
      },
      _sum: { sizeBytes: true },
    });
    expect(storage.putObject).toHaveBeenCalledOnce(); // ORIGINAL only
  });

  it('removes a persisted derivative object when its metadata transaction fails', async () => {
    const { service, storage, tx } = harness();
    await service.upload(uploadInput());
    tx.attachmentVariant.create.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.uploadVariant(
        'user-1',
        'attachment-1',
        AttachmentVariantKind.CROPPED,
        'image/png',
        png(4, 5),
      ),
    ).rejects.toThrow('database unavailable');

    expect(storage.putObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenCalledOnce();
  });

  it('does not append derivatives to an attachment that belongs to nothing mutable', async () => {
    // Draft, holding and purchase are the three scopes an owner can still act
    // on; anything else (a soft-deleted or detached row) stays frozen.
    const { service, prisma, storage } = harness();
    prisma.attachment.findUnique.mockResolvedValueOnce({
      id: 'attachment-detached',
      version: 4,
      uploadedById: 'user-1',
      intakeId: null,
      purchaseId: null,
      assetId: null,
      intake: null,
      deletedAt: null,
      variants: [],
    });

    await expect(
      service.uploadVariant(
        'user-1',
        'attachment-detached',
        AttachmentVariantKind.CROPPED,
        'image/png',
        png(4, 5),
      ),
    ).rejects.toThrow(/immutable/);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejects a derivative based on stale attachment metadata after a concurrent review', async () => {
    const { service, storage, tx } = harness();
    await service.upload(uploadInput());
    tx.attachment.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.uploadVariant(
        'user-1',
        'attachment-1',
        AttachmentVariantKind.CROPPED,
        'image/png',
        png(4, 5),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.attachment.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'attachment-1', version: 1 }),
      data: { version: { increment: 1 } },
    });
    expect(tx.attachmentVariant.create).not.toHaveBeenCalled();
    expect(storage.putObject).toHaveBeenCalledOnce(); // ORIGINAL only
  });

  it('requires a stored derivative before confirming a crop recipe', async () => {
    const { service } = harness();
    await service.upload(uploadInput());

    await expect(
      service.review('user-1', 'attachment-1', {
        version: 1,
        userConfirmed: true,
        processingMetadata: { crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks a reviewed crop READY after the derivative is uploaded', async () => {
    const { service, tx } = harness();
    await service.upload(uploadInput());
    await service.uploadVariant(
      'user-1',
      'attachment-1',
      AttachmentVariantKind.CROPPED,
      'image/png',
      png(4, 5),
    );

    await service.review('user-1', 'attachment-1', {
      version: 2,
      userConfirmed: true,
      processingMetadata: { crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
    });

    expect(tx.attachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userConfirmed: true, status: 'READY' }),
      }),
    );
  });

  it('persists READY attachment assignment and display metadata with optimistic concurrency', async () => {
    const { service, getStored, tx } = harness();
    await service.upload(uploadInput());
    await service.uploadVariant(
      'user-1',
      'attachment-1',
      AttachmentVariantKind.CROPPED,
      'image/png',
      png(4, 5),
    );
    await service.review('user-1', 'attachment-1', {
      version: 2,
      userConfirmed: true,
    });
    tx.purchaseIntake.updateMany.mockClear();
    tx.attachment.updateMany.mockClear();

    const updated = await service.review('user-1', 'attachment-1', {
      version: 3,
      kind: 'serial',
      mediaClass: AttachmentMediaClass.ASSET_PHOTO,
      draftItemId: 'draft-item-2',
      description: 'new serial close-up',
      isCover: false,
    });

    expect(updated).toEqual(
      expect.objectContaining({
        version: 4,
        status: 'READY',
        kind: 'serial',
        draftItemId: 'draft-item-2',
        description: 'new serial close-up',
        isCover: false,
      }),
    );
    expect(getStored()).toEqual(expect.objectContaining({ userConfirmed: true }));
    expect(tx.purchaseIntake.updateMany).toHaveBeenCalledOnce();
    expect(tx.attachment.updateMany).toHaveBeenCalledOnce();
    expect(tx.purchaseIntake.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.attachment.updateMany.mock.invocationCallOrder[0]!,
    );

    await expect(
      service.review('user-1', 'attachment-1', {
        version: 3,
        description: 'stale overwrite',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects metadata changes after an attachment leaves its draft intake', async () => {
    const { service, prisma } = harness();
    prisma.attachment.findUnique.mockResolvedValueOnce({
      id: 'attachment-finalized',
      version: 4,
      uploadedById: 'user-1',
      intakeId: null,
      purchaseId: 'purchase-1',
      intake: null,
      deletedAt: null,
      variants: [],
    });

    await expect(
      service.review('user-1', 'attachment-finalized', {
        version: 4,
        description: 'too late',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not retain cover status when reclassifying an asset photo as a document', async () => {
    const { service, storage } = harness();
    await service.upload({
      ...uploadInput(),
      metadata: { ...uploadInput().metadata, isCover: 'true' },
    });

    await expect(
      service.review('user-1', 'attachment-1', {
        version: 1,
        mediaClass: AttachmentMediaClass.DOCUMENT,
        processingMode: AttachmentProcessingMode.NONE,
      }),
    ).rejects.toThrow(/Only asset photos/);

    expect(storage.putObject).toHaveBeenCalledOnce();
  });

  it('does not allow one user to soft-delete another user’s upload', async () => {
    const { service, prisma } = harness();
    prisma.attachment.findUnique.mockResolvedValueOnce({
      id: 'attachment-foreign',
      uploadedById: 'user-2',
      intake: null,
      deletedAt: null,
      variants: [],
    });

    await expect(service.softDelete('user-1', 'attachment-foreign')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });

  it('soft-deletes metadata without deleting the private original object', async () => {
    const { service, storage, tx } = harness();
    await service.upload(uploadInput());

    const deleted = await service.softDelete('user-1', 'attachment-1');

    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(tx.attachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deletedAt: expect.any(Date), version: { increment: 1 }, isCover: false },
      }),
    );
    expect(tx.purchaseIntake.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.purchaseIntake.updateMany.mock.invocationCallOrder[1]).toBeLessThan(
      tx.attachment.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('does not soft-delete an attachment that belongs to nothing mutable', async () => {
    const { service, prisma } = harness();
    prisma.attachment.findUnique.mockResolvedValueOnce({
      id: 'attachment-orphaned',
      uploadedById: 'user-1',
      intakeId: null,
      purchaseId: null,
      assetId: null,
      intake: null,
      deletedAt: null,
      variants: [],
    });

    await expect(service.softDelete('user-1', 'attachment-orphaned')).rejects.toThrow(/immutable/);
  });

  it('lets the owner remove a purchase-level document after finalization', async () => {
    // The holding editor lists invoices and receipts, so removing one there has
    // to work; before this, every such delete answered 409.
    const record = {
      id: 'attachment-invoice',
      uploadedById: 'user-1',
      intakeId: null,
      purchaseId: 'purchase-1',
      assetId: null,
      intake: null,
      deletedAt: null,
      mediaClass: AttachmentMediaClass.DOCUMENT,
      version: 1,
      variants: [],
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      attachment: {
        updateMany,
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...record, deletedAt: new Date('2026-09-14T00:00:00Z') }),
      },
    };
    const prisma = {
      attachment: { findUnique: vi.fn().mockResolvedValue(record) },
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const service = new AttachmentsService(
      prisma as never,
      {} as never,
      { recordInTransaction: vi.fn().mockResolvedValue(undefined) } as never,
      { get: vi.fn() } as never,
    );

    await expect(service.softDelete('user-1', 'attachment-invoice')).resolves.toMatchObject({
      id: 'attachment-invoice',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attachment-invoice', purchaseId: 'purchase-1', deletedAt: null },
      }),
    );
  });
});

describe('AttachmentsService after finalization', () => {
  const metadata = { kind: 'front', mediaClass: 'ASSET_PHOTO', captureSource: 'LIBRARY' };

  function build() {
    const tx = {
      attachment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        aggregate: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ version: 2 }),
      },
      attachmentVariant: {
        findFirst: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { sizeBytes: 0 } }),
        create: vi.fn().mockResolvedValue({ id: 'variant-2', kind: 'CROPPED', revision: 1 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
      asset: { findUnique: vi.fn().mockResolvedValue({ id: 'asset-1', status: 'HELD' }) },
      attachment: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      attachmentVariant: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new AttachmentsService(
      prisma as never,
      { putObject: vi.fn(), deleteObject: vi.fn() } as never,
      { recordInTransaction: vi.fn() } as never,
      { get: vi.fn() } as never,
    );
    return { service, prisma, tx };
  }

  it('does not charge a holding derivative against an intake quota', async () => {
    const { service, prisma, tx } = build();
    prisma.attachment.findUnique.mockResolvedValue({
      id: 'attachment-1',
      version: 1,
      intakeId: null,
      purchaseId: null,
      assetId: 'asset-1',
      deletedAt: null,
      mediaClass: 'ASSET_PHOTO',
      uploadedById: 'user-1',
      intake: null,
      variants: [],
    });

    await service.uploadVariant('user-1', 'attachment-1', 'CROPPED' as never, 'image/png', png());

    expect(tx.attachment.aggregate).not.toHaveBeenCalled();
    expect(tx.attachmentVariant.create).toHaveBeenCalledOnce();
  });

  it('rejects an Idempotency-Key reused for a different holding upload', async () => {
    const { service, prisma } = build();
    prisma.attachment.findUnique.mockResolvedValue({
      assetId: 'asset-1',
      uploadRequestHash: 'digest-of-another-file',
      variants: [],
    });

    await expect(
      service.uploadForAsset({
        assetId: 'asset-1',
        userId: 'user-1',
        filename: 'gold.png',
        declaredMime: 'image/png',
        idempotencyKey: 'asset-upload-key',
        bytes: png(),
        metadata: metadata as never,
      }),
    ).rejects.toThrow(/different upload/);
  });
});

describe('AttachmentsService listForAsset', () => {
  function assetHarness(asset: { id: string; status: string; purchaseId: string | null } | null) {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      asset: { findUnique: vi.fn().mockResolvedValue(asset) },
      attachment: { findMany },
    };
    return {
      service: new AttachmentsService(
        prisma as never,
        {} as never,
        {} as never,
        { get: vi.fn() } as never,
      ),
      findMany,
    };
  }

  it('lists the purchase-level documents alongside the holding own photos', async () => {
    // Finalization moves photos onto the asset but leaves invoices/receipts on
    // the purchase, so an assetId-only query hid every document ever uploaded
    // through the purchase wizard.
    const { service, findMany } = assetHarness({
      id: 'asset-1',
      status: 'HELD',
      purchaseId: 'purchase-1',
    });

    await service.listForAsset('user-1', 'asset-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          OR: [{ assetId: 'asset-1' }, { purchaseId: 'purchase-1' }],
        },
      }),
    );
  });

  it('queries only the holding when it has no purchase', async () => {
    const { service, findMany } = assetHarness({
      id: 'asset-1',
      status: 'HELD',
      purchaseId: null,
    });

    await service.listForAsset('user-1', 'asset-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, OR: [{ assetId: 'asset-1' }] },
      }),
    );
  });

  it('reports an unknown holding rather than listing nothing', async () => {
    const { service } = assetHarness(null);
    await expect(service.listForAsset('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AttachmentsService issueReadUrl disposition', () => {
  function readHarness() {
    const issueReadUrl = vi.fn().mockResolvedValue({ url: 'signed', expiresInSeconds: 300 });
    const prisma = {
      attachment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'attachment-1',
          filename: 'invoice.pdf',
          mediaClass: AttachmentMediaClass.DOCUMENT,
          deletedAt: null,
          uploadedById: 'user-1',
          intake: null,
          variants: [],
        }),
      },
      attachmentVariant: {
        findMany: vi.fn().mockResolvedValue([
          {
            kind: AttachmentVariantKind.ORIGINAL,
            revision: 1,
            storageKey: 'private/invoice.pdf',
            mime: 'application/pdf',
          },
        ]),
      },
    };
    return {
      service: new AttachmentsService(
        prisma as never,
        { issueReadUrl } as never,
        {} as never,
        { get: vi.fn() } as never,
      ),
      issueReadUrl,
    };
  }

  it('still defaults a document to a download', async () => {
    const { service, issueReadUrl } = readHarness();
    await service.issueReadUrl('user-1', 'attachment-1');
    expect(issueReadUrl).toHaveBeenCalledWith(
      'private/invoice.pdf',
      expect.objectContaining({ download: true }),
    );
  });

  it('serves a document inline when the caller is previewing it', async () => {
    const { service, issueReadUrl } = readHarness();
    await service.issueReadUrl('user-1', 'attachment-1', undefined, undefined, 'inline');
    expect(issueReadUrl).toHaveBeenCalledWith(
      'private/invoice.pdf',
      expect.objectContaining({ download: false }),
    );
  });
});

describe('bounded raw attachment body reader', () => {
  it('rejects an oversized Content-Length before reading', async () => {
    const req = { headers: { 'content-length': '11' }, rawBody: Buffer.from('small') };
    await expect(readBoundedRawBody(req as never, 10)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('returns a captured raw body within the bound', async () => {
    const req = { headers: { 'content-length': '4' }, rawBody: Buffer.from('gold') };
    await expect(readBoundedRawBody(req as never, 10)).resolves.toEqual(
      new Uint8Array(Buffer.from('gold')),
    );
  });
});
