import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ProductsModule } from './products/products.module.js';
import { PurchasesModule } from './purchases/purchases.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { WebAuthnModule } from './webauthn/webauthn.module.js';
import { StorageModule } from './storage/storage.module.js';
import { AuditModule } from './audit/audit.module.js';
import { MetalsModule } from './metals/metals.module.js';
import { SecurityGuardModule } from './common/security-guard.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { PurchaseIntakesModule } from './purchase-intakes/purchase-intakes.module.js';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { PriceProvidersModule } from './price-providers/price-providers.module.js';
import { MarketPricesModule } from './market-prices/market-prices.module.js';
import { MovementsModule } from './movements/movements.module.js';
import { BackupModule } from './backup/backup.module.js';
import { DealersModule } from './dealers/dealers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Package scripts run with apps/api as cwd, while direct launches often
      // run from the workspace root. Cover both without requiring duplicate
      // environment files.
      envFilePath: ['.env', '../.env', '../../.env'],
    }),
    PrismaModule,
    AuditModule,
    SecurityGuardModule,
    HealthModule,
    AuthModule,
    MetalsModule,
    OrganizationsModule,
    ProductsModule,
    PurchasesModule,
    PurchaseIntakesModule,
    AttachmentsModule,
    AssetsModule,
    PriceProvidersModule,
    MarketPricesModule,
    MovementsModule,
    DealersModule,
    DashboardModule,
    WebAuthnModule,
    StorageModule,
    BackupModule,
  ],
})
export class AppModule {}
