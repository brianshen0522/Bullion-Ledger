-- Phase 2 market data: provider health tracking and the immutable
-- purchase-time market snapshot required by PRD §9.

CREATE TABLE "PriceProviderStatus" (
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMPTZ(6),
    "lastFailureAt" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "consecutiveFail" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PriceProviderStatus_pkey" PRIMARY KEY ("provider")
);

CREATE TABLE "PurchasePriceSnapshot" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "metalId" TEXT NOT NULL,
    "quotePrice" DECIMAL(18,6) NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "quoteUnit" TEXT NOT NULL,
    "quotedAt" TIMESTAMPTZ(6) NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "fxRate" DECIMAL(18,8),
    "fxBaseCurrency" TEXT,
    "fxQuoteCurrency" TEXT,
    "pricePerGram" DECIMAL(18,6) NOT NULL,
    "pricePerQian" DECIMAL(18,6) NOT NULL,
    "intrinsicValue" DECIMAL(18,4) NOT NULL,
    "premiumAmount" DECIMAL(18,4) NOT NULL,
    "premiumRate" DECIMAL(12,8) NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasePriceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchasePriceSnapshot_purchaseId_metalId_key"
    ON "PurchasePriceSnapshot"("purchaseId", "metalId");
CREATE INDEX "PurchasePriceSnapshot_metalId_quotedAt_idx"
    ON "PurchasePriceSnapshot"("metalId", "quotedAt");

ALTER TABLE "PurchasePriceSnapshot"
    ADD CONSTRAINT "PurchasePriceSnapshot_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchasePriceSnapshot"
    ADD CONSTRAINT "PurchasePriceSnapshot_metalId_fkey"
    FOREIGN KEY ("metalId") REFERENCES "Metal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
