-- Mobile purchase intake drafts and non-destructive attachment revisions.
-- This migration is additive. The owner CHECK is NOT VALID so legacy rows are
-- not scanned during deploy; PostgreSQL still enforces it for all new writes.

CREATE TYPE "PurchaseIntakeStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AttachmentMediaClass" AS ENUM ('ASSET_PHOTO', 'DOCUMENT');
CREATE TYPE "AttachmentCaptureSource" AS ENUM ('CAMERA', 'LIBRARY');
CREATE TYPE "AttachmentStatus" AS ENUM ('READY', 'NEEDS_REVIEW', 'PROCESSING', 'FAILED');
CREATE TYPE "AttachmentProcessingMode" AS ENUM ('NONE', 'OBJECT_CROP', 'DOCUMENT_SCAN');
CREATE TYPE "AttachmentVariantKind" AS ENUM (
    'ORIGINAL',
    'CROPPED',
    'SCAN_COLOR',
    'SCAN_GRAY',
    'THUMBNAIL',
    'PDF'
);

CREATE TABLE "PurchaseIntake" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PurchaseIntakeStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "draftData" JSONB NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseIntake_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseIntake_userId_status_updatedAt_idx"
    ON "PurchaseIntake"("userId", "status", "updatedAt");
ALTER TABLE "PurchaseIntake" ADD CONSTRAINT "PurchaseIntake_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Purchase" ADD COLUMN "sourceIntakeId" TEXT;
CREATE UNIQUE INDEX "Purchase_sourceIntakeId_key" ON "Purchase"("sourceIntakeId");
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_sourceIntakeId_fkey"
    FOREIGN KEY ("sourceIntakeId") REFERENCES "PurchaseIntake"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Attachment"
    ADD COLUMN "intakeId" TEXT,
    ADD COLUMN "uploadedById" TEXT,
    ADD COLUMN "draftItemId" TEXT,
    ADD COLUMN "mediaClass" "AttachmentMediaClass" NOT NULL DEFAULT 'ASSET_PHOTO',
    ADD COLUMN "captureSource" "AttachmentCaptureSource" NOT NULL DEFAULT 'LIBRARY',
    ADD COLUMN "status" "AttachmentStatus" NOT NULL DEFAULT 'READY',
    ADD COLUMN "processingMode" "AttachmentProcessingMode" NOT NULL DEFAULT 'NONE',
    ADD COLUMN "description" TEXT,
    ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "verifiedMime" TEXT,
    ADD COLUMN "sha256" CHAR(64),
    ADD COLUMN "width" INTEGER,
    ADD COLUMN "height" INTEGER,
    ADD COLUMN "pageCount" INTEGER,
    ADD COLUMN "processingMetadata" JSONB,
    ADD COLUMN "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "uploadKeyHash" CHAR(64),
    ADD COLUMN "uploadRequestHash" CHAR(64),
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "Attachment_uploadKeyHash_key" ON "Attachment"("uploadKeyHash");
CREATE INDEX "Attachment_intakeId_deletedAt_idx" ON "Attachment"("intakeId", "deletedAt");
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");
CREATE INDEX "Attachment_sha256_idx" ON "Attachment"("sha256");

ALTER TABLE "Attachment" DROP CONSTRAINT IF EXISTS "Attachment_exactly_one_owner_check";
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_exactly_one_owner_check"
    CHECK (num_nonnulls("intakeId", "purchaseId", "assetId") = 1) NOT VALID;

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_intakeId_fkey"
    FOREIGN KEY ("intakeId") REFERENCES "PurchaseIntake"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "AppUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AttachmentVariant" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "kind" "AttachmentVariantKind" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "pageCount" INTEGER,
    "transformMetadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttachmentVariant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttachmentVariant_storageKey_key"
    ON "AttachmentVariant"("storageKey");
CREATE UNIQUE INDEX "AttachmentVariant_attachmentId_kind_revision_key"
    ON "AttachmentVariant"("attachmentId", "kind", "revision");
CREATE INDEX "AttachmentVariant_attachmentId_kind_idx"
    ON "AttachmentVariant"("attachmentId", "kind");
ALTER TABLE "AttachmentVariant" ADD CONSTRAINT "AttachmentVariant_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
