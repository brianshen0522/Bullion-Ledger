import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttributionStatus, OrganizationRole, type Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

import { PrismaService } from '../prisma/prisma.module.js';
import { MetalsService } from '../metals/metals.service.js';
import {
  ArgumentError,
  fineWeightGrams,
  quantizeWeightGrams,
  toGrams,
  validatePurity,
} from '@bullion-ledger/shared';
import {
  ProductDefinitionDto,
  ProductOrganizationDto,
  UpdateProductDefinitionDto,
} from './dto/product-definition.dto.js';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { presentProductDefinition, PRODUCT_INCLUDE } from './product-presenter.js';

/**
 * Product Definition management (PRD §6.1). Inputs are validated at the API
 * boundary; canonical weights/purity are derived via the shared Decimal
 * helpers so the stored values are always grams + ratio.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metals: MetalsService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const products = await this.prisma.productDefinition.findMany({
      orderBy: { createdAt: 'desc' },
      include: PRODUCT_INCLUDE,
    });
    return products.map(presentProductDefinition);
  }

  async get(id: string) {
    const product = await this.prisma.productDefinition.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException('Product definition not found');
    return presentProductDefinition(product);
  }

  async create(dto: ProductDefinitionDto, userId?: string) {
    const metal = await this.metals.requireByCode(dto.metalCode);
    const purity = validatePurity(dto.purity);
    const unitWeightGrams = quantizeWeightGrams(
      toGrams(dto.unitWeight, dto.weightUnit as never),
      'defaultUnitWeightGrams',
    );

    if (unitWeightGrams.lte(0)) {
      throw new ArgumentError('unitWeight must be > 0');
    }

    // Sanity-check fine weight math so a bad combination cannot be persisted.
    void quantizeWeightGrams(fineWeightGrams(unitWeightGrams, purity), 'defaultFineWeightGrams');

    const parties = await this.resolveParties(this.prisma, dto.parties ?? []);
    const primaryBrand =
      parties.find((party) => party.role === OrganizationRole.BRAND && party.isPrimary) ??
      parties.find((party) => party.role === OrganizationRole.BRAND);

    const created = await this.prisma.productDefinition.create({
      data: {
        name: dto.name.trim(),
        metalId: metal.id,
        form: dto.form.trim(),
        brand: primaryBrand?.canonicalName ?? dto.brand?.trim() ?? null,
        country: dto.country?.trim() ?? null,
        yearOrVersion: dto.yearOrVersion?.trim() ?? null,
        defaultPurity: purity.toString(),
        defaultUnitWeightGrams: unitWeightGrams.toString(),
        defaultWeightUnit: dto.weightUnit,
        active: dto.active ?? true,
        source: 'USER',
        organizations: {
          create: parties.map(({ canonicalName: _canonicalName, ...party }) => party),
        },
      },
      include: PRODUCT_INCLUDE,
    });
    await this.audit.record({
      userId,
      action: 'product.create',
      resourceType: 'ProductDefinition',
      resourceId: created.id,
      afterSummary: { name: created.name, metal: metal.code, parties: parties.length },
    });
    return presentProductDefinition(created);
  }

  /**
   * Partial edit of a saved ProductDefinition. `metalCode` is identity and is
   * never changed here. Canonical grams are recomputed only when `unitWeight`
   * is present; changing `weightUnit` alone preserves the stored grams. Parties
   * are fully replaced only when supplied. The version increment uses an atomic
   * CAS (updateMany where id + old-version) so two concurrent requests for the
   * same version cannot both succeed.
   */
  async update(id: string, dto: UpdateProductDefinitionDto, auditContext: AuditContext = {}) {
    if (isNoopPatch(dto)) {
      throw new BadRequestException('No fields to update');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.productDefinition.findUnique({
        where: { id },
        include: PRODUCT_INCLUDE,
      });
      if (!before) throw new NotFoundException('Product definition not found');
      if (before.version !== dto.version) {
        throw new ConflictException(
          `Product definition version conflict: expected ${dto.version}, current ${before.version}`,
        );
      }

      const hasExistingBrandOrg = before.organizations.some(
        (party) => party.role === OrganizationRole.BRAND,
      );
      if (dto.brand !== undefined && hasExistingBrandOrg && dto.parties === undefined) {
        throw new BadRequestException(
          'Cannot set scalar brand when a BRAND organization is assigned; remove the organization first',
        );
      }

      const data: Record<string, unknown> = {};

      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.form !== undefined) data.form = dto.form.trim();
      if (dto.brand !== undefined) data.brand = brandOrNull(dto.brand);
      if (dto.country !== undefined) data.country = nullableString(dto.country);
      if (dto.yearOrVersion !== undefined) data.yearOrVersion = nullableString(dto.yearOrVersion);
      if (dto.active !== undefined) data.active = dto.active;

      if (dto.unitWeight !== undefined) {
        const unit = (dto.weightUnit ?? before.defaultWeightUnit) as string;
        const unitWeightGrams = quantizeWeightGrams(
          toGrams(dto.unitWeight, unit as never),
          'defaultUnitWeightGrams',
        );
        if (unitWeightGrams.lte(0)) {
          throw new BadRequestException('unitWeight must be > 0');
        }
        data.defaultUnitWeightGrams = unitWeightGrams.toString();
        if (dto.weightUnit !== undefined) data.defaultWeightUnit = dto.weightUnit;
      } else if (dto.weightUnit !== undefined) {
        data.defaultWeightUnit = dto.weightUnit;
      }

      let purity: Decimal | undefined;
      if (dto.purity !== undefined) {
        purity = validatePurity(dto.purity);
        data.defaultPurity = purity.toString();
      }

      const effectiveUnitWeight = data.defaultUnitWeightGrams
        ? new Decimal(data.defaultUnitWeightGrams as string)
        : new Decimal(before.defaultUnitWeightGrams.toString());
      // Prisma returns its own Decimal implementation. Convert it at this
      // boundary before calling shared helpers, which intentionally accept
      // decimal.js values (and otherwise reject Prisma Decimal objects).
      const effectivePurity = purity ?? new Decimal(before.defaultPurity.toString());
      void quantizeWeightGrams(
        fineWeightGrams(effectiveUnitWeight, effectivePurity),
        'defaultFineWeightGrams',
      );

      let parties: Awaited<ReturnType<ProductsService['resolveParties']>> | undefined;
      if (dto.parties !== undefined) {
        parties = await this.resolveParties(tx, dto.parties);
        const primaryBrand =
          parties.find((party) => party.role === OrganizationRole.BRAND && party.isPrimary) ??
          parties.find((party) => party.role === OrganizationRole.BRAND);
        if (primaryBrand) {
          data.brand = primaryBrand.canonicalName;
        } else {
          data.brand = dto.brand !== undefined ? brandOrNull(dto.brand) : null;
        }
      } else if (dto.brand !== undefined) {
        data.brand = brandOrNull(dto.brand);
      }

      // Reject semantic no-op — every computed data value must differ from the
      // current persisted state (after canonicalization). Parties are compared
      // separately since they are written via a different path.
      let partiesSame = false;
      if (parties !== undefined) {
        const sortedParties = parties
          .map((p) => ({
            organizationId: p.organizationId,
            role: p.role,
            isPrimary: p.isPrimary,
            attributionStatus: p.attributionStatus,
          }))
          .sort(partyComparator);
        const sortedExisting = before.organizations
          .map((o) => ({
            organizationId: o.organizationId,
            role: o.role,
            isPrimary: o.isPrimary,
            attributionStatus: o.attributionStatus,
          }))
          .sort(partyComparator);
        partiesSame =
          sortedExisting.length === sortedParties.length &&
          sortedParties.every(
            (p, i) =>
              sortedExisting[i] &&
              p.organizationId === sortedExisting[i]!.organizationId &&
              p.role === sortedExisting[i]!.role &&
              p.isPrimary === sortedExisting[i]!.isPrimary &&
              p.attributionStatus === sortedExisting[i]!.attributionStatus,
          );
      }

      if (
        !Object.keys(data).some((key) => productFieldDiffers(key, data[key], before)) &&
        (parties === undefined || partiesSame)
      ) {
        throw new BadRequestException('No fields to update');
      }

      const { count } = await tx.productDefinition.updateMany({
        where: { id, version: before.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new ConflictException(
          `Product definition ${id} was updated by another request; refresh and retry`,
        );
      }

      if (parties) {
        await tx.productOrganization.deleteMany({ where: { productDefinitionId: id } });
        if (parties.length) {
          await tx.productOrganization.createMany({
            data: parties.map(({ canonicalName: _cn, ...party }) => ({
              productDefinitionId: id,
              ...party,
            })),
          });
        }
      }

      const updated = await tx.productDefinition.findUnique({
        where: { id },
        include: PRODUCT_INCLUDE,
      });

      await this.audit.recordInTransaction(tx, {
        ...auditContext,
        action: 'product.update',
        resourceType: 'ProductDefinition',
        resourceId: id,
        beforeSummary: summarizeProduct(before),
        afterSummary: summarizeProduct(updated),
      });
      return updated!;
    });

    return presentProductDefinition(result);
  }

  /** Resolves the canonical grams weight for a unit weight on a product. */
  static canonicalGrams(unitWeight: Decimal, unit: string): Decimal {
    return toGrams(unitWeight, unit as never);
  }

  private async resolveParties(tx: Prisma.TransactionClient, parties: ProductOrganizationDto[]) {
    const duplicateKeys = new Set<string>();
    const seen = new Set<string>();
    const primaryRoles = new Set<OrganizationRole>();
    for (const party of parties) {
      const key = `${party.organizationId}:${party.role}`;
      if (seen.has(key)) duplicateKeys.add(key);
      seen.add(key);
      if (party.isPrimary) {
        if (primaryRoles.has(party.role)) {
          throw new BadRequestException(`Only one primary ${party.role} organization is allowed`);
        }
        primaryRoles.add(party.role);
      }
    }
    if (duplicateKeys.size) {
      throw new BadRequestException('Duplicate organization-role party');
    }

    const organizationIds = [...new Set(parties.map(({ organizationId }) => organizationId))];
    const organizations = await tx.organization.findMany({
      where: { id: { in: organizationIds }, active: true },
      select: { id: true, canonicalName: true },
    });
    if (organizations.length !== organizationIds.length) {
      throw new BadRequestException('One or more product organizations are missing or inactive');
    }
    const byId = new Map(organizations.map((organization) => [organization.id, organization]));

    return parties.map((party) => ({
      organizationId: party.organizationId,
      role: party.role,
      isPrimary: party.isPrimary ?? false,
      attributionStatus: party.attributionStatus ?? AttributionStatus.DECLARED,
      canonicalName: byId.get(party.organizationId)!.canonicalName,
    }));
  }
}

