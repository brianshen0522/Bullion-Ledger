import { ConflictException } from '@nestjs/common';
import { PurchaseIntakeStatus, type Prisma } from '@prisma/client';

type DraftIntakeLockClient = Pick<Prisma.TransactionClient, 'purchaseIntake'>;

/**
 * Obtains the intake row lock without advancing its optimistic-concurrency
 * version. Every transaction that mutates draft attachments must take this
 * lock before touching attachment rows, so finalization can close the intake
 * without a late upload or metadata write escaping its attachment snapshot.
 */
export async function tryLockDraftIntake(
  tx: DraftIntakeLockClient,
  intakeId: string,
  userId: string,
): Promise<boolean> {
  const locked = await tx.purchaseIntake.updateMany({
    where: {
      id: intakeId,
      userId,
      status: PurchaseIntakeStatus.DRAFT,
    },
    data: { version: { increment: 0 } },
  });
  return locked.count === 1;
}

export async function lockDraftIntake(
  tx: DraftIntakeLockClient,
  intakeId: string,
  userId: string,
): Promise<void> {
  if (!(await tryLockDraftIntake(tx, intakeId, userId))) {
    throw new ConflictException('Purchase intake is no longer a mutable draft');
  }
}
