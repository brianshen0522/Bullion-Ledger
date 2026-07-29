-- Add a normalized organization catalog without rewriting the Phase 1 schema.
-- Existing free-text product brands remain available for compatibility and are
-- linked to migrated organization records when they are non-blank.

CREATE TYPE "CatalogSource" AS ENUM ('SYSTEM', 'USER', 'MIGRATED');
CREATE TYPE "OrganizationAliasKind" AS ENUM (
    'OFFICIAL',
    'FORMER_NAME',
    'TRADE_NAME',
    'ACRONYM',
    'LOCALIZED',
    'SEARCH_ONLY'
);
CREATE TYPE "OrganizationRole" AS ENUM (
    'BRAND',
    'REFINER',
    'MINT',
    'MANUFACTURER',
    'ISSUER',
    'ASSAYER'
);
CREATE TYPE "AttributionStatus" AS ENUM (
    'VERIFIED',
    'DECLARED',
    'USER_REPORTED',
    'UNKNOWN'
);

ALTER TABLE "ProductDefinition"
    ADD COLUMN "catalogKey" TEXT,
    ADD COLUMN "source" "CatalogSource" NOT NULL DEFAULT 'USER';

CREATE UNIQUE INDEX "ProductDefinition_catalogKey_key"
    ON "ProductDefinition"("catalogKey");
CREATE INDEX "ProductDefinition_source_active_idx"
    ON "ProductDefinition"("source", "active");

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "seedKey" TEXT,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "countryCode" CHAR(2),
    "source" "CatalogSource" NOT NULL DEFAULT 'USER',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_seedKey_key" ON "Organization"("seedKey");
CREATE UNIQUE INDEX "Organization_normalizedName_key" ON "Organization"("normalizedName");
CREATE INDEX "Organization_canonicalName_idx" ON "Organization"("canonicalName");
CREATE INDEX "Organization_active_idx" ON "Organization"("active");

CREATE TABLE "OrganizationAlias" (
    "id" TEXT NOT NULL,
    "seedKey" TEXT,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "kind" "OrganizationAliasKind" NOT NULL,
    "locale" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizationAlias_seedKey_key" ON "OrganizationAlias"("seedKey");
CREATE UNIQUE INDEX "OrganizationAlias_organizationId_normalizedName_locale_key"
    ON "OrganizationAlias"("organizationId", "normalizedName", "locale");
CREATE INDEX "OrganizationAlias_normalizedName_idx"
    ON "OrganizationAlias"("normalizedName");
CREATE INDEX "OrganizationAlias_organizationId_kind_idx"
    ON "OrganizationAlias"("organizationId", "kind");

CREATE TABLE "OrganizationCapability" (
    "organizationId" TEXT NOT NULL,
    "capability" "OrganizationRole" NOT NULL,
    CONSTRAINT "OrganizationCapability_pkey"
        PRIMARY KEY ("organizationId", "capability")
);
CREATE INDEX "OrganizationCapability_capability_idx"
    ON "OrganizationCapability"("capability");

CREATE TABLE "ProductOrganization" (
    "id" TEXT NOT NULL,
    "productDefinitionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "attributionStatus" "AttributionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "validFrom" DATE,
    "validTo" DATE,
    "sourceUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ProductOrganization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductOrganization_productDefinitionId_organizationId_role_key"
    ON "ProductOrganization"("productDefinitionId", "organizationId", "role");
CREATE INDEX "ProductOrganization_organizationId_role_idx"
    ON "ProductOrganization"("organizationId", "role");
CREATE INDEX "ProductOrganization_productDefinitionId_role_isPrimary_idx"
    ON "ProductOrganization"("productDefinitionId", "role", "isPrimary");

CREATE TABLE "PurchaseItemOrganizationSnapshot" (
    "id" TEXT NOT NULL,
    "purchaseItemId" TEXT NOT NULL,
    "organizationId" TEXT,
    "role" "OrganizationRole" NOT NULL,
    "displayName" TEXT NOT NULL,
    "attributionStatus" "AttributionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseItemOrganizationSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseItemOrganizationSnapshot_purchaseItemId_role_idx"
    ON "PurchaseItemOrganizationSnapshot"("purchaseItemId", "role");
CREATE INDEX "PurchaseItemOrganizationSnapshot_organizationId_idx"
    ON "PurchaseItemOrganizationSnapshot"("organizationId");

ALTER TABLE "OrganizationAlias" ADD CONSTRAINT "OrganizationAlias_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationCapability" ADD CONSTRAINT "OrganizationCapability_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOrganization" ADD CONSTRAINT "ProductOrganization_productDefinitionId_fkey"
    FOREIGN KEY ("productDefinitionId") REFERENCES "ProductDefinition"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOrganization" ADD CONSTRAINT "ProductOrganization_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseItemOrganizationSnapshot" ADD CONSTRAINT "PurchaseItemOrganizationSnapshot_purchaseItemId_fkey"
    FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseItemOrganizationSnapshot" ADD CONSTRAINT "PurchaseItemOrganizationSnapshot_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Rows created before catalog provenance existed are explicitly marked as
-- migrated. New records continue to use the USER default.
UPDATE "ProductDefinition" SET "source" = 'MIGRATED';

WITH normalized_brands AS (
    SELECT
        MIN(BTRIM("brand")) AS "canonicalName",
        BTRIM(REGEXP_REPLACE(LOWER(BTRIM("brand")), '[^[:alnum:]]+', ' ', 'g')) AS "normalizedName"
    FROM "ProductDefinition"
    WHERE "brand" IS NOT NULL AND BTRIM("brand") <> ''
    GROUP BY BTRIM(REGEXP_REPLACE(LOWER(BTRIM("brand")), '[^[:alnum:]]+', ' ', 'g'))
)
INSERT INTO "Organization" (
    "id", "seedKey", "canonicalName", "normalizedName", "source", "verified", "active", "updatedAt"
)
SELECT
    'migrated-brand-' || MD5("normalizedName"),
    'migrated-brand:' || MD5("normalizedName"),
    "canonicalName",
    "normalizedName",
    'MIGRATED',
    false,
    true,
    CURRENT_TIMESTAMP
FROM normalized_brands
WHERE "normalizedName" <> ''
ON CONFLICT ("normalizedName") DO NOTHING;

INSERT INTO "ProductOrganization" (
    "id",
    "productDefinitionId",
    "organizationId",
    "role",
    "isPrimary",
    "attributionStatus",
    "updatedAt"
)
SELECT
    'migrated-brand-link-' || MD5(product."id" || organization."id"),
    product."id",
    organization."id",
    'BRAND',
    true,
    'DECLARED',
    CURRENT_TIMESTAMP
FROM "ProductDefinition" AS product
JOIN "Organization" AS organization
    ON organization."normalizedName" = BTRIM(
        REGEXP_REPLACE(LOWER(BTRIM(product."brand")), '[^[:alnum:]]+', ' ', 'g')
    )
WHERE product."brand" IS NOT NULL AND BTRIM(product."brand") <> ''
ON CONFLICT ("productDefinitionId", "organizationId", "role") DO NOTHING;
