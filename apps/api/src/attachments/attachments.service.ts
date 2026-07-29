import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AttachmentMediaClass,
  AttachmentProcessingMode,
  AttachmentStatus,
  AttachmentVariantKind,
  PurchaseIntakeStatus,
  type Prisma,
} from '@prisma/client';

import { AuditService } from '../audit/audit.service.js';
import { lockDraftIntake } from '../purchase-intakes/draft-intake-lock.js';
import type { PurchaseAuditContext } from '../purchases/purchases.service.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { StorageService } from '../storage/storage.service.js';
import type { ReviewAttachmentDto, UploadAttachmentQueryDto } from './dto/attachment.dto.js';
import {
  assertSafePixelCount,
  declaredMimeMatches,
  detectAcceptedMedia,
  sha256Hex,
  type AcceptedMediaKind,
} from './file-validation.js';
import {
  presentAttachment,
  presentAttachmentVariant,
  type AttachmentWithVariants,
} from './attachment-presenter.js';

const DEFAULT_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_PDF_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_INTAKE_MAX_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 60_000_000;
const DEFAULT_DERIVATIVE_MAX_REVISIONS = 20;
const DEFAULT_DERIVATIVE_MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 240;
const MAX_TAGS = 24;
const MAX_PDF_PAGES = 100;
const MAX_PROCESSING_METADATA_BYTES = 32 * 1024;

interface AttachmentLimits {
  imageMaxBytes: number;
  pdfMaxBytes: number;
  intakeMaxBytes: number;
  maxPixels: number;
  derivativeMaxRevisions: number;
  derivativeMaxBytes: number;
}

interface UploadInput {
  intakeId: string;
  userId: string;
  filename: string;
  declaredMime: string;
  idempotencyKey: string;
  bytes: Uint8Array;
  metadata: UploadAttachmentQueryDto;
  auditContext?: PurchaseAuditContext;
}

