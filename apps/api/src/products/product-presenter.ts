import type { Prisma } from '@prisma/client';

export const PRODUCT_INCLUDE = {
  metal: { select: { code: true, name: true } },
  organizations: {
    include: {
      organization: {
        select: { id: true, canonicalName: true, countryCode: true, verified: true },
      },
    },
    orderBy: [{ role: 'asc' as const }, { isPrimary: 'desc' as const }],
  },
} satisfies Prisma.ProductDefinitionInclude;

type ProductWithRelations = Prisma.ProductDefinitionGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;

/**
 * Converts Prisma values into the stable public product-definition contract.
 * In particular, Decimal and Date instances must never reach Nest's generic
 * class serializer because it expands their private implementation fields.
 */
export function presentProductDefinition(product: ProductWithRelations) {
  return {
    id: product.id,
    name: product.name,
    metal: product.metal,
    form: product.form,
    brand: product.brand,
    country: product.country,
    yearOrVersion: product.yearOrVersion,
    // Decimal#toString switches very small legal values to exponent notation,
    // while the public DTO intentionally accepts fixed-point decimals only.
    defaultPurity: product.defaultPurity.toFixed(),
    defaultUnitWeightGrams: product.defaultUnitWeightGrams.toFixed(),
    defaultWeightUnit: product.defaultWeightUnit,
    active: product.active,
    source: product.source,
    version: product.version,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    organizations: product.organizations.map((party) => ({
      id: party.id,
      role: party.role,
      isPrimary: party.isPrimary,
      attributionStatus: party.attributionStatus,
      organization: party.organization,
    })),
  };
}
