import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AttachmentMediaClass,
  AttachmentProcessingMode,
  AttachmentStatus,
  AttributionStatus,
  OrganizationRole,
  PurchaseIntakeStatus,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.module.js';
import { MetalsService } from '../metals/metals.service.js';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { PriceQueueService } from '../jobs/price-queue.service.js';
export type { AuditContext as PurchaseAuditContext };
import { tryLockDraftIntake } from '../purchase-intakes/draft-intake-lock.js';
import Decimal from 'decimal.js';
import { formatWeightInput, fromGrams, type WeightUnit } from '@bullion-ledger/shared';
import { computePurchase, type PurchaseInput } from './purchase-domain.js';
import { PurchaseDto } from './dto/purchase.dto.js';
import { summarizeHeldAssets } from './purchase-summary.js';
import {
  hashIdempotencyKey,
  hashPurchaseRequest,
  isIdempotencyKeyUniqueConflict,
  requireIdempotencyKey,
} from './purchase-idempotency.js';

interface CatalogProduct {
  id: string;
  version: number;
  metalId: string;
  active: boolean;
  name: string;
  form: string;
  brand: string | null;
  country: string | null;
  yearOrVersion: string | null;
  defaultPurity: string;
  defaultUnitWeightGrams: string;
  defaultWeightUnit: string;
  organizations: Array<{
    organizationId: string;
    role: OrganizationRole;
    isPrimary: boolean;
    attributionStatus: AttributionStatus;
    organization: { canonicalName: string };
  }>;
}

interface OrganizationSnapshotInput {
  organizationId: string | null;
  role: OrganizationRole;
  displayName: string;
  isPrimary: boolean;
  attributionStatus: AttributionStatus;
}

/**
 * Atomic purchase creation. PRD §8. The header, items, and generated assets
 * are written in a single Prisma transaction so partial failures cannot
 * leave the ledger in an inconsistent state. Allocation results are persisted
 * verbatim; no re-derivation happens downstream.
 */
@Injectable()
export class PurchasesService {
  private readonly logger = new Logger('Purchases');

  constructor(
    private readonly prisma: PrismaService,
    private readonly metals: MetalsService,
    private readonly audit: AuditService,
    /**
     * Optional so the ledger keeps working with no queue attached: recording a
     * purchase must never depend on market data being reachable (PRD §9).
     */
    @Optional() private readonly priceQueue?: PriceQueueService,
  ) {}

  async list() {
    const purchases = await this.prisma.purchase.findMany({
      orderBy: { purchasedAt: 'desc' },
      include: {
        items: {
          include: {
            metal: { select: { code: true, name: true } },
            organizationSnapshots: { orderBy: [{ role: 'asc' }, { displayName: 'asc' }] },
          },
        },
      },
    });
    return purchases.map((purchase) => this.toPublicPurchase(purchase));
  }