const ATTACHMENT_INCLUDE = {
  variants: { orderBy: [{ kind: 'asc' }, { revision: 'desc' }] },
} satisfies Prisma.AttachmentInclude;

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger('Attachments');
  private readonly limits: AttachmentLimits;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.limits = {
      imageMaxBytes: parseLimit(
        config.get<string>('ATTACHMENT_IMAGE_MAX_BYTES'),
        DEFAULT_IMAGE_MAX_BYTES,
        1 * 1024 * 1024,
        100 * 1024 * 1024,
      ),
      pdfMaxBytes: parseLimit(
        config.get<string>('ATTACHMENT_PDF_MAX_BYTES'),
        DEFAULT_PDF_MAX_BYTES,
        1 * 1024 * 1024,
        200 * 1024 * 1024,
      ),
      intakeMaxBytes: parseLimit(
        config.get<string>('ATTACHMENT_INTAKE_MAX_BYTES'),
        DEFAULT_INTAKE_MAX_BYTES,
        1 * 1024 * 1024,
        2_000 * 1024 * 1024,
      ),
      maxPixels: parseLimit(
        config.get<string>('ATTACHMENT_MAX_PIXELS'),
        DEFAULT_MAX_PIXELS,
        1_000_000,
        250_000_000,
      ),
      derivativeMaxRevisions: parseLimit(
        config.get<string>('ATTACHMENT_DERIVATIVE_MAX_REVISIONS'),
        DEFAULT_DERIVATIVE_MAX_REVISIONS,
        1,
        1_000,
      ),
      derivativeMaxBytes: parseLimit(
        config.get<string>('ATTACHMENT_DERIVATIVE_MAX_BYTES'),
        DEFAULT_DERIVATIVE_MAX_BYTES,
        1,
        2_000 * 1024 * 1024,
      ),
    };
  }

  maxRawUploadBytes(declaredMime?: string): number {
    return normalizeDeclaredMime(declaredMime ?? '') === 'application/pdf'
      ? this.limits.pdfMaxBytes
      : this.limits.imageMaxBytes;
  }

  async upload(input: UploadInput) {
    if (!input.bytes.byteLength) throw new BadRequestException('Attachment body is empty');
    if (input.intakeId.length > 128) throw new NotFoundException('Purchase intake not found');
    const filename = normalizeFilename(input.filename);
    const detected = detectAcceptedMedia(input.bytes);
    if (!detected) {
      throw new BadRequestException(
        'Only valid JPEG, PNG, WebP, HEIC/HEIF, or PDF files are accepted',
      );
    }
    if (!declaredMimeMatches(detected.kind, input.declaredMime)) {
      throw new BadRequestException('Declared Content-Type does not match the file signature');
    }

    const isPdf = detected.kind === 'PDF';
    const fileLimit = isPdf ? this.limits.pdfMaxBytes : this.limits.imageMaxBytes;
    if (input.bytes.byteLength > fileLimit) {
      throw new PayloadTooLargeException(
        `${isPdf ? 'PDF' : 'Image'} exceeds the configured upload limit`,
      );
    }
    if (isPdf && input.metadata.mediaClass !== AttachmentMediaClass.DOCUMENT) {
      throw new BadRequestException('PDF files must use mediaClass DOCUMENT');
    }

    let pageCount: number | null = null;
    if (isPdf) {
      pageCount = validatePdfAndEstimatePages(input.bytes);
    } else {
      try {
        assertSafePixelCount(detected, this.limits.maxPixels);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      if (detected.width === null || detected.height === null) {
        throw new BadRequestException('Image dimensions could not be verified');
      }
    }

    const intake = await this.prisma.purchaseIntake.findFirst({
      where: { id: input.intakeId, userId: input.userId },
      select: { id: true, status: true },
    });
    if (!intake) throw new NotFoundException('Purchase intake not found');
    if (intake.status !== PurchaseIntakeStatus.DRAFT) {
      throw new ConflictException('Attachments can only be uploaded to a draft intake');
    }

    const tags = normalizeTags(input.metadata.tags?.split(',') ?? []);
    const processingMode =
      input.metadata.processingMode ??
      (input.metadata.mediaClass === AttachmentMediaClass.DOCUMENT
        ? AttachmentProcessingMode.DOCUMENT_SCAN
        : AttachmentProcessingMode.OBJECT_CROP);
    validateMode(input.metadata.mediaClass, processingMode);
    const isCover = input.metadata.isCover === 'true';
    if (isCover && input.metadata.mediaClass !== AttachmentMediaClass.ASSET_PHOTO) {
      throw new BadRequestException('Only asset photos can be marked as the cover');
    }
    const sha256 = sha256Hex(input.bytes);
    const uploadKeyHash = hashUploadKey(input.userId, input.intakeId, input.idempotencyKey);
    const uploadRequestHash = hashUploadRequest({
      sha256,
      filename,
      kind: input.metadata.kind,
      mediaClass: input.metadata.mediaClass,
      captureSource: input.metadata.captureSource,
      draftItemId: input.metadata.draftItemId ?? null,
      clientMediaId: input.metadata.clientMediaId?.trim() || null,
      processingMode,
      description: input.metadata.description?.trim() || null,
      tags,
      isSensitive: input.metadata.isSensitive === 'true',
      isCover,
    });

    const replay = await this.prisma.attachment.findUnique({
      where: { uploadKeyHash },
      include: ATTACHMENT_INCLUDE,
    });
    if (replay) return this.resolveUploadReplay(replay, input, uploadRequestHash);

    const currentOriginalBytes = await this.prisma.attachment.aggregate({
      where: { intakeId: input.intakeId },
      _sum: { sizeBytes: true },
    });
    const currentDerivativeBytes = await this.prisma.attachmentVariant.aggregate({
      where: {
        attachment: { intakeId: input.intakeId },
        kind: { not: AttachmentVariantKind.ORIGINAL },
      },
      _sum: { sizeBytes: true },
    });
    this.assertIntakeStorageQuota(
      currentOriginalBytes._sum.sizeBytes ?? 0,
      currentDerivativeBytes._sum.sizeBytes ?? 0,
      input.bytes.byteLength,
    );

    const storageKey = buildStorageKey(input.userId, input.intakeId, filename);
    await this.storage.putObject({
      storageKey,
      mime: detected.mime,
      body: input.bytes,
      cacheControl: 'private, no-store',
    });

    try {
      const attachment = await this.prisma.$transaction(async (tx) => {
        // Serialize every intake mutation before calculating retained bytes.
        await lockDraftIntake(tx, input.intakeId, input.userId);

        const originalUsage = await tx.attachment.aggregate({
          where: { intakeId: input.intakeId },
          _sum: { sizeBytes: true },
        });
        const derivativeUsage = await tx.attachmentVariant.aggregate({
          where: {
            attachment: { intakeId: input.intakeId },
            kind: { not: AttachmentVariantKind.ORIGINAL },
          },
          _sum: { sizeBytes: true },
        });
        this.assertIntakeStorageQuota(
          originalUsage._sum.sizeBytes ?? 0,
          derivativeUsage._sum.sizeBytes ?? 0,
          input.bytes.byteLength,
        );

        const attachment = await tx.attachment.create({
          data: {
            intakeId: input.intakeId,
            uploadedById: input.userId,
            draftItemId: input.metadata.draftItemId?.trim() || null,
            kind: input.metadata.kind.trim(),
            mediaClass: input.metadata.mediaClass,
            captureSource: input.metadata.captureSource,
            status:
              processingMode === AttachmentProcessingMode.NONE
                ? AttachmentStatus.READY
                : AttachmentStatus.NEEDS_REVIEW,
            processingMode,
            description: input.metadata.description?.trim() || null,
            tags,
            filename,
            mime: normalizeDeclaredMime(input.declaredMime),
            verifiedMime: detected.mime,
            sizeBytes: input.bytes.byteLength,
            sha256,
            width: detected.width,
            height: detected.height,
            pageCount,
            processingMetadata: {
              detectedKind: detected.kind,
              originalPreserved: true,
              clientMediaId: input.metadata.clientMediaId?.trim() || null,
            },
            userConfirmed: processingMode === AttachmentProcessingMode.NONE,
            uploadKeyHash,
            uploadRequestHash,
            storageKey,
            isSensitive: input.metadata.isSensitive === 'true',
            isCover,
            variants: {
              create: {
                kind: AttachmentVariantKind.ORIGINAL,
                revision: 1,
                storageKey,
                mime: detected.mime,
                sizeBytes: input.bytes.byteLength,
                sha256,
                width: detected.width,
                height: detected.height,
                pageCount,
              },
            },
          },
          include: ATTACHMENT_INCLUDE,
        });
        await this.audit.recordInTransaction(tx, {
          ...input.auditContext,
          userId: input.userId,
          action: 'attachment.upload',
          resourceType: 'Attachment',
          resourceId: attachment.id,
          afterSummary: {
            intakeId: input.intakeId,
            mediaClass: attachment.mediaClass,
            verifiedMime: attachment.verifiedMime,
            sizeBytes: attachment.sizeBytes,
          },
        });
        return attachment;
      });
      return presentAttachment(attachment);
    } catch (error) {
      await this.removeOrphan(storageKey);
      if (isUniqueConflict(error, 'uploadKeyHash')) {
        const winner = await this.prisma.attachment.findUnique({
          where: { uploadKeyHash },
          include: ATTACHMENT_INCLUDE,
        });
        if (winner) return this.resolveUploadReplay(winner, input, uploadRequestHash);
      }
      throw error;
    }
  }

  async uploadVariant(
    userId: string,
    attachmentId: string,
    kind: AttachmentVariantKind,
    declaredMime: string,
    bytes: Uint8Array,
    auditContext: PurchaseAuditContext = {},
  ) {
    if (kind === AttachmentVariantKind.ORIGINAL) {
      throw new BadRequestException('The ORIGINAL variant is immutable');
    }
    if (!bytes.byteLength) throw new BadRequestException('Attachment variant body is empty');
    const attachment = await this.requireAuthorized(userId, attachmentId, true);
    assertMutableDraftAttachment(attachment, userId);
    const detected = detectAcceptedMedia(bytes);
    if (!detected || !declaredMimeMatches(detected.kind, declaredMime)) {
      throw new BadRequestException(
        'Variant Content-Type does not match a supported file signature',
      );
    }

    const isPdf = detected.kind === 'PDF';
    if (bytes.byteLength > (isPdf ? this.limits.pdfMaxBytes : this.limits.imageMaxBytes)) {
      throw new PayloadTooLargeException('Attachment variant exceeds the configured upload limit');
    }
    validateVariantCompatibility(attachment.mediaClass, kind, detected.kind);
    let pageCount: number | null = null;
    if (isPdf) {
      pageCount = validatePdfAndEstimatePages(bytes);
    } else {
      try {
        assertSafePixelCount(detected, this.limits.maxPixels);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      if (detected.width === null || detected.height === null) {
        throw new BadRequestException('Variant image dimensions could not be verified');
      }
    }

    const sha256 = sha256Hex(bytes);
    const existing = await this.prisma.attachmentVariant.findFirst({
      where: { attachmentId, kind, sha256 },
      orderBy: { revision: 'desc' },
    });
    if (existing) {
      return {
        ...presentAttachmentVariant(existing),
        attachmentVersion: attachment.version,
      };
    }

    const currentDerivatives = attachment.variants.filter(
      (variant) => variant.kind !== AttachmentVariantKind.ORIGINAL,
    );
    this.assertDerivativeQuota(
      currentDerivatives.length,
      currentDerivatives.reduce((total, variant) => total + variant.sizeBytes, 0),
      bytes.byteLength,
    );

    const storageKey = buildVariantStorageKey(attachmentId, kind);
    let objectPersisted = false;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await lockDraftIntake(tx, attachment.intakeId!, userId);
        // Updating the parent serializes revision assignment for concurrent
        // derivatives of the same attachment. The conditional prevents a
        // finalize/cancel race from mutating an attachment after its intake
        // has stopped being editable. The version token also rejects a
        // derivative validated against media metadata changed by a concurrent
        // review before this transaction acquired the intake lock.
        const parent = await tx.attachment.updateMany({
          where: {
            ...draftAttachmentMutationWhere(attachmentId, userId, attachment.intakeId!),
            version: attachment.version,
          },
          data: { version: { increment: 1 } },
        });
        if (parent.count !== 1) {
          throw new ConflictException('Attachment changed; reload the draft and try again');
        }

        const replay = await tx.attachmentVariant.findFirst({
          where: { attachmentId, kind, sha256 },
          orderBy: { revision: 'desc' },
        });
        if (replay) {
          const current = await tx.attachment.findUnique({
            where: { id: attachmentId },
            select: { version: true },
          });
          if (!current) throw immutableAttachmentConflict();
          return { variant: replay, attachmentVersion: current.version };
        }

        const usage = await tx.attachmentVariant.aggregate({
          where: { attachmentId, kind: { not: AttachmentVariantKind.ORIGINAL } },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        });
        this.assertDerivativeQuota(usage._count._all, usage._sum.sizeBytes ?? 0, bytes.byteLength);

        const intakeOriginalUsage = await tx.attachment.aggregate({
          where: { intakeId: attachment.intakeId },
          _sum: { sizeBytes: true },
        });
        const intakeDerivativeUsage = await tx.attachmentVariant.aggregate({
          where: {
            attachment: { intakeId: attachment.intakeId },
            kind: { not: AttachmentVariantKind.ORIGINAL },
          },
          _sum: { sizeBytes: true },
        });
        this.assertIntakeStorageQuota(
          intakeOriginalUsage._sum.sizeBytes ?? 0,
          intakeDerivativeUsage._sum.sizeBytes ?? 0,
          bytes.byteLength,
        );

        const latest = await tx.attachmentVariant.findFirst({
          where: { attachmentId, kind },
          orderBy: { revision: 'desc' },
          select: { revision: true },
        });
        await this.storage.putObject({
          storageKey,
          mime: detected.mime,
          body: bytes,
          cacheControl: 'private, no-store',
        });
        objectPersisted = true;
        const variant = await tx.attachmentVariant.create({
          data: {
            attachmentId,
            kind,
            revision: (latest?.revision ?? 0) + 1,
            storageKey,
            mime: detected.mime,
            sizeBytes: bytes.byteLength,
            sha256,
            width: detected.width,
            height: detected.height,
            pageCount,
          },
        });
        await this.audit.recordInTransaction(tx, {
          ...auditContext,
          userId,
          action: 'attachment.variant-upload',
          resourceType: 'Attachment',
          resourceId: attachmentId,
          afterSummary: { kind, revision: variant.revision, sizeBytes: variant.sizeBytes },
        });
        const current = await tx.attachment.findUnique({
          where: { id: attachmentId },
          select: { version: true },
        });
        if (!current) throw immutableAttachmentConflict();
        return { variant, attachmentVersion: current.version };
      });
      return {
        ...presentAttachmentVariant(result.variant),
        attachmentVersion: result.attachmentVersion,
      };
    } catch (error) {
      if (objectPersisted) await this.removeOrphan(storageKey);
      throw error;
    }
  }

  async review(
    userId: string,
    id: string,
    dto: ReviewAttachmentDto,
    auditContext: PurchaseAuditContext = {},
  ) {
    const attachment = await this.requireAuthorized(userId, id, true);
    assertMutableDraftAttachment(attachment, userId);
    if (dto.version !== attachment.version) {
      throw new ConflictException('Attachment changed; reload the draft and try again');
    }
    const intakeId = attachment.intakeId!;

    const mediaClass = dto.mediaClass ?? attachment.mediaClass;
    const processingMode = dto.processingMode ?? attachment.processingMode;
    validateMode(mediaClass, processingMode);
    if (mediaClass === AttachmentMediaClass.ASSET_PHOTO && attachment.pageCount !== null) {
      throw new BadRequestException('PDF attachments cannot be changed to asset photos');
    }
    const isCover = dto.isCover ?? attachment.isCover;
    if (isCover && mediaClass !== AttachmentMediaClass.ASSET_PHOTO) {
      throw new BadRequestException('Only asset photos can be marked as the cover');
    }
    const kind = dto.kind === undefined ? undefined : dto.kind.trim();
    if (kind !== undefined && (!kind || kind.length > 64)) {
      throw new BadRequestException('kind must contain at most 64 characters');
    }
    const draftItemId = dto.draftItemId === undefined ? undefined : dto.draftItemId?.trim() || null;
    if (draftItemId && draftItemId.length > 128) {
      throw new BadRequestException('draftItemId must contain at most 128 characters');
    }
    if (dto.processingMetadata !== undefined) validateProcessingMetadata(dto.processingMetadata);
    const tags = dto.tags === undefined ? undefined : normalizeTags(dto.tags);
    const userConfirmed = dto.userConfirmed ?? attachment.userConfirmed;
    if (userConfirmed && processingMode !== AttachmentProcessingMode.NONE) {
      const requiredKinds =
        processingMode === AttachmentProcessingMode.OBJECT_CROP
          ? [AttachmentVariantKind.CROPPED]
          : [
              AttachmentVariantKind.SCAN_COLOR,
              AttachmentVariantKind.SCAN_GRAY,
              AttachmentVariantKind.PDF,
            ];
      const derivative = await this.prisma.attachmentVariant.findFirst({
        where: { attachmentId: id, kind: { in: requiredKinds } },
        select: { id: true },
      });
      if (!derivative) {
        throw new ConflictException(
          `${processingMode} requires an uploaded derivative before confirmation`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockDraftIntake(tx, intakeId, userId);
      const result = await tx.attachment.updateMany({
        where: {
          ...draftAttachmentMutationWhere(id, userId, intakeId),
          version: dto.version,
        },
        data: {
          ...(kind === undefined ? {} : { kind }),
          ...(dto.mediaClass === undefined ? {} : { mediaClass }),
          ...(draftItemId === undefined ? {} : { draftItemId }),
          processingMode,
          ...(dto.processingMetadata === undefined
            ? {}
            : { processingMetadata: dto.processingMetadata as Prisma.InputJsonValue }),
          ...(dto.description === undefined
            ? {}
            : { description: dto.description?.trim() || null }),
          ...(tags === undefined ? {} : { tags }),
          ...(dto.isCover === undefined ? {} : { isCover }),
          userConfirmed,
          status: userConfirmed ? AttachmentStatus.READY : AttachmentStatus.NEEDS_REVIEW,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException('Attachment changed; reload the draft and try again');
      }
      const saved = await tx.attachment.findUnique({
        where: { id },
        include: ATTACHMENT_INCLUDE,
      });
      if (!saved) throw new ConflictException('Attachment changed; reload the draft and try again');
      await this.audit.recordInTransaction(tx, {
        ...auditContext,
        userId,
        action: 'attachment.review',
        resourceType: 'Attachment',
        resourceId: id,
        afterSummary: {
          status: saved.status,
          processingMode: saved.processingMode,
          userConfirmed: saved.userConfirmed,
          version: saved.version,
          kind: saved.kind,
          mediaClass: saved.mediaClass,
          draftItemId: saved.draftItemId,
          isCover: saved.isCover,
        },
      });
      return saved;
    });
    return presentAttachment(updated);
  }

  async softDelete(userId: string, id: string, auditContext: PurchaseAuditContext = {}) {
    const attachment = await this.requireAuthorized(userId, id, false);
    if (attachment.deletedAt) return presentAttachment(attachment);
    assertMutableDraftAttachment(attachment, userId);

    const deletedAt = new Date();
    const deleted = await this.prisma.$transaction(async (tx) => {
      await lockDraftIntake(tx, attachment.intakeId!, userId);
      const result = await tx.attachment.updateMany({
        where: draftAttachmentMutationWhere(id, userId, attachment.intakeId!),
        data: { deletedAt, version: { increment: 1 }, isCover: false },
      });
      if (result.count !== 1) throw immutableAttachmentConflict();
      const saved = await tx.attachment.findUnique({
        where: { id },
        include: ATTACHMENT_INCLUDE,
      });
      if (!saved) throw immutableAttachmentConflict();
      await this.audit.recordInTransaction(tx, {
        ...auditContext,
        userId,
        action: 'attachment.soft-delete',
        resourceType: 'Attachment',
        resourceId: id,
        afterSummary: { deletedAt: saved.deletedAt?.toISOString() },
      });
      return saved;
    });
    return presentAttachment(deleted);
  }

  async issueReadUrl(
    userId: string,
    id: string,
    kind: AttachmentVariantKind = AttachmentVariantKind.ORIGINAL,
    revision?: number,
  ) {
    const attachment = await this.requireAuthorized(userId, id, true);
    const variants = await this.prisma.attachmentVariant.findMany({
      where: { attachmentId: id, kind, ...(revision === undefined ? {} : { revision }) },
      orderBy: { revision: 'desc' },
      take: 1,
    });
    const variant = variants[0];
    if (!variant) throw new NotFoundException('Attachment variant not found');
    const signed = await this.storage.issueReadUrl(variant.storageKey, {
      filename:
        variant.kind === AttachmentVariantKind.ORIGINAL
          ? attachment.filename
          : derivativeFilename(attachment.filename, variant.mime),
      mime: variant.mime,
      download: attachment.mediaClass === AttachmentMediaClass.DOCUMENT,
    });
    return {
      ...signed,
      attachmentId: attachment.id,
      variant: variant.kind,
      revision: variant.revision,
    };
  }

  private async requireAuthorized(userId: string, id: string, activeOnly: boolean) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id },
      include: {
        intake: { select: { userId: true, status: true } },
        variants: { orderBy: [{ kind: 'asc' }, { revision: 'desc' }] },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    // uploadedById remains after finalize; intake ownership covers pre-finalize
    // drafts. Legacy Phase 1 rows have neither and belong to the sole account.
    if (
      (attachment.uploadedById && attachment.uploadedById !== userId) ||
      (attachment.intake && attachment.intake.userId !== userId)
    ) {
      throw new NotFoundException('Attachment not found');
    }
    if (activeOnly && attachment.deletedAt) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  private resolveUploadReplay(
    attachment: AttachmentWithVariants,
    input: UploadInput,
    requestHash: string,
  ) {
    if (
      attachment.uploadedById !== input.userId ||
      attachment.intakeId !== input.intakeId ||
      attachment.uploadRequestHash !== requestHash
    ) {
      throw new ConflictException('Idempotency-Key was already used for a different upload');
    }
    return presentAttachment(attachment);
  }

  private async removeOrphan(storageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey);
    } catch (error) {
      this.logger.error(
        `Unable to remove orphan object ${storageKey}: ${(error as Error).message}`,
      );
    }
  }

  private assertDerivativeQuota(
    currentRevisionCount: number,
    currentBytes: number,
    nextBytes: number,
  ): void {
    if (currentRevisionCount >= this.limits.derivativeMaxRevisions) {
      throw new PayloadTooLargeException('Attachment derivative revision quota exceeded');
    }
    if (currentBytes + nextBytes > this.limits.derivativeMaxBytes) {
      throw new PayloadTooLargeException('Attachment derivative byte quota exceeded');
    }
  }

  private assertIntakeStorageQuota(
    currentOriginalBytes: number,
    currentDerivativeBytes: number,
    nextBytes: number,
  ): void {
    if (currentOriginalBytes + currentDerivativeBytes + nextBytes > this.limits.intakeMaxBytes) {
      throw new PayloadTooLargeException('Purchase intake retained storage quota exceeded');
    }
  }
}

