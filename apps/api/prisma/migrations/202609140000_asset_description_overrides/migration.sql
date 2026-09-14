-- Per-lot descriptive overrides for a holding.
--
-- Before this change, editing a catalog-linked holding's name/brand/country/
-- year wrote to its PurchaseItem snapshot, which the inventory presenter
-- ignores whenever the asset carries a productDefinitionId — the edit was
-- accepted and then invisible. A holding now carries its own optional value:
-- null keeps inheriting (ProductDefinition for catalog-linked lots, the
-- PurchaseItem snapshot otherwise), and clearing an override restores that
-- inheritance without touching the catalog or the purchase record.

ALTER TABLE "Asset"
    ADD COLUMN "nameOverride" TEXT,
    ADD COLUMN "formOverride" TEXT,
    ADD COLUMN "brandOverride" TEXT,
    ADD COLUMN "countryOverride" TEXT,
    ADD COLUMN "yearOrVersionOverride" TEXT;
