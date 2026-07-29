import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import {
  completedIntakeForDraft,
  continueFinalizeOrRecover,
  evictCompletedIntakeQueries,
  recoveredPurchaseResult,
} from '../src/screens/purchase-intake-recovery.js';

describe('completed purchase intake recovery', () => {
  it('recognizes only a completed intake with the current local draft ID', () => {
    const completed = {
      id: 'purchase-draft-current',
      status: 'COMPLETED' as const,
      completedPurchaseId: 'purchase-42',
    };

    expect(completedIntakeForDraft('purchase-draft-current', completed)).toBe(completed);
    expect(completedIntakeForDraft('purchase-draft-new', completed)).toBeNull();
    expect(
      completedIntakeForDraft('purchase-draft-current', {
        ...completed,
        status: 'DRAFT',
      }),
    ).toBeNull();
  });

  it('returns the committed purchase and skips attachment upload/finalize work', async () => {
    const uploadAndFinalize = vi.fn(async () => ({ id: 'unexpected-duplicate' }));

    const result = await continueFinalizeOrRecover(
      'purchase-draft-current',
      {
        id: 'purchase-draft-current',
        status: 'COMPLETED',
        completedPurchaseId: 'purchase-42',
      },
      uploadAndFinalize,
    );

    expect(uploadAndFinalize).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'purchase-42',
      intakeId: 'purchase-draft-current',
      recoveredFromCompletedIntake: true,
    });
  });

  it('continues normally for a draft and ignores an older completed intake', async () => {
    const finalizeDraft = vi.fn(async () => ({ id: 'purchase-new' }));
    await expect(
      continueFinalizeOrRecover(
        'purchase-draft-current',
        { id: 'purchase-draft-current', status: 'DRAFT' },
        finalizeDraft,
      ),
    ).resolves.toEqual({ id: 'purchase-new' });
    expect(finalizeDraft).toHaveBeenCalledOnce();

    const finalizeNewDraft = vi.fn(async () => ({ id: 'purchase-newer' }));
    await expect(
      continueFinalizeOrRecover(
        'purchase-draft-current',
        {
          id: 'purchase-draft-old',
          status: 'COMPLETED',
          completedPurchaseId: 'purchase-old',
        },
        finalizeNewDraft,
      ),
    ).resolves.toEqual({ id: 'purchase-newer' });
    expect(finalizeNewDraft).toHaveBeenCalledOnce();
  });

  it('falls back to the intake ID when an older server omits completedPurchaseId', () => {
    expect(recoveredPurchaseResult({ id: 'purchase-draft-current', status: 'COMPLETED' })).toEqual({
      id: 'purchase-draft-current',
      intakeId: 'purchase-draft-current',
      recoveredFromCompletedIntake: true,
    });
  });

  it('evicts a completed intake from exact and DRAFT-list caches before navigation', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['purchase-intake', 'purchase-draft-current'], {
      id: 'purchase-draft-current',
      status: 'DRAFT',
    });
    queryClient.setQueryData(
      ['purchase-intakes', 'DRAFT'],
      [
        { id: 'purchase-draft-current', status: 'DRAFT' },
        { id: 'purchase-draft-other', status: 'DRAFT' },
      ],
    );

    evictCompletedIntakeQueries(queryClient, 'purchase-draft-current');

    expect(queryClient.getQueryData(['purchase-intake', 'purchase-draft-current'])).toBeUndefined();
    expect(queryClient.getQueryData(['purchase-intakes', 'DRAFT'])).toEqual([
      { id: 'purchase-draft-other', status: 'DRAFT' },
    ]);
    queryClient.clear();
  });
});