function assertMutableDraftAttachment(
  attachment: {
    intakeId: string | null;
    purchaseId: string | null;
    assetId: string | null;
    intake: { userId: string; status: PurchaseIntakeStatus } | null;
  },
  userId: string,
): void {
  if (
    !attachment.intakeId ||
    attachment.purchaseId ||
    attachment.assetId ||
    !attachment.intake ||
    attachment.intake.userId !== userId ||
    attachment.intake.status !== PurchaseIntakeStatus.DRAFT
  ) {
    throw immutableAttachmentConflict();
  }
}

function immutableAttachmentConflict(): ConflictException {
  return new ConflictException('Completed or cancelled attachments are immutable');
}

function draftAttachmentMutationWhere(
  id: string,
  userId: string,
  intakeId: string,
): Prisma.AttachmentWhereInput {
  return {
    id,
    intakeId,
    purchaseId: null,
    assetId: null,
    deletedAt: null,
    intake: { is: { id: intakeId, userId, status: PurchaseIntakeStatus.DRAFT } },
  };
}

function validateMode(
  mediaClass: AttachmentMediaClass,
  processingMode: AttachmentProcessingMode,
): void {
  if (
    (mediaClass === AttachmentMediaClass.DOCUMENT &&
      processingMode === AttachmentProcessingMode.OBJECT_CROP) ||
    (mediaClass === AttachmentMediaClass.ASSET_PHOTO &&
      processingMode === AttachmentProcessingMode.DOCUMENT_SCAN)
  ) {
    throw new BadRequestException('processingMode is incompatible with mediaClass');
  }
}

