-- Bullion Ledger Phase 1 initial schema.
-- Postgres 16, all timestamps UTC, weights in grams, money/rates DECIMAL.
-- Generated from prisma/schema.prisma.

-- Metals catalog (XAU, XAG seeded at runtime).
CREATE TABLE "Metal" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayPrecision" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Metal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Metal_code_key" ON "Metal"("code");
CREATE INDEX "Metal_code_idx" ON "Metal"("code");

-- Single-owner account table.
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "initializedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppUser_username_key" ON "AppUser"("username");

-- HttpOnly cookie sessions; tokenHash = HMAC-SHA256(token, SESSION_SECRET).
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "idleExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMPTZ(6),
    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WebAuthn passkey credentials. PRD §5.3. No secret / biometric data stored.
CREATE TABLE "UserPasskey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "name" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6),
    CONSTRAINT "UserPasskey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserPasskey_credentialId_key" ON "UserPasskey"("credentialId");
CREATE INDEX "UserPasskey_userId_idx" ON "UserPasskey"("userId");
ALTER TABLE "UserPasskey" ADD CONSTRAINT "UserPasskey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Product definitions (specification, not an instance). PRD §6.1.
CREATE TABLE "ProductDefinition" (
    "id" TEXT NOT NULL,
    "metalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "brand" TEXT,
    "country" TEXT,
    "yearOrVersion" TEXT,
    "defaultPurity" DECIMAL(8,7) NOT NULL,
    "defaultUnitWeightGrams" DECIMAL(18,9) NOT NULL,
    "defaultWeightUnit" TEXT NOT NULL DEFAULT 'g',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ProductDefinition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductDefinition_metalId_idx" ON "ProductDefinition"("metalId");
ALTER TABLE "ProductDefinition" ADD CONSTRAINT "ProductDefinition_metalId_fkey"
    FOREIGN KEY ("metalId") REFERENCES "Metal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Purchase transaction header. PRD §8.1 + §8.3.
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "idempotencyKeyHash" CHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "purchasedAt" TIMESTAMPTZ(6) NOT NULL,
    "dealerName" TEXT,
    "branch" TEXT,
    "orderNumber" TEXT,
    "invoiceNumber" TEXT,
    "currency" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "premium" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "labor" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shipping" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "otherFees" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "allocationMethod" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Purchase_idempotencyKeyHash_key" ON "Purchase"("idempotencyKeyHash");
CREATE INDEX "Purchase_purchasedAt_idx" ON "Purchase"("purchasedAt");
CREATE INDEX "Purchase_currency_idx" ON "Purchase"("currency");

-- Purchase line. PRD §8.2.
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productDefinitionId" TEXT,
    "metalId" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "yearOrVersion" TEXT,
    "serial" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitWeightGrams" DECIMAL(18,9) NOT NULL,
    "weightUnit" TEXT NOT NULL DEFAULT 'g',
    "purity" DECIMAL(8,7) NOT NULL,
    "grossWeightGrams" DECIMAL(18,9) NOT NULL,
    "fineWeightGrams" DECIMAL(18,9) NOT NULL,
    "lineSubtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "manualAmount" DECIMAL(18,4),
    "allocatedCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "packagingState" TEXT,
    "hasCertificate" BOOLEAN NOT NULL DEFAULT false,
    "initialStorageLocation" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");
CREATE INDEX "PurchaseItem_metalId_idx" ON "PurchaseItem"("metalId");
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_productDefinitionId_fkey"
    FOREIGN KEY ("productDefinitionId") REFERENCES "ProductDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_metalId_fkey"
    FOREIGN KEY ("metalId") REFERENCES "Metal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Physical asset (lot of identical items). PRD §6.2.
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "purchaseItemId" TEXT,
    "purchaseId" TEXT,
    "productDefinitionId" TEXT,
    "metalId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "grossWeightGrams" DECIMAL(18,9) NOT NULL,
    "purity" DECIMAL(8,7) NOT NULL,
    "fineWeightGrams" DECIMAL(18,9) NOT NULL,
    "allocatedCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "serial" TEXT,
    "storageLocation" TEXT,
    "acquiredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Asset_metalId_idx" ON "Asset"("metalId");
CREATE INDEX "Asset_purchaseId_idx" ON "Asset"("purchaseId");
CREATE INDEX "Asset_status_idx" ON "Asset"("status");
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_purchaseItemId_fkey"
    FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_productDefinitionId_fkey"
    FOREIGN KEY ("productDefinitionId") REFERENCES "ProductDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_metalId_fkey"
    FOREIGN KEY ("metalId") REFERENCES "Metal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Attachment metadata; files in private MinIO. PRD §14.
-- Exactly one explicit owner FK is required. The XOR check prevents orphaned
-- and ambiguously-owned attachment metadata.
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT,
    "assetId" TEXT,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Attachment_exactly_one_owner_check"
        CHECK (num_nonnulls("purchaseId", "assetId") = 1)
);
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");
CREATE INDEX "Attachment_purchaseId_idx" ON "Attachment"("purchaseId");
CREATE INDEX "Attachment_assetId_idx" ON "Attachment"("assetId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Spot/FX market snapshots. PRD §9, §12.
CREATE TABLE "SpotPriceSnapshot" (
    "id" TEXT NOT NULL,
    "metalId" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "quoteUnit" TEXT NOT NULL,
    "normalizedPricePerGram" DECIMAL(18,6) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "provider" TEXT,
    "retrievalTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,
    CONSTRAINT "SpotPriceSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpotPriceSnapshot_metalId_timestamp_sourceType_quoteCurrenc_key"
    ON "SpotPriceSnapshot"("metalId", "timestamp", "sourceType", "quoteCurrency", "quoteUnit");
CREATE INDEX "SpotPriceSnapshot_metalId_timestamp_idx"
    ON "SpotPriceSnapshot"("metalId", "timestamp");
ALTER TABLE "SpotPriceSnapshot" ADD CONSTRAINT "SpotPriceSnapshot_metalId_fkey"
    FOREIGN KEY ("metalId") REFERENCES "Metal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FxRateSnapshot" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FxRateSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FxRateSnapshot_baseCurrency_quoteCurrency_timestamp_source_key"
    ON "FxRateSnapshot"("baseCurrency", "quoteCurrency", "timestamp", "source");
CREATE INDEX "FxRateSnapshot_baseCurrency_quoteCurrency_timestamp_idx"
    ON "FxRateSnapshot"("baseCurrency", "quoteCurrency", "timestamp");

-- Append-only audit trail. PRD §25. Never stores secrets.
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "beforeSummary" JSONB,
    "afterSummary" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "sessionId" TEXT,
    "result" TEXT NOT NULL DEFAULT 'success',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Key/value system settings (init flag, feature toggles).
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
