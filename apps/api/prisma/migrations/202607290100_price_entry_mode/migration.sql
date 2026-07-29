-- Record how the buyer knew the price (PRD §8.1), so a stored 0 in the
-- itemized charge columns is distinguishable from "not known separately".
--
-- Existing rows were captured through the fully itemized form, so ITEMIZED is
-- the truthful default for them and for the column.

ALTER TABLE "Purchase"
    ADD COLUMN "priceEntryMode" TEXT NOT NULL DEFAULT 'ITEMIZED';

ALTER TABLE "Purchase"
    ADD CONSTRAINT "Purchase_priceEntryMode_check"
    CHECK ("priceEntryMode" IN ('SIMPLE', 'ITEMIZED'));