function validateVariantCompatibility(
  mediaClass: AttachmentMediaClass,
  variantKind: AttachmentVariantKind,
  detectedKind: AcceptedMediaKind,
): void {
  const isPdf = detectedKind === 'PDF';
  if (variantKind === AttachmentVariantKind.PDF) {
    if (!isPdf || mediaClass !== AttachmentMediaClass.DOCUMENT) {
      throw new BadRequestException('PDF variants require a document attachment and PDF bytes');
    }
    return;
  }
  if (isPdf || detectedKind === 'HEIC') {
    throw new BadRequestException('Image derivatives must be normalized JPEG, PNG, or WebP');
  }
  if (
    variantKind === AttachmentVariantKind.CROPPED &&
    mediaClass !== AttachmentMediaClass.ASSET_PHOTO
  ) {
    throw new BadRequestException('CROPPED variants require an asset photo');
  }
  if (
    (variantKind === AttachmentVariantKind.SCAN_COLOR ||
      variantKind === AttachmentVariantKind.SCAN_GRAY) &&
    mediaClass !== AttachmentMediaClass.DOCUMENT
  ) {
    throw new BadRequestException('SCAN variants require a document attachment');
  }
}

function normalizeFilename(value: string): string {
  let raw = value.trim();
  if (/^UTF-8''/i.test(raw)) {
    try {
      raw = decodeURIComponent(raw.slice(7));
    } catch {
      throw new BadRequestException('X-Filename contains invalid UTF-8 percent encoding');
    }
  }
  const printable = Array.from(raw, (character) => character)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('');
  const filename = printable.split(/[\\/]/).pop() ?? '';
  if (!filename || filename.length > MAX_FILENAME_LENGTH) {
    throw new BadRequestException(
      'X-Filename must contain a valid filename of at most 240 characters',
    );
  }
  return filename;
}

