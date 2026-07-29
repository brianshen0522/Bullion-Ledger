import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.module.js';

export interface AuditContext {
  userId?: string | null;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditInput {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  beforeSummary?: unknown;
  afterSummary?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  result?: 'success' | 'failure';
}

/**
 * Append-only audit trail. PRD §25. Never logs password / passkey / token
 * values — callers must sanitize before passing summary objects.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.write(this.prisma, input);
    } catch (e) {
      // Audit must never break a request path; log and continue.
      this.logger.error(`Failed to write audit log: ${(e as Error).message}`);
    }
  }

  /**
   * Write through the caller's transaction. Errors intentionally propagate so
   * the protected mutation and its audit record either both commit or both
   * roll back.
   */
  async recordInTransaction(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
    await this.write(tx, input);
  }

  private async write(
    client: Pick<Prisma.TransactionClient, 'auditLog'>,
    input: AuditInput,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        beforeSummary:
          input.beforeSummary === undefined ? undefined : (input.beforeSummary as object),
        afterSummary: input.afterSummary === undefined ? undefined : (input.afterSummary as object),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        sessionId: input.sessionId ?? null,
        result: input.result ?? 'success',
      },
    });
  }
}
