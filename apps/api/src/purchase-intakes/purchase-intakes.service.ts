import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PurchaseIntakeStatus, type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { presentAttachment } from '../attachments/attachment-presenter.js';
import type { PurchaseAuditContext } from '../purchases/purchases.service.js';
import { CreatePurchaseIntakeDto, UpdatePurchaseIntakeDto } from './dto/purchase-intake.dto.js';

const INTAKE_INCLUDE = {
  attachments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: { variants: { orderBy: [{ kind: 'asc' }, { revision: 'desc' }] } },
  },
  purchase: { select: { id: true } },
} satisfies Prisma.PurchaseIntakeInclude;

type IntakeWithRelations = Prisma.PurchaseIntakeGetPayload<{ include: typeof INTAKE_INCLUDE }>;

@Injectable()
export class PurchaseIntakesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    dto: CreatePurchaseIntakeDto,
    auditContext: PurchaseAuditContext = {},
  ) {
    const existing = await this.prisma.purchaseIntake.findUnique({
      where: { id: dto.draftId },
      include: INTAKE_INCLUDE,
    });
    if (existing) {
      if (existing.userId !== userId) throw new NotFoundException('Purchase intake not found');
      return presentIntake(existing);
    }

    try {
      const intake = await this.prisma.$transaction(async (tx) => {
        const intake = await tx.purchaseIntake.create({
          data: {
            id: dto.draftId,
            userId,
            currentStep: dto.currentStep ?? 0,
            schemaVersion: dto.schemaVersion ?? 1,
            draftData: (dto.draftData ?? {}) as Prisma.InputJsonValue,
          },
          include: INTAKE_INCLUDE,
        });
        await this.audit.recordInTransaction(tx, {
          ...auditContext,
          userId,
          action: 'purchase-intake.create',
          resourceType: 'PurchaseIntake',
          resourceId: intake.id,
          afterSummary: { schemaVersion: intake.schemaVersion },
        });
        return intake;
      });
      return presentIntake(intake);
    } catch (error) {
      if (!isUniqueConflict(error, 'id')) throw error;
      return this.get(userId, dto.draftId);
    }
  }

  async list(userId: string, status?: PurchaseIntakeStatus) {
    const intakes = await this.prisma.purchaseIntake.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { updatedAt: 'desc' },
      include: INTAKE_INCLUDE,
    });
    return intakes.map(presentIntake);
  }

  async get(userId: string, id: string) {
    const intake = await this.prisma.purchaseIntake.findFirst({
      where: { id, userId },
      include: INTAKE_INCLUDE,
    });
    if (!intake) throw new NotFoundException('Purchase intake not found');
    return presentIntake(intake);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdatePurchaseIntakeDto,
    auditContext: PurchaseAuditContext = {},
  ) {
    const result = await this.prisma.purchaseIntake.updateMany({
      where: { id, userId, status: PurchaseIntakeStatus.DRAFT, version: dto.version },
      data: {
        ...(dto.currentStep === undefined ? {} : { currentStep: dto.currentStep }),
        ...(dto.schemaVersion === undefined ? {} : { schemaVersion: dto.schemaVersion }),
        ...(dto.draftData === undefined
          ? {}
          : { draftData: dto.draftData as Prisma.InputJsonValue }),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) await this.throwUpdateFailure(userId, id, dto.version);

    const intake = await this.get(userId, id);
    await this.audit.record({
      ...auditContext,
      userId,
      action: 'purchase-intake.update',
      resourceType: 'PurchaseIntake',
      resourceId: id,
      afterSummary: {
        version: intake.version,
        currentStep: intake.currentStep,
        schemaVersion: intake.schemaVersion,
      },
    });
    return intake;
  }

  async cancel(userId: string, id: string, auditContext: PurchaseAuditContext = {}) {
    const current = await this.get(userId, id);
    if (current.status === PurchaseIntakeStatus.CANCELLED) return current;
    if (current.status === PurchaseIntakeStatus.COMPLETED) {
      throw new ConflictException('A completed purchase intake cannot be cancelled');
    }

    const result = await this.prisma.purchaseIntake.updateMany({
      where: { id, userId, status: PurchaseIntakeStatus.DRAFT },
      data: {
        status: PurchaseIntakeStatus.CANCELLED,
        cancelledAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      const raced = await this.get(userId, id);
      if (raced.status === PurchaseIntakeStatus.CANCELLED) return raced;
      throw new ConflictException('Purchase intake is no longer cancellable');
    }

    const intake = await this.get(userId, id);
    await this.audit.record({
      ...auditContext,
      userId,
      action: 'purchase-intake.cancel',
      resourceType: 'PurchaseIntake',
      resourceId: id,
      afterSummary: { version: intake.version },
    });
    return intake;
  }

  private async throwUpdateFailure(userId: string, id: string, expectedVersion: number) {
    const current = await this.prisma.purchaseIntake.findFirst({
      where: { id, userId },
      select: { status: true, version: true },
    });
    if (!current) throw new NotFoundException('Purchase intake not found');
    if (current.status !== PurchaseIntakeStatus.DRAFT) {
      throw new ConflictException(`Purchase intake is ${current.status.toLowerCase()}`);
    }
    throw new ConflictException(
      `Purchase intake version conflict: expected ${expectedVersion}, current ${current.version}`,
    );
  }
}

function presentIntake(intake: IntakeWithRelations) {
  return {
    id: intake.id,
    status: intake.status,
    currentStep: intake.currentStep,
    schemaVersion: intake.schemaVersion,
    version: intake.version,
    draftData: intake.draftData,
    completedPurchaseId: intake.purchase?.id ?? null,
    completedAt: intake.completedAt,
    cancelledAt: intake.cancelledAt,
    createdAt: intake.createdAt,
    updatedAt: intake.updatedAt,
    attachments: intake.attachments.map(presentAttachment),
  };
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