function derivativeFilename(originalFilename: string, mime: string): string {
  const extension =
    {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    }[mime.toLowerCase()] ?? null;
  if (!extension) return originalFilename;
  const lastDot = originalFilename.lastIndexOf('.');
  const basename = lastDot > 0 ? originalFilename.slice(0, lastDot) : originalFilename;
  return `${basename}.${extension}`;
}

function normalizeTags(values: string[]): string[] {
  const tags = [
    ...new Set(values.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0)),
  ];
  if (tags.length > MAX_TAGS || tags.some((tag) => tag.length > 64)) {
    throw new BadRequestException('Attachments support at most 24 tags of 64 characters each');
  }
  return tags;
}

function normalizeDeclaredMime(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase();
}

function validatePdfAndEstimatePages(bytes: Uint8Array): number | null {
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 2048))).toString('latin1');
  if (!tail.includes('%%EOF')) throw new BadRequestException('PDF is incomplete or malformed');
  const text = Buffer.from(bytes).toString('latin1');
  const pageCount = text.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pageCount > MAX_PDF_PAGES) {
    throw new BadRequestException(`PDF exceeds the ${MAX_PDF_PAGES}-page safety limit`);
  }
  return pageCount || null;
}

function buildStorageKey(userId: string, intakeId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'upload';
  return `intakes/${safeSegment(userId)}/${safeSegment(intakeId)}/${randomUUID()}/${safe}`;
}

