-- Optimistic concurrency versioning for editable ProductDefinition and held Asset.
ALTER TABLE "ProductDefinition"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Asset"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
