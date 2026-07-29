-- Persist each user's Dashboard weight display preference.
ALTER TABLE "AppUser"
    ADD COLUMN "dashboardWeightUnit" TEXT NOT NULL DEFAULT 'g';

ALTER TABLE "AppUser"
    ADD CONSTRAINT "AppUser_dashboardWeightUnit_check"
    CHECK ("dashboardWeightUnit" IN ('g', 'kg', 'troy_oz', 'qian'));
