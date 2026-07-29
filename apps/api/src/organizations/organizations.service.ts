import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { OrganizationRole, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.module.js';
import {
  CreateOrganizationDto,
  OrganizationSearchQueryDto,
  type OrganizationSearchResultDto,
} from './dto/create-organization.dto.js';
import { normalizeOrganizationName } from './organization-normalization.js';

const ORGANIZATION_CREATE_LOCK_KEY = BigInt('7311204202607280001');

const ORGANIZATION_SELECT = {
  id: true,
  canonicalName: true,
  countryCode: true,
  source: true,
  verified: true,
  active: true,
  aliases: {
    select: { id: true, name: true, kind: true, locale: true },
    orderBy: [{ kind: 'asc' as const }, { name: 'asc' as const }],
  },
  capabilities: {
    select: { capability: true },
    orderBy: { capability: 'asc' as const },
  },
} satisfies Prisma.OrganizationSelect;

type SelectedOrganization = Prisma.OrganizationGetPayload<{ select: typeof ORGANIZATION_SELECT }>;
type SearchOrganization = Omit<SelectedOrganization, 'aliases'> & {
  normalizedName: string;
  aliases: Array<SelectedOrganization['aliases'][number] & { normalizedName: string }>;
};

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async search(query: OrganizationSearchQueryDto): Promise<OrganizationSearchResultDto[]> {
    const normalizedQuery = normalizeOrganizationName(query.q ?? '');
    const capabilities = this.parseCapabilities(query.capabilities);
    const limit = query.limit ?? 20;

    const organizations = await this.prisma.organization.findMany({
      where: {
        active: true,
        ...(normalizedQuery
          ? {
              OR: [
                { normalizedName: { contains: normalizedQuery } },
                { aliases: { some: { normalizedName: { contains: normalizedQuery } } } },
              ],
            }
          : {}),
        ...(capabilities.length
          ? {
              AND: capabilities.map((capability) => ({
                capabilities: { some: { capability } },
              })),
            }
          : {}),
      },
      select: {
        ...ORGANIZATION_SELECT,
        normalizedName: true,
        aliases: {
          select: { id: true, name: true, normalizedName: true, kind: true, locale: true },
          orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        },
      },
      take: Math.min(limit * 5, 100),
      orderBy: [{ verified: 'desc' }, { canonicalName: 'asc' }],
    });

    return organizations
      .sort((left, right) => this.rank(left, normalizedQuery) - this.rank(right, normalizedQuery))
      .slice(0, limit)
      .map((result) => {
        const matchedAlias = this.matchedAlias(result, normalizedQuery)?.name ?? null;
        const {
          normalizedName: _normalizedName,
          aliases,
          capabilities: roles,
          ...organization
        } = result;
        return {
          ...organization,
          aliases: aliases.map(({ normalizedName: _normalizedAlias, ...alias }) => alias),
          capabilities: roles.map(({ capability }) => capability),
          matchedAlias,
        };
      });
  }

  async create(dto: CreateOrganizationDto, userId?: string) {
    const canonicalName = dto.canonicalName.trim();
    const normalizedName = normalizeOrganizationName(canonicalName);
    if (!normalizedName)
      throw new BadRequestException('canonicalName must contain letters or numbers');

    const aliases = [
      { name: canonicalName, normalizedName, kind: 'OFFICIAL' as const, locale: null },
      ...(dto.aliases ?? []).map((alias) => ({
        name: alias.name.trim(),
        normalizedName: normalizeOrganizationName(alias.name),
        kind: alias.kind,
        locale: alias.locale ?? null,
      })),
    ];
    const seenAliases = new Set<string>();
    for (const alias of aliases) {
      if (!alias.normalizedName)
        throw new BadRequestException('Alias must contain letters or numbers');
      if (seenAliases.has(alias.normalizedName)) {
        throw new BadRequestException(`Duplicate alias: ${alias.name}`);
      }
      seenAliases.add(alias.normalizedName);
    }

    const normalizedCandidates = [...seenAliases];
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Alias uniqueness spans two tables, so serialize this low-frequency
        // operation and re-check under the transaction lock.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ORGANIZATION_CREATE_LOCK_KEY}::bigint)`;
        const duplicate = await tx.organization.findFirst({
          where: {
            OR: [
              { normalizedName: { in: normalizedCandidates } },
              { aliases: { some: { normalizedName: { in: normalizedCandidates } } } },
            ],
          },
          select: {
            canonicalName: true,
            normalizedName: true,
            aliases: {
              where: { normalizedName: { in: normalizedCandidates } },
              select: { name: true, normalizedName: true },
              take: 1,
            },
          },
        });
        if (duplicate) {
          const conflictingName = duplicate.aliases[0]?.name ?? duplicate.canonicalName;
          throw new ConflictException(
            `Organization name or alias already exists as ${conflictingName} (${duplicate.canonicalName})`,
          );
        }

        const saved = await tx.organization.create({
          data: {
            canonicalName,
            normalizedName,
            countryCode: dto.countryCode ?? null,
            source: 'USER',
            verified: false,
            aliases: { create: aliases },
            capabilities: {
              create: (dto.capabilities ?? []).map((capability) => ({ capability })),
            },
          },
          select: ORGANIZATION_SELECT,
        });
        await this.audit.recordInTransaction(tx, {
          userId,
          action: 'organization.create',
          resourceType: 'Organization',
          resourceId: saved.id,
          afterSummary: {
            canonicalName: saved.canonicalName,
            countryCode: saved.countryCode,
            capabilities: saved.capabilities.map(({ capability }) => capability),
          },
        });
        return saved;
      });
      return this.present(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'An organization or alias with this normalized name already exists',
        );
      }
      throw error;
    }
  }

  private parseCapabilities(value: string | undefined): OrganizationRole[] {
    if (!value?.trim()) return [];
    const requested = [
      ...new Set(
        value
          .split(',')
          .map((role) => role.trim())
          .filter(Boolean),
      ),
    ];
    const validRoles = new Set<string>(Object.values(OrganizationRole));
    const invalid = requested.filter((role) => !validRoles.has(role));
    if (invalid.length) {
      throw new BadRequestException(`Unknown organization capabilities: ${invalid.join(', ')}`);
    }
    return requested as OrganizationRole[];
  }

  private rank(organization: SearchOrganization, query: string): number {
    if (!query) return organization.verified ? 0 : 1;
    const aliasNames = organization.aliases.map(({ normalizedName }) => normalizedName);
    if (organization.normalizedName === query) return 0;
    if (aliasNames.includes(query)) return 1;
    if (organization.normalizedName.startsWith(query)) return 2;
    if (aliasNames.some((alias) => alias.startsWith(query))) return 3;
    return organization.verified ? 4 : 5;
  }

  private matchedAlias(
    organization: SearchOrganization,
    query: string,
  ): SearchOrganization['aliases'][number] | null {
    if (!query || organization.normalizedName === query) return null;
    const exact = organization.aliases.find(({ normalizedName }) => normalizedName === query);
    if (exact) return exact;
    if (organization.normalizedName.startsWith(query)) return null;
    const prefix = organization.aliases.find(({ normalizedName }) =>
      normalizedName.startsWith(query),
    );
    if (prefix) return prefix;
    if (organization.normalizedName.includes(query)) return null;
    return (
      organization.aliases.find(({ normalizedName }) => normalizedName.includes(query)) ?? null
    );
  }

  private present(organization: SelectedOrganization) {
    return {
      ...organization,
      capabilities: organization.capabilities.map(({ capability }) => capability),
    };
  }
}