function buildVariantStorageKey(attachmentId: string, kind: AttachmentVariantKind): string {
  return `attachments/${safeSegment(attachmentId)}/${kind.toLowerCase()}/${randomUUID()}`;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
}

function hashUploadKey(userId: string, intakeId: string, key: string): string {
  return createHash('sha256')
    .update(`bullion-ledger:attachment-upload:v1:${userId}:${intakeId}:${key}`)
    .digest('hex');
}

function hashUploadRequest(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateProcessingMetadata(value: Record<string, unknown>): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PROCESSING_METADATA_BYTES) {
    throw new BadRequestException('processingMetadata is too large');
  }
  if ('crop' in value) validateCrop(value.crop);
  if ('corners' in value) validateCorners(value.corners);
}

function validateCrop(value: unknown): void {
  if (!value || typeof value !== 'object') throw new BadRequestException('crop is invalid');
  const crop = value as Record<string, unknown>;
  const x = normalizedNumber(crop.x, 'crop.x');
  const y = normalizedNumber(crop.y, 'crop.y');
  const width = normalizedNumber(crop.width, 'crop.width');
  const height = normalizedNumber(crop.height, 'crop.height');
  if (width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new BadRequestException('crop must be a positive normalized rectangle inside the image');
  }
}

function validateCorners(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new BadRequestException('corners must contain four normalized points');
  }
  const points = value.map((point, index) => {
    if (!point || typeof point !== 'object') {
      throw new BadRequestException(`corners[${index}] is invalid`);
    }
    const p = point as Record<string, unknown>;
    return {
      x: normalizedNumber(p.x, `corners[${index}].x`),
      y: normalizedNumber(p.y, `corners[${index}].y`),
    };
  });
  const area = Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
  if (area < 0.0001) throw new BadRequestException('corners do not describe a valid document');
}

function normalizedNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new BadRequestException(`${field} must be a finite number from 0 to 1`);
  }
  return value;
}

function parseLimit(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function isUniqueConflict(error: unknown, field: string): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') {
    return false;
  }
  const meta = 'meta' in error && error.meta && typeof error.meta === 'object' ? error.meta : null;
  const target = meta && 'target' in meta ? meta.target : null;
  return Array.isArray(target)
    ? target.some((value) => value === field)
    : typeof target === 'string' && target.includes(field);
}
