-- Asset lifecycle ledger (PRD §6.4, §15.3): sale, gift out, gift received,
-- loss, and storage transfer, plus the acquisition channel of each holding.

CREATE TYPE "AssetMovementType" AS ENUM (
    'PURCHASE_IN',
    'GIFT_IN',
    'SALE',
    'GIFT_OUT',
    'LOST',
    'DAMAGED',
    'INVENTORY_ADJUSTMENT',
    'STORAGE_TRANSFER',
    'SENT_FOR_APPRAISAL',
    'RETURNED_FROM_APPRAISAL'
);

CREATE TYPE "AssetAcquisitionType" AS ENUM ('PURCHASE', 'GIFT_RECEIVED', 'ADJUSTMENT');

-- Every existing holding came from a purchase.
ALTER TABLE "Asset"
    ADD COLUMN "acquisitionType" "AssetAcquisitionType" NOT NULL DEFAULT 'PURCHASE';

CREATE TABLE "AssetMovement" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetMovementType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "fineWeightGrams" DECIMAL(18,9) NOT NULL DEFAULT 0,
    "grossWeightGrams" DECIMAL(18,9) NOT NULL DEFAULT 0,
    "counterparty" TEXT,
    "proceedsAmount" DECIMAL(18,4),
    "fees" DECIMAL(18,4),
    "netProceeds" DECIMAL(18,4),
    "currency" TEXT,
    "costBasis" DECIMAL(18,4),
    "realizedPnl" DECIMAL(18,4),
    "spotPricePerGram" DECIMAL(18,6),
    "marketValue" DECIMAL(18,4),
    "marketCurrency" TEXT,
    "fromStorageLocation" TEXT,
    "toStorageLocation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssetMovement_assetId_occurredAt_idx" ON "AssetMovement"("assetId", "occurredAt");
CREATE INDEX "AssetMovement_type_occurredAt_idx" ON "AssetMovement"("type", "occurredAt");
CREATE INDEX "AssetMovement_occurredAt_idx" ON "AssetMovement"("occurredAt");

ALTER TABLE "AssetMovement"
    ADD CONSTRAINT "AssetMovement_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A movement can never take out more than nothing.
ALTER TABLE "AssetMovement"
    ADD CONSTRAINT "AssetMovement_quantity_check" CHECK ("quantity" >= 0);