type PresentableProduct = Parameters<typeof presentProductDefinition>[0];

function summarizeProduct(product: PresentableProduct | null | undefined) {
  if (!product) return null;
  return {
    name: product.name,
    form: product.form,
    brand: product.brand,
    country: product.country,
    yearOrVersion: product.yearOrVersion,
    purity: product.defaultPurity.toFixed(),
    unitWeightGrams: product.defaultUnitWeightGrams.toFixed(),
    weightUnit: product.defaultWeightUnit,
    active: product.active,
    version: product.version,
    parties: product.organizations.map((party) => ({
      role: party.role,
      isPrimary: party.isPrimary,
      organization: party.organization.canonicalName,
    })),
  };
}

function brandOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function nullableString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function partyKey(p: { organizationId: string; role: string }): string {
  return `${p.role}:${p.organizationId}`;
}
function partyComparator(
  a: { organizationId: string; role: string },
  b: { organizationId: string; role: string },
): number {
  return partyKey(a).localeCompare(partyKey(b));
}

function productFieldDiffers(key: string, newValue: unknown, record: PresentableProduct): boolean {
  const oldValue = (record as Record<string, unknown>)[key];
  if (oldValue instanceof Decimal) {
    try {
      return !new Decimal(String(newValue)).eq(oldValue);
    } catch {
      return true;
    }
  }
  return String(newValue) !== String(oldValue);
}

function isNoopPatch(dto: UpdateProductDefinitionDto): boolean {
  return (
    dto.name === undefined &&
    dto.form === undefined &&
    dto.brand === undefined &&
    dto.country === undefined &&
    dto.yearOrVersion === undefined &&
    dto.purity === undefined &&
    dto.unitWeight === undefined &&
    dto.weightUnit === undefined &&
    dto.active === undefined &&
    dto.parties === undefined
  );
}
