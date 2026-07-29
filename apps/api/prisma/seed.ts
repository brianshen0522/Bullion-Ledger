import { PrismaClient } from '@prisma/client';

import {
  ORGANIZATION_ALIASES_V1,
  ORGANIZATION_CATALOG_VERSION,
  ORGANIZATIONS_V1,
} from './catalog/organizations.v1.js';

const prisma = new PrismaClient();

function normalizeOrganizationName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function fixtureDate(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

async function main(): Promise<void> {
  // Phase 1 metals per PRD §3.1.
  await prisma.metal.upsert({
    where: { code: 'XAU' },
    create: { code: 'XAU', name: 'Gold', displayPrecision: 2 },
    update: {},
  });

  const organizationIds = new Map<string, string>();
  for (const organization of ORGANIZATIONS_V1) {
    const seeded = await prisma.organization.upsert({
      where: { seedKey: organization.seedKey },
      create: {
        seedKey: organization.seedKey,
        canonicalName: organization.canonicalName,
        normalizedName: normalizeOrganizationName(organization.canonicalName),
        countryCode: organization.countryCode ?? null,
        source: 'SYSTEM',
        verified: true,
        active: true,
      },
      update: {
        canonicalName: organization.canonicalName,
        normalizedName: normalizeOrganizationName(organization.canonicalName),
        countryCode: organization.countryCode ?? null,
        source: 'SYSTEM',
        verified: true,
        active: true,
      },
      select: { id: true },
    });
    organizationIds.set(organization.seedKey, seeded.id);
  }

  await prisma.organizationCapability.createMany({
    data: ORGANIZATIONS_V1.flatMap((organization) =>
      organization.capabilities.map((capability) => ({
        organizationId: organizationIds.get(organization.seedKey)!,
        capability,
      })),
    ),
    skipDuplicates: true,
  });

  for (const alias of ORGANIZATION_ALIASES_V1) {
    const organizationId = organizationIds.get(alias.organizationSeedKey);
    if (!organizationId) {
      throw new Error(`Missing seeded organization for alias ${alias.seedKey}`);
    }
    await prisma.organizationAlias.upsert({
      where: { seedKey: alias.seedKey },
      create: {
        seedKey: alias.seedKey,
        organizationId,
        name: alias.name,
        normalizedName: normalizeOrganizationName(alias.name),
        kind: alias.kind,
        locale: alias.locale ?? null,
        validFrom: fixtureDate(alias.validFrom),
        validTo: fixtureDate(alias.validTo),
      },
      update: {
        organizationId,
        name: alias.name,
        normalizedName: normalizeOrganizationName(alias.name),
        kind: alias.kind,
        locale: alias.locale ?? null,
        validFrom: fixtureDate(alias.validFrom),
        validTo: fixtureDate(alias.validTo),
      },
    });
  }
  await prisma.metal.upsert({
    where: { code: 'XAG' },
    create: { code: 'XAG', name: 'Silver', displayPrecision: 2 },
    update: {},
  });

  // Reserved metals per PRD §3.2 are NOT auto-created in Phase 1; they can be
  // added later via the metals management page so they don't show up in the
  // default unit switcher before they are needed.
  console.log(
    `Seed complete: XAU, XAG; organization catalog ${ORGANIZATION_CATALOG_VERSION} ` +
      `(${ORGANIZATIONS_V1.length} organizations, ${ORGANIZATION_ALIASES_V1.length} aliases)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
