import type { QueryClient } from '@tanstack/react-query';

export interface RecoverablePurchaseIntake {
  id: string;
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  completedPurchaseId?: string | null;
}

export interface RecoveredPurchaseResult {
  id: string;
  intakeId: string;
  recoveredFromCompletedIntake: true;
}

/**
 * Completion recovery is deliberately scoped to the browser's current draft ID.
 * This prevents an unrelated, older completed intake from dismissing a new wizard.
 */
export function completedIntakeForDraft<T extends RecoverablePurchaseIntake>(
  draftId: string | null | undefined,
  intake: T | null | undefined,
): T | null {
  if (!draftId || !intake || intake.id !== draftId || intake.status !== 'COMPLETED') return null;
  return intake;
}

export function recoveredPurchaseResult(
  intake: RecoverablePurchaseIntake,
): RecoveredPurchaseResult {
  return {
    id: intake.completedPurchaseId ?? intake.id,
    intakeId: intake.id,
    recoveredFromCompletedIntake: true,
  };
}

/** Runs the upload/finalize path only when the synchronized intake is still a draft. */
export async function continueFinalizeOrRecover<T>(
  draftId: string,
  intake: RecoverablePurchaseIntake | null | undefined,
  continueFinalize: () => Promise<T>,
): Promise<T | RecoveredPurchaseResult> {
  const completed = completedIntakeForDraft(draftId, intake);
  return completed ? recoveredPurchaseResult(completed) : continueFinalize();
}

/**
 * Removes a completed intake from both React Query cache shapes before leaving
 * the wizard. A plain invalidation can expose the old DRAFT value long enough
 * for the next wizard mount to hydrate it as a live draft.
 */
export function evictCompletedIntakeQueries(queryClient: QueryClient, draftId: string): void {
  queryClient.removeQueries({ queryKey: ['purchase-intake', draftId], exact: true });
  queryClient.setQueryData<RecoverablePurchaseIntake[]>(['purchase-intakes', 'DRAFT'], (drafts) =>
    drafts?.filter(({ id }) => id !== draftId),
  );
}
