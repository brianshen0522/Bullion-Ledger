-- Preserve the user's primary organization selection on immutable purchase snapshots.
ALTER TABLE "PurchaseItemOrganizationSnapshot"
    ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
