import type { Attachment, AttachmentVariant } from '@prisma/client';

export type AttachmentWithVariants = Attachment & { variants: AttachmentVariant[] };

/** Never let MinIO keys, upload digests, or content hashes cross the API boundary. */
export function presentAttachment(attachment: AttachmentWithVariants) {
  return {
    id: attachment.id,
    intakeId: attachment.intakeId,
    purchaseId: attachment.purchaseId,
    assetId: attachment.assetId,
    draftItemId: attachment.draftItemId,
    kind: attachment.kind,
    mediaClass: attachment.mediaClass,
    captureSource: attachment.captureSource,
    status: attachment.status,
    processingMode: attachment.processingMode,
    description: attachment.description,
    tags: attachment.tags,
    filename: attachment.filename,
    mime: attachment.mime,
    verifiedMime: attachment.verifiedMime,
    sizeBytes: attachment.sizeBytes,
    width: attachment.width,
    height: attachment.height,
    pageCount: attachment.pageCount,
    processingMetadata: attachment.processingMetadata,
    userConfirmed: attachment.userConfirmed,
    version: attachment.version,
    isCover: attachment.isCover,
    isSensitive: attachment.isSensitive,
    deletedAt: attachment.deletedAt,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
    variants: attachment.variants.map(presentAttachmentVariant),
  };
}

export function presentAttachmentVariant(variant: AttachmentVariant) {
  return {
    id: variant.id,
    kind: variant.kind,
    revision: variant.revision,
    mime: variant.mime,
    sizeBytes: variant.sizeBytes,
    width: variant.width,
    height: variant.height,
    pageCount: variant.pageCount,
  };
}