  async get(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            metal: { select: { code: true, name: true } },
            product: { select: { name: true } },
            organizationSnapshots: { orderBy: [{ role: 'asc' }, { displayName: 'asc' }] },
          },
        },
      },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    return this.toPublicPurchase(purchase);
  }

  async create(
    dto: PurchaseDto,
    rawIdempotencyKey: string | undefined,
    auditContext: AuditContext = {},
    sourceIntake?: { id: string; userId: string },
  ) {
    const idempotencyKey = requireIdempotencyKey(rawIdempotencyKey);
    const idempotencyKeyHash = hashIdempotencyKey(idempotencyKey);
    const requestHash = hashPurchaseRequest(dto);

    // Replays are resolved before catalog lookups. A successfully-created
    // purchase remains replayable even if a referenced catalog row is later
    // made inactive.
    const existing = await this.prisma.purchase.findUnique({
      where: { idempotencyKeyHash },
      select: { id: true, requestHash: true, sourceIntakeId: true },
    });
    this.requireMatchingSourceIntake(existing, sourceIntake);
    const existingId = this.requireMatchingRequest(existing, requestHash);
    if (existingId) return this.get(existingId);

    // Resolve metal codes -> ids up front so the transaction stays tight.
    const metalByCode = new Map<string, string>();
    for (const item of dto.items) {
      if (!metalByCode.has(item.metalCode)) {
        const metal = await this.metals.requireByCode(item.metalCode);
        if (!metal.active) {
          throw new BadRequestException(`Metal ${item.metalCode} is inactive`);
        }
        metalByCode.set(item.metalCode, metal.id);
      }
    }

    // Race-safety: purchase creation is wrapped in a single transaction so a
    // crash mid-write rolls back the header, items, and assets together.
    // computePurchase is called INSIDE the transaction, after FOR SHARE locks
    // are placed on catalog products, so authoritative catalog values (purity,
    // unit weight, weight unit) override caller-supplied input before derivation.
    let outcome: { id: string; created: boolean; summary?: string };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        if (sourceIntake) {
          // This is the first authoritative write in the transaction. Original
          // uploads and every draft-attachment mutation take the same intake
          // row lock before touching attachment rows. Whichever transaction
          // wins is therefore fully visible to the next one: finalize either
          // includes the upload in its snapshot, or the upload observes the
          // completed intake and aborts before inserting an attachment.
          const locked = await tryLockDraftIntake(tx, sourceIntake.id, sourceIntake.userId);
          if (!locked) {
            const intake = await tx.purchaseIntake.findFirst({
              where: { id: sourceIntake.id, userId: sourceIntake.userId },
              select: { status: true, purchase: { select: { id: true } } },
            });
            if (!intake) throw new NotFoundException('Purchase intake not found');
            if (intake.purchase) return { id: intake.purchase.id, created: false };
            throw new ConflictException(`Purchase intake is ${intake.status.toLowerCase()}`);
          }
        }

        // The second lookup closes the gap between the initial replay check
        // and the transaction. The database unique constraint is the final
        // arbiter for two transactions that still race after this point.
        const replay = await tx.purchase.findUnique({
          where: { idempotencyKeyHash },
          select: { id: true, requestHash: true, sourceIntakeId: true },
        });
        this.requireMatchingSourceIntake(replay, sourceIntake);
        const replayId = this.requireMatchingRequest(replay, requestHash);
        if (replayId) return { id: replayId, created: false };

        // FOR SHARE lock catalog products and get authoritative defaults.
        const catalogProducts = await this.validateProductDefinitions(tx, dto, metalByCode);

        // Build authoritative PurchaseInput — linked items use catalog grams/purity.
        const authoritativeInput: PurchaseInput = {
          currency: dto.currency,
          subtotal: dto.subtotal,
          premium: dto.premium ?? 0,
          labor: dto.labor ?? 0,
          tax: dto.tax ?? 0,
          shipping: dto.shipping ?? 0,
          otherFees: dto.otherFees ?? 0,
          discount: dto.discount ?? 0,
          allocationMethod: dto.allocationMethod as never,
          items: dto.items.map((raw) => {
            const product = raw.productDefinitionId
              ? catalogProducts.get(raw.productDefinitionId)
              : undefined;
            return {
              productDefinitionId: raw.productDefinitionId ?? null,
              productDefinitionVersion: raw.productDefinitionVersion ?? null,
              metalId: metalByCode.get(raw.metalCode)!,
              form: product?.form ?? raw.form,
              brand: product?.brand ?? raw.brand ?? null,
              name: product?.name ?? raw.name,
              country: product?.country ?? raw.country ?? null,
              yearOrVersion: product?.yearOrVersion ?? raw.yearOrVersion ?? null,
              serial: raw.serial ?? null,
              quantity: raw.quantity,
              unitWeight: product ? product.defaultUnitWeightGrams : raw.unitWeight,
              weightUnit: product ? 'g' : raw.weightUnit,
              purity: product ? product.defaultPurity : raw.purity,
              lineSubtotal: raw.lineSubtotal,
              manualAmount: raw.manualAmount ?? null,
              packagingState: raw.packagingState ?? null,
              hasCertificate: raw.hasCertificate ?? false,
              initialStorageLocation: raw.initialStorageLocation ?? null,
            };
          }),
        };

        const computed = computePurchase(authoritativeInput);

        const customOrganizations = await this.resolveCustomOrganizations(tx, dto);

        const purchase = await tx.purchase.create({
          data: {
            idempotencyKeyHash,
            requestHash,
            purchasedAt: new Date(dto.purchasedAt),
            dealerName: dto.dealerName ?? null,
            branch: dto.branch ?? null,
            orderNumber: dto.orderNumber ?? null,
            invoiceNumber: dto.invoiceNumber ?? null,
            currency: computed.currency,
            paymentMethod: dto.paymentMethod ?? null,
            subtotal: computed.subtotal.toString(),
            premium: computed.premium.toString(),
            labor: computed.labor.toString(),
            tax: computed.tax.toString(),
            shipping: computed.shipping.toString(),
            otherFees: computed.otherFees.toString(),
            discount: computed.discount.toString(),
            totalAmount: computed.totalAmount.toString(),
            allocationMethod: computed.allocationMethod,
            priceEntryMode: dto.priceEntryMode ?? 'ITEMIZED',
            notes: dto.notes ?? null,
            sourceIntakeId: sourceIntake?.id ?? null,
          },
        });

        // Items + assets in matched order. Asset per item = lot of `quantity`.
        const assetByDraftItemId = new Map<string, string>();
        const draftItemIds = dto.items
          .map((item) => item.draftItemId)
          .filter((id): id is string => typeof id === 'string');
        if (new Set(draftItemIds).size !== draftItemIds.length) {
          throw new BadRequestException('draftItemId must be unique within a purchase');
        }
        for (const [index, item] of computed.items.entries()) {
          const rawItem = dto.items[index]!;
          const product = item.input.productDefinitionId
            ? catalogProducts.get(item.input.productDefinitionId)
            : undefined;
          const snapshots = product
            ? product.organizations.map((party) => ({
                organizationId: party.organizationId,
                role: party.role,
                displayName: party.organization.canonicalName,
                isPrimary: party.isPrimary,
                attributionStatus: party.attributionStatus,
              }))
            : this.customSnapshots(rawItem.parties ?? [], customOrganizations);
          const primaryBrand = product
            ? (product.organizations.find(
                (party) => party.role === OrganizationRole.BRAND && party.isPrimary,
              ) ?? product.organizations.find((party) => party.role === OrganizationRole.BRAND))
            : undefined;
          const customBrand =
            snapshots.find(
              (snapshot) => snapshot.role === OrganizationRole.BRAND && snapshot.isPrimary,
            ) ?? snapshots.find((snapshot) => snapshot.role === OrganizationRole.BRAND);

          const createdItem = await tx.purchaseItem.create({
            data: {
              purchaseId: purchase.id,
              productDefinitionId: item.input.productDefinitionId ?? null,
              metalId: item.input.metalId,
              form: product?.form ?? item.input.form.trim(),
              brand:
                primaryBrand?.organization.canonicalName ??
                product?.brand ??
                customBrand?.displayName ??
                item.input.brand?.trim() ??
                null,
              name: product?.name ?? item.input.name.trim(),
              country: product?.country ?? item.input.country?.trim() ?? null,
              yearOrVersion: product?.yearOrVersion ?? item.input.yearOrVersion?.trim() ?? null,
              serial: item.input.serial ?? null,
              quantity: item.input.quantity,
              unitWeightGrams: item.unitWeightGrams.toString(),
              weightUnit: item.input.weightUnit,
              purity: item.purity.toString(),
              grossWeightGrams: item.grossWeightGrams.toString(),
              fineWeightGrams: item.fineWeightGrams.toString(),
              lineSubtotal: item.lineSubtotal.toString(),
              manualAmount:
                computed.allocationMethod === 'MANUAL' ? item.allocatedCost.toString() : null,
              allocatedCost: item.allocatedCost.toString(),
              packagingState: item.input.packagingState ?? null,
              hasCertificate: item.input.hasCertificate ?? false,
              initialStorageLocation: item.input.initialStorageLocation ?? null,
            },
          });

          if (snapshots.length) {
            await tx.purchaseItemOrganizationSnapshot.createMany({
              data: snapshots.map((snapshot) => ({
                purchaseItemId: createdItem.id,
                ...snapshot,
              })),
            });
          }

          const createdAsset = await tx.asset.create({
            data: {
              purchaseItemId: createdItem.id,
              purchaseId: purchase.id,
              productDefinitionId: item.input.productDefinitionId ?? null,
              metalId: item.input.metalId,
              quantity: item.input.quantity,
              grossWeightGrams: item.grossWeightGrams.toString(),
              purity: item.purity.toString(),
              fineWeightGrams: item.fineWeightGrams.toString(),
              allocatedCost: item.allocatedCost.toString(),
              currency: computed.currency,
              status: 'HELD',
              serial: item.input.serial ?? null,
              storageLocation: item.input.initialStorageLocation ?? null,
              acquiredAt: purchase.purchasedAt,
            },
          });
          if (rawItem.draftItemId) {
            assetByDraftItemId.set(rawItem.draftItemId, createdAsset.id);
          }
        }

        if (sourceIntake) {
          await this.reassignIntakeAttachments(
            tx,
            sourceIntake.id,
            purchase.id,
            assetByDraftItemId,
          );
          await tx.purchaseIntake.update({
            where: { id: sourceIntake.id },
            data: {
              status: PurchaseIntakeStatus.COMPLETED,
              completedAt: new Date(),
              version: { increment: 1 },
            },
          });
          await this.audit.recordInTransaction(tx, {
            ...auditContext,
            userId: sourceIntake.userId,
            action: 'purchase-intake.finalize',
            resourceType: 'PurchaseIntake',
            resourceId: sourceIntake.id,
            afterSummary: {
              purchaseId: purchase.id,
              attachmentsReassigned: true,
            },
          });
        }

        // This call deliberately propagates failures. The audit row and every
        // ledger write are committed by this one transaction or not at all.
        await this.audit.recordInTransaction(tx, {
          ...auditContext,
          action: 'purchase.create',
          resourceType: 'Purchase',
          resourceId: purchase.id,
          afterSummary: {
            items: computed.items.length,
            total: computed.totalAmount.toString(),
            currency: computed.currency,
            allocationMethod: computed.allocationMethod,
            remainderUnits: computed.allocation.remainderUnits,
          },
        });

        return {
          id: purchase.id,
          created: true,
          summary: `${computed.items.length} items, total=${computed.totalAmount.toString()} ${computed.currency}`,
        };
      });
    } catch (error) {
      if (sourceIntake && isUniqueConflict(error, 'sourceIntakeId')) {
        const winner = await this.prisma.purchase.findUnique({
          where: { sourceIntakeId: sourceIntake.id },
          select: { id: true },
        });
        if (winner) return this.get(winner.id);
      }
      if (!isIdempotencyKeyUniqueConflict(error)) throw error;

      // Another transaction committed this key first. Resolve the winner
      // outside the aborted transaction and apply the same hash comparison.
      const winner = await this.prisma.purchase.findUnique({
        where: { idempotencyKeyHash },
        select: { id: true, requestHash: true, sourceIntakeId: true },
      });
      this.requireMatchingSourceIntake(winner, sourceIntake);
      const winnerId = this.requireMatchingRequest(winner, requestHash);
      if (!winnerId) throw error;
      outcome = { id: winnerId, created: false };
    }

    if (outcome.created && outcome.summary) {
      this.logger.log(`Created purchase ${outcome.id} (${outcome.summary})`);
      // PRD §12.3: capture the market snapshot the moment a purchase lands.
      // Fire-and-forget by design — the purchase has already committed, and
      // the worker reconciles anything this misses.
      await this.priceQueue?.requestPurchaseSnapshot(outcome.id);
    }

    return this.get(outcome.id);
  }

  async createFromIntake(
    intakeId: string,
    userId: string,
    dto: PurchaseDto,
    rawIdempotencyKey: string | undefined,
    auditContext: AuditContext = {},
  ) {
    const intake = await this.prisma.purchaseIntake.findFirst({
      where: { id: intakeId, userId },
      select: { status: true, purchase: { select: { id: true } } },
    });
    if (!intake) throw new NotFoundException('Purchase intake not found');
    if (intake.purchase) return this.get(intake.purchase.id);
    if (intake.status !== PurchaseIntakeStatus.DRAFT) {
      throw new ConflictException(`Purchase intake is ${intake.status.toLowerCase()}`);
    }
    return this.create(
      dto,
      rawIdempotencyKey,
      { ...auditContext, userId },
      { id: intakeId, userId },
    );
  }

  /** Aggregate metrics for the dashboard summary; never returns mock numbers. */
  async summary() {
    const [assets, purchaseCount] = await Promise.all([
      this.prisma.asset.findMany({
        where: { status: 'HELD' },
        select: {
          metal: { select: { code: true } },
          currency: true,
          quantity: true,
          fineWeightGrams: true,
          allocatedCost: true,
        },
      }),
      this.prisma.purchase.count(),
    ]);

    return summarizeHeldAssets(
      assets.map((asset) => ({
        metalCode: asset.metal.code,
        currency: asset.currency,
        quantity: asset.quantity,
        fineWeightGrams: asset.fineWeightGrams.toString(),
        allocatedCost: asset.allocatedCost.toString(),
      })),
      purchaseCount,
    );
  }

  private async validateProductDefinitions(
    tx: Prisma.TransactionClient,
    dto: PurchaseDto,
    metalByCode: Map<string, string>,
  ): Promise<Map<string, CatalogProduct>> {
    const productIds = Array.from(
      new Set(
        dto.items
          .map((item) => item.productDefinitionId)
          .filter((id): id is string => id !== undefined && id !== null),
      ),
    );
    for (const item of dto.items) {
      if (item.productDefinitionVersion !== undefined && !item.productDefinitionId) {
        throw new BadRequestException('productDefinitionVersion requires productDefinitionId');
      }
      if (item.productDefinitionId && item.parties?.length) {
        throw new BadRequestException(
          'parties cannot be supplied with productDefinitionId; catalog parties are authoritative',
        );
      }
    }

    if (productIds.length === 0) return new Map<string, CatalogProduct>();

    // Acquire FOR SHARE locks in deterministic sorted order so lock ordering
    // is testable and deadlock-free.
    const sortedIds = [...productIds].sort();
    for (const id of sortedIds) {
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "ProductDefinition" WHERE "id" = ${id} FOR SHARE
      `;
      if (!locked) {
        throw new NotFoundException(`Product definition ${id} not found`);
      }
    }

    // All rows are locked; read full data with Prisma's normal query layer.
    const products = await tx.productDefinition.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        version: true,
        metalId: true,
        active: true,
        name: true,
        form: true,
        brand: true,
        country: true,
        yearOrVersion: true,
        defaultPurity: true,
        defaultUnitWeightGrams: true,
        defaultWeightUnit: true,
        organizations: {
          select: {
            organizationId: true,
            role: true,
            isPrimary: true,
            attributionStatus: true,
            organization: { select: { canonicalName: true } },
          },
          orderBy: [{ role: 'asc' }, { isPrimary: 'desc' }, { organizationId: 'asc' }],
        },
      },
    });

    const byId = new Map<string, CatalogProduct>();
    for (const product of products) {
      byId.set(product.id, {
        id: product.id,
        version: product.version,
        metalId: product.metalId,
        active: product.active,
        name: product.name,
        form: product.form,
        brand: product.brand,
        country: product.country,
        yearOrVersion: product.yearOrVersion,
        defaultPurity: product.defaultPurity.toFixed(),
        defaultUnitWeightGrams: product.defaultUnitWeightGrams.toFixed(),
        defaultWeightUnit: product.defaultWeightUnit,
        organizations: product.organizations.map((o) => ({
          organizationId: o.organizationId,
          role: o.role,
          isPrimary: o.isPrimary,
          attributionStatus: o.attributionStatus,
          organization: o.organization,
        })),
      });
    }

    for (const rawItem of dto.items) {
      const productId = rawItem.productDefinitionId;
      if (!productId) continue;
      const product = byId.get(productId);
      if (!product) {
        throw new NotFoundException(`Product definition ${productId} not found`);
      }
      if (!product.active) {
        throw new BadRequestException(`Product definition ${productId} is inactive`);
      }
      if (product.metalId !== metalByCode.get(rawItem.metalCode)) {
        throw new BadRequestException(`Product definition ${productId} does not match item metal`);
      }
      // The version sent from the client is the catalog version observed when
      // the template was applied. If the catalog version changed since then the
      // purchase must be re-created with current product data.
      const observedVersion = rawItem.productDefinitionVersion;
      if (observedVersion === undefined) {
        if (product.version !== 1) {
          throw new ConflictException({
            code: 'PRODUCT_VERSION_CONFLICT',
            message: `Product definition ${productId} has been updated; refresh the purchase form to continue`,
          });
        }
      } else if (observedVersion !== product.version) {
        throw new ConflictException({
          code: 'PRODUCT_VERSION_CONFLICT',
          message: `Product definition ${productId} version mismatch: expected ${observedVersion}, current ${product.version}`,
        });
      }

      // Validate submitted physical values against locked catalog defaults.
      // Weight: the submitted magnitude in the caller's unit must round-trip
      // to the canonical grams (e.g. 1000g -> 32.150746569 troy_oz accepted).
      const expectedMagnitude = formatWeightInput(
        fromGrams(new Decimal(product.defaultUnitWeightGrams), rawItem.weightUnit as WeightUnit),
      );
      const submittedMagnitude = formatWeightInput(rawItem.unitWeight);
      if (expectedMagnitude !== submittedMagnitude) {
        throw new BadRequestException(
          `Product definition ${productId} unitWeight ${rawItem.unitWeight} ${rawItem.weightUnit} does not match catalog default ${product.defaultUnitWeightGrams} g`,
        );
      }
      // Purity: exact Decimal equality.
      if (!new Decimal(rawItem.purity).eq(new Decimal(product.defaultPurity))) {
        throw new BadRequestException(
          `Product definition ${productId} purity ${rawItem.purity} does not match catalog default ${product.defaultPurity}`,
        );
      }
    }
    return byId;
  }

  private async resolveCustomOrganizations(tx: Prisma.TransactionClient, dto: PurchaseDto) {
    const ids = [
      ...new Set(
        dto.items.flatMap((item) =>
          item.productDefinitionId
            ? []
            : (item.parties ?? []).flatMap((party) =>
                party.organizationId ? [party.organizationId] : [],
              ),
        ),
      ),
    ];
    if (!ids.length) return new Map<string, { id: string; canonicalName: string }>();
    const organizations = await tx.organization.findMany({
      where: { id: { in: ids }, active: true },
      select: { id: true, canonicalName: true },
    });
    if (organizations.length !== ids.length) {
      throw new BadRequestException(
        'One or more purchase item organizations are missing or inactive',
      );
    }
    return new Map(organizations.map((organization) => [organization.id, organization]));
  }

  private customSnapshots(
    parties: NonNullable<PurchaseDto['items'][number]['parties']>,
    organizations: Map<string, { id: string; canonicalName: string }>,
  ): OrganizationSnapshotInput[] {
    const seen = new Set<string>();
    const primaryRoles = new Set<OrganizationRole>();
    return parties.map((party) => {
      const linked = party.organizationId ? organizations.get(party.organizationId) : undefined;
      const displayName = linked?.canonicalName ?? party.displayName?.trim();
      if (!displayName) {
        throw new BadRequestException(
          'Each custom item party requires organizationId or displayName',
        );
      }
      const key = `${party.role}:${party.organizationId ?? ''}:${displayName}`;
      if (seen.has(key))
        throw new BadRequestException('Duplicate purchase item organization party');
      seen.add(key);
      const isPrimary = party.isPrimary ?? false;
      if (isPrimary && primaryRoles.has(party.role)) {
        throw new BadRequestException(`Only one primary ${party.role} organization is allowed`);
      }
      if (isPrimary) primaryRoles.add(party.role);
      return {
        organizationId: linked?.id ?? null,
        role: party.role,
        displayName,
        isPrimary,
        attributionStatus: party.attributionStatus ?? AttributionStatus.USER_REPORTED,
      };
    });
  }

  private async reassignIntakeAttachments(
    tx: Prisma.TransactionClient,
    intakeId: string,
    purchaseId: string,
    assetByDraftItemId: Map<string, string>,
  ): Promise<void> {
    const attachments = await tx.attachment.findMany({
      where: { intakeId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        mediaClass: true,
        draftItemId: true,
        kind: true,
        isCover: true,
        status: true,
        processingMode: true,
        userConfirmed: true,
      },
    });
    const coverAttachmentIds = normalizedCoverAttachmentIds(attachments);
    for (const attachment of attachments) {
      if (
        attachment.status !== AttachmentStatus.READY ||
        (attachment.processingMode !== AttachmentProcessingMode.NONE && !attachment.userConfirmed)
      ) {
        throw new ConflictException(
          `Attachment ${attachment.id} must be reviewed and confirmed before finalization`,
        );
      }
      if (attachment.mediaClass === AttachmentMediaClass.DOCUMENT) {
        await tx.attachment.update({
          where: { id: attachment.id },
          data: { intakeId: null, purchaseId, assetId: null },
        });
        continue;
      }

      if (!attachment.draftItemId) {
        await tx.attachment.update({
          where: { id: attachment.id },
          data: { intakeId: null, purchaseId, assetId: null },
        });
        continue;
      }

      const assetId = assetByDraftItemId.get(attachment.draftItemId);
      if (!assetId) {
        throw new BadRequestException(
          `Attachment references unknown draftItemId ${attachment.draftItemId}`,
        );
      }
      await tx.attachment.update({
        where: { id: attachment.id },
        data: {
          intakeId: null,
          purchaseId: null,
          assetId,
          isCover: coverAttachmentIds.has(attachment.id),
        },
      });
    }
  }

  private requireMatchingSourceIntake(
    existing: { sourceIntakeId?: string | null } | null,
    expected: { id: string; userId: string } | undefined,
  ): void {
    if (existing && expected && existing.sourceIntakeId !== expected.id) {
      throw new ConflictException('Idempotency-Key was already used for a different intake');
    }
  }

  private requireMatchingRequest(
    existing: { id: string; requestHash: string } | null,
    requestHash: string,
  ): string | null {
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new ConflictException('Idempotency-Key was already used for a different request');
    }
    return existing.id;
  }

  /** Idempotency digests are internal concurrency metadata, not API fields. */
  private toPublicPurchase<T extends { idempotencyKeyHash: string; requestHash: string }>(
    purchase: T,
  ): Omit<T, 'idempotencyKeyHash' | 'requestHash'> {
    const {
      idempotencyKeyHash: _idempotencyKeyHash,
      requestHash: _requestHash,
      ...publicPurchase
    } = purchase;
    return publicPurchase;
  }
}

function normalizedCoverAttachmentIds(
  attachments: readonly {
    id: string;
    mediaClass: AttachmentMediaClass;
    draftItemId: string | null;
    kind: string;
    isCover: boolean;
  }[],
): Set<string> {
  const chosen = new Map<string, { id: string; priority: number }>();
  for (const attachment of attachments) {
    if (attachment.mediaClass !== AttachmentMediaClass.ASSET_PHOTO || !attachment.draftItemId) {
      continue;
    }
    const priority = attachment.isCover ? 2 : attachment.kind === 'front' ? 1 : 0;
    const current = chosen.get(attachment.draftItemId);
    // findMany is ordered by creation time and id, so equal-priority ties are
    // stable while a user-selected cover always replaces a fallback.
    if (!current || priority > current.priority) {
      chosen.set(attachment.draftItemId, { id: attachment.id, priority });
    }
  }
  return new Set([...chosen.values()].map(({ id }) => id));
}

function isUniqueConflict(error: unknown, field: string): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') {
    return false;
  }
  const meta = 'meta' in error && error.meta && typeof error.meta === 'object' ? error.meta : null;
  const target = meta && 'target' in meta ? meta.target : null;
  return Array.isArray(target)
    ? target.some((value) => value === field)
    : typeof target === 'string' && target.includes(field);
}
