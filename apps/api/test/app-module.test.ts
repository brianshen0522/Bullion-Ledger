import 'reflect-metadata';
import { GLOBAL_MODULE_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AuthModule } from '../src/auth/auth.module';
import { SecurityGuardModule } from '../src/common/security-guard.module';
import { MetalsModule } from '../src/metals/metals.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { ProductsModule } from '../src/products/products.module';
import { AppModule } from '../src/app.module';
import { AttachmentsModule } from '../src/attachments/attachments.module';
import { PurchaseIntakesModule } from '../src/purchase-intakes/purchase-intakes.module';

function importsOf(module: object): unknown[] {
  return (Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) as unknown[] | undefined) ?? [];
}

describe('application module wiring', () => {
  it('makes the Prisma module global', () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, PrismaModule)).toBe(true);
  });

  it('imports auth providers for the global guards', () => {
    expect(importsOf(SecurityGuardModule)).toContain(AuthModule);
  });

  it('imports metal providers for products', () => {
    expect(importsOf(ProductsModule)).toContain(MetalsModule);
  });

  it('wires the wizard draft and attachment API modules', () => {
    expect(importsOf(AppModule)).toEqual(
      expect.arrayContaining([PurchaseIntakesModule, AttachmentsModule]),
    );
  });
});
